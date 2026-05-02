"""HTTP-level e2e for the Layla sketch.

The runtime tests in test_layla_sketch.py drive the dispatcher directly. This
file walks the same flows through the actual FastAPI app — anonymous auth,
JSON-serialized OutboundEvents, the full contract boundary an iOS client
will hit. If this passes, the sketch holds end-to-end.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from botella import create_app
from examples.layla_sketch.manifest import build_manifest


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(build_manifest()))


def _auth(client: TestClient, device_id: str) -> str:
    r = client.post("/v1/auth/anonymous", json={"device_id": device_id})
    assert r.status_code == 200, r.text
    return r.json()["jwt"]


def _send(client: TestClient, jwt: str, **kwargs) -> list[dict]:
    r = client.post(
        "/v1/messages",
        headers={"Authorization": f"Bearer {jwt}"},
        json={"transport": "test", **kwargs},
    )
    assert r.status_code == 200, r.text
    return r.json()["events"]


def _texts(events: list[dict]) -> list[str]:
    return [e["payload"]["text"] for e in events if e["type"] == "text"]


def _qrs(events: list[dict]) -> list[dict]:
    return [e["payload"] for e in events if e["type"] == "quick_replies"]


def test_full_onboarding_then_intake_via_http(client: TestClient):
    jwt = _auth(client, "device-layla-1")

    out = _send(client, jwt, text="/start")
    assert _qrs(out)[0]["prompt"] == "Hi! Pick your language."

    out = _send(client, jwt, callback_data="lang_en")
    assert _texts(out) == ["What's your name?"]

    out = _send(client, jwt, text="Barak")
    assert "Nice to meet you, Barak." in _texts(out)
    assert _qrs(out)[0]["options"] == ["Male", "Female"]

    _send(client, jwt, callback_data="gender_m")
    _send(client, jwt, text="15/03/1990")
    _send(client, jwt, text="14:30")
    out = _send(client, jwt, text="Tel Aviv")
    assert _texts(out)[0] == "Got it. Sun in Pisces — full chart on the way."

    # Returning user — no flow re-entered.
    out = _send(client, jwt, text="/start")
    assert _texts(out) == ["Welcome back, Barak."]

    # /gettoknow starts intake; complete all 3.
    out = _send(client, jwt, text="/gettoknow")
    assert _texts(out) == ["Where are you at in life right now?"]
    _send(client, jwt, text="In transition.")
    _send(client, jwt, text="Career.")
    out = _send(client, jwt, text="My partner.")
    assert _texts(out) == ["Thanks. I've saved that."]


def test_disambiguation_branch_via_http(client: TestClient):
    jwt = _auth(client, "device-layla-amb")
    _send(client, jwt, text="/start")
    _send(client, jwt, callback_data="lang_en")
    _send(client, jwt, text="Tester")
    _send(client, jwt, callback_data="gender_f")
    _send(client, jwt, text="15/03/1990")
    _send(client, jwt, text="/skip")

    out = _send(client, jwt, text="Springfield")
    qr = _qrs(out)[0]
    assert qr["prompt"] == "A few matches — which one?"
    assert len(qr["options"]) == 3

    out = _send(client, jwt, callback_data="place_pick:1")
    assert _texts(out)[0].startswith("Got it.")


def test_two_devices_isolated_via_http(client: TestClient):
    a = _auth(client, "device-A")
    b = _auth(client, "device-B")
    _send(client, a, text="/start")
    _send(client, a, callback_data="lang_en")
    _send(client, a, text="Alice")
    out = _send(client, b, text="/start")
    assert _qrs(out)[0]["prompt"] == "Hi! Pick your language."
