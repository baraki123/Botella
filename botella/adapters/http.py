"""HTTP adapter for the mobile transport.

For v0 streaming uses request-collection: the client POSTs a message, the
server runs the dispatcher to completion, returns all events in one JSON
response. WebSocket streaming is added in a later adapter.

Also exposes /v1/voice — a transcription-only endpoint that runs the
manifest's voice_handler against an uploaded audio blob and returns the
transcript. The mobile shell then sends the transcript over its existing
WS as a regular text message, so the streaming reply path stays unchanged.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from botella import runtime
from botella.auth.routes import current_user_id
from botella.contract import BotManifest, InboundMessage


class MessageRequest(BaseModel):
    text: str | None = Field(default=None, max_length=8000)
    callback_data: str | None = Field(default=None, max_length=512)
    transport: Literal["ios", "android", "test"] = "ios"
    voice_origin: bool = False


class EventDTO(BaseModel):
    type: str
    payload: dict[str, Any]


class MessageResponse(BaseModel):
    events: list[EventDTO]


class VoiceResponse(BaseModel):
    text: str


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
            voice_origin=body.voice_origin,
        )
        events: list[EventDTO] = []
        async for event in runtime.run(msg, manifest):
            # Encode raw image bytes as a base64 data URL — JSON-friendly,
            # drops straight into an <img src=…> on the client side.
            payload = dict(event.payload)
            img = payload.get("image")
            if isinstance(img, (bytes, bytearray)):
                import base64
                b64 = base64.b64encode(bytes(img)).decode("ascii")
                payload["image"] = None
                payload["image_data_url"] = f"data:image/png;base64,{b64}"
            events.append(EventDTO(type=event.type, payload=payload))
        return MessageResponse(events=events)

    @router.post("/voice", response_model=VoiceResponse)
    async def post_voice(
        audio: UploadFile = File(..., description="audio blob (m4a/webm/ogg/wav)"),
        user_id: str = Depends(current_user_id),
    ) -> VoiceResponse:
        """Transcribe an uploaded audio blob via the manifest's voice_handler
        and return the transcript. Caller sends the transcript over WS as a
        normal text message so the dispatcher path stays in one place.
        """
        if manifest.voice_handler is None:
            raise HTTPException(
                status_code=501,
                detail="voice transcription not configured on this bot",
            )
        body = await audio.read()
        if not body:
            raise HTTPException(status_code=400, detail="empty audio body")

        msg = InboundMessage(
            user_id=user_id,
            transport="ios",
            voice_audio=body,
        )
        session = await manifest.storage.load_session(user_id)
        msg = await manifest.voice_handler(msg, session, manifest.storage)
        return VoiceResponse(text=msg.text or "")

    return router
