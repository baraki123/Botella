"""Layla onboarding sketched against botella, MemoryStorage-only.

Mirrors the structure of GombiStar/handlers/onboarding.py — same state names,
same callback_data values, same DD/MM/YYYY validation, same place-disambiguation
fork — but rewritten on top of botella primitives. NO GombiStar code is touched;
chart.py stubs the geocode + natal-chart integrations.

The point is to prove the abstraction holds for the real complexity (callbacks
inside a flow, branching paths, validation loops with Stay, chained Goto states,
nested data on session.data, Done(carry={...}) handing data to the user record)
BEFORE we go modify GombiStar's actual code.

State map — names match GombiStar's ConversationHandler IDs:

  CHOOSE_LANG     callback (lang_en | lang_he)         -> ASK_NAME
  ASK_NAME        text                                  -> ASK_GENDER
  ASK_GENDER      callback (gender_m | gender_f)        -> ASK_DATE
  ASK_DATE        text DD/MM/YYYY                       -> ASK_TIME
  ASK_TIME        text HH:MM | /skip                    -> ASK_PLACE
  ASK_PLACE       text city                             -> SAVE_CHART | DISAMBIGUATE
  DISAMBIGUATE    callback place_pick:N                 -> SAVE_CHART
  SAVE_CHART      (chained, no input)                   -> Done(carry=natal)

A second `intake` Flow models the 3-question follow-up Layla runs after
onboarding (started via /gettoknow). Real Layla generates Q2..Q7 from Claude;
the sketch keeps them scripted to stay focused on flow mechanics.
"""

from __future__ import annotations

import re
from datetime import date as date_cls, time as time_cls

from botella import (
    BotManifest,
    Done,
    Flow,
    Goto,
    Start,
    Stay,
    WaitFor,
    complete,
    quick_replies,
    text,
    typing,
)
from botella.storage import MemoryStorage

from examples.layla_sketch.chart import (
    GeoCandidate,
    build_natal_chart,
    geocode_city,
)


# ─── Onboarding flow ─────────────────────────────────────────────────────────

onboarding = Flow("onboarding")


@onboarding.state("choose_lang", entry=True)
async def choose_lang(msg, session, storage):
    return [
        quick_replies(
            ["English", "עברית"],
            prompt="Hi! Pick your language.",
        ),
    ], WaitFor("got_lang")


@onboarding.state("got_lang")
async def got_lang(msg, session, storage):
    cb = msg.callback_data or ""
    txt = (msg.text or "").strip().lower()
    if cb == "lang_en" or txt in ("english", "en"):
        session.data["lang"] = "en"
    elif cb == "lang_he" or txt in ("hebrew", "he") or (msg.text or "").strip() == "עברית":
        session.data["lang"] = "he"
    else:
        return [text("Please tap one of the buttons.")], Stay()
    return [], Goto("ask_name")


@onboarding.state("ask_name")
async def ask_name(msg, session, storage):
    return [text("What's your name?")], WaitFor("got_name")


@onboarding.state("got_name")
async def got_name(msg, session, storage):
    name = (msg.text or "").strip()
    if not name or len(name) > 60:
        return [text("I didn't catch that — what should I call you?")], Stay()
    session.data["name"] = name
    return [text(f"Nice to meet you, {name}.")], Goto("ask_gender")


@onboarding.state("ask_gender")
async def ask_gender(msg, session, storage):
    return [
        quick_replies(
            ["Male", "Female"],
            prompt="What's your gender? (helps me get pronouns right)",
        ),
    ], WaitFor("got_gender")


@onboarding.state("got_gender")
async def got_gender(msg, session, storage):
    cb = msg.callback_data or ""
    txt = (msg.text or "").strip().lower()
    if cb == "gender_m" or txt in ("male", "m"):
        session.data["gender"] = "m"
    elif cb == "gender_f" or txt in ("female", "f"):
        session.data["gender"] = "f"
    else:
        return [text("Pick one of the options.")], Stay()
    return [], Goto("ask_date")


@onboarding.state("ask_date")
async def ask_date(msg, session, storage):
    return [text("Birth date? (DD/MM/YYYY)")], WaitFor("got_date")


_DATE_RE = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*$")


@onboarding.state("got_date")
async def got_date(msg, session, storage):
    m = _DATE_RE.match(msg.text or "")
    if not m:
        return [text("Please use DD/MM/YYYY (e.g. 15/03/1990).")], Stay()
    day, month, year = (int(g) for g in m.groups())
    try:
        birth_date = date_cls(year, month, day)
    except ValueError:
        return [text("That's not a valid date. Try again, DD/MM/YYYY.")], Stay()
    session.data["birth_date"] = birth_date.isoformat()
    return [], Goto("ask_time")


@onboarding.state("ask_time")
async def ask_time(msg, session, storage):
    return [
        text(
            "Birth time? (HH:MM, 24h)\n"
            "Send /skip if you don't know — readings are less precise but still useful."
        ),
    ], WaitFor("got_time")


_TIME_RE = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*$")


@onboarding.state("got_time")
async def got_time(msg, session, storage):
    raw = (msg.text or "").strip()
    if raw == "/skip":
        session.data["birth_time"] = None
        return [], Goto("ask_place")
    m = _TIME_RE.match(raw)
    if not m:
        return [text("HH:MM, please. Or /skip.")], Stay()
    try:
        birth_time = time_cls(int(m.group(1)), int(m.group(2)))
    except ValueError:
        return [text("That's not a valid time. Try again or /skip.")], Stay()
    session.data["birth_time"] = birth_time.isoformat()
    return [], Goto("ask_place")


@onboarding.state("ask_place")
async def ask_place(msg, session, storage):
    return [text("Birth city?")], WaitFor("got_place")


@onboarding.state("got_place")
async def got_place(msg, session, storage):
    query = (msg.text or "").strip()
    if not query:
        return [text("Please type a city name.")], Stay()
    candidates = geocode_city(query)
    if not candidates:
        return [text(f"I couldn't find '{query}'. Try a larger nearby city.")], Stay()
    if len(candidates) == 1:
        _store_geo(session, candidates[0])
        return [], Goto("save_chart")
    session.data["place_candidates"] = [
        {"name": c.name, "lat": c.lat, "lng": c.lng, "timezone": c.timezone}
        for c in candidates
    ]
    return [
        quick_replies(
            [c.name for c in candidates],
            prompt="A few matches — which one?",
        ),
    ], WaitFor("disambiguate_place")


@onboarding.state("disambiguate_place")
async def disambiguate_place(msg, session, storage):
    candidates = session.data.get("place_candidates", [])
    chosen: dict | None = None
    cb = msg.callback_data or ""
    if cb.startswith("place_pick:"):
        try:
            idx = int(cb.split(":", 1)[1])
        except ValueError:
            idx = -1
        if 0 <= idx < len(candidates):
            chosen = candidates[idx]
    if chosen is None:
        # Text fallback so iOS clients can send the label string directly.
        txt = (msg.text or "").strip().lower()
        for c in candidates:
            if c["name"].lower() == txt:
                chosen = c
                break
    if chosen is None:
        return [text("Tap one of the options.")], Stay()
    _store_geo(session, GeoCandidate(**chosen))
    session.data.pop("place_candidates", None)
    return [], Goto("save_chart")


@onboarding.state("save_chart")
async def save_chart(msg, session, storage):
    name = session.data["name"]
    birth_date = date_cls.fromisoformat(session.data["birth_date"])
    birth_time = (
        time_cls.fromisoformat(session.data["birth_time"])
        if session.data.get("birth_time")
        else None
    )
    geo = GeoCandidate(
        name=session.data["place_name"],
        lat=session.data["place_lat"],
        lng=session.data["place_lng"],
        timezone=session.data["place_timezone"],
    )
    chart = build_natal_chart(
        name=name, birth_date=birth_date, birth_time=birth_time, geo=geo,
    )
    return (
        [
            text(f"Got it. Sun in {chart['sun']} — full chart on the way."),
            text("When you're ready, /gettoknow lets me ask a few questions."),
        ],
        Done(
            carry={
                "lang": session.data["lang"],
                "name": name,
                "gender": session.data["gender"],
                "natal_chart": chart,
            },
        ),
    )


def _store_geo(session, geo: GeoCandidate) -> None:
    session.data["place_name"] = geo.name
    session.data["place_lat"] = geo.lat
    session.data["place_lng"] = geo.lng
    session.data["place_timezone"] = geo.timezone


# ─── Intake flow (post-onboarding Q&A) ───────────────────────────────────────

intake = Flow("intake")

_INTAKE_QUESTIONS = [
    "Where are you at in life right now?",
    "What's the biggest thing on your mind these days?",
    "Anyone you want me to keep in mind when reading for you?",
]


@intake.state("ask", entry=True)
async def intake_ask(msg, session, storage):
    idx = session.data.get("q", 0)
    if idx >= len(_INTAKE_QUESTIONS):
        return (
            [text("Thanks. I've saved that.")],
            Done(carry={"intake_answers": session.data.get("answers", [])}),
        )
    return [text(_INTAKE_QUESTIONS[idx])], WaitFor("got_answer")


@intake.state("got_answer")
async def intake_got_answer(msg, session, storage):
    ans = (msg.text or "").strip()
    if not ans:
        return [text("Take your time — anything works.")], Stay()
    session.data.setdefault("answers", []).append(ans)
    session.data["q"] = session.data.get("q", 0) + 1
    return [], Goto("ask")


# ─── Triggers ────────────────────────────────────────────────────────────────


async def start_trigger(msg, session, storage):
    user = await storage.get_user(session.user_id)
    if "natal_chart" in user:
        return [text(f"Welcome back, {user['name']}.")], None
    return [], Start("onboarding")


async def gettoknow_trigger(msg, session, storage):
    user = await storage.get_user(session.user_id)
    if "natal_chart" not in user:
        return [text("Let's set up your chart first.")], Start("onboarding")
    return [], Start("intake")


async def reset_trigger(msg, session, storage):
    session.flow = None
    session.state = None
    session.data = {}
    return [text("Reset.")], None


# ─── Free chat (stub — Layla's claude_service goes here) ─────────────────────


async def free_chat(msg, session, storage):
    user = await storage.get_user(session.user_id)
    name = user.get("name", "stranger")
    full = f"(Layla → {name}): {msg.text or ''}"
    yield typing()
    yield complete(full)


# ─── Manifest ────────────────────────────────────────────────────────────────


def build_manifest() -> BotManifest:
    return BotManifest(
        name="layla-sketch",
        storage=MemoryStorage(),
        flows=[onboarding, intake],
        triggers={
            "/start": start_trigger,
            "/gettoknow": gettoknow_trigger,
            "/reset": reset_trigger,
        },
        free_chat=free_chat,
    )
