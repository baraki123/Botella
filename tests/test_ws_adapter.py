"""WebSocket adapter end-to-end tests via Starlette TestClient.

Proves: auth gate, full conversation including streaming free chat with the
expected token order, turn_end sentinel, and per-user state isolation across
two parallel connections.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from botella import create_app
from examples.echo_bot.manifest import build_manifest


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(build_manifest()))


def _auth(client: TestClient, device_id: str) -> str:
    r = client.post("/v1/auth/anonymous", json={"device_id": device_id})
    assert r.status_code == 200, r.text
    return r.json()["jwt"]


def _drain_until_turn_end(ws) -> list[dict]:
    events = []
    while True:
        ev = ws.receive_json()
        if ev["type"] == "turn_end":
            return events
        events.append(ev)


def test_ws_rejects_missing_token(client: TestClient):
    with pytest.raises(Exception):
        with client.websocket_connect("/v1/stream") as _ws:
            pass


def test_ws_rejects_bad_token(client: TestClient):
    with pytest.raises(Exception):
        with client.websocket_connect("/v1/stream?token=garbage") as _ws:
            pass


def test_ws_full_flow_streaming(client: TestClient):
    jwt = _auth(client, "ws-device-1")
    with client.websocket_connect(f"/v1/stream?token={jwt}") as ws:
        # /start → entry state prompts.
        ws.send_json({"text": "/start"})
        events = _drain_until_turn_end(ws)
        texts = [e["payload"]["text"] for e in events if e["type"] == "text"]
        assert texts == ["What's your name?"]

        # Name → ack + quick_replies.
        ws.send_json({"text": "Barak"})
        events = _drain_until_turn_end(ws)
        texts = [e["payload"]["text"] for e in events if e["type"] == "text"]
        qrs = [e for e in events if e["type"] == "quick_replies"]
        assert texts == ["Nice to meet you, Barak."]
        assert len(qrs) == 1
        assert qrs[0]["payload"]["prompt"] == "What's your favorite color?"

        # Color → Done.
        ws.send_json({"text": "blue"})
        events = _drain_until_turn_end(ws)
        texts = [e["payload"]["text"] for e in events if e["type"] == "text"]
        assert texts == ["Got it — Barak likes blue. We're done."]

        # Free chat — pure streaming. Must arrive as typing → tokens → complete.
        ws.send_json({"text": "hello again"})
        events = _drain_until_turn_end(ws)
        types_in_order = [e["type"] for e in events]
        # First event is typing.
        assert types_in_order[0] == "typing"
        # Last event is complete.
        assert types_in_order[-1] == "complete"
        # Everything between is tokens.
        middle = types_in_order[1:-1]
        assert all(t == "token" for t in middle)
        # Reconstructed message.
        streamed = "".join(
            e["payload"]["text"] for e in events if e["type"] == "token"
        )
        assert streamed == "echo to Barak (blue): hello again"


def test_ws_two_users_isolated(client: TestClient):
    a_jwt = _auth(client, "ws-A")
    b_jwt = _auth(client, "ws-B")
    with client.websocket_connect(f"/v1/stream?token={a_jwt}") as ws_a:
        ws_a.send_json({"text": "/start"})
        _drain_until_turn_end(ws_a)
        ws_a.send_json({"text": "Alice"})
        _drain_until_turn_end(ws_a)
        ws_a.send_json({"text": "red"})
        _drain_until_turn_end(ws_a)

        # B opens fresh — should hit the intro flow.
        with client.websocket_connect(f"/v1/stream?token={b_jwt}") as ws_b:
            ws_b.send_json({"text": "/start"})
            evs = _drain_until_turn_end(ws_b)
            texts = [e["payload"]["text"] for e in evs if e["type"] == "text"]
            assert texts == ["What's your name?"]

        # A's free chat should still know Alice.
        ws_a.send_json({"text": "ping"})
        evs = _drain_until_turn_end(ws_a)
        streamed = "".join(e["payload"]["text"] for e in evs if e["type"] == "token")
        assert "Alice" in streamed
