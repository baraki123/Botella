"""POST /v1/account/link/redeem — Telegram → iOS account migration.

The bot mints a code via its own DAL (we mock with a tiny dict here);
the iOS client posts the code with its current JWT; the server merges
identities into the target user and returns a fresh JWT for that user.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from botella import BotManifest, create_app
from botella.storage import MemoryStorage


@pytest.fixture
def app_and_storage():
    storage = MemoryStorage()
    codes: dict[str, str] = {}

    async def resolver(code: str) -> str | None:
        return codes.pop(code.upper(), None)

    manifest = BotManifest(
        name="t",
        storage=storage,
        flows=[],
        triggers={},
        link_code_resolver=resolver,
    )
    return TestClient(create_app(manifest)), storage, codes


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_redeem_merges_identities_and_swaps_jwt(app_and_storage):
    client, storage, codes = app_and_storage

    # Seed: existing Telegram user (target).
    target_user = _run(storage.resolve_identity("telegram", "12345"))
    _run(storage.update_user(target_user, {"name": "Barak", "lang": "en"}))

    # Caller is anonymous on iOS.
    r = client.post("/v1/auth/anonymous", json={"device_id": "ios-A"})
    body = r.json()
    ios_user_id = body["user_id"]
    ios_jwt = body["jwt"]
    assert ios_user_id != target_user

    # Bot side mints a code that points at the target Telegram user.
    codes["KX2J9P4L"] = target_user

    r = client.post(
        "/v1/account/link/redeem",
        headers={"Authorization": f"Bearer {ios_jwt}"},
        json={"code": "kx2j9p4l"},  # lowercase to test normalization
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["user_id"] == target_user
    assert out["auth"] == "linked"
    assert out["jwt"] != ios_jwt

    # The anonymous identity for "ios-A" now points at the target.
    re_resolve = _run(storage.resolve_identity("anonymous", "ios-A"))
    assert re_resolve == target_user

    # The iOS user_id's session and record are gone.
    assert _run(storage.get_user(ios_user_id)) == {}

    # Target user's data is preserved.
    assert _run(storage.get_user(target_user))["name"] == "Barak"


def test_redeem_invalid_code_400(app_and_storage):
    client, _storage, _codes = app_and_storage
    r = client.post("/v1/auth/anonymous", json={"device_id": "ios-A"})
    jwt = r.json()["jwt"]

    r = client.post(
        "/v1/account/link/redeem",
        headers={"Authorization": f"Bearer {jwt}"},
        json={"code": "WRONGGGG"},
    )
    assert r.status_code == 400


def test_redeem_requires_auth(app_and_storage):
    client, _storage, _codes = app_and_storage
    r = client.post("/v1/account/link/redeem", json={"code": "ABCD2345"})
    assert r.status_code == 401


def test_redeem_unconfigured_returns_501():
    """A bot without link_code_resolver gets a 501 instead of crashing."""
    storage = MemoryStorage()
    manifest = BotManifest(name="t", storage=storage, flows=[], triggers={})
    client = TestClient(create_app(manifest))

    r = client.post("/v1/auth/anonymous", json={"device_id": "ios-A"})
    jwt = r.json()["jwt"]

    r = client.post(
        "/v1/account/link/redeem",
        headers={"Authorization": f"Bearer {jwt}"},
        json={"code": "ABCD2345"},
    )
    assert r.status_code == 501


def test_redeem_when_already_target_is_noop(app_and_storage):
    """If the caller IS the target user, the merge step is skipped (no-op)
    but a fresh JWT still mints back."""
    client, storage, codes = app_and_storage
    r = client.post("/v1/auth/anonymous", json={"device_id": "ios-A"})
    body = r.json()
    user_id = body["user_id"]
    jwt = body["jwt"]
    codes["MYOWN888"] = user_id

    r = client.post(
        "/v1/account/link/redeem",
        headers={"Authorization": f"Bearer {jwt}"},
        json={"code": "MYOWN888"},
    )
    assert r.status_code == 200
    assert r.json()["user_id"] == user_id
