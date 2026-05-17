"""E2E: early onboarding state machine.

Walks from a fresh anonymous session through:
  lang → intro_name → got_intro_name → ask_gender → got_gender →
  first_map_intro → ask_date

That covers every onboarding state EXCEPT the LLM-heavy first-map
build, which costs money + takes ~90s on every run. The first-map
stream is tested separately in test_flows_onboarding.py (mocked LLM)
and the rubric scenario suite (real LLM, manual).

What we assert here is the WIRE shape: the right chips appear, the
right text bubbles arrive in order, the new astro-depth prompt shows
up only AFTER place lookup completes (which we can't drive without
LLM, so we stop just before that).
"""
from __future__ import annotations

from playwright.sync_api import Page

from ._runner import (
    mint_anon_session,
    open_chat,
    seed_session,
    shot,
    wait_for_bubble_text,
)


def run(page: Page) -> None:
    session = mint_anon_session()
    seed_session(page, session["jwt"], session["user_id"])
    open_chat(page)

    # 1. Lang chooser
    assert wait_for_bubble_text(page, "Choose your language", timeout_ms=10000), \
        "expected the bilingual language-chooser opener"

    # 2. Pick English chip
    page.get_by_text("English", exact=True).first.click()
    assert wait_for_bubble_text(page, "nice to meet you", timeout_ms=10000), \
        "expected the introduce_self bot beat after lang pick"
    assert wait_for_bubble_text(page, "What should I call you", timeout_ms=5000), \
        "expected the name prompt"

    # 3. Type a name
    ta = page.locator('[data-testid="composer-input"]').first
    ta.fill("E2E TestUser")
    page.locator('[data-testid="send-button"]').click()

    # Sage-short acknowledgement: just "{name}." — the marketing-copy
    # intention paragraph was removed in the brevity pass.
    assert wait_for_bubble_text(page, "E2E TestUser", timeout_ms=5000), \
        "expected the user's name to appear in their own bubble + Layla's ack"

    # Gender prompt with chips
    assert wait_for_bubble_text(page, "How should I address you", timeout_ms=5000), \
        "expected the gender prompt"

    # 4. Pick Male chip
    page.get_by_text("👦 Male", exact=False).first.click()

    # Trust opener (post-brevity-pass copy): "Let's build your map from
    # your birth details first."
    assert wait_for_bubble_text(page, "build your map from your birth details", timeout_ms=5000), \
        "expected the trust opener after gender pick"

    # Date prompt — post-brevity copy "Date of birth? DD/MM/YYYY."
    assert wait_for_bubble_text(page, "DD/MM/YYYY", timeout_ms=5000), \
        "expected the date prompt"

    # 5. Bad date → invalid_date loop (verifies brevity-pass copy)
    ta.fill("not a real date")
    page.locator('[data-testid="send-button"]').click()
    assert wait_for_bubble_text(page, "Use DD/MM/YYYY", timeout_ms=5000), \
        "expected the sage-short invalid-date copy"

    # 6. Good date → time prompt ("Time of birth? HH:MM, 24h.")
    ta.fill("15/03/1990")
    page.locator('[data-testid="send-button"]').click()
    assert wait_for_bubble_text(page, "Time of birth", timeout_ms=5000), \
        "expected the time prompt after a valid date"

    shot(page, "e2e_onboarding_early_landed_on_time_prompt")
