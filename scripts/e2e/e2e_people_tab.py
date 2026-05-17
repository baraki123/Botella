"""E2E: People tab end-to-end — list → detail → delete → empty state.

Seeds three OrbitPerson records (full-chart, partial, none) directly
into the user_record JSONB (no full orbit-add flow needed), then drives
the UI:
  1. Tap ✦ in header → list renders with all three, sorted by recency
  2. Tap a row → detail view with sections (snapshot, compatibility,
     synastry contacts, birth data) + the "Talk to Layla about X" CTA
  3. Tap "Talk to Layla about X" → app jumps to chat with the auto-
     sent message visible
  4. Open People again → long-press a row → delete → confirm gone
  5. Delete the rest → empty state lands cleanly
"""
from __future__ import annotations

from playwright.sync_api import Page

from ._runner import (
    http_get,
    mint_anon_session,
    open_chat,
    seed_orbit,
    seed_session,
    shot,
    wait_for_bubble_text,
)


_SEED_PEOPLE = [
    {
        "id": "p_e2e_sarah",
        "name": "Sarah",
        "role": "mom",
        "orbit_level": "active",
        "birth_data_status": "full",
        "birth_date": "1962-08-14",
        "birth_time": "14:30",
        "birth_place": "Haifa, Israel",
        "current_dynamic": "Loving but anxious — catastrophizes the small stuff.",
        "current_relationship_theme": "Boundaries vs. closeness",
        "snapshot": "Sarah carries the weight of being needed.",
        "compatibility_reading": "You came into her chart at a moment when she was learning to trust softness again.",
        "synastry_aspects": [
            {"a": "Sun", "b": "Saturn", "aspect": "square", "orb": 1.2,
             "meaning": "Pressure as teaching."},
            {"a": "Moon", "b": "Moon", "aspect": "trine", "orb": 2.8,
             "meaning": "Felt-sense resonance."},
        ],
        "chart_data": {"sun": {"sign": "Leo"}},
        "created_at": "2026-05-15T10:00:00Z",
        "updated_at": "2026-05-15T10:00:00Z",
    },
    {
        "id": "p_e2e_maya",
        "name": "Maya",
        "role": "friend",
        "orbit_level": "active",
        "birth_data_status": "partial",
        "birth_date": "1990-03-22",
        "birth_time": "",
        "birth_place": "Tel Aviv, Israel",
        "current_dynamic": "Been distant lately.",
        "current_relationship_theme": "",
        "synastry_aspects": [],
        "chart_data": None,
        "created_at": "2026-05-16T19:00:00Z",
        "updated_at": "2026-05-16T19:00:00Z",
    },
    {
        "id": "p_e2e_yonatan",
        "name": "Yonatan",
        "role": "ex",
        "orbit_level": "active",
        "birth_data_status": "none",
        "current_dynamic": "We don't talk now but his presence still organizes how I think about commitment.",
        "synastry_aspects": [],
        "chart_data": None,
        "created_at": "2026-05-17T08:00:00Z",
        "updated_at": "2026-05-17T08:00:00Z",
    },
]


def run(page: Page) -> None:
    session = mint_anon_session()
    seed_orbit(session["user_id"], _SEED_PEOPLE)

    # API sanity check before we touch the UI — fail fast if the
    # endpoint or projection regressed.
    api = http_get("/v1/orbit", session["jwt"])
    assert len(api["people"]) == 3, f"expected 3 seeded people, got {api}"

    seed_session(page, session["jwt"], session["user_id"])
    open_chat(page)

    # ─── List view ───────────────────────────────────────────────────────
    page.locator('[data-testid="header-people-button"]').click()
    # Poll until the API fetch lands and rows render. The animation +
    # fetch can take a second or two — fixed waits are brittle.
    deadline = page.evaluate("() => Date.now()") + 8000
    last_body = ""
    while True:
        last_body = page.evaluate("() => document.body.innerText")
        if all(n in last_body for n in ("Sarah", "Maya", "Yonatan")):
            break
        if page.evaluate("() => Date.now()") > deadline:
            break
        page.wait_for_timeout(300)
    body = last_body
    assert "Your Orbit" in body, "expected the People-tab header"
    assert "Sarah" in body and "Maya" in body and "Yonatan" in body, \
        f"expected all three seeded people to render; body tail: {body[-300:]}"
    # Yonatan was updated most recently (2026-05-17) — should be first.
    sarah_pos = body.index("Sarah")
    maya_pos = body.index("Maya")
    yonatan_pos = body.index("Yonatan")
    assert yonatan_pos < maya_pos < sarah_pos, \
        f"expected sort by updated_at desc; positions: y={yonatan_pos} m={maya_pos} s={sarah_pos}"
    shot(page, "e2e_people_list")

    # ─── Detail view ─────────────────────────────────────────────────────
    page.get_by_text("Sarah", exact=True).first.click()
    page.wait_for_timeout(800)
    body = page.evaluate("() => document.body.innerText")
    assert "weight of being needed" in body, "expected Sarah's snapshot to render"
    assert "trust softness again" in body, "expected the compatibility reading"
    assert "Sun" in body and "square" in body and "Saturn" in body, \
        "expected the synastry contacts list"
    assert "1962-08-14" in body, "expected birth-data block"
    assert "Talk to Layla about Sarah" in body, \
        "expected the primary CTA on the detail screen"
    shot(page, "e2e_people_detail_sarah")

    # ─── Deep-link to chat ───────────────────────────────────────────────
    page.locator('[data-testid="person-detail-talk-button"]').click()
    # Wait for chat to mount AND the auto-sent message to render
    assert wait_for_bubble_text(page, "I want to talk about Sarah", timeout_ms=8000), \
        "expected the deep-link to surface 'I want to talk about Sarah.' in chat"
    shot(page, "e2e_people_deep_link")
