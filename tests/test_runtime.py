"""Unit-level runtime tests — direct calls to runtime.run, no HTTP."""

from __future__ import annotations

import pytest

from botella import (
    BotManifest,
    Flow,
    InboundMessage,
    Stay,
    Start,
    WaitFor,
    text,
)
from botella import runtime
from botella.storage import MemoryStorage


def _make_manifest() -> BotManifest:
    flow = Flow("greet")

    @flow.state("ask", entry=True)
    async def ask(msg, session, storage):
        return [text("name?")], WaitFor("got")

    @flow.state("got")
    async def got(msg, session, storage):
        if not msg.text:
            return [text("retry")], Stay()
        await storage.update_user(session.user_id, {"name": msg.text})
        return [text(f"hi {msg.text}")], None  # stays in flow at "got" — fine for test

    async def start_trigger(msg, session, storage):
        return [], Start("greet")

    async def echo(msg, session, storage):
        user = await storage.get_user(session.user_id)
        yield text(f"echo:{user.get('name', '?')}:{msg.text or ''}")

    return BotManifest(
        name="t",
        storage=MemoryStorage(),
        flows=[flow],
        triggers={"/start": start_trigger},
        free_chat=echo,
    )


async def _collect(msg, manifest):
    return [e async for e in runtime.run(msg, manifest)]


@pytest.mark.asyncio
async def test_trigger_starts_flow_and_runs_entry_state():
    m = _make_manifest()
    out = await _collect(InboundMessage(user_id="u1", transport="test", text="/start"), m)
    # Trigger emits no events; entry state ("ask") emits "name?".
    assert [e.payload["text"] for e in out if e.type == "text"] == ["name?"]
    # Session should be parked at "got" waiting for text.
    s = await m.storage.load_session("u1")
    assert s.flow == "greet"
    assert s.state == "got"


@pytest.mark.asyncio
async def test_stay_keeps_state_on_validation_failure():
    m = _make_manifest()
    await _collect(InboundMessage(user_id="u1", transport="test", text="/start"), m)
    out = await _collect(InboundMessage(user_id="u1", transport="test", text=""), m)
    assert [e.payload["text"] for e in out if e.type == "text"] == ["retry"]
    s = await m.storage.load_session("u1")
    assert s.state == "got"  # didn't advance


@pytest.mark.asyncio
async def test_free_chat_runs_when_no_flow_active():
    m = _make_manifest()
    out = await _collect(InboundMessage(user_id="u1", transport="test", text="hello"), m)
    assert any("echo:?:hello" in e.payload.get("text", "") for e in out)
