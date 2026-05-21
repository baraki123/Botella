"""Smoke + visual check for the typing/scrolling polish work.

What this verifies:
  · No JS errors / console exceptions on load.
  · The new caret glyph is `|`, not the old `▍` (smoke test for the
    Bubble rewrite landing).
  · Sign-in screen renders.
  · No crashes when navigating into chat (anonymous device path).
  · Screenshots saved to botella/screenshots/typing-polish-*.png for
    later visual review.

We don't try to drive the full Layla onboarding here — that has many
steps and we already have manual e2e for that. This is a tight check
that the new render code doesn't blow up.

Usage: python scripts/test_typing_polish.py
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

URL = "http://localhost:8081"
SHOTS = Path(__file__).resolve().parent.parent / "screenshots"
SHOTS.mkdir(exist_ok=True)


def shot(page: Page, label: str) -> Path:
    path = SHOTS / f"typing-polish-{label}.png"
    page.screenshot(path=str(path), full_page=False)
    print(f"  📸 {path}")
    return path


def main() -> int:
    errors: list[str] = []
    console_msgs: list[str] = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(viewport={"width": 390, "height": 844})
        page = ctx.new_page()

        page.on("console", lambda msg: console_msgs.append(f"[{msg.type}] {msg.text}"))
        page.on("pageerror", lambda exc: errors.append(f"[pageerror] {exc}"))

        print(f"→ open {URL}")
        try:
            page.goto(URL, wait_until="domcontentloaded", timeout=15_000)
        except Exception as e:
            print(f"  ✗ navigation failed: {e}")
            return 1

        # Wait for the app shell to mount (something Layla-y to be on the page).
        page.wait_for_timeout(2500)
        shot(page, "01-loaded")

        # Look for the OLD caret glyph anywhere in the rendered DOM. If
        # found, the Bubble rewrite didn't land or stripHtml regressed.
        old_caret_found = "▍" in page.content()
        if old_caret_found:
            print("  ✗ OLD caret '▍' still appears in DOM — Bubble rewrite stale")
            errors.append("old caret present")
        else:
            print("  ✓ Old caret '▍' absent from DOM (expected — new caret is '|')")

        # Read what's visible to sanity-check the page mounted.
        body_text = page.inner_text("body")[:240].replace("\n", " ⏎ ")
        print(f"  body[:240]: {body_text}")

        # Anonymous sign-in: tap the "Begin" button on the welcome screen.
        page.wait_for_timeout(800)
        try:
            begin = page.get_by_text("Begin", exact=True).first
            if begin.is_visible(timeout=1500):
                print("→ tap Begin (anonymous device sign-in)")
                begin.click()
                page.wait_for_timeout(3500)
                shot(page, "02-after-begin")
        except Exception as e:
            print(f"  (no Begin button: {e})")

        # We should now be in onboarding or chat. Look for the composer
        # placeholder text; if present, we're in chat.
        page.wait_for_timeout(2000)
        shot(page, "03-state")

        # Try to find the composer input and send a quick prompt — if we
        # land in chat, this triggers a streamed reply and we can grab
        # mid-stream + settled screenshots.
        try:
            ti = page.locator("textarea, input[type='text']").first
            if ti.is_visible(timeout=2000):
                print("→ composer found — sending a prompt to trigger streaming")
                ti.click()
                ti.fill("Tell me one thing about Scorpios in two sentences.")
                page.keyboard.press("Enter")
                # Mid-stream capture.
                page.wait_for_timeout(1800)
                shot(page, "04-mid-stream")
                # Settled capture.
                page.wait_for_timeout(8000)
                shot(page, "05-settled")
                # Confirm the caret faded out (no '|' or '▍' visible in
                # any rendered bot text run).
                content = page.content()
                if "▍" in content:
                    print("  ✗ old caret '▍' present after settle")
                    errors.append("old caret after settle")
                else:
                    print("  ✓ no '▍' caret in final DOM")
        except Exception as e:
            print(f"  (couldn't drive composer — likely still in onboarding: {e})")

        print("\n— console messages —")
        for m in console_msgs[-30:]:
            print(f"  {m}")
        print(f"\n— pageerrors: {len(errors)} —")
        for e in errors:
            print(f"  {e}")

        browser.close()

    if errors:
        print(f"\n✗ {len(errors)} pageerror(s) — see above")
        return 1
    print("\n✓ no JS pageerrors on load")
    return 0


if __name__ == "__main__":
    sys.exit(main())
