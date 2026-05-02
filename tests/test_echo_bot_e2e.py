"""End-to-end test through the actual HTTP API.

Proves the contract holds for a real bot: anonymous auth, multi-step flow with
WaitFor + Goto + Stay, Done(carry=...) writing to user record, and free chat
reading the carried-over user data on a subsequent turn.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from botella import create_app
from examples.echo_bot.manifest import build_manifest


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(build_manifest()))


def _auth(client: TestClient, device_id: str = "device-1") -> tuple[str, str]:
    r = client.post("/v1/auth/anonymous", json={"device_id": device_id})
    assert r.status_code == 200, r.text
    body = r.json()
    return body["jwt"], body["user_id"]


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


def test_unauthenticated_request_rejected(client: TestClient):
    r = client.post("/v1/messages", json={"text": "hi", "transport": "test"})
    assert r.status_code == 401


def test_anonymous_returns_stable_user_id(client: TestClient):
    _, u1 = _auth(client, "device-A")
    _, u2 = _auth(client, "device-A")
    _, u3 = _auth(client, "device-B")
    assert u1 == u2  # same device → same user
    assert u1 != u3  # different device → different user


def test_full_flow_completion_and_then_free_chat(client: TestClient):
    jwt, _ = _auth(client, "device-flow")

    # /start → trigger emits nothing; entry state "ask_name" prompts.
    out = _send(client, jwt, text="/start")
    assert _texts(out) == ["What's your name?"]

    # Reply with name → got_name (Goto) → ask_color, both emit on this turn.
    out = _send(client, jwt, text="Barak")
    assert _texts(out) == ["Nice to meet you, Barak."]
    qrs = [e for e in out if e["type"] == "quick_replies"]
    assert len(qrs) == 1
    assert qrs[0]["payload"]["prompt"] == "What's your favorite color?"
    assert qrs[0]["payload"]["options"] == ["red", "green", "blue", "other"]

    # Empty reply → Stay
    out = _send(client, jwt, text="")
    assert _texts(out) == ["Pick one:"]

    # Reply with color → Done(carry=...) writes name+color to user record.
    out = _send(client, jwt, text="blue")
    assert _texts(out) == ["Got it — Barak likes blue. We're done."]

    # Now in free chat — pure streaming: typing, tokens, complete (no text events).
    out = _send(client, jwt, text="hello again")
    streamed = "".join(e["payload"]["text"] for e in out if e["type"] == "token")
    assert streamed == "echo to Barak (blue): hello again"
    assert any(e["type"] == "complete" for e in out)
    assert _texts(out) == []  # streaming only, no plain text events


def test_returning_user_recognized_on_start(client: TestClient):
    jwt, _ = _auth(client, "device-return")
    # Complete the flow once.
    _send(client, jwt, text="/start")
    _send(client, jwt, text="Mira")
    _send(client, jwt, text="green")
    # Second /start should greet without re-running the flow.
    out = _send(client, jwt, text="/start")
    assert _texts(out) == ["Welcome back, Mira."]


def test_reset_clears_session(client: TestClient):
    jwt, _ = _auth(client, "device-reset")
    _send(client, jwt, text="/start")  # parks at "got_name"
    out = _send(client, jwt, text="/reset")
    assert _texts(out) == ["Reset."]
    # Next free-chat call should not still be in the flow.
    out = _send(client, jwt, text="hello")
    streamed = "".join(e["payload"]["text"] for e in out if e["type"] == "token")
    assert "echo to stranger" in streamed


def test_two_users_isolated(client: TestClient):
    a_jwt, _ = _auth(client, "device-A2")
    b_jwt, _ = _auth(client, "device-B2")

    _send(client, a_jwt, text="/start")
    _send(client, a_jwt, text="Alice")
    _send(client, a_jwt, text="red")

    # B is fresh — /start should still begin the flow.
    out = _send(client, b_jwt, text="/start")
    assert _texts(out) == ["What's your name?"]

    # A's free chat (pure streaming) should know Alice; B (mid-flow) shouldn't.
    out_a = _send(client, a_jwt, text="hi")
    streamed_a = "".join(e["payload"]["text"] for e in out_a if e["type"] == "token")
    assert "Alice" in streamed_a

    out_b = _send(client, b_jwt, text="bob")  # B is mid-flow → got_name
    assert _texts(out_b) == ["Nice to meet you, bob."]
    qrs = [e for e in out_b if e["type"] == "quick_replies"]
    assert len(qrs) == 1
    assert qrs[0]["payload"]["prompt"] == "What's your favorite color?"
