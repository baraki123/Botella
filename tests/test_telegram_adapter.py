"""Telegram adapter tests.

Skips PTB's Application internals — exercises the rendering logic and the
public `drive_inbound()` path against a FakeBot that records every call.
End-to-end coverage of the toy bot via the Telegram transport.
"""

from __future__ import annotations

import pytest

from botella.adapters.telegram import (
    TokenBuffer,
    drive_inbound,
    render_event,
)
from botella.contract import OutboundEvent
from examples.echo_bot.manifest import build_manifest


# ─── FakeBot ─────────────────────────────────────────────────────────────────


class FakeBot:
    def __init__(self) -> None:
        self.messages: list[dict] = []
        self.actions: list[dict] = []
        self.photos: list[dict] = []

    async def send_message(self, *, chat_id, text, reply_markup=None, parse_mode=None):
        self.messages.append(
            {
                "chat_id": chat_id,
                "text": text,
                "reply_markup": reply_markup,
                "parse_mode": parse_mode,
            }
        )

    async def send_chat_action(self, *, chat_id, action):
        self.actions.append({"chat_id": chat_id, "action": action})

    async def send_photo(self, *, chat_id, photo, caption=""):
        self.photos.append({"chat_id": chat_id, "photo": photo, "caption": caption})


def _texts(bot: FakeBot) -> list[str]:
    return [m["text"] for m in bot.messages]


# ─── render_event unit tests ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_text_event_sends_html_message():
    bot = FakeBot()
    buf = TokenBuffer()
    await render_event(OutboundEvent("text", {"text": "hi"}), 99, bot, buf)
    assert _texts(bot) == ["hi"]
    assert bot.messages[0]["parse_mode"] == "HTML"


@pytest.mark.asyncio
async def test_typing_event_sends_chat_action():
    bot = FakeBot()
    await render_event(OutboundEvent("typing", {}), 99, bot, TokenBuffer())
    assert bot.actions == [{"chat_id": 99, "action": "typing"}]
    assert bot.messages == []


@pytest.mark.asyncio
async def test_token_buffers_and_complete_flushes_as_one_message():
    bot = FakeBot()
    buf = TokenBuffer()
    for ch in "hello":
        await render_event(OutboundEvent("token", {"text": ch}), 99, bot, buf)
    assert bot.messages == []  # nothing sent yet
    await render_event(OutboundEvent("complete", {"text": ""}), 99, bot, buf)
    assert _texts(bot) == ["hello"]


@pytest.mark.asyncio
async def test_complete_with_text_when_no_tokens_streamed():
    bot = FakeBot()
    buf = TokenBuffer()
    await render_event(OutboundEvent("complete", {"text": "done"}), 99, bot, buf)
    assert _texts(bot) == ["done"]


@pytest.mark.asyncio
async def test_complete_with_text_ignored_when_tokens_were_streamed():
    """Tokens win — complete.text is the source-of-truth only when nothing streamed."""
    bot = FakeBot()
    buf = TokenBuffer()
    for ch in "abc":
        await render_event(OutboundEvent("token", {"text": ch}), 99, bot, buf)
    await render_event(OutboundEvent("complete", {"text": "abc"}), 99, bot, buf)
    assert _texts(bot) == ["abc"]  # exactly one send, not duplicated


@pytest.mark.asyncio
async def test_text_mid_stream_flushes_buffer_first():
    """If a `text` event arrives mid-stream, buffered tokens flush first so order is preserved."""
    bot = FakeBot()
    buf = TokenBuffer()
    for ch in "ab":
        await render_event(OutboundEvent("token", {"text": ch}), 99, bot, buf)
    await render_event(OutboundEvent("text", {"text": "MID"}), 99, bot, buf)
    for ch in "cd":
        await render_event(OutboundEvent("token", {"text": ch}), 99, bot, buf)
    await render_event(OutboundEvent("complete", {"text": ""}), 99, bot, buf)
    assert _texts(bot) == ["ab", "MID", "cd"]


@pytest.mark.asyncio
async def test_quick_replies_renders_inline_keyboard():
    from telegram import InlineKeyboardMarkup

    bot = FakeBot()
    await render_event(
        OutboundEvent(
            "quick_replies", {"options": ["yes", "no"], "prompt": "pick"}
        ),
        99,
        bot,
        TokenBuffer(),
    )
    assert _texts(bot) == ["pick"]
    kb = bot.messages[0]["reply_markup"]
    assert isinstance(kb, InlineKeyboardMarkup)
    rows = kb.inline_keyboard
    labels = [btn.text for btn in rows[0]]
    callbacks = [btn.callback_data for btn in rows[0]]
    assert labels == ["yes", "no"]
    assert callbacks == ["yes", "no"]


@pytest.mark.asyncio
async def test_media_with_bytes_sends_photo():
    bot = FakeBot()
    await render_event(
        OutboundEvent(
            "media", {"image": b"PNG_BYTES", "image_url": None, "caption": "look"}
        ),
        99,
        bot,
        TokenBuffer(),
    )
    assert bot.photos == [{"chat_id": 99, "photo": b"PNG_BYTES", "caption": "look"}]


# ─── End-to-end through the toy bot ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_e2e_full_intro_flow_via_telegram():
    manifest = build_manifest()
    bot = FakeBot()
    chat_id = 1001
    tg_user = 555

    # /start → trigger emits nothing; intro/ask_name prompts.
    await drive_inbound(
        manifest=manifest, bot=bot, chat_id=chat_id,
        telegram_user_id=tg_user, text="/start",
    )
    assert _texts(bot) == ["What's your name?"]
    bot.messages.clear()

    # Reply with name → got_name (Goto) → ask_color. Two messages: the
    # acknowledgement, then the quick_replies prompt with inline keyboard.
    await drive_inbound(
        manifest=manifest, bot=bot, chat_id=chat_id,
        telegram_user_id=tg_user, text="Barak",
    )
    assert _texts(bot) == [
        "Nice to meet you, Barak.",
        "What's your favorite color?",
    ]
    assert bot.messages[0]["reply_markup"] is None
    assert bot.messages[1]["reply_markup"] is not None  # inline keyboard
    bot.messages.clear()

    # Empty reply → Stay
    await drive_inbound(
        manifest=manifest, bot=bot, chat_id=chat_id,
        telegram_user_id=tg_user, text="",
    )
    assert _texts(bot) == ["Pick one:"]
    bot.messages.clear()

    # Color → Done(carry=...)
    await drive_inbound(
        manifest=manifest, bot=bot, chat_id=chat_id,
        telegram_user_id=tg_user, text="blue",
    )
    assert _texts(bot) == ["Got it — Barak likes blue. We're done."]
    bot.messages.clear()

    # Free chat — pure streaming. Telegram should see ONE message after token flush.
    await drive_inbound(
        manifest=manifest, bot=bot, chat_id=chat_id,
        telegram_user_id=tg_user, text="hello again",
    )
    assert _texts(bot) == ["echo to Barak (blue): hello again"]
    # And a typing action was sent before the message.
    assert bot.actions == [{"chat_id": chat_id, "action": "typing"}]


@pytest.mark.asyncio
async def test_e2e_callback_data_routes_to_trigger():
    """A callback-query payload of "/reset" should hit the /reset trigger.
    (The toy bot's quick_replies use values that match trigger keys, exercising
    the same code path used by inline-button taps.)"""
    manifest = build_manifest()
    bot = FakeBot()
    chat_id = 2002
    tg_user = 777

    # Begin the flow so /reset has something to clear.
    await drive_inbound(
        manifest=manifest, bot=bot, chat_id=chat_id,
        telegram_user_id=tg_user, text="/start",
    )
    bot.messages.clear()

    # Simulate inline-button tap with callback_data="/reset". The runtime's
    # trigger matcher checks command-style text first; callback_data with
    # "callback:..." key would also work. Here we test the text path via a
    # callback_data that exactly matches a slash command.
    await drive_inbound(
        manifest=manifest, bot=bot, chat_id=chat_id,
        telegram_user_id=tg_user, text="/reset",
    )
    assert _texts(bot) == ["Reset."]


@pytest.mark.asyncio
async def test_e2e_two_telegram_users_get_separate_state():
    manifest = build_manifest()
    bot = FakeBot()

    await drive_inbound(
        manifest=manifest, bot=bot, chat_id=1, telegram_user_id=100, text="/start"
    )
    await drive_inbound(
        manifest=manifest, bot=bot, chat_id=1, telegram_user_id=100, text="Alice"
    )
    await drive_inbound(
        manifest=manifest, bot=bot, chat_id=1, telegram_user_id=100, text="red"
    )

    bot.messages.clear()
    await drive_inbound(
        manifest=manifest, bot=bot, chat_id=2, telegram_user_id=200, text="/start"
    )
    # User 200 is fresh — should hit the intro flow, not the welcome-back path.
    assert _texts(bot) == ["What's your name?"]


@pytest.mark.asyncio
async def test_e2e_telegram_identity_is_per_user_not_per_chat():
    """Same telegram user ID across two different chats should resolve to the
    same internal user_id and share state."""
    manifest = build_manifest()
    bot = FakeBot()

    # Chat A
    await drive_inbound(
        manifest=manifest, bot=bot, chat_id=10, telegram_user_id=42, text="/start"
    )
    await drive_inbound(
        manifest=manifest, bot=bot, chat_id=10, telegram_user_id=42, text="Mira"
    )
    await drive_inbound(
        manifest=manifest, bot=bot, chat_id=10, telegram_user_id=42, text="green"
    )

    bot.messages.clear()
    # Same user, different chat — should be recognized as returning.
    await drive_inbound(
        manifest=manifest, bot=bot, chat_id=99, telegram_user_id=42, text="/start"
    )
    assert _texts(bot) == ["Welcome back, Mira."]
