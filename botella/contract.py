"""
The contract every bot conforms to.

A bot using botella provides a `BotManifest` made of:
  - flows:        multi-step state machines (replaces PTB ConversationHandler)
  - triggers:     commands and callback patterns that preempt any current state
  - free_chat:    the streaming LLM path used when no flow is active
  - voice_handler: optional pre-processor that turns voice -> text on InboundMessage
  - storage:      persistence layer (sessions, identity, per-user data)

The runtime (botella.runtime) consumes a manifest and dispatches inbound messages.
Adapters (botella.adapters.*) translate transport-specific input to InboundMessage
and OutboundEvents back out to transport-specific output.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import (
    Any,
    AsyncIterator,
    Awaitable,
    Callable,
    Literal,
    Protocol,
    Union,
)


# ─── Inbound ─────────────────────────────────────────────────────────────────

Transport = Literal["telegram", "ios", "android", "test"]


@dataclass
class InboundMessage:
    """One message coming into the bot, normalized across transports."""
    user_id: str
    transport: Transport
    text: str | None = None
    voice_audio: bytes | None = None
    image: bytes | None = None
    location: tuple[float, float] | None = None
    callback_data: str | None = None  # e.g. inline button payload on Telegram


# ─── Outbound ────────────────────────────────────────────────────────────────

EventType = Literal[
    "text", "typing", "token", "complete", "quick_replies", "media"
]


@dataclass
class OutboundEvent:
    """One outbound chunk. Adapters render these per transport."""
    type: EventType
    payload: dict[str, Any]


def text(s: str) -> OutboundEvent:
    return OutboundEvent("text", {"text": s})


def typing() -> OutboundEvent:
    return OutboundEvent("typing", {})


def token(s: str) -> OutboundEvent:
    """A single LLM token in a streaming response."""
    return OutboundEvent("token", {"text": s})


def complete(full_text: str = "") -> OutboundEvent:
    """Marks the end of a streaming response."""
    return OutboundEvent("complete", {"text": full_text})


def quick_replies(options: list[str], prompt: str = "") -> OutboundEvent:
    return OutboundEvent("quick_replies", {"options": options, "prompt": prompt})


def media(
    *,
    image: bytes | None = None,
    image_url: str | None = None,
    caption: str = "",
) -> OutboundEvent:
    return OutboundEvent(
        "media",
        {"image": image, "image_url": image_url, "caption": caption},
    )


# ─── Session ─────────────────────────────────────────────────────────────────


@dataclass
class SessionState:
    """Per-user persistent state. Replaces PTB's in-memory context.user_data."""
    user_id: str
    flow: str | None = None
    state: str | None = None
    data: dict[str, Any] = field(default_factory=dict)
    flow_stack: list[dict[str, Any]] = field(default_factory=list)
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# ─── Transitions ─────────────────────────────────────────────────────────────


@dataclass
class WaitFor:
    """Advance to next_state and wait for the next inbound message."""
    next_state: str


@dataclass
class Stay:
    """Stay in current state. Use after validation failure."""


@dataclass
class Goto:
    """Run the named state immediately, with no new input."""
    state: str


@dataclass
class Done:
    """End the current flow. Pops the flow stack if nested.
    `carry` is merged into the user record before pop."""
    carry: dict[str, Any] = field(default_factory=dict)


@dataclass
class Start:
    """Enter a flow. If `nest=True`, push the current flow onto the stack."""
    flow: str
    state: str | None = None  # default: flow's entry state
    nest: bool = False


Transition = Union[WaitFor, Stay, Goto, Done, Start, None]


# ─── Handler signatures ──────────────────────────────────────────────────────

# Used inside flow states + as triggers.
StateFn = Callable[
    ["InboundMessage", "SessionState", "Storage"],
    Awaitable[tuple[list["OutboundEvent"], "Transition"]],
]

# Streaming free-chat path.
FreeChatFn = Callable[
    ["InboundMessage", "SessionState", "Storage"],
    AsyncIterator["OutboundEvent"],
]

# Voice pre-processor: returns the same message with .text populated.
VoiceFn = Callable[
    ["InboundMessage", "SessionState", "Storage"],
    Awaitable["InboundMessage"],
]


# ─── Flow ────────────────────────────────────────────────────────────────────


class Flow:
    """A named state machine. Register state functions with `@flow.state(...)`."""

    def __init__(self, name: str):
        self.name = name
        self.states: dict[str, StateFn] = {}
        self.entry: str | None = None

    def state(self, name: str, *, entry: bool = False):
        def deco(fn: StateFn) -> StateFn:
            if name in self.states:
                raise ValueError(
                    f"Flow {self.name!r}: state {name!r} already registered"
                )
            self.states[name] = fn
            if entry:
                if self.entry is not None:
                    raise ValueError(
                        f"Flow {self.name!r}: entry state already set "
                        f"to {self.entry!r}"
                    )
                self.entry = name
            return fn

        return deco


# ─── Storage protocol ────────────────────────────────────────────────────────


class Storage(Protocol):
    """Persistence interface. Bots implement (or use a botella-provided impl).

    botella ships an in-memory implementation in `botella.storage.memory.MemoryStorage`
    suitable for tests and single-process toy bots. Production bots implement
    against their own database (Postgres, SQLite, etc.).
    """

    # Sessions
    async def load_session(self, user_id: str) -> SessionState: ...
    async def save_session(self, session: SessionState) -> None: ...

    # Identity (anonymous on day 1; Apple/Google later)
    async def resolve_identity(self, provider: str, external_id: str) -> str:
        """Return the internal user_id for (provider, external_id), creating
        a fresh user if none exists."""
        ...

    # Per-user opaque data — the bot's domain (name, chart, preferences, …)
    async def get_user(self, user_id: str) -> dict[str, Any]: ...
    async def update_user(self, user_id: str, patch: dict[str, Any]) -> None:
        """Merge `patch` into the user record."""
        ...

    async def delete_user(self, user_id: str) -> None:
        """Wipe everything we hold about a user: sessions, identities,
        per-user data. Required by App Store policy 5.1.1(v) for any app
        that supports account creation. Implementations should be
        idempotent — calling on an unknown user is a no-op.
        """
        ...


# ─── Manifest ────────────────────────────────────────────────────────────────


@dataclass
class BotManifest:
    """The single integration point a bot exposes to botella."""
    name: str
    storage: Storage
    flows: list[Flow] = field(default_factory=list)
    triggers: dict[str, StateFn] = field(default_factory=dict)
    free_chat: FreeChatFn | None = None
    voice_handler: VoiceFn | None = None
    config: dict[str, Any] = field(default_factory=dict)

    def flow_by_name(self, name: str) -> Flow:
        for f in self.flows:
            if f.name == name:
                return f
        raise KeyError(f"flow {name!r} not registered in manifest {self.name!r}")
