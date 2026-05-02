"""Headless monitor for the Expo web build via Playwright.

Drives the chat: opens the page, waits for the greeting, walks the conversation,
prints what it sees, saves screenshots at each step. Works in the current Claude
Code session (no MCP setup, no restart) — same capability as @playwright/mcp.

Usage:
    python scripts/monitor.py                # walk the canned demo
    python scripts/monitor.py --interactive  # open browser, leave it for you
    python scripts/monitor.py --shot only    # one screenshot of current state
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

URL = "http://localhost:8081"
SHOTS_DIR = Path("/tmp/botella-shots")


def shot(page: Page, label: str) -> Path:
    SHOTS_DIR.mkdir(exist_ok=True)
    path = SHOTS_DIR / f"{label}.png"
    page.screenshot(path=str(path), full_page=False)
    print(f"  📸 {path}")
    return path


def visible_messages(page: Page) -> list[str]:
    # Grab everything in the FlatList — bot bubbles + user bubbles in order.
    return page.locator("text=/.+/").all_text_contents()


def wait_for_text(page: Page, needle: str, timeout_ms: int = 5000) -> bool:
    end = time.time() + timeout_ms / 1000
    while time.time() < end:
        if needle in page.content():
            return True
        time.sleep(0.1)
    return False


def send_message(page: Page, text: str) -> None:
    box = page.locator('input[placeholder="Message"], textarea[placeholder="Message"]').first
    box.click()
    box.fill(text)
    # The composer's TextInput is multiline (Enter = newline on web), so the
    # button is the canonical submit. Click it.
    # The send button is the only Pressable adjacent to the text input;
    # locate by aria role + position.
    page.locator('div[role="button"], [aria-label="send"]').last.click()


def click_chip(page: Page, label: str) -> None:
    page.get_by_text(label, exact=True).first.click()


def walk_conversation(page: Page) -> int:
    failures = 0

    print("→ open chat")
    page.goto(URL, wait_until="networkidle")
    if not wait_for_text(page, "Echo", 10_000):
        print("  ✗ header 'Echo' not visible")
        failures += 1
    shot(page, "01-open")

    print("→ /start")
    send_message(page, "/start")
    if not wait_for_text(page, "What's your name?", 5000):
        print("  ✗ entry-state prompt not received")
        failures += 1
    shot(page, "02-start")

    print("→ name")
    send_message(page, "Barak")
    if not wait_for_text(page, "Nice to meet you, Barak", 5000):
        print("  ✗ ack not received")
        failures += 1
    if not wait_for_text(page, "What's your favorite color?", 5000):
        print("  ✗ quick_replies prompt not received")
        failures += 1
    shot(page, "03-name")

    print("→ tap 'blue' chip")
    try:
        click_chip(page, "blue")
    except Exception as e:
        print(f"  ✗ chip tap failed: {e}")
        failures += 1
    if not wait_for_text(page, "Got it — Barak likes blue", 5000):
        print("  ✗ Done message not received")
        failures += 1
    shot(page, "04-color")

    print("→ free chat 'hello'")
    send_message(page, "hello")
    # The streamed bubble fills token-by-token; final text contains the message.
    if not wait_for_text(page, "echo to Barak (blue): hello", 6000):
        print("  ✗ streamed reply not visible")
        failures += 1
    shot(page, "05-streaming")

    return failures


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--interactive", action="store_true", help="leave browser open")
    ap.add_argument("--shot", choices=["only"], help="one screenshot, then exit")
    ap.add_argument("--headed", action="store_true", help="show the browser")
    args = ap.parse_args()

    headless = not (args.interactive or args.headed)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=headless)
        ctx = browser.new_context(viewport={"width": 390, "height": 844})  # iPhone 14 size
        page = ctx.new_page()

        page.on("console", lambda msg: print(f"  [console.{msg.type}] {msg.text}"))
        page.on("pageerror", lambda exc: print(f"  [pageerror] {exc}"))

        if args.shot == "only":
            page.goto(URL, wait_until="networkidle")
            shot(page, "snapshot")
            browser.close()
            return 0

        rc = walk_conversation(page)

        if args.interactive:
            print("\n→ browser left open. Ctrl+C to close.")
            try:
                while True:
                    time.sleep(1)
            except KeyboardInterrupt:
                pass

        browser.close()
        return 1 if rc else 0


if __name__ == "__main__":
    sys.exit(main())
