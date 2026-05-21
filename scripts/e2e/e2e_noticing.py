"""E2E: noticing engine surfaces a queued observation on the user's
next free_chat turn, then clears.

Seeds `pending_noticing` directly on the user_record (no need to drive
the full chat flow that would otherwise produce one). Sends a single
doorway-token user message — `__doorway_reflect` — which routes through
free_chat (so the top-of-dispatch noticing surfacer fires) but ends
in a static doorway reply (no LLM call, no cost, deterministic).

Verifies:
  1. The noticing bubble appears as a bot message AFTER the user
     sends their input but BEFORE / alongside the doorway reply.
  2. `pending_noticing` is cleared on the user record after surfacing.
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


_NOTICING_TEXT = (
    "You've come back to the question about your dad three times this "
    "week — all on Saturn-day Tuesdays. Want to pull on it?"
)


def run(page: Page) -> None:
    session = mint_anon_session()
    uid = session["user_id"]

    # Seed: minimal user state + pending_noticing. Deliberately NO
    # natal_chart — start_trigger with a chart routes to the `checkin`
    # flow which makes an OpenAI call before yielding any events, which
    # would race with the rest of the test. Without a chart, start_trigger
    # routes to onboarding's intro_self state which is a fast static
    # text + chip render (no LLM). We then /reset to clear the flow
    # so the actual test message flows through free_chat dispatch.
    seed_user_record(uid, {
        "name": "Tester",
        "lang": "en",
        "gender": "f",
        "pending_noticing": {
            "text": _NOTICING_TEXT,
            "evidence_key": "anchor:dad:recur3",
            "set_at": "2026-05-21T00:00:00Z",
        },
        "noticings_log": [],
    })

    # Sanity check the seed landed.
    rec = get_user_record(uid)
    assert (rec.get("pending_noticing") or {}).get("text") == _NOTICING_TEXT, (
        f"seed missing — record: {rec}"
    )

    seed_session(page, session["jwt"], uid)
    open_chat(page)

    # iOS auto-/start fires start_trigger → onboarding's choose_lang
    # which emits the language quick_replies prompt (no LLM). Wait
    # until that lands so we know the WS is open + the auto-/start
    # turn has fully completed BEFORE sending /reset (which the
    # runtime can only process AFTER the prior turn ends).
    assert wait_for_bubble_text(page, "Choose your language", timeout_ms=15000), (
        "expected onboarding's language prompt after WS open"
    )

    # Now clear session so the next message dispatches through
    # triggers/free_chat (where the noticing surfacer lives).
    send_text(page, "/reset")
    assert wait_for_bubble_text(page, "Reset.", timeout_ms=8000), (
        "expected /reset acknowledgment before sending the test message"
    )

    # Trigger a free_chat turn that does NOT require the LLM — sending
    # the literal `__doorway_reflect` token routes through free_chat
    # (so the noticing surfacer at the top of dispatch fires) and ends
    # in a static doorway reply. Cost-free + deterministic.
    send_text(page, "__doorway_reflect")

    # The noticing should land as a bot bubble within a second or two
    # — it's just typing() + text() emitted before the doorway dispatch.
    found = wait_for_bubble_text(page, "Saturn-day Tuesdays", timeout_ms=8000)
    shot(page, "e2e_noticing_surface")
    assert found, "expected the pending noticing to surface as a bot bubble"

    # And `pending_noticing` should now be cleared on the record.
    rec_after = get_user_record(uid)
    after_pn = rec_after.get("pending_noticing")
    assert after_pn in (None, {}, ""), (
        f"expected pending_noticing cleared, got: {after_pn}"
    )
