"""Drive the Layla sketch end-to-end against MemoryStorage.

This is the proof that botella's Flow primitive holds up under Layla's real
complexity: callback_data inside flow states, validation loops with Stay,
chained Goto across multiple states, branching to a disambiguation state,
Done(carry={...}) handing the chart to the user record.
"""

from __future__ import annotations

import pytest

from botella import InboundMessage, runtime
from examples.layla_sketch.manifest import build_manifest


async def _send(manifest, user_id: str, **kwargs) -> list:
    msg = InboundMessage(user_id=user_id, transport="test", **kwargs)
    return [e async for e in runtime.run(msg, manifest)]


def _texts(events) -> list[str]:
    return [e.payload["text"] for e in events if e.type == "text"]


def _qrs(events) -> list[dict]:
    return [e.payload for e in events if e.type == "quick_replies"]


# ─── Onboarding happy path ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_onboarding_full_callback_path():
    """English + Male + unambiguous city, all callbacks where Layla uses them."""
    m = build_manifest()
    u = "u1"

    out = await _send(m, u, text="/start")
    assert _qrs(out)[0]["prompt"] == "Hi! Pick your language."

    out = await _send(m, u, callback_data="lang_en")
    assert _texts(out) == ["What's your name?"]

    out = await _send(m, u, text="Barak")
    assert _texts(out)[0] == "Nice to meet you, Barak."
    assert _qrs(out)[0]["options"] == ["Male", "Female"]

    out = await _send(m, u, callback_data="gender_m")
    assert _texts(out) == ["Birth date? (DD/MM/YYYY)"]

    out = await _send(m, u, text="15/03/1990")
    assert _texts(out)[0].startswith("Birth time?")

    out = await _send(m, u, text="14:30")
    assert _texts(out) == ["Birth city?"]

    out = await _send(m, u, text="Tel Aviv")
    assert _texts(out) == [
        "Got it. Sun in Pisces — full chart on the way.",
        "When you're ready, /gettoknow lets me ask a few questions.",
    ]

    user = await m.storage.get_user(u)
    assert user["name"] == "Barak"
    assert user["gender"] == "m"
    assert user["lang"] == "en"
    chart = user["natal_chart"]
    assert chart["sun"] == "Pisces"
    assert chart["place"] == "Tel Aviv, Israel"
    assert chart["timezone"] == "Asia/Jerusalem"
    assert chart["birth_time"] == "14:30:00"

    # Session is reset (Done resets when flow stack empty).
    s = await m.storage.load_session(u)
    assert s.flow is None
    assert s.state is None


@pytest.mark.asyncio
async def test_onboarding_text_path_for_ios_client():
    """iOS app sends labels as text, not callback_data — both paths must work."""
    m = build_manifest()
    u = "ios"
    await _send(m, u, text="/start")
    await _send(m, u, text="English")
    await _send(m, u, text="Mira")
    await _send(m, u, text="Female")
    await _send(m, u, text="01/06/1995")
    await _send(m, u, text="/skip")  # no birth time
    out = await _send(m, u, text="Haifa")
    assert _texts(out)[0].startswith("Got it.")
    user = await m.storage.get_user(u)
    assert user["gender"] == "f"
    assert user["natal_chart"]["birth_time"] is None
    assert user["natal_chart"]["sun"] == "Gemini"


# ─── Validation / Stay loops ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_invalid_lang_keeps_state():
    m = build_manifest()
    u = "u-lang"
    await _send(m, u, text="/start")
    out = await _send(m, u, text="francais")  # not a recognized language
    assert _texts(out) == ["Please tap one of the buttons."]
    s = await m.storage.load_session(u)
    assert s.state == "got_lang"


@pytest.mark.asyncio
async def test_invalid_date_formats_loop_in_got_date():
    m = build_manifest()
    u = "u-date"
    await _send(m, u, text="/start")
    await _send(m, u, callback_data="lang_en")
    await _send(m, u, text="Tester")
    await _send(m, u, callback_data="gender_f")

    out = await _send(m, u, text="March 15 1990")  # wrong format
    assert _texts(out) == ["Please use DD/MM/YYYY (e.g. 15/03/1990)."]
    s = await m.storage.load_session(u)
    assert s.state == "got_date"

    out = await _send(m, u, text="31/02/1990")  # impossible date
    assert _texts(out) == ["That's not a valid date. Try again, DD/MM/YYYY."]
    s = await m.storage.load_session(u)
    assert s.state == "got_date"

    # Recover with a valid date — should advance.
    out = await _send(m, u, text="15/03/1990")
    assert _texts(out)[0].startswith("Birth time?")
    s = await m.storage.load_session(u)
    assert s.state == "got_time"


@pytest.mark.asyncio
async def test_invalid_time_loops_then_skip_works():
    m = build_manifest()
    u = "u-time"
    await _send(m, u, text="/start")
    await _send(m, u, callback_data="lang_en")
    await _send(m, u, text="Tester")
    await _send(m, u, callback_data="gender_f")
    await _send(m, u, text="15/03/1990")

    out = await _send(m, u, text="2:30 PM")
    assert _texts(out) == ["HH:MM, please. Or /skip."]

    out = await _send(m, u, text="25:99")  # parses but invalid clock
    assert _texts(out) == ["That's not a valid time. Try again or /skip."]

    out = await _send(m, u, text="/skip")
    assert _texts(out) == ["Birth city?"]


@pytest.mark.asyncio
async def test_unknown_city_loops_in_got_place():
    m = build_manifest()
    u = "u-place"
    await _send(m, u, text="/start")
    await _send(m, u, callback_data="lang_en")
    await _send(m, u, text="Tester")
    await _send(m, u, callback_data="gender_f")
    await _send(m, u, text="15/03/1990")
    await _send(m, u, text="/skip")

    out = await _send(m, u, text="Atlantis")
    assert _texts(out) == ["I couldn't find 'Atlantis'. Try a larger nearby city."]
    s = await m.storage.load_session(u)
    assert s.state == "got_place"


# ─── Place disambiguation branch ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_ambiguous_city_routes_through_disambiguate_state():
    m = build_manifest()
    u = "u-amb"
    await _send(m, u, text="/start")
    await _send(m, u, callback_data="lang_en")
    await _send(m, u, text="Tester")
    await _send(m, u, callback_data="gender_f")
    await _send(m, u, text="15/03/1990")
    await _send(m, u, text="/skip")

    out = await _send(m, u, text="Springfield")
    qr = _qrs(out)
    assert qr and qr[0]["prompt"] == "A few matches — which one?"
    assert len(qr[0]["options"]) == 3
    s = await m.storage.load_session(u)
    assert s.state == "disambiguate_place"
    assert len(s.data["place_candidates"]) == 3

    # Bad callback_data → Stay
    out = await _send(m, u, callback_data="place_pick:99")
    assert _texts(out) == ["Tap one of the options."]
    s = await m.storage.load_session(u)
    assert s.state == "disambiguate_place"

    # Good callback_data → save_chart → Done
    out = await _send(m, u, callback_data="place_pick:1")  # MA
    assert _texts(out)[0].startswith("Got it.")
    user = await m.storage.get_user(u)
    assert user["natal_chart"]["place"] == "Springfield, MA, USA"
    assert user["natal_chart"]["timezone"] == "America/New_York"
    s = await m.storage.load_session(u)
    assert s.flow is None  # cleared by Done
    assert "place_candidates" not in s.data  # cleaned up before Done


@pytest.mark.asyncio
async def test_disambiguate_text_fallback_for_ios():
    m = build_manifest()
    u = "u-amb-text"
    await _send(m, u, text="/start")
    await _send(m, u, callback_data="lang_en")
    await _send(m, u, text="Tester")
    await _send(m, u, callback_data="gender_f")
    await _send(m, u, text="15/03/1990")
    await _send(m, u, text="/skip")
    await _send(m, u, text="Springfield")
    out = await _send(m, u, text="Springfield, MO, USA")
    assert _texts(out)[0].startswith("Got it.")
    user = await m.storage.get_user(u)
    assert user["natal_chart"]["place"] == "Springfield, MO, USA"


# ─── /start re-entry semantics ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_returning_user_recognized_on_start():
    m = build_manifest()
    u = "u-return"
    # Complete onboarding
    await _send(m, u, text="/start")
    await _send(m, u, callback_data="lang_en")
    await _send(m, u, text="Yael")
    await _send(m, u, callback_data="gender_f")
    await _send(m, u, text="15/03/1990")
    await _send(m, u, text="/skip")
    await _send(m, u, text="Haifa")

    out = await _send(m, u, text="/start")
    assert _texts(out) == ["Welcome back, Yael."]
    s = await m.storage.load_session(u)
    assert s.flow is None


@pytest.mark.asyncio
async def test_reset_aborts_mid_flow():
    m = build_manifest()
    u = "u-reset"
    await _send(m, u, text="/start")
    await _send(m, u, callback_data="lang_en")
    await _send(m, u, text="Half-Done")
    # Mid-flow at ask_gender now
    out = await _send(m, u, text="/reset")
    assert _texts(out) == ["Reset."]
    s = await m.storage.load_session(u)
    assert s.flow is None
    # Free chat works
    out = await _send(m, u, text="hello")
    completes = [e for e in out if e.type == "complete"]
    assert completes and "stranger" in completes[0].payload["text"]


# ─── Two users isolated ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_two_users_isolated():
    m = build_manifest()
    a, b = "a", "b"
    await _send(m, a, text="/start")
    await _send(m, a, callback_data="lang_en")
    await _send(m, a, text="Alice")

    # B starts fresh — should still see lang prompt.
    out = await _send(m, b, text="/start")
    assert _qrs(out)[0]["prompt"] == "Hi! Pick your language."

    # A's session still parked at ask_gender, B's at got_lang.
    sa = await m.storage.load_session(a)
    sb = await m.storage.load_session(b)
    assert sa.state == "got_gender"
    assert sb.state == "got_lang"
    assert sa.data["name"] == "Alice"
    assert "name" not in sb.data


# ─── Intake (post-onboarding sub-flow) ───────────────────────────────────────


@pytest.mark.asyncio
async def test_gettoknow_routes_to_onboarding_first_if_no_chart():
    m = build_manifest()
    u = "u-gk-fresh"
    out = await _send(m, u, text="/gettoknow")
    assert _texts(out) == ["Let's set up your chart first."]
    s = await m.storage.load_session(u)
    assert s.flow == "onboarding"


@pytest.mark.asyncio
async def test_intake_runs_three_questions_and_carries_answers():
    m = build_manifest()
    u = "u-intake"

    # Onboard
    await _send(m, u, text="/start")
    await _send(m, u, callback_data="lang_en")
    await _send(m, u, text="Noa")
    await _send(m, u, callback_data="gender_f")
    await _send(m, u, text="15/03/1990")
    await _send(m, u, text="/skip")
    await _send(m, u, text="Haifa")

    out = await _send(m, u, text="/gettoknow")
    assert _texts(out) == ["Where are you at in life right now?"]

    # Empty answer → Stay
    out = await _send(m, u, text="")
    assert _texts(out) == ["Take your time — anything works."]

    out = await _send(m, u, text="In transition.")
    assert _texts(out) == ["What's the biggest thing on your mind these days?"]

    out = await _send(m, u, text="Career.")
    assert _texts(out) == ["Anyone you want me to keep in mind when reading for you?"]

    out = await _send(m, u, text="My partner.")
    assert _texts(out) == ["Thanks. I've saved that."]

    user = await m.storage.get_user(u)
    assert user["intake_answers"] == ["In transition.", "Career.", "My partner."]
    # Onboarding-carried fields are still intact.
    assert user["name"] == "Noa"
    assert user["natal_chart"]["sun"] == "Pisces"

    s = await m.storage.load_session(u)
    assert s.flow is None
