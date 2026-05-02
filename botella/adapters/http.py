"""HTTP adapter for the mobile transport.

For v0 streaming uses request-collection: the client POSTs a message, the
server runs the dispatcher to completion, returns all events in one JSON
response. WebSocket streaming is added in a later adapter.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from botella import runtime
from botella.auth.routes import current_user_id
from botella.contract import BotManifest, InboundMessage


class MessageRequest(BaseModel):
    text: str | None = Field(default=None, max_length=8000)
    callback_data: str | None = Field(default=None, max_length=512)
    transport: Literal["ios", "android", "test"] = "ios"


class EventDTO(BaseModel):
    type: str
    payload: dict[str, Any]


class MessageResponse(BaseModel):
    events: list[EventDTO]


def build_http_router(manifest: BotManifest) -> APIRouter:
    router = APIRouter(prefix="/v1", tags=["messages"])

    @router.post("/messages", response_model=MessageResponse)
    async def post_message(
        body: MessageRequest,
        user_id: str = Depends(current_user_id),
    ) -> MessageResponse:
        msg = InboundMessage(
            user_id=user_id,
            transport=body.transport,
            text=body.text,
            callback_data=body.callback_data,
        )
        events: list[EventDTO] = []
        async for event in runtime.run(msg, manifest):
            # Strip raw bytes from media payloads for HTTP — adapters that
            # need to ship binary should use multipart or a separate endpoint.
            payload = dict(event.payload)
            if "image" in payload and isinstance(payload["image"], (bytes, bytearray)):
                payload["image"] = "<binary>"
            events.append(EventDTO(type=event.type, payload=payload))
        return MessageResponse(events=events)

    return router
