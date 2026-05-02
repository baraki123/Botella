"""DELETE /v1/account — App Store 5.1.1(v) compliance.

The route accepts only an authenticated request (Bearer JWT), wipes
everything storage holds for that user, and returns 204.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from botella import BotManifest, create_app
from botella.auth.jwt import mint_jwt
from botella.storage import MemoryStorage


@pytest.fixture
def app_and_storage():
    storage = MemoryStorage()
    manifest = BotManifest(name="t", storage=storage, flows=[], triggers={})
    return TestClient(create_app(manifest)), storage


def test_delete_account_removes_session_user_and_identities(app_and_storage):
    client, storage = app_and_storage
    # Seed: anonymous user with some session + user data
    r = client.post("/v1/auth/anonymous", json={"device_id": "device-A"})
    assert r.status_code == 200
    body = r.json()
    user_id = body["user_id"]
    jwt = body["jwt"]

    # Touch some data
    import asyncio
    asyncio.get_event_loop().run_until_complete(
        storage.update_user(user_id, {"name": "Barak", "lang": "he"})
    )
    assert (asyncio.get_event_loop()
            .run_until_complete(storage.get_user(user_id))) != {}

    r = client.delete("/v1/account", headers={"Authorization": f"Bearer {jwt}"})
    assert r.status_code == 204

    # Everything wiped
    assert (asyncio.get_event_loop()
            .run_until_complete(storage.get_user(user_id))) == {}
    # Identity row gone — re-resolving with the same device_id mints a NEW user_id
    r2 = client.post("/v1/auth/anonymous", json={"device_id": "device-A"})
    assert r2.status_code == 200
    assert r2.json()["user_id"] != user_id


def test_delete_account_requires_auth(app_and_storage):
    client, _ = app_and_storage
    r = client.delete("/v1/account")
    assert r.status_code == 401


def test_delete_account_with_bad_token_rejected(app_and_storage):
    client, _ = app_and_storage
    r = client.delete("/v1/account", headers={"Authorization": "Bearer not-a-jwt"})
    assert r.status_code == 401


def test_delete_account_idempotent(app_and_storage):
    """Calling twice with the same JWT (the second time the user is gone)
    should still 204 — the JWT is valid, the deletion is a no-op on a missing user."""
    client, storage = app_and_storage
    r = client.post("/v1/auth/anonymous", json={"device_id": "device-B"})
    jwt = r.json()["jwt"]
    r1 = client.delete("/v1/account", headers={"Authorization": f"Bearer {jwt}"})
    assert r1.status_code == 204
    r2 = client.delete("/v1/account", headers={"Authorization": f"Bearer {jwt}"})
    assert r2.status_code == 204
