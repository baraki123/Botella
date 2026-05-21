"""E2E: getting-to-know flow walk-through.

Triggers via /get_to_know slash command (the chip is on the post-map
paginated_read; testing it from a seeded mid-onboarding state would
need more setup, while the slash command Starts the same flow). Walks
five sequential questions — answering three, skipping two — and
asserts:

  1. Each question landed as a bot bubble in order.
  2. The closing line ("Now I know you a little better.") landed.
  3. The four standard doorway chips re-render at the end so the user
     lands back at choice.
  4. The user record now holds the answered fields (gratitude,
     vision_5y, self_recognition) AND active_challenges + anchor_questions
     are unchanged for the skipped questions.
"""
from __future__ import annotations

from playwright.sync_api import Page

from ._runner import (
    get_user_record,
    mint_anon_session,
    open_chat,
    seed_session,
    seed_user_record,
    send_text,
    shot,
    wait_for_bubble_text,
)


def run(page: Page) -> None:
    session = mint_anon_session()
    uid = session["user_id"]

    # Seed: minimal user record — lang determines question language.
    # No natal_chart on purpose so start_trigger routes to onboarding
    # (fast non-LLM intro_self) instead of checkin (LLM opener).
    seed_user_record(uid, {
        "name": "Tester",
        "lang": "en",
        "gender": "f",
    })

    seed_session(page, session["jwt"], uid)
    open_chat(page)

    # Wait for the WS auto-/start turn to finish before sending /reset.
    # The onboarding entry state (choose_lang) emits a quick_replies
    # event with the "Choose your language" prompt (no LLM, fast).
    # Once it lands we know the runtime has returned to receive_text
    # and our /reset will process immediately rather than queue.
    assert wait_for_bubble_text(page, "Choose your language", timeout_ms=15000), (
        "expected onboarding's language prompt after WS open"
    )

    # /get_to_know IS a trigger and would override any active flow,
    # but the runtime processes messages serially per user — sending
    # /reset first gives us a deterministic clean slate.
    send_text(page, "/reset")
    assert wait_for_bubble_text(page, "Reset.", timeout_ms=8000), (
        "expected /reset acknowledgment before kicking off the flow"
    )

    # ─── Trigger the flow ────────────────────────────────────────────────
    send_text(page, "/get_to_know")
    assert wait_for_bubble_text(page, "most grateful for", timeout_ms=8000), (
        "expected Q1 (gratitude) prompt to land"
    )

    # ─── Q1: gratitude — answer with text ────────────────────────────────
    send_text(page, "the early morning walks with my dog")
    assert wait_for_bubble_text(page, "on your mind most", timeout_ms=5000), (
        "expected Q2 (on-your-mind) prompt to land"
    )

    # ─── Q2: on-your-mind — skip ─────────────────────────────────────────
    send_text(page, "/skip")
    assert wait_for_bubble_text(page, "five years from now", timeout_ms=5000), (
        "expected Q3 (vision) prompt to land"
    )

    # ─── Q3: vision — answer with text ───────────────────────────────────
    send_text(page, "running a small design studio in Tel Aviv")
    assert wait_for_bubble_text(page, "keeping you up lately", timeout_ms=5000), (
        "expected Q4 (anchor) prompt to land"
    )

    # ─── Q4: anchor — skip ───────────────────────────────────────────────
    send_text(page, "/skip")
    assert wait_for_bubble_text(page, "most like yourself", timeout_ms=5000), (
        "expected Q5 (self-recognition) prompt to land"
    )

    # ─── Q5: self-recognition — answer with text ─────────────────────────
    send_text(page, "when I'm walking and listening to a long album")
    assert wait_for_bubble_text(page, "know you a little better", timeout_ms=5000), (
        "expected the closing line"
    )

    shot(page, "e2e_get_to_know_complete")

    # ─── Assert the record holds the right fields ───────────────────────
    rec = get_user_record(uid)
    cm = rec.get("current_moment") or {}
    assert (cm.get("gratitude") or "").startswith("the early morning walks"), (
        f"expected gratitude saved, got: {cm.get('gratitude')!r}"
    )
    assert (cm.get("vision_5y") or "").startswith("running a small design studio"), (
        f"expected vision_5y saved, got: {cm.get('vision_5y')!r}"
    )
    assert "walking and listening" in (cm.get("self_recognition") or ""), (
        f"expected self_recognition saved, got: {cm.get('self_recognition')!r}"
    )
    # Q2 and Q4 were skipped — those slots should be untouched / empty.
    assert not (cm.get("active_challenges") or []), (
        f"expected active_challenges empty after Q2 /skip, got: {cm.get('active_challenges')!r}"
    )
    assert not (rec.get("anchor_questions") or []), (
        f"expected anchor_questions empty after Q4 /skip, got: {rec.get('anchor_questions')!r}"
    )

    # ─── Doorway chips re-render ────────────────────────────────────────
    body = page.evaluate("() => document.body.innerText")
    assert "Go deeper" in body or "deeper on the map" in body, (
        f"expected the 4 doorway chips to re-render; tail: {body[-400:]}"
    )
