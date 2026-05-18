"""botella — a transport-neutral runtime for Python Telegram bots.

Wraps a bot's brain (handlers, services, prompts) so the same logic can serve
Telegram and a native iOS/Android app without duplicating the bot logic.
"""

from botella.app import create_app
from botella.contract import (
    BotManifest,
    Done,
    Flow,
    Goto,
    InboundMessage,
    OutboundEvent,
    SessionState,
    Start,
    Stay,
    Storage,
    Transition,
    WaitFor,
    complete,
    media,
    paginated_read,
    quick_replies,
    text,
    token,
    typing,
)

__all__ = [
    # app
    "create_app",
    # types
    "BotManifest",
    "Flow",
    "InboundMessage",
    "OutboundEvent",
    "SessionState",
    "Storage",
    "Transition",
    # transitions
    "WaitFor",
    "Stay",
    "Goto",
    "Done",
    "Start",
    # event helpers
    "text",
    "typing",
    "token",
    "complete",
    "quick_replies",
    "media",
    "paginated_read",
]
