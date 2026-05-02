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
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status

from botella import runtime
from botella.auth.jwt import JWTError, verify_jwt
from botella.contract import BotManifest, InboundMessage

log = logging.getLogger(__name__)


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
                )

                async for event in runtime.run(msg, manifest):
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


def _scrub(payload: dict[str, Any]) -> dict[str, Any]:
    """Strip raw bytes from media payloads — JSON can't carry them."""
    out = dict(payload)
    if "image" in out and isinstance(out["image"], (bytes, bytearray)):
        out["image"] = "<binary>"
    return out
