"""Toy bot: validates the contract end-to-end.

Exercises every primitive a real bot will use:
  - /start trigger that begins a flow (Start)
  - WaitFor between states
  - Goto chained state without input
  - Stay on validation failure
  - Done(carry=...) writing into the user record
  - Streaming free chat reading the carried-over user data
"""

from __future__ import annotations

from botella import (
    BotManifest,
    Done,
    Flow,
    Goto,
    Stay,
    Start,
    WaitFor,
    complete,
    quick_replies,
    text,
    token,
    typing,
)
from botella.storage import MemoryStorage


# ─── Flow: introduce the user ────────────────────────────────────────────────

intro = Flow("intro")


@intro.state("ask_name", entry=True)
async def ask_name(msg, session, storage):
    return [text("What's your name?")], WaitFor("got_name")


@intro.state("got_name")
async def got_name(msg, session, storage):
    name = (msg.text or "").strip()
    if not name:
        return [text("I didn't catch that — what should I call you?")], Stay()
    session.data["name"] = name
    return [text(f"Nice to meet you, {name}.")], Goto("ask_color")


@intro.state("ask_color")
async def ask_color(msg, session, storage):
    return [
        quick_replies(
            ["red", "green", "blue", "other"],
            prompt="What's your favorite color?",
        ),
    ], WaitFor("got_color")


@intro.state("got_color")
async def got_color(msg, session, storage):
    color = (msg.text or "").strip().lower()
    if not color:
        return [text("Pick one:")], Stay()
    name = session.data["name"]
    return (
        [text(f"Got it — {name} likes {color}. We're done.")],
        Done(carry={"name": name, "color": color}),
    )


# ─── Triggers ────────────────────────────────────────────────────────────────


async def start_trigger(msg, session, storage):
    user = await storage.get_user(session.user_id)
    if "name" in user:
        return [text(f"Welcome back, {user['name']}.")], None
    return [], Start("intro")


async def reset_trigger(msg, session, storage):
    session.flow = None
    session.state = None
    session.data = {}
    return [text("Reset.")], None


# ─── Free chat (streaming) ───────────────────────────────────────────────────


async def free_chat(msg, session, storage):
    user = await storage.get_user(session.user_id)
    name = user.get("name", "stranger")
    color = user.get("color")
    yield typing()
    prefix = f"echo to {name}"
    if color:
        prefix += f" ({color})"
    full = f"{prefix}: {msg.text or ''}"
    for ch in full:
        yield token(ch)
    yield complete(full)


# ─── Manifest ────────────────────────────────────────────────────────────────


def build_manifest() -> BotManifest:
    return BotManifest(
        name="echo",
        storage=MemoryStorage(),
        flows=[intro],
        triggers={
            "/start": start_trigger,
            "/reset": reset_trigger,
        },
        free_chat=free_chat,
    )
