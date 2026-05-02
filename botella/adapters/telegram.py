"""Telegram adapter — wraps python-telegram-bot so the same BotManifest serves Telegram.

Two integration shapes:

  1. Polling (local dev):
       app = build_telegram_application(manifest, token=BOT_TOKEN)
       app.run_polling()

  2. Webhook (production, mounted in FastAPI):
       app = create_app(manifest)
       setup_telegram_webhook(app, manifest, token=..., webhook_url=..., secret_token=...)

Telegram does not support token-by-token streaming; this adapter buffers `token`
events and flushes them on `complete` (or on any non-token event that arrives
mid-stream, so message order is preserved).

Identity: every Telegram update resolves to an internal user_id via
storage.resolve_identity("telegram", str(telegram_user_id)). Group chats and
channels are NOT supported (the resolver uses effective_user, not chat).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request, status
from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    Update,
)
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from botella import runtime
from botella.contract import BotManifest, InboundMessage, OutboundEvent

log = logging.getLogger(__name__)


# ─── Public API ──────────────────────────────────────────────────────────────


def build_telegram_application(manifest: BotManifest, token: str) -> Application:
    """Build a PTB Application wired to a manifest. Use .run_polling() locally."""
    application = ApplicationBuilder().token(token).build()
    _register_handlers(application, manifest)
    return application


def setup_telegram_webhook(
    app: FastAPI,
    manifest: BotManifest,
    *,
    token: str,
    webhook_url: str | None = None,
    secret_token: str | None = None,
    path: str = "/webhooks/telegram",
) -> Application:
    """Mount a webhook receiver on the given FastAPI app.

    If `webhook_url` is given, the webhook is registered with Telegram on
    startup. `secret_token`, if given, is sent by Telegram as the
    X-Telegram-Bot-Api-Secret-Token header on every webhook call and
    enforced here.
    """
    application = build_telegram_application(manifest, token)

    async def _startup() -> None:
        await application.initialize()
        if webhook_url:
            await application.bot.set_webhook(
                url=webhook_url, secret_token=secret_token
            )
        await application.start()

    async def _shutdown() -> None:
        await application.stop()
        await application.shutdown()

    # Starlette 1.0 dropped `add_event_handler` from the FastAPI app object;
    # the underlying router still has it (and so do older versions). Routing
    # through .router keeps us compatible with both.
    app.router.add_event_handler("startup", _startup)
    app.router.add_event_handler("shutdown", _shutdown)

    @app.post(path)
    async def _webhook(request: Request) -> dict:
        if secret_token:
            sent = request.headers.get("X-Telegram-Bot-Api-Secret-Token")
            if sent != secret_token:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="bad secret token",
                )
        body = await request.json()
        update = Update.de_json(body, application.bot)
        await application.process_update(update)
        return {"ok": True}

    return application


# ─── Handler wiring ──────────────────────────────────────────────────────────


def _register_handlers(application: Application, manifest: BotManifest) -> None:
    # Commands first — every "/foo" trigger key gets a CommandHandler.
    seen_commands: set[str] = set()
    for trigger_key in manifest.triggers:
        if not trigger_key.startswith("/"):
            continue
        cmd = trigger_key[1:].split()[0]
        if cmd in seen_commands:
            continue
        seen_commands.add(cmd)
        application.add_handler(
            CommandHandler(cmd, _make_command_handler(manifest, trigger_key))
        )

    # Plain text (non-command).
    application.add_handler(
        MessageHandler(filters.TEXT & ~filters.COMMAND, _make_text_handler(manifest))
    )

    # Voice.
    application.add_handler(
        MessageHandler(filters.VOICE, _make_voice_handler(manifest))
    )

    # Inline keyboard taps.
    application.add_handler(CallbackQueryHandler(_make_callback_handler(manifest)))


def _make_text_handler(manifest: BotManifest):
    async def handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        await _drive_inbound(
            manifest=manifest,
            bot=context.bot,
            chat_id=update.effective_chat.id,
            telegram_user_id=update.effective_user.id,
            text=update.message.text,
        )

    return handler


def _make_command_handler(manifest: BotManifest, trigger_key: str):
    async def handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        # Pass the full trigger key (e.g. "/start") so runtime._match_trigger
        # routes it identically to a plain-text "/start".
        await _drive_inbound(
            manifest=manifest,
            bot=context.bot,
            chat_id=update.effective_chat.id,
            telegram_user_id=update.effective_user.id,
            text=trigger_key,
        )

    return handler


def _make_voice_handler(manifest: BotManifest):
    async def handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        file = await update.message.voice.get_file()
        audio = bytes(await file.download_as_bytearray())
        await _drive_inbound(
            manifest=manifest,
            bot=context.bot,
            chat_id=update.effective_chat.id,
            telegram_user_id=update.effective_user.id,
            voice_audio=audio,
        )

    return handler


def _make_callback_handler(manifest: BotManifest):
    async def handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
        query = update.callback_query
        await query.answer()
        await _drive_inbound(
            manifest=manifest,
            bot=context.bot,
            chat_id=query.message.chat_id,
            telegram_user_id=update.effective_user.id,
            callback_data=query.data,
        )

    return handler


# ─── Core inbound driver — testable without PTB internals ────────────────────


class TokenBuffer:
    """Tracks streamed tokens within one render-pass.

    `ever_added` lets the `complete` handler distinguish:
      - tokens streamed → take buffer as the message, ignore complete.text
      - no tokens       → use complete.text as the message
    """

    def __init__(self) -> None:
        self._tokens: list[str] = []
        self.ever_added: bool = False

    def add(self, s: str) -> None:
        self._tokens.append(s)
        self.ever_added = True

    def take(self) -> str:
        out = "".join(self._tokens)
        self._tokens.clear()
        return out


async def drive_inbound(
    *,
    manifest: BotManifest,
    bot,
    chat_id: int,
    telegram_user_id: int,
    text: str | None = None,
    callback_data: str | None = None,
    voice_audio: bytes | None = None,
) -> None:
    """Public entrypoint for tests + handlers. Resolves identity, runs the
    dispatcher, renders events to Telegram via `bot`."""
    user_id = await manifest.storage.resolve_identity(
        "telegram", str(telegram_user_id)
    )
    msg = InboundMessage(
        user_id=user_id,
        transport="telegram",
        text=text,
        callback_data=callback_data,
        voice_audio=voice_audio,
    )
    buffer = TokenBuffer()
    async for event in runtime.run(msg, manifest):
        await render_event(event, chat_id, bot, buffer)
    # Final flush in case the stream ended without a complete event.
    pending = buffer.take()
    if pending:
        await _safe_send(bot, chat_id, pending)


_drive_inbound = drive_inbound  # internal alias used by handlers above


async def render_event(
    event: OutboundEvent,
    chat_id: int,
    bot,
    buffer: TokenBuffer,
) -> None:
    """Render one OutboundEvent to Telegram. Buffers `token` events; flushes
    the buffer before any non-token event so message ordering is preserved."""
    if event.type == "typing":
        try:
            await bot.send_chat_action(chat_id=chat_id, action="typing")
        except Exception:
            log.exception("send_chat_action failed")
        return

    if event.type == "token":
        buffer.add(event.payload.get("text", ""))
        return

    # Non-token events: flush any pending streamed tokens first.
    pending = buffer.take()
    if pending:
        await _safe_send(bot, chat_id, pending)

    if event.type == "text":
        await _safe_send(bot, chat_id, event.payload["text"])
        return

    if event.type == "complete":
        full = event.payload.get("text", "")
        # If tokens were streamed, they were just flushed above — ignore
        # complete.text. If nothing was streamed, use complete.text.
        if full and not buffer.ever_added:
            await _safe_send(bot, chat_id, full)
        return

    if event.type == "quick_replies":
        options = event.payload.get("options", [])
        prompt = event.payload.get("prompt") or " "
        keyboard = InlineKeyboardMarkup(
            [[InlineKeyboardButton(text=opt, callback_data=opt) for opt in options]]
        )
        try:
            await bot.send_message(
                chat_id=chat_id,
                text=prompt,
                reply_markup=keyboard,
                parse_mode="HTML",
            )
        except Exception:
            log.exception("send_message (quick_replies) failed")
        return

    if event.type == "media":
        payload = event.payload
        photo = payload.get("image") or payload.get("image_url")
        if photo is None:
            return
        try:
            await bot.send_photo(
                chat_id=chat_id, photo=photo, caption=payload.get("caption", "")
            )
        except Exception:
            log.exception("send_photo failed")
        return

    log.warning("unknown OutboundEvent type: %r", event.type)


# ─── helpers ─────────────────────────────────────────────────────────────────


async def _safe_send(bot, chat_id: int, text: str) -> None:
    if not text:
        return
    try:
        await bot.send_message(chat_id=chat_id, text=text, parse_mode="HTML")
    except Exception:
        log.exception("send_message failed")
