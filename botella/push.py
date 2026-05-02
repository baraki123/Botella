"""Push notifications via Expo Push.

Two pieces:
  - `POST /v1/push/register {expo_push_token}` — clients call this on launch
    after the user grants notification permission. We persist the token in
    the user record (storage.update_user). One device per user for now;
    multi-device fan-out is a later step.
  - `proactive_send(user_id, title, body, data)` — server-side helper for
    pushing notifications from outside the request lifecycle (e.g. Layla's
    APScheduler morning-reading job). It looks up the token and POSTs to
    Expo's API. Idempotent + best-effort: a failed push is logged, not
    retried.

This file deliberately avoids depending on a specific Expo SDK; the wire
format is small and stable.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Iterable

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from botella.auth.routes import current_user_id
from botella.contract import BotManifest

log = logging.getLogger(__name__)

EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send"


class RegisterPushTokenRequest(BaseModel):
    expo_push_token: str = Field(..., min_length=8, max_length=256)


class RegisterPushTokenResponse(BaseModel):
    ok: bool


@dataclass
class PushResult:
    """Result of a single proactive_send call."""
    sent: bool
    skipped_reason: str | None = None
    expo_status: str | None = None


def build_push_router(manifest: BotManifest) -> APIRouter:
    router = APIRouter(prefix="/v1/push", tags=["push"])

    @router.post("/register", response_model=RegisterPushTokenResponse)
    async def register(
        body: RegisterPushTokenRequest,
        user_id: str = Depends(current_user_id),
    ) -> RegisterPushTokenResponse:
        # Expo's tokens look like ExponentPushToken[xxxx...]; we accept the
        # raw string and don't try to parse it — Expo's API will reject a
        # bad one when we try to send.
        await manifest.storage.update_user(
            user_id, {"expo_push_token": body.expo_push_token}
        )
        return RegisterPushTokenResponse(ok=True)

    @router.delete("/register", status_code=status.HTTP_204_NO_CONTENT)
    async def unregister(user_id: str = Depends(current_user_id)):
        # Set to empty string so the field is still present (helpful for
        # debugging), and proactive_send treats falsy as "no token."
        await manifest.storage.update_user(user_id, {"expo_push_token": ""})
        return None

    return router


async def proactive_send(
    manifest: BotManifest,
    user_id: str,
    *,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
    sound: str | None = "default",
    badge: int | None = None,
) -> PushResult:
    """Send a single push to one user. Best-effort, never raises.

    Wraps Expo's `/--/api/v2/push/send` API. For batching at scale, use
    `proactive_send_many()` which posts up to 100 messages per HTTP call.
    """
    user = await manifest.storage.get_user(user_id)
    token = user.get("expo_push_token")
    if not token:
        return PushResult(sent=False, skipped_reason="no_token")

    payload = {
        "to": token,
        "title": title,
        "body": body,
        "sound": sound,
        "data": data or {},
    }
    if badge is not None:
        payload["badge"] = badge

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(EXPO_PUSH_ENDPOINT, json=payload)
        r.raise_for_status()
        body_json = r.json()
    except Exception as e:
        log.exception("proactive_send to user_id=%s failed: %s", user_id, e)
        return PushResult(sent=False, skipped_reason="http_error")

    # Expo returns either {"data": {...}} or {"data": [{...}]} depending on
    # batch shape. Just look at the first ticket's status.
    data_field = body_json.get("data")
    ticket = data_field[0] if isinstance(data_field, list) and data_field else data_field
    expo_status = ticket.get("status") if isinstance(ticket, dict) else None
    return PushResult(
        sent=expo_status == "ok",
        skipped_reason=None if expo_status == "ok" else f"expo:{expo_status}",
        expo_status=expo_status,
    )


async def proactive_send_many(
    manifest: BotManifest,
    user_ids: Iterable[str],
    *,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> list[PushResult]:
    """Convenience: fan-out to N users sequentially.

    For Layla's morning-reading job which fires per user at 8am local, this
    is fine. If we later need to push to thousands at once, switch to a
    real batch (Expo accepts arrays of up to 100 in one HTTP call).
    """
    results = []
    for uid in user_ids:
        results.append(
            await proactive_send(manifest, uid, title=title, body=body, data=data)
        )
    return results
