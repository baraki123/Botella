"""Push notification scaffold tests.

Verify:
  - POST /v1/push/register stashes the token in the user record
  - DELETE /v1/push/register clears it
  - proactive_send() skips when no token, attempts an Expo POST when present
  - proactive_send() doesn't raise on Expo errors (best-effort)
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from botella import BotManifest, create_app
from botella.push import EXPO_PUSH_ENDPOINT, proactive_send
from botella.storage import MemoryStorage


@pytest.fixture
def app_and_storage():
    storage = MemoryStorage()
    manifest = BotManifest(name="t", storage=storage, flows=[], triggers={})
    return TestClient(create_app(manifest)), storage, manifest


def _auth(client) -> tuple[str, str]:
    r = client.post("/v1/auth/anonymous", json={"device_id": "device-push"})
    body = r.json()
    return body["jwt"], body["user_id"]


def test_register_stashes_token(app_and_storage):
    client, storage, _ = app_and_storage
    jwt, user_id = _auth(client)

    r = client.post(
        "/v1/push/register",
        headers={"Authorization": f"Bearer {jwt}"},
        json={"expo_push_token": "ExponentPushToken[abc123]"},
    )
    assert r.status_code == 200
    assert r.json() == {"ok": True}

    user = asyncio.get_event_loop().run_until_complete(storage.get_user(user_id))
    assert user["expo_push_token"] == "ExponentPushToken[abc123]"


def test_register_requires_auth(app_and_storage):
    client, _, _ = app_and_storage
    r = client.post("/v1/push/register", json={"expo_push_token": "ExponentPushToken[x]"})
    assert r.status_code == 401


def test_unregister_clears_token(app_and_storage):
    client, storage, _ = app_and_storage
    jwt, user_id = _auth(client)
    client.post(
        "/v1/push/register",
        headers={"Authorization": f"Bearer {jwt}"},
        json={"expo_push_token": "ExponentPushToken[abc123]"},
    )
    r = client.delete(
        "/v1/push/register",
        headers={"Authorization": f"Bearer {jwt}"},
    )
    assert r.status_code == 204
    user = asyncio.get_event_loop().run_until_complete(storage.get_user(user_id))
    assert user["expo_push_token"] == ""


# ─── proactive_send ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_proactive_send_skips_when_no_token(app_and_storage):
    _, storage, manifest = app_and_storage
    user_id = await storage.resolve_identity("anonymous", "no-token-user")
    res = await proactive_send(manifest, user_id, title="hi", body="hey")
    assert res.sent is False
    assert res.skipped_reason == "no_token"


@pytest.mark.asyncio
async def test_proactive_send_posts_to_expo(app_and_storage):
    _, storage, manifest = app_and_storage
    user_id = await storage.resolve_identity("anonymous", "tok-user")
    await storage.update_user(user_id, {"expo_push_token": "ExponentPushToken[X]"})

    captured = {}

    class FakeResponse:
        status_code = 200
        def raise_for_status(self): pass
        def json(self): return {"data": [{"status": "ok", "id": "ticket-1"}]}

    class FakeClient:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *exc): pass
        async def post(self, url, json=None):
            captured["url"] = url
            captured["json"] = json
            return FakeResponse()

    with patch("botella.push.httpx.AsyncClient", FakeClient):
        res = await proactive_send(
            manifest, user_id, title="🌙 Layla", body="Today's reading is in.",
            data={"kind": "daily_reading"},
        )

    assert res.sent is True
    assert res.expo_status == "ok"
    assert captured["url"] == EXPO_PUSH_ENDPOINT
    assert captured["json"]["to"] == "ExponentPushToken[X]"
    assert captured["json"]["title"] == "🌙 Layla"
    assert captured["json"]["body"] == "Today's reading is in."
    assert captured["json"]["data"] == {"kind": "daily_reading"}


@pytest.mark.asyncio
async def test_proactive_send_swallows_http_errors(app_and_storage):
    _, storage, manifest = app_and_storage
    user_id = await storage.resolve_identity("anonymous", "err-user")
    await storage.update_user(user_id, {"expo_push_token": "ExponentPushToken[E]"})

    class BoomClient:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *exc): pass
        async def post(self, *args, **kwargs):
            raise RuntimeError("network down")

    with patch("botella.push.httpx.AsyncClient", BoomClient):
        res = await proactive_send(manifest, user_id, title="x", body="y")
    assert res.sent is False
    assert res.skipped_reason == "http_error"


@pytest.mark.asyncio
async def test_proactive_send_marks_expo_error_status(app_and_storage):
    _, storage, manifest = app_and_storage
    user_id = await storage.resolve_identity("anonymous", "exp-err")
    await storage.update_user(user_id, {"expo_push_token": "ExponentPushToken[Y]"})

    class FakeResponse:
        status_code = 200
        def raise_for_status(self): pass
        def json(self):
            return {"data": [{"status": "error", "message": "DeviceNotRegistered"}]}

    class FakeClient:
        def __init__(self, *args, **kwargs): pass
        async def __aenter__(self): return self
        async def __aexit__(self, *exc): pass
        async def post(self, *args, **kwargs):
            return FakeResponse()

    with patch("botella.push.httpx.AsyncClient", FakeClient):
        res = await proactive_send(manifest, user_id, title="x", body="y")
    assert res.sent is False
    assert res.expo_status == "error"
