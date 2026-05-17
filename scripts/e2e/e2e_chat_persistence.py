"""E2E: chat persistence across reload.

The BUG-4 fix added AsyncStorage caching of the message tail keyed by
`layla:chat_messages:${userId}`. This test verifies the round-trip:
  1. Seed a small message history into localStorage
  2. Reload the Expo web build
  3. Confirm the bubbles render (without the WS having to re-emit them)

That's enough to prove the hydrate-on-mount path stays alive.
"""
from __future__ import annotations

import json

from playwright.sync_api import Page

from ._runner import (
    METRO,
    mint_anon_session,
    visible_bubbles,
)


_HISTORY = [
    {"id": "p-1", "role": "user", "text": "I keep procrastinating on this big move."},
    {"id": "p-2", "role": "bot",
     "text": "Procrastination here isn't laziness — it's a pause at the threshold where possibility and risk meet.",
     "streaming": False},
    {"id": "p-3", "role": "user", "text": "What's the smallest step I could take this week?"},
    {"id": "p-4", "role": "bot",
     "text": "Pick one specific action you can do in under ten minutes today.",
     "streaming": False},
]


def run(page: Page) -> None:
    session = mint_anon_session()

    key = f"layla:chat_messages:{session['user_id']}"
    payload = json.dumps(_HISTORY)
    page.add_init_script(
        f"""
        try {{
            localStorage.setItem('botella.jwt', {json.dumps(session['jwt'])});
            localStorage.setItem('botella.userId', {json.dumps(session['user_id'])});
            localStorage.setItem({json.dumps(key)}, {json.dumps(payload)});
        }} catch (e) {{}}
        """
    )

    page.goto(METRO, wait_until="networkidle", timeout=15000)
    page.wait_for_selector('[data-testid="composer-input"]', timeout=15000)
    page.wait_for_timeout(1500)  # let hydration + render settle

    bubbles = visible_bubbles(page)
    texts = [b["text"] for b in bubbles]

    # All four seeded entries must be present after reload.
    assert any("procrastinating on this big move" in t for t in texts), \
        f"expected user msg 1 to survive reload, saw: {texts[:4]}"
    assert any("pause at the threshold" in t for t in texts), \
        "expected bot msg 1 to survive reload"
    assert any("smallest step" in t for t in texts), \
        "expected user msg 2 to survive reload"
    assert any("under ten minutes" in t for t in texts), \
        "expected bot msg 2 to survive reload"

    # Storage key still has the data (the persistence didn't clobber
    # it during the hydrate path).
    raw = page.evaluate(f"() => localStorage.getItem({json.dumps(key)})")
    assert raw, "localStorage chat-history key was cleared by hydration"
    parsed = json.loads(raw)
    assert len(parsed) >= 4, \
        f"persisted history shrank below seed (was {len(parsed)})"
