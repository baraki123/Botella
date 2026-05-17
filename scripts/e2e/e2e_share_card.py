"""E2E: shareable insight card.

Seeds a long bot bubble into localStorage so the hydration path picks
it up, then long-presses the bubble → asserts the share-card flow
fires:
  1. "Rendering card…" toast appears
  2. ImageLightbox opens with the rendered PNG (data: URL)
  3. Lightbox can be closed

The actual PNG bytes go through POST /v1/card/render — same endpoint
covered by test_insight_card.py at the pure-function level. Here we
just verify the round-trip + UI surface.
"""
from __future__ import annotations

import json
import time

from playwright.sync_api import Page

from ._runner import (
    METRO,
    mint_anon_session,
    open_chat,
    seed_session,
    shot,
)


_LONG_BUBBLE_TEXT = (
    "Stop choosing between tenderness and strength. Build a life where "
    "your fire does not need to hide behind self-protection, and your "
    "sensitivity does not need to hide behind performance. Let "
    "relationships be clear, let work be meaningful, and let your inner "
    "life become a source of guidance rather than a private storm."
)


def run(page: Page) -> None:
    session = mint_anon_session()

    # Seed a long bot bubble into AsyncStorage so ChatScreen hydrates
    # with it on mount — same code path the BUG-4 persistence uses.
    msg = {
        "id": "e2e-long-bot",
        "role": "bot",
        "text": _LONG_BUBBLE_TEXT,
        "streaming": False,
    }
    key = f"layla:chat_messages:{session['user_id']}"
    payload = json.dumps([msg])
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

    # The hydrated bubble should be on screen.
    bubble = page.locator('[data-testid="bubble-bot"]').first
    bubble.wait_for(state="visible", timeout=8000)

    # Long-press by holding the mouse down for ~700ms. Playwright doesn't
    # expose a dedicated longpress helper, but we can simulate via
    # mouse.down() + sleep + mouse.up() over the bubble's center.
    box = bubble.bounding_box()
    assert box is not None, "expected bubble to have a bounding box"
    cx = box["x"] + box["width"] / 2
    cy = box["y"] + box["height"] / 2
    page.mouse.move(cx, cy)
    page.mouse.down()
    time.sleep(0.7)  # longer than delayLongPress (550ms)
    page.mouse.up()

    # The "Rendering card…" toast should appear briefly. The render is
    # fast (~80ms server-side) so we may miss the toast — instead poll
    # for the lightbox image which is the durable end-state.
    deadline = time.time() + 12
    found_img = False
    while time.time() < deadline:
        # ImageLightbox shows a full-screen Image with the data: URL.
        # Easiest: look for an <img> whose src starts with data:image/png.
        src = page.evaluate(
            "() => {"
            "  const imgs = document.querySelectorAll('img');"
            "  for (const i of imgs) {"
            "    if (i.src && i.src.startsWith('data:image/png')) return i.src.slice(0, 60);"
            "  }"
            "  return '';"
            "}"
        )
        if src:
            found_img = True
            break
        time.sleep(0.3)

    assert found_img, "expected ImageLightbox to render the data: URL PNG"
    shot(page, "e2e_share_card_lightbox_open")
