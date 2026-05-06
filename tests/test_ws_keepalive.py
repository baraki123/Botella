"""Keep-alive wrapper for the WS adapter — emits typing frames during
long silences so proxies don't drop the idle socket."""
from __future__ import annotations

import asyncio
from typing import AsyncIterator

import pytest

from botella.adapters.ws import _with_keepalive
from botella.contract import OutboundEvent, text


@pytest.mark.asyncio
async def test_passes_events_through_without_extra_frames(monkeypatch):
    async def src() -> AsyncIterator[OutboundEvent]:
        yield text("a")
        yield text("b")
        yield text("c")

    out = [e async for e in _with_keepalive(src())]
    assert [e.type for e in out] == ["text", "text", "text"]
    assert [e.payload["text"] for e in out] == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_injects_typing_during_silence(monkeypatch):
    """Drop the idle window low for the test; expect at least one typing
    frame between the two real events."""
    monkeypatch.setattr("botella.adapters.ws.IDLE_KEEPALIVE", 0.05)

    async def src() -> AsyncIterator[OutboundEvent]:
        yield text("first")
        await asyncio.sleep(0.18)  # ~3 keep-alive ticks worth of silence
        yield text("second")

    out = [e async for e in _with_keepalive(src())]
    types = [e.type for e in out]
    # First and last are the real text frames; one or more typing frames
    # in between (count is timing-dependent, lower bound is 2 for 0.18s).
    assert types[0] == "text"
    assert types[-1] == "text"
    assert types.count("typing") >= 1


@pytest.mark.asyncio
async def test_propagates_source_exceptions():
    async def src() -> AsyncIterator[OutboundEvent]:
        yield text("ok")
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError, match="boom"):
        _ = [e async for e in _with_keepalive(src())]
