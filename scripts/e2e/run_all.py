"""Driver: runs every e2e_*.py against a single Playwright browser
and prints a PASS/FAIL summary.

Usage (from botella/ root):
    python scripts/e2e/run_all.py

Requires: backend on http://127.0.0.1:8000 + Metro on http://localhost:8081.
The script checks both before doing anything.

Test artifacts: screenshots go to screenshots/e2e/<label>.png.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make `scripts/` importable as a package when run as a script.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from playwright.sync_api import sync_playwright

from scripts.e2e import (
    e2e_chat_persistence,
    e2e_get_to_know,
    e2e_noticing,
    e2e_onboarding_early,
    e2e_people_tab,
    e2e_share_card,
)
from scripts.e2e._runner import check_servers, run_one

# Order matters slightly — chat_persistence + share_card seed
# localStorage; running them BEFORE the onboarding tests keeps each
# session's user_id distinct (we mint a fresh anon every time anyway,
# but order helps when debugging).
TESTS = [
    ("onboarding-early", e2e_onboarding_early.run),
    ("chat-persistence", e2e_chat_persistence.run),
    ("share-card", e2e_share_card.run),
    ("people-tab", e2e_people_tab.run),
    ("get-to-know", e2e_get_to_know.run),
    ("noticing-surface", e2e_noticing.run),
]


def main() -> int:
    print("→ checking backend + Metro reachability…")
    check_servers()
    print("  backend + Metro up")

    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        try:
            for name, fn in TESTS:
                # Each test gets a fresh browser context so localStorage
                # / cookies / WebSockets from a prior test can't leak.
                ctx = browser.new_context(viewport={"width": 1200, "height": 800})
                page = ctx.new_page()
                try:
                    print(f"\n▶ {name}")
                    r = run_one(page, name, fn)
                    print(f"  {r}")
                    results.append(r)
                finally:
                    ctx.close()
        finally:
            browser.close()

    # Summary
    print("\n" + "=" * 60)
    passed = sum(1 for r in results if r.passed)
    failed = sum(1 for r in results if r.passed is False)
    total_ms = sum(r.duration_ms for r in results)
    print(f"E2E SUITE: {passed} passed, {failed} failed in {total_ms / 1000:.1f}s")
    if failed:
        print("\nFailures:")
        for r in results:
            if not r.passed:
                print(f"  ❌ {r.name}: {r.error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
