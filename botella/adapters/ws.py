"""WebSocket adapter — token-by-token streaming for the mobile transport.

Wire shape:

  Client → POST /v1/auth/anonymous → JWT
  Client → WSS /v1/stream?token=<jwt>
  Client → {"text": "hi", "transport": "ios"}              [JSON frame]
  Server → {"type": "typing", "payload": {}}                [JSON frame]
  Server → {"type": "token",  "payload": {"text": "h"}}     [...as they stream]
  Server → {"type": "complete", "payload": {"text": "hi"}}  [end of one turn]
  Client → {"text": "next message"} ...                     [next turn, same socket]

One socket per connected user. The dispatcher runs once per inbound frame; all
events for that turn stream out before the next inbound frame is processed.

If a single state takes a long time (chart computation + Claude calls can
total 30-40s), no frames flow during that window and proxies / mobile
networks happily drop the idle socket. The keep-alive wrapper below
injects a typing frame every IDLE_KEEPALIVE seconds while the runtime is
busy, so the proxy sees traffic and the socket survives.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncIterator

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from botella import runtime
from botella.auth.jwt import JWTError, verify_jwt
from botella.contract import BotManifest, InboundMessage, OutboundEvent

log = logging.getLogger(__name__)

# Send a no-op `typing` frame every N seconds while the runtime is busy.
# Has to be well under the tightest idle timeout in any link of the chain
# (Istio/Envoy default is 1h; mobile carriers and Cloudflare can be as
# low as 30s). 8s gives us plenty of margin without flooding the line.
IDLE_KEEPALIVE = 8.0


def build_ws_router(manifest: BotManifest) -> APIRouter:
    router = APIRouter(prefix="/v1", tags=["stream"])

    @router.websocket("/stream")
    async def stream(ws: WebSocket, token: str = Query(...)) -> None:
        # Authenticate before accepting the socket.
        try:
            claims = verify_jwt(token)
            user_id = claims["sub"]
        except (JWTError, KeyError):
            await ws.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        await ws.accept()

        # ─── Auto-resume on connect (mid-flow users only) ──────────────
        # When an existing session is mid-flow, synthesize an internal
        # /start so the trigger's resume gates fire (re-emit current
        # section / rerun LLM / Stay / etc.). This means an iOS app that
        # reconnects after a network blip or after being backgrounded
        # sees its current state without depending on the client's
        # one-shot auto-/start logic firing again.
        #
        # For fresh users (no session.flow yet) we skip this — the iOS
        # client's first /start will drive normal onboarding entry, and
        # tests that expect their first ws.send_json to be the only
        # /start in flight don't get a surprise event from us.
        try:
            existing = await manifest.storage.load_session(user_id)
            if existing.flow is not None:
                resume_msg = InboundMessage(
                    user_id=user_id,
                    transport="ws_resume",
                    text="/start",
                    callback_data=None,
                    voice_origin=False,
                )
                async for event in _with_keepalive(runtime.run(resume_msg, manifest)):
                    payload = _scrub(event.payload)
                    await ws.send_json({"type": event.type, "payload": payload})
                await ws.send_json({"type": "turn_end", "payload": {}})
        except WebSocketDisconnect:
            return
        except Exception:
            log.exception("ws auto-resume error")
            # Don't close — let the user proceed with their first real
            # message even if the resume push had a hiccup.

        try:
            while True:
                raw = await ws.receive_text()
                try:
                    body = json.loads(raw)
                except json.JSONDecodeError:
                    await ws.send_json({"type": "error", "payload": {"message": "bad json"}})
                    continue

                msg = InboundMessage(
                    user_id=user_id,
                    transport=body.get("transport", "ios"),
                    text=body.get("text"),
                    callback_data=body.get("callback_data"),
                    voice_origin=bool(body.get("voice_origin", False)),
                )

                async for event in _with_keepalive(runtime.run(msg, manifest)):
                    payload = _scrub(event.payload)
                    await ws.send_json({"type": event.type, "payload": payload})

                # Sentinel so the client knows this turn is done.
                await ws.send_json({"type": "turn_end", "payload": {}})

        except WebSocketDisconnect:
            return
        except Exception:
            log.exception("ws stream error")
            try:
                await ws.close(code=status.WS_1011_INTERNAL_ERROR)
            except Exception:
                pass

    return router


async def _with_keepalive(
    source: AsyncIterator[OutboundEvent],
) -> AsyncIterator[OutboundEvent]:
    """Pass events from `source` straight through, but inject a `typing`
    frame every IDLE_KEEPALIVE seconds when the runtime is silent. The
    iOS client treats consecutive typing events as one (already-on dots
    just stay on), so callers see no visible change — proxies do, and
    don't drop the socket during a slow chart build."""
    queue: asyncio.Queue = asyncio.Queue()
    DONE: object = object()
    FAIL: object = object()

    async def _drain() -> None:
        try:
            async for ev in source:
                await queue.put(ev)
        except Exception as e:
            await queue.put((FAIL, e))
        finally:
            await queue.put(DONE)

    task = asyncio.create_task(_drain())
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=IDLE_KEEPALIVE)
            except asyncio.TimeoutError:
                yield OutboundEvent(type="typing", payload={})
                continue
            if item is DONE:
                return
            if isinstance(item, tuple) and item and item[0] is FAIL:
                raise item[1]
            yield item
    finally:
        if not task.done():
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass


def _scrub(payload: dict[str, Any]) -> dict[str, Any]:
    """Encode raw image bytes as a base64 data URL — JSON can't carry them
    natively, but a data URL drops straight into an <img src=...>."""
    out = dict(payload)
    img = out.get("image")
    if isinstance(img, (bytes, bytearray)):
        import base64
        b64 = base64.b64encode(bytes(img)).decode("ascii")
        out["image"] = None
        out["image_data_url"] = f"data:image/png;base64,{b64}"
    return out
