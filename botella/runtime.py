"""The dispatcher.

Given an `InboundMessage` and a `BotManifest`, yield `OutboundEvent`s.

Order of precedence:
  1. Triggers (commands like /start, callback patterns) — always preempt.
  2. If a flow is active in the session — dispatch to its current state.
  3. Otherwise — free chat.

`Goto` and `Start` transitions auto-execute the next state with empty input,
so a multi-step flow can prompt the user without requiring a wasted message.
"""

from __future__ import annotations

from typing import AsyncIterator

from botella.contract import (
    BotManifest,
    Done,
    Goto,
    InboundMessage,
    OutboundEvent,
    SessionState,
    Stay,
    Start,
    Storage,
    Transition,
    WaitFor,
    text,
)


async def run(
    msg: InboundMessage, manifest: BotManifest
) -> AsyncIterator[OutboundEvent]:
    """Process one inbound message. Loads session, dispatches, saves session."""
    storage = manifest.storage
    session = await storage.load_session(msg.user_id)

    # Voice → text preprocessing
    if msg.voice_audio is not None and manifest.voice_handler is not None:
        msg = await manifest.voice_handler(msg, session, storage)

    async for event in _dispatch(msg, session, manifest, storage):
        yield event

    await storage.save_session(session)


# ─── internals ───────────────────────────────────────────────────────────────


async def _dispatch(
    msg: InboundMessage,
    session: SessionState,
    manifest: BotManifest,
    storage: Storage,
) -> AsyncIterator[OutboundEvent]:
    # 1. Triggers preempt.
    trigger = _match_trigger(msg, manifest)
    if trigger is not None:
        events, transition = await trigger(msg, session, storage)
        for e in events:
            yield e
        async for e in _follow(transition, session, manifest, storage, msg):
            yield e
        return

    # 2. In a flow.
    if session.flow is not None:
        flow = manifest.flow_by_name(session.flow)
        state_fn = flow.states.get(session.state or "")
        if state_fn is None:
            # Corrupt state — reset and fall through to free chat.
            _reset_session(session)
        else:
            events, transition = await state_fn(msg, session, storage)
            for e in events:
                yield e
            async for e in _follow(transition, session, manifest, storage, msg):
                yield e
            return

    # 3. Free chat.
    if manifest.free_chat is not None:
        async for e in manifest.free_chat(msg, session, storage):
            yield e
        return

    yield text("(no handler)")


def _match_trigger(msg: InboundMessage, manifest: BotManifest):
    if msg.text and msg.text.startswith("/"):
        cmd = msg.text.split(maxsplit=1)[0]
        fn = manifest.triggers.get(cmd)
        if fn is not None:
            return fn
    if msg.callback_data:
        fn = manifest.triggers.get(f"callback:{msg.callback_data}")
        if fn is not None:
            return fn
    return None


async def _follow(
    transition: Transition,
    session: SessionState,
    manifest: BotManifest,
    storage: Storage,
    msg: InboundMessage,
) -> AsyncIterator[OutboundEvent]:
    """Apply a transition. For Goto/Start, immediately run the next state with
    empty input — recurses until WaitFor/Done/Stay/None."""
    if transition is None or isinstance(transition, Stay):
        return

    if isinstance(transition, WaitFor):
        session.state = transition.next_state
        return

    if isinstance(transition, Done):
        if transition.carry:
            await storage.update_user(session.user_id, transition.carry)
        if session.flow_stack:
            frame = session.flow_stack.pop()
            session.flow = frame["flow"]
            session.state = frame["state"]
            session.data = frame["data"]
        else:
            _reset_session(session)
        return

    if isinstance(transition, Start):
        flow = manifest.flow_by_name(transition.flow)
        entry = transition.state or flow.entry
        if entry is None:
            raise RuntimeError(
                f"Flow {flow.name!r} has no entry state and Start did not specify one"
            )
        if transition.nest and session.flow is not None:
            session.flow_stack.append(
                {
                    "flow": session.flow,
                    "state": session.state,
                    "data": dict(session.data),
                }
            )
        session.flow = flow.name
        session.state = entry
        session.data = {}
        async for e in _run_state(entry, session, manifest, storage, msg):
            yield e
        return

    if isinstance(transition, Goto):
        if session.flow is None:
            raise RuntimeError("Goto used outside a flow")
        session.state = transition.state
        async for e in _run_state(transition.state, session, manifest, storage, msg):
            yield e
        return

    raise TypeError(f"unknown transition: {transition!r}")


async def _run_state(
    state_name: str,
    session: SessionState,
    manifest: BotManifest,
    storage: Storage,
    msg: InboundMessage,
) -> AsyncIterator[OutboundEvent]:
    """Run the named state with empty input; chain through Goto/Start."""
    flow = manifest.flow_by_name(session.flow)  # type: ignore[arg-type]
    state_fn = flow.states.get(state_name)
    if state_fn is None:
        raise RuntimeError(
            f"State {state_name!r} not in flow {session.flow!r}"
        )
    empty = InboundMessage(user_id=msg.user_id, transport=msg.transport)
    events, transition = await state_fn(empty, session, storage)
    for e in events:
        yield e
    async for e in _follow(transition, session, manifest, storage, empty):
        yield e


def _reset_session(session: SessionState) -> None:
    session.flow = None
    session.state = None
    session.data = {}
