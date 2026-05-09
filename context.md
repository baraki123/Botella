# botella — handoff

> A fresh Claude session can read this top-to-bottom and pick up the work
> cold. Last updated 2026-05-08. If anything disagrees with the running
> system, trust the system and update this file. The other authoritative
> doc is `botella/spec.md` (current product spec). Core value:
> *"we add value to the user."*

---

## 0. Where we are right now

**The chat-first redesign (Map / Moment / Orbit) is LIVE in production.**
Telegram (`@laylastarbot`) and the iOS/web app both speak to the same
FastAPI service on `bot_botella.py`. The 14-section linear onboarding
walk has been replaced with: lang → gender → trust opener → birth
data → name → first map read (deep, 9 sections, chart-only) →
**paginated section reveal with section-aware Continue chips** → post-
map pause + 4 doorway chips (situation / person / question / reflect)
→ Done. After Done, free_chat handles all turns with Map+Moment+Orbit
context injected into the system prompt.

**Production endpoint:** `https://http--laylabot--28ttnydqvqwp.code.run`
- `GET /health` → `{"ok": true, "bot": "layla"}`
- `GET /healthz` → `{"ok": true}` (Northflank LB liveness probe; silences 404 log spam)
- `GET /v1/me` → `{user_id, is_admin, build:{sha, note, commit_time, boot_time}}` (JWT)
- `POST /v1/auth/anonymous` / `POST /v1/auth/apple` / `DELETE /v1/account`
- `POST /v1/account/link/redeem` (Telegram→iOS migration)
- `POST /v1/messages` (HTTP request-collection)
- `WSS /v1/stream` (token streaming chat, with 8s typing keep-alive injected)
- `POST /v1/voice` (multipart audio → transcript)
- `POST /v1/push/register` (Expo push token)
- `POST /webhooks/telegram` (validates `X-Telegram-Bot-Api-Secret-Token`)

**LLM provider:** OpenAI (env `LAYLA_LLM_PROVIDER=openai`). Two tiers:
chat / extractions ride **`gpt-4.1`**, marquee outputs (first map
read, chart cards, daily readings, transit alerts, teaser, lessons,
compatibility) ride **`gpt-5.4`**. The first map read is intentionally
the most expensive call in the product — a single 4500-token reasoning
call that takes ~60s and produces a 12-15k char psychological mirror.

**Build provenance:** `/v1/me` returns the deployed git SHA + commit
subject + timestamp, sourced from `LAYLA_BUILD_VERSION/_NOTE/_TIME`
env vars stamped on Northflank after every push (see §6). iOS shows
admin a one-shot "✦ Layla {sha} · {time} is live" banner on session
open.

**Shipped 2026-05-08 (this session — chat-first redesign + cleanup):**

- **`spec.md` saved at repo root.** Core value: *"we add value to the
  user."* This is the active product spec — replaces the §12 stub
  below. Naming note: production code stays "Layla"; spec text uses
  "Laila" as the persona — same product.

- **New 9-section first map read prompt** (`personality/first_map_read_prompt.md`):
  Deep Realization → Executive Summary → Core Signature → Emotional
  Pattern → Relationship Blueprint → Work/Purpose/Direction → Shadow
  Pattern → Mature Expression → Core Instruction. Generated from chart
  data ONLY (no life questions before — trust principle). Loaded via
  `personality.get_first_map_read_prompt()`. Drives
  `services.claude_service.generate_first_map_read()`.

- **New data layer (JSONB on `layla_user_records.data`, no SQL migration):**
  - `living_map` — stable LivingMap projection extracted from the
    first map read (7 fields: core_identity, emotional_pattern,
    relationship_blueprint, vocation_signature, shadow_patterns,
    mature_expression, core_instruction).
  - `current_moment` — live 7-domain context (body/health, career/money,
    romance, dating, emotions, self-understanding, spirituality) +
    anchor_questions / active_decisions / active_challenges / current
    emotional state / current life season. Updated quietly by a JSON-
    only LLM call after every chat turn.
  - `orbit` — list of OrbitPerson objects (name, role, optional birth
    data, dynamic summary, etc).
  - Multi-turn `orbit_pending` state machine for conversational orbit
    creation: awaiting_accept → asked_role → asked_intent → asked_birth
    → confirmation. State is durable across WS drops.
  - `orbit_suggestion_pending` — queue from background orbit-detect
    LLM call; surfaced on the user's NEXT turn as a yes/no chip pair.
  - `first_map_read_text` — the raw 12-15k char first map read.
  - `chat_history` — last 20 turns; durable per-user.
  - `active_doorway` / `active_doorway_at` — which doorway slug the
    user just tapped (cleared after the next LLM turn frames it).
  - `anchor_questions` — recurring questions the user has named.

- **New services (in GombiStar):**
  - `services/laila_state.py` — typed projections + helpers (LivingMap,
    CurrentMoment, OrbitPerson, doorway tokens, dedup_capped helper,
    `_now_iso()`, `build_chat_context_block()`).
  - `services/laila_chat.py` — chat-turn helpers (doorway detection,
    multi-turn orbit-pending flow, communication-help intent, fire-
    and-forget moment_update + orbit_detect schedulers with INFLIGHT
    pop-race protection).
  - `flows/_shared.py` — `parse_dmy_strict` + `find_dmy_in_text`.

- **`flows/onboarding.py` rewritten** end-to-end: lang → gender →
  trust opener ("Before I ask anything about your life…") → date →
  time → place → name (LAST, ALWAYS asked — no skip-when-record-has-name
  shortcut) → save_chart → build_first_map (idempotent, 3 resume gates)
  → emit_first_map (paginated; one section per state-hop with a
  section-aware Continue chip "(N / 9)"). After section 9, post-map
  pause + 4 doorway chips → Done.

- **`botella_manifest.py:free_chat` rewritten:**
  1. doorway tap → static reply (no LLM, persisted to chat_history)
  2. orbit-pending turn → drive multi-step creation
  3. LLM stream with `system_extras: list[str]` carrying the doorway
     hint + communication-help directive + Map+Moment+Orbit context
     block (single param, replaces earlier `extra_context` +
     `mode_directive` sprawl).
  4. post-LLM: ONE `storage.get_user(uid)` reused for orbit-suggestion
     surfacing AND the orbit-detect gate (was 3 sequential reads).
  5. fire-and-forget Moment update + Orbit detection background tasks.

- **iOS (`layla-app/`):**
  - `Bubble.tsx`: `## headings` (the 9 first-map section titles)
    render in the serif display face (Cochin) with warmer line height.
    `**bold**` tokens tint to softer gold. `stripHtml()` converts
    `<b>`/`<i>` → markdown so server copy works on Telegram (HTML
    native) and iOS (markdown rendered) without branching. `useMemo`
    around `stripHtml` so streaming-token re-renders don't re-walk
    the regex chain on every paint.
  - `QuickReplies.tsx`: doorway chips (values starting `__doorway_`)
    get a serif label + soft gold halo, but the SAME chrome size as
    chat-flow chips (earlier oversized version was rolled back per
    user feedback).
  - `ChatScreen.tsx`: viewport stability fix — completed bot bubbles
    NEVER auto-scroll; user-msg echoes + streaming tokens sticky-
    bottom only when the user is actually at the bottom (`isAtBottomRef`).
    The "↓ Latest" pill surfaces immediately when new content lands
    below the viewport. Removed the unused `messageHeightsRef` +
    per-row `onLayout` callback. FlatList virtualization tuned
    (`initialNumToRender=50`, `windowSize=50`, `removeClippedSubviews=
    false`) so older messages stay mounted defensively.

- **Apps still on Telegram path get the SAME redesign** since
  free_chat / onboarding are transport-agnostic. The doorway chips
  render as Telegram inline keyboard buttons; the section pagination
  uses Telegram's continue-chip pattern.

**Test status:** 72 botella + 166 GombiStar tests pass.

The §12 stub at the bottom of this file describes the OLD pending
redesign — that's been superseded by the live shipped version above
and `spec.md`. Leave §12 in place for historical context but trust
spec.md.

---

## 1. Three repos, one product

```
~/Desktop/Coding/
├── botella/        ← THIS REPO. Public on GitHub: baraki123/Botella
│                     Framework + mobile-template + layla-app + this doc.
│                     No deploy target — used as a pip dep by GombiStar.
│
├── GombiStar/      ← Layla's brain. Private: baraki123/GombiStar
│                     Prompts, personality, handlers/, services/, manifest.
│                     Northflank auto-deploys from main on push.
│                     LAYLA_BUILD_* env stamped via API after each push.
│
└── event-e-fire/   ← Second bot (event scraping → Calendar links).
                      Stateless. Not ported to botella. Different product;
                      flag wrong-tab pastes.
```

**Why botella is public:** GombiStar's Docker build does
`pip install git+https://github.com/baraki123/Botella.git@main`
without auth. Framework code is generic; secrets and prompts stay
in GombiStar.

---

## 2. Architecture (unchanged in shape)

```
                ┌─────────────────────────────────┐
                │  bot's Python brain             │
                │  (handlers, services, llm)      │
                └─────────────┬───────────────────┘
                              │
                  ┌───────────▼───────────┐
                  │   BotManifest         │  ← single integration point
                  │   - flows[]           │     (one per bot)
                  │   - triggers{}        │
                  │   - free_chat         │
                  │   - voice_handler     │
                  │   - link_code_resolver│
                  │   - storage           │
                  └───────────┬───────────┘
                              │
                  ┌───────────▼───────────┐
                  │   runtime.run()       │  ← async dispatcher
                  │   triggers > flows >  │
                  │   free_chat           │
                  └───────────┬───────────┘
                              │ yields OutboundEvents
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼─────┐         ┌─────▼─────┐         ┌─────▼─────┐
   │ Telegram │         │   HTTP    │         │ WebSocket │
   │ adapter  │         │  adapter  │         │  adapter  │
   │ (PTB)    │         │ POST /v1  │         │ WSS /v1   │
   │ webhook  │         │ /messages │         │ /stream   │
   │ + buffer │         │           │         │ + 8s      │
   │ tokens   │         │           │         │ keepalive │
   └──────────┘         └───────────┘         └───────────┘
```

**Storage Protocol** (botella/contract.py): `load_session`,
`save_session`, `resolve_identity`, `link_identity` (Apple linking),
`get_user`, `update_user`, `delete_user`, `merge_users` (Telegram→iOS
migration). Layla implements via `database/storage.py` →
`PostgresStorage` against Neon.

**Identity model:**
- `layla_user_identities (provider, external_id) → internal_user_id (UUID)`
- providers: `telegram` (BIGINT as string), `anonymous` (device UUID), `apple` (sub)
- `merge_users` re-points all identity rows from `from_user_id` to
  `to_user_id` and drops the from-side session/record/codes. Used when
  a user redeems a `/link` code on iOS.
- Bots see only `internal_user_id`. Adapters resolve at the edge.

---

## 3. What's in this repo (botella)

```
botella/                              public on GitHub: baraki123/Botella
├── botella/                          installable package
│   ├── contract.py                   InboundMessage, OutboundEvent, Storage,
│   │                                 BotManifest (link_code_resolver field),
│   │                                 transitions
│   ├── runtime.py                    dispatcher
│   ├── app.py                        create_app(manifest) → FastAPI w/ all routes
│   ├── push.py                       /v1/push/register + proactive_send
│   ├── storage/memory.py             in-memory impl (incl. merge_users)
│   ├── auth/
│   │   ├── jwt.py                    HS256 mint/verify, 90-day TTL
│   │   ├── apple.py                  Apple identity-token verifier; aud is
│   │   │                             COMMA-SEPARATED so Expo Go's bundle id
│   │   │                             (host.exp.Exponent) AND the real bundle
│   │   │                             (app.layla.ios) both validate
│   │   └── routes.py                 /v1/auth/{anonymous,apple} + /v1/account
│   │                                 + /v1/account/link/redeem
│   └── adapters/
│       ├── http.py                   /v1/messages + /v1/voice
│       ├── ws.py                     /v1/stream. _with_keepalive wrapper
│       │                             injects a typing frame every 8s while
│       │                             the runtime is silent — proxies see
│       │                             traffic during slow chart builds.
│       └── telegram.py               PTB wrapper. Webhook + secret check.
│
├── examples/echo_bot/                exercise primitives
├── tests/                            72 passing
│
├── layla-app/                        First product fork. Layla branding.
│   ├── app.json                      bundle app.layla.ios; mic + photo perms
│   ├── eas.json                      development / preview / production
│   └── src/
│       ├── api/
│       │   ├── stream.ts             WS client w/ reconnect + outbox
│       │   ├── link.ts               redeemLinkCode helper
│       │   └── me.ts                 fetchMe — build provenance + is_admin
│       ├── auth/                     anonymous + Apple
│       ├── chat/
│       │   ├── ChatScreen.tsx        viewport-stable scroll: completed
│       │   │                         bot bubbles never auto-scroll; user
│       │   │                         msgs + streaming tokens sticky-
│       │   │                         bottom only when at-bottom. "↓
│       │   │                         Latest" pill surfaces ONLY when
│       │   │                         user is more than one viewport
│       │   │                         above bottom (was 60px — was too
│       │   │                         aggressive during section
│       │   │                         pagination). FlatList tuned
│       │   │                         (initialNumToRender=50, windowSize=
│       │   │                         50, removeClippedSubviews=false).
│       │   │                         pings /v1/me on session, fires
│       │   │                         AdminBuildBanner one-shot.
│       │   ├── Bubble.tsx            Layla msg = no bubble, gold dot,
│       │   │                         fade-up animation; user pill w/ shadow.
│       │   │                         ## headings render in Cochin serif
│       │   │                         + warm line height (the 9 first-map
│       │   │                         section titles); **bold** tints
│       │   │                         softer gold; stripHtml() converts
│       │   │                         <b>/<i> → markdown so Telegram-flavored
│       │   │                         server copy works on iOS too.
│       │   │                         useMemo around stripHtml.
│       │   │                         Image-only message → edge-to-edge
│       │   ├── Composer.tsx          gradient send button; pulsing gold
│       │   │                         ring on mic record state; safe-area
│       │   │                         bottom inset from useSafeAreaInsets
│       │   ├── ImageLightbox.tsx     full-screen tap-to-view; Save (Photos
│       │   │                         via expo-media-library) + Share (system
│       │   │                         sheet via expo-sharing); writes file
│       │   │                         via expo-file-system/legacy
│       │   │                         writeAsStringAsync (the new File.write
│       │   │                         TypedArray overload crashed Hermes)
│       │   ├── AdminBuildBanner.tsx  one-shot toast on new SHA
│       │   ├── QuickReplies.tsx      chips, supports {label,url} options
│       │   │                         (telegram=inline btn url=, iOS=Linking).
│       │   │                         Doorway chips (value starts
│       │   │                         "__doorway_") get serif label +
│       │   │                         soft gold halo, same chrome size
│       │   │                         as chat-flow chips.
│       │   ├── TypingIndicator.tsx   3 breathing gold dots
│       │   ├── atmosphere/
│       │   │   ├── Starfield.tsx     scattered SVG sparkles, twinkle loop
│       │   │   └── Glow.tsx          stacked LinearGradients, fake radial
│       │   └── types.ts              QuickReplyOption = string|{url}|{value}
│       ├── push/registerPush.ts      registers Expo token on session change.
│       │                             expo-notifications + expo-device deps
│       │                             installed; works in dev-client / TF.
│       ├── settings/SettingsScreen.tsx  has "Link Telegram account" row.
│       │                             Accepts onClose prop and renders a
│       │                             "‹ Back" button. App.tsx renders
│       │                             Settings as an absolute overlay on
│       │                             ChatScreen (not a swap), so chat
│       │                             keeps its message state across
│       │                             open → back. (2026-05-07)
│       └── voice/recorder.ts         expo-audio + MediaRecorder web fallback;
│                                     setAudioModeAsync(allowsRecording=true)
│                                     before record(); native upload uses
│                                     {uri,type,name} multipart shape (web
│                                     uses the Blob path); transcribe()
│                                     posts /v1/voice
│
├── mobile-template/                  Generic fork-point (kept in sync)
├── spec.md                           CURRENT product spec (chat-first
│                                       Map+Moment+Orbit redesign). Core
│                                       value: "we add value to the user."
├── CLAUDE.md                         onboarding map for fresh agents
└── context.md                        THIS FILE
```

---

## 4. What's in GombiStar (Layla's brain)

```
GombiStar/
├── bot_botella.py                    uvicorn entry. Mounts manifest +
│                                     telegram webhook. Boots the daily
│                                     reading scheduler at startup.
│                                     Adds GET /v1/me with admin gating.
├── botella_manifest.py               wires:
│                                       7 triggers: /start, /newchart,
│                                         /addfriend, /addperson,
│                                         /gettoknow, /settings, /link,
│                                         /reset
│                                       6 flows: onboarding, invite,
│                                         add_person, intake, checkin,
│                                         settings
│                                       free_chat — chat-first redesign
│                                         (1) doorway tap detection
│                                         (2) orbit-pending state machine
│                                         (3) LLM stream w/ system_extras
│                                             list (doorway hint + comm-
│                                             help directive + Map+Moment+
│                                             Orbit context block)
│                                         (4) ONE post-LLM get_user reused
│                                             for orbit-suggestion surface
│                                             + orbit-detect gate
│                                         (5) fire-and-forget Moment update
│                                             + Orbit detection
│                                         + legacy regex layers (invite,
│                                         notes-update, add-person mention)
│                                         on the Telegram-linked path.
│                                         Module-level _DOORWAY_HINTS table
│                                         drives the per-doorway system
│                                         prompt hint.
│                                       voice_handler (Whisper)
│                                       link_code_resolver (mint/redeem
│                                         codes against layla_link_codes)
│
├── flows/
│   ├── _shared.py                    parse_dmy_strict() +
│   │                                 find_dmy_in_text(). Used by
│   │                                 onboarding's got_date and
│   │                                 services/laila_chat's orbit
│   │                                 birth-date capture. (Other DMY
│   │                                 parsers in flows/people, flows/
│   │                                 invite are still inline; migrate
│   │                                 in a follow-up.)
│   ├── onboarding.py                 chat-first redesign per spec.md:
│                                       choose_lang → got_lang → ask_gender
│                                       → got_gender → first_map_intro
│                                       (trust-building line: "Before I
│                                       ask anything about your life…")
│                                       → ask_date → got_date (uses
│                                       parse_dmy_strict) → ask_time →
│                                       got_time → ask_place → got_place
│                                       → geocode_place → disambiguate_place
│                                       → ask_name_if_needed (ALWAYS asks
│                                       — no shortcut on record.name)
│                                       → got_name → save_chart (emits
│                                       "I'm reading your chart now…") →
│                                       build_first_map (idempotent, three
│                                       resume gates: sections present /
│                                       chart present / fresh) → emit_first_map
│                                       (paginated: ONE section per state-
│                                       hop with section-aware Continue
│                                       chip "(N/9)" labels — "The whole
│                                       picture", "Walk into who you are",
│                                       "How you actually feel", "How you
│                                       love", "Where your work lives",
│                                       "What you don't see in yourself",
│                                       "Who you're becoming", "Your life
│                                       instruction") → got_first_map_continue
│                                       → loops to next section. Final
│                                       section emits + post-map pause +
│                                       4 doorway chips (situation/person/
│                                       question/reflect) → Done.
│   ├── settings.py                   menu/lang/gender/city. Replaces the
│   │                                 dead handlers/settings.py path.
│   ├── invite.py                     legacy invite flow (Telegram-anchored)
│   ├── intake.py                     get-to-know-me Q&A
│   ├── checkin.py                    smart returning-user opener.
│   │                                 As of 2026-05-07, ALSO emits 4
│   │                                 quick-reply chips under the opener:
│   │                                 3 randomized first-person questions
│   │                                 (one each from Love / Work / Self
│   │                                 pools in personality/welcome_chips/)
│   │                                 + a fixed "Something else is on my
│   │                                 mind" escape. Tracks last 6 shown
│   │                                 slugs in user_record.recent_chip_ids
│   │                                 to avoid back-to-back repeats. Chip
│   │                                 values are the question text itself,
│   │                                 routed via free_chat as user input.
│   └── people.py                     add-friend flow
│
├── services/
│   ├── llm.py                        provider abstraction. complete() and
│   │                                 complete_stream() dispatch on
│   │                                 LAYLA_LLM_PROVIDER (anthropic|gemini
│   │                                 |openai). Per-call tier kwarg
│   │                                 ("default" | "reasoning") picks
│   │                                 model from per-provider map. Per-call
│   │                                 model= kwarg honored ONLY when its
│   │                                 prefix matches the active provider's
│   │                                 family. Default models:
│   │                                   anthropic default/reasoning =
│   │                                     claude-sonnet-4-6
│   │                                   gemini   default = gemini-2.5-flash
│   │                                            reasoning = gemini-2.5-pro
│   │                                   openai   default = gpt-4.1
│   │                                            reasoning = gpt-5.4
│   │                                 Override blanket via LAYLA_LLM_MODEL,
│   │                                 per-tier via LAYLA_LLM_MODEL_DEFAULT
│   │                                 / _REASONING.
│   ├── claude_service.py             ALL Layla-side LLM functions.
│   │                                 NEW for redesign:
│   │                                   generate_first_map_read
│   │                                     (deep 9-section, reasoning tier,
│   │                                     no system prompt — the .md
│   │                                     file IS the prompt)
│   │                                   extract_living_map (JSON)
│   │                                   extract_moment_update (JSON delta)
│   │                                   detect_orbit_intent (JSON)
│   │                                   generate_orbit_dynamic_summary (JSON)
│   │                                   communication_help_directive
│   │                                 chat_with_advisor[_stream] +
│   │                                   _build_chat_with_advisor_prompt
│   │                                   take a `system_extras: list[str]`
│   │                                   (replaces the old extra_context +
│   │                                   mode_directive sprawl). Caller
│   │                                   composes the ordered prompt list.
│   │                                 Existing: generate_chart_teaser,
│   │                                 generate_placement_card,
│   │                                 generate_daily_reading,
│   │                                 generate_checkin_opener,
│   │                                 generate_person_transit_alert,
│   │                                 generate_compatibility_reading,
│   │                                 generate_lesson, interpret_natal_chart
│   │                                 — all reasoning tier.
│   │                                 chat_with_advisor / _stream,
│   │                                 generate_invite_message, intake_*,
│   │                                 extract_* — default tier. The banned
│   │                                 phrase filter + retry behavior is
│   │                                 unchanged (in _create_message).
│   │                                 _strip_json_fence handles ```json
│   │                                 wrapping for the new JSON-mode calls.
│   ├── laila_state.py                NEW. Typed projections + helpers
│   │                                 for LivingMap / CurrentMoment /
│   │                                 OrbitPerson; doorway slug constants
│   │                                 (DOORWAY_SITUATION/PERSON/QUESTION/
│   │                                 REFLECT — values the chip wires
│   │                                 send back); ORBIT_STAGE_*; helpers:
│   │                                 build_chat_context_block (the
│   │                                 system-prompt projection of all
│   │                                 three layers), dedup_capped (used
│   │                                 by anchor_questions + active_*
│   │                                 lists), _now_iso, doorway_chips.
│   ├── laila_chat.py                 NEW. Chat-turn helpers:
│   │                                   detect_doorway_token,
│   │                                   doorway_first_reply (static),
│   │                                   detect_communication_help (regex),
│   │                                   handle_orbit_pending_turn (table-
│   │                                     driven: _ORBIT_NEXT_PROMPT +
│   │                                     _advance_orbit_stage +
│   │                                     _orbit_confirmation),
│   │                                   begin_orbit_suggestion,
│   │                                   take_queued_orbit_suggestion,
│   │                                   schedule_moment_update + _do_moment_update,
│   │                                   schedule_orbit_detect + _do_orbit_detect,
│   │                                   remember_anchor_question.
│   │                                 INFLIGHT dicts use asyncio.current_task()
│   │                                 identity-check before pop in finally
│   │                                 — fix for the cancelled-task wiping
│   │                                 the live-task entry race.
│   ├── chart_wheel.py                round natal wheel (+ birth-info
│   │                                 block, placements list, balance box,
│   │                                 brand footer). Pillow w/ 2× supersample
│   │                                 + Lanczos downsample. 760×1480 PNG.
│   ├── chart_table.py                Co-Star-style placements table image
│   │                                 (still callable; not used post-wheel).
│   ├── chart_service.py              build_natal_chart — saves all 12
│   │                                 house cusps in chart_data so the
│   │                                 wheel renders accurate spokes.
│   ├── daily_runner.py               APScheduler job under bot_botella.
│   │                                 Hourly tick; per-user gate fires
│   │                                 when local hour == 8. Fans out to
│   │                                 Telegram via PTB Bot AND iOS via
│   │                                 botella.push.proactive_send.
│   ├── welcome_chips.py              loader + picker for checkin's
│   │                                 welcome-back chips. Reads .md pools
│   │                                 from personality/welcome_chips/,
│   │                                 picks 1 random per category biased
│   │                                 away from recent_ids history.
│   │                                 Gender-aware Hebrew variants
│   │                                 (.he.md masc default, .he.f.md fem).
│   ├── transit_service.py            transit calc + scoring
│   ├── transcribe.py                 Whisper. _sniff_extension reads
│   │                                 magic bytes (ftyp/OggS/RIFF/EBML/
│   │                                 fLaC/ID3/MP3) so iOS m4a doesn't
│   │                                 get sent as .ogg.
│   └── build_info.py                 returns sha + note + commit_time +
│                                     boot_time. Resolution: env first
│                                     (LAYLA_BUILD_VERSION / _NOTE /
│                                     _TIME), then files baked at Docker
│                                     build (rare on Northflank — strips
│                                     .git from build context), then live
│                                     git (local), then "dev".
│
├── database/
│   ├── schema.sql                    layla_users, layla_natal_charts
│   │                                 (UNIQUE user_id), layla_people,
│   │                                 layla_chat_history, layla_daily_readings,
│   │                                 layla_transit_alerts, layla_user_identities,
│   │                                 layla_sessions, layla_user_records,
│   │                                 layla_link_codes
│   ├── migrations/                   2026_05_04_natal_charts_unique.sql
│   │                                 2026_05_04_link_codes.sql
│   ├── db.py                         DAL. Includes mint_link_code + 
│   │                                 redeem_link_code at the bottom.
│   └── storage.py                    PostgresStorage Storage impl,
│                                     including merge_users.
│
├── personality/                      Markdown character bible
│   ├── layla_system_prompt.md        single canonical Layla voice + reading
│   │                                 framework (synthesis, chapters, tone).
│   ├── first_map_read_prompt.md      THE 9-section first-map prompt.
│   │                                 Loaded by personality.get_first_map_read_prompt.
│   │                                 Drives generate_first_map_read in
│   │                                 services/claude_service.py. Structure:
│   │                                 Deep Realization → Executive Summary →
│   │                                 Core Signature → Emotional Pattern →
│   │                                 Relationship Blueprint → Work,
│   │                                 Purpose, and Direction → Shadow
│   │                                 Pattern → Mature Expression → Core
│   │                                 Instruction. Sent w/o system prompt
│   │                                 (this file IS the prompt).
│   ├── natal_reading_prompt.md       legacy chaptered-reading prompt. Still
│   │                                 reachable via generate_full_reading;
│   │                                 not used by the chat-first redesign.
│   ├── agent_testing.md              QA rubric for prompt edits.
│   └── welcome_chips/                12 first-person questions per file:
│       ├── love.md / love.he.md / love.he.f.md
│       ├── work.md / work.he.md / work.he.f.md
│       └── self.md / self.he.md / self.he.f.md
│                                     Format: `slug :: question`. Slugs are
│                                     stable IDs for de-dup history.
│                                     Hebrew variants generated via GPT-4o
│                                     translation (see /tmp/translate_chips*
│                                     scripts in repo history; rerun if you
│                                     edit the English pool).
├── personality.py                    PERSONALITIES dict (default,
│                                     experimental). identity / reading_style
│                                     / chat_persona / advise_style fields.
│                                     ⚠ See "Open work" — character bible
│                                     update PENDING from 2026-05-06.
│
├── locales/strings.py                t() + g() (gendered He/En)
├── handlers/                         legacy PTB code (mostly dead but kept
│                                     for ref. handlers/daily.py:
│                                     get_or_generate_daily still used by
│                                     services/daily_runner.py)
├── tests/                            166 passing (added test_laila_chat
│                                       + rewrote test_flows_onboarding
│                                       for the chat-first flow).
└── Dockerfile                        FROM gombicreations/laylabot-base.
                                       apt installs git (pip needs it).
                                       COPY . . (.git stripped by
                                       Northflank's build context anyway,
                                       so build provenance comes from env
                                       not file).
```

**Postgres schema** (Neon, us-east-1):
- `layla_users` (BIGINT user_id, name, language, gender, current_timezone,
  life_context JSONB, created_at, last_active) — Telegram-keyed
- `layla_natal_charts` (FK user_id UNIQUE, chart_data JSONB, birth_*,
  lat, lng, timezone)
- `layla_chat_history` (FK user_id, role, content, archived,
  context_extracted, created_at)
- `layla_people` (FK user_id, name, relationship_type, gender,
  birth_*, chart_data, notes, invite_token)
- `layla_user_identities` (provider, external_id) → internal_user_id UUID
- `layla_sessions` (internal_user_id PK, flow, state, data JSONB,
  flow_stack JSONB)  ← botella sessions
- `layla_user_records` (internal_user_id PK, data JSONB)  ← botella
  per-user data (incl. expo_push_token, chart_history for anon users,
  natal_chart for anon users)
- `layla_link_codes` (code TEXT PK, internal_user_id UUID, created_at,
  expires_at, used_at) — Telegram→iOS migration

---

## 5. Key contract specifics

### Storage protocol surface

```python
async def load_session(user_id: str) -> SessionState
async def save_session(session: SessionState) -> None
async def resolve_identity(provider, external_id) -> str   # creates if new
async def link_identity(provider, external_id, target_user_id) -> str
                                                            # binds existing
async def get_user(user_id) -> dict
async def update_user(user_id, patch: dict) -> None
async def delete_user(user_id) -> None                       # 5.1.1(v)
async def merge_users(from_user_id, to_user_id) -> None      # /link redemption
```

### Tier-aware LLM dispatch

Every Layla-side LLM call goes through `services.llm.complete()` or
`complete_stream()`. The `tier=` kwarg picks the model from the active
provider's `{default, reasoning}` map. Adding a provider = one block in
`_DEFAULT_MODELS` + four helper functions (sync + async × convert
messages + run). Adding a per-call override = pass `model=` (honored
only when family matches) or set `LAYLA_LLM_MODEL`.

### Free chat regex layers

`botella_manifest.py:free_chat` runs four regex passes BEFORE Claude:
1. invite-intent → emits a `quick_replies` row with `{label,url}`
   options (WhatsApp + Telegram share). Telegram renders inline URL
   buttons; iOS renders chips that open via `Linking.openURL`.
2. pending-notes-save (set by a prior turn's update-notes detect)
3. notes-update intent → stash for next turn
4. add-person mention → emit a `/addperson` chip after Claude's reply

The 5th legacy regex (`awaiting_settings_city`) is GONE — Settings is
its own flow now.

### Image-only edge-to-edge bubble

When the bot emits a `media` event with no caption, iOS's `Bubble.tsx`
detects `isImageOnly = !isUser && imageUrl && !text` and renders the
image WITHOUT the gold-dot chrome, edge-to-edge with `aspectRatio:
760/1023`. This is what makes the chart wheel feel like a centerpiece.
`flows/onboarding.py` deliberately calls `media(image=wheel_png)` with
no caption.

### `/link` flow

Telegram side: `/link` mints an 8-char code (`KX2J9P4L` style; alphabet
excludes 0/O/1/I/L), stores in `layla_link_codes` with 15min TTL.
iOS side: Settings has a "Link Telegram account" row → user pastes →
`POST /v1/account/link/redeem` → server calls
`manifest.link_code_resolver(code)` (which is `redeem_link_code` from
`database/db.py`) → if valid, calls `storage.merge_users(current,
target)` → mints a fresh JWT for the target user and returns it.
Identities re-pointed; from-side data dropped.

### Build provenance / admin banner

`/v1/me` returns `{user_id, is_admin, build:{sha, note, commit_time,
boot_time}}`. SHA + note + time come from `LAYLA_BUILD_VERSION/_NOTE/
_TIME` env vars set on Northflank after each push. iOS pings on
ChatScreen mount; if admin AND SHA != AsyncStorage cached SHA, slides
a one-shot gold-bordered banner from the top.

Admin gating, two paths (either):
- `LAYLA_ADMIN_USER_IDS` env (comma-sep UUID allowlist) — fastest
- `ADMIN_CHAT_ID` env (Telegram BIGINT) → matches when
  `storage.telegram_id_for(uuid)` resolves to that BIGINT (i.e. the
  user has /link'd Telegram into iOS)

### WS keep-alive

`botella/adapters/ws.py:_with_keepalive` wraps `runtime.run`. If the
runtime is silent for >8s, injects a `typing` frame. Stops idle-
timeout drops on long chart builds (kerykeion + 6 Claude calls = 30-40s).

---

## 6. Operational knowledge

### LLM env config

```bash
LAYLA_LLM_PROVIDER=openai            # anthropic | gemini | openai
LAYLA_LLM_MODEL=...                  # blanket override (rare)
LAYLA_LLM_MODEL_DEFAULT=gpt-4.1      # tier override
LAYLA_LLM_MODEL_REASONING=gpt-5.4    # tier override

# API keys (lazy-init; only the active provider's key needs to exist)
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
OPENAI_API_KEY=sk-svcacct-...        # currently a service-account key
```

### Northflank API patterns

```bash
NF=$(grep NORTHFLANK_TOKEN ~/Desktop/Coding/GombiStar/.env | cut -d= -f2)

# Service status
curl -s -H "Authorization: Bearer $NF" \
  https://api.northflank.com/v1/projects/gombibot/services/laylabot

# Runtime env: ALWAYS GET-merge-POST. POST replaces the entire env.
curl -s -H "Authorization: Bearer $NF" \
  https://api.northflank.com/v1/projects/gombibot/services/laylabot/runtime-environment \
  > /tmp/env.json
# ...edit /tmp/env.json...
curl -s -X POST -H "Authorization: Bearer $NF" -H 'Content-Type: application/json' \
  -d @/tmp/env.json \
  https://api.northflank.com/v1/projects/gombibot/services/laylabot/runtime-environment

# Runtime logs
curl -s -H "Authorization: Bearer $NF" \
  "https://api.northflank.com/v1/projects/gombibot/services/laylabot/logs?lines=200&type=runtime"
```

### Build-info stamping (now automated — was manual)

Stamping is automated by `.github/workflows/stamp-build.yml` in the
GombiStar repo. On every push to `main`, GitHub Actions runs
`scripts/stamp_build.py` which polls Northflank until the build for
the pushed commit is deployed, then GETs / merges / POSTs the
runtime-environment with the fresh `LAYLA_BUILD_VERSION`,
`LAYLA_BUILD_NOTE`, and `LAYLA_BUILD_TIME`. No human touches it.

One-time setup (per repo, ever): the workflow needs the Northflank
API token in GitHub Secrets as `NORTHFLANK_TOKEN`:

```bash
# Inside the GombiStar repo:
gh secret set NORTHFLANK_TOKEN --repo baraki123/GombiStar \
  --body "$(grep '^NORTHFLANK_TOKEN' .env | cut -d= -f2)"
```

(Requires `gh auth login` once if `gh` isn't already authenticated.)

#### Manual fallback (only if the workflow is broken)

```bash
cd ~/Desktop/Coding/GombiStar
NORTHFLANK_TOKEN=$(grep '^NORTHFLANK_TOKEN' .env | cut -d= -f2) \
  GIT_SHA=$(git rev-parse --short=8 HEAD) \
  GIT_NOTE="$(git log -1 --pretty=%s)" \
  GIT_TIME="$(git log -1 --pretty=%cI)" \
  WAIT_FOR_BUILD=0 \
  python3 scripts/stamp_build.py
```

### Local dev

```bash
cd ~/Desktop/Coding/GombiStar && source venv/bin/activate

# Tests
python -m pytest tests/ -q                        # 128 passing

# Local backend (against prod Neon — be careful!)
LAYLA_DISABLE_SCHEDULER=1 uvicorn bot_botella:app --host 0.0.0.0 --port 8000

# In another shell — Layla web app
cd ~/Desktop/Coding/botella/layla-app
npx expo start --port 8081
# → http://localhost:8081

# Run the iOS app via Expo Go on a phone, off your LAN:
npx expo start --tunnel    # serves Metro through ngrok-style HTTPS;
                           # phone scans QR and reaches it from cellular
```

The iOS app's `apiUrl` (in `src/config/product.ts`) defaults to **prod**
(Northflank URL) on iOS native to avoid ATS HTTPS-only enforcement
issues. Web dev still hits `localhost:8000`. To force local backend
on native, set `EXPO_PUBLIC_API_URL=http://lan-ip:8000` (also requires
ATS exemption) or use `expo start --tunnel` and override.

### Botella tests

```bash
cd ~/Desktop/Coding/botella && source venv/bin/activate && python -m pytest -q
# 72 passing (incl. WS keepalive + account-link + apple-auth multi-aud)
```

---

## 7. Known gotchas

- **Northflank build context strips `.git`.** Despite `COPY . .` in the
  Dockerfile, runtime `git rev-parse` returns nothing in prod. Build
  provenance MUST come from `LAYLA_BUILD_*` env vars stamped after push.
- **iOS App Transport Security blocks HTTP** to LAN backends. Hence
  iOS native dev defaults to prod URL. Override via
  `EXPO_PUBLIC_API_URL` only with ATS exemption or HTTPS tunnel.
- **Apple Sign-In `aud` claim differs by build context.** Expo Go uses
  bundle id `host.exp.Exponent`; built apps use `app.layla.ios`.
  `APPLE_SIGN_IN_AUDIENCE` is comma-separated to validate both.
- **`expo-file-system` 19+ legacy methods are stubs that throw.** The
  *submodule* `expo-file-system/legacy` still ships the working
  `writeAsStringAsync` API. Use that submodule for image save/share.
  The new `File.write(Uint8Array)` overload crashes Hermes on iOS for
  larger payloads — DO NOT use it.
- **WS without keep-alive drops on 30+s computations.** Mobile carriers,
  proxies, or the iOS app's network sleep can drop the socket during
  chart build. The `_with_keepalive` wrapper sends a `typing` frame
  every 8s — don't remove without an alternative.
- **`websockets` is not a uvicorn base-install dep.** Botella declares
  it in `pyproject.toml`. If you build a fresh venv and WS upgrades 404,
  `pip install websockets`.
- **Base image lacks `git`.** GombiStar's `Dockerfile` installs it via
  apt because pip needs git to clone botella from GitHub.
- **kerykeion `online=True` hangs on geonames rate limit.** Always
  pass `online=False, tz_str=geo["timezone"]` to `AstrologicalSubject`.
- **kerykeion 3-letter sign codes** (`Pis`, `Sco`, `Aqu`) leak unless
  run through `_full_sign` (services/chart_table.py).
- **Anonymous users vs `layla_users` rows.** `layla_users.id` is BIGINT
  (Telegram). Anonymous (iOS) users have NO row there.
  `save_chat_message(tid, ...)` is FK'd to `layla_users` — gate on
  `if tid is not None`. Persistent state for anonymous users goes into
  `layla_user_records.data` (JSONB) via `storage.update_user(uuid, patch)`.
- **Northflank env-var POST replaces the entire env.** Always GET-merge-POST.
- **`pathIgnoreRules` skip `.md` changes from triggering builds.**
  Editing context.md alone won't redeploy.
- **Region split.** Northflank service runs on `nf-us-central`, Neon
  on `aws.us-east-1`. ~30-40ms cross-region per query. Not the
  bottleneck (LLM TTFT dominates) but worth fixing eventually.
- **Hermes runtime needs `react-native-get-random-values` polyfill.**
  Imported at top of `mobile-template/index.ts` and `layla-app/index.ts`.
- **iOS audio session needs `setAudioModeAsync({allowsRecording: true,
  playsInSilentMode: true})` BEFORE recording.** Otherwise `record()`
  captures silence.
- **`ask_name_if_needed` ALWAYS asks now.** Earlier version short-
  circuited when `record.get("name")` was set, which meant /newchart
  users (record.name populated by previous run) never got the prompt.
  Apple Sign-In's name lives under `apple_given_name` separately;
  `record.name` is populated only by a prior onboarding's
  `build_first_map`, so skipping on it was always wrong. The single-
  dispatch dedup via `session.data["name"]` still prevents re-prompts
  inside the same flow run.
- **WS resume re-emits the current section.** Resume-gate-A (in
  `start_trigger`) routes mid-onboarding reconnects to `emit_first_map`,
  which now re-emits the CURRENT section (idempotent via
  `first_map_section_idx`). The earlier 14-chapter walk had a known
  duplicate-section bug; the redesigned paginated reveal handles it
  via an idempotent reading_history append (skip if last entry already
  matches the current section text).
- **iOS viewport must stay stable on new content.** Completed bot
  bubbles never auto-scroll (`recordMessageHeight` was removed; that
  callback is gone). User-msg echoes + streaming tokens sticky-bottom-
  follow ONLY when `isAtBottomRef.current` is true. The "↓ Latest"
  pill surfaces ONLY when the user is more than ONE FULL VIEWPORT
  HEIGHT above the bottom (was 60px — too aggressive during paginated
  reading). If you re-introduce a `scrollToIndex` somewhere, you'll
  yank the user mid-section.
- **INFLIGHT pop race in laila_chat schedulers.** `_INFLIGHT_MOMENT_UPDATE`
  / `_INFLIGHT_ORBIT_DETECT` cancellation could let a stale task's
  finally wipe the LIVE entry from the dict. Both runners now check
  `if _INFLIGHT_X.get(uid) is asyncio.current_task()` before pop. If
  you add another scheduler with the same shape, copy the pattern.
- **Doorway slug values are stable across languages.** `__doorway_situation`
  / `__doorway_person` / `__doorway_question` / `__doorway_reflect` —
  iOS QuickReplies styles them via `value.startsWith("__doorway_")`
  prefix. If you rename the prefix server-side, update QuickReplies.tsx.
- **system_extras param ordering matters.** Doorway hint comes BEFORE
  communication-help directive comes BEFORE Map+Moment+Orbit context.
  Earlier extras win on framing; later ones provide background. The
  current order in `botella_manifest.free_chat` is the calibrated one.

---

## 8. Decisions made (don't relitigate without new info)

- **Build, don't buy.** Botella is internal infrastructure (~2300 LOC),
  not a public framework. Public on GitHub purely so GombiStar can
  pip-install without auth.
- **Stay on Northflank** for Layla. Auto-deploy on push, Neon already
  wired, Docker-friendly. No host migration during the iOS push.
- **Anonymous-first auth.** Apple Sign-In required pre-launch but not
  for v0 in dev. Users start anonymous; link Apple via Settings later.
- **Fork-per-product, not multi-bot launcher.** Each product is its
  own standalone app. Side menu reserved for in-app nav.
- **No streaming on Telegram.** Token events buffer; flush on complete
  or before any non-token event. Telegram's typing indicator covers it.
- **No refresh tokens for v0.** 90-day JWTs.
- **LLM provider via env, NOT per-call.** Adding a new provider is
  one block in `_DEFAULT_MODELS` + four helpers. Per-call model
  override exists but is only used when the model family matches the
  active provider — keeps call sites portable.
- **Chart wheel is THE chart.** The earlier placements-table image is
  callable but unused; the round wheel + sidebar data is the production
  experience.
- **Build provenance via env, not git-in-image.** Northflank strips
  `.git` from the build context; stamping env after push is more
  reliable than baking files into the image.

---

## 9. Open work, ranked

| # | Item | Size | Notes |
|---|------|------|-------|
| 1 | **Sensual/paced text reveal for the first map sections** (user-requested 2026-05-08) | ~2-3h | The user wants Layla's words to "come to life" on the first map read. Recommended path: server-side switch the section emit from `text(...)` to `token(...)` stream with `await asyncio.sleep(0.04)` per word + `0.25-0.4s` breaths at sentence-end / heading boundaries; iOS already has the gold-caret streaming-bubble path. Add a tap-to-skip on the streaming bubble for users who want to scan. Tradeoff: stretches each section from ~instant to ~6-12s of paced reveal. |
| 2 | **Apple Sign-In name → onboarding skip** | ~1h | `auth/routes.py` stores Apple-provided names as `apple_given_name`/`apple_family_name` (not `name`). `ask_name_if_needed` always asks now. If you want Apple users to skip the prompt, prefer `record.get("apple_given_name")` (or build a single canonical `display_name` field on first auth) and check that — not `record.name`. |
| 3 | **Mark blocked Telegram users inactive in `daily_runner`** | ~30 min | Telegram returns 403 Forbidden when the user has blocked the bot (saw one on 2026-05-07: tg_id 7933050328). The daily push job logs a warning and continues, but it'll keep trying that user every day forever. Catch the 403, set a `daily_push_disabled` flag (or `blocked_at` timestamp) on their row, and skip them on subsequent runs. |
| 4 | **`_strip_json_fence` retrofit on existing JSON callers** | ~30 min | `intake_next_question`, `extract_intake_people`, the check-in opener at `services/claude_service.py:757` — all `json.loads(raw.strip())` directly. If Claude/GPT ever wraps the response in ```json fences, those callers misbehave. Apply the new `_strip_json_fence` helper to them too. |
| 5 | **DMY parser duplication** | ~30 min | `flows/_shared.py` was extracted in the simplification pass and used in `flows/onboarding:got_date` + `services/laila_chat:handle_orbit_pending_turn`. `flows/people.py:205` and `flows/invite.py:241` still have inline `_DATE_RE` copies; migrate them. |
| 6 | **Personality + reading-quality rewrite** (carried from 2026-05-06) | ~3-4h | Direction: readings should always identify aspects + patterns (T-squares, stelliums, conjunctions, oppositions) — not just placements. Always have a thesis. Tone: direct, literary, slightly intense — not corporate, not bubbly. Voice register: "you are not here to skim the surface of life" / "the immature version argues with reality... the mature version is a spiritual warrior-intellectual". Now mostly applies to the NEW `personality/first_map_read_prompt.md` + the chat-with-advisor system prompt; the legacy `natal_reading_prompt.md` is no longer the hot path. `services/chart_service.py:build_natal_chart` needs to capture nodes + Chiron (kerykeion has `mean_node`, `true_node`, `chiron`). |
| 7 | **Communication-help mode end-to-end test** | ~30 min | Implementation is shipped (`detect_communication_help` + `communication_help_directive` in `services/laila_chat.py`/`claude_service.py`), but no end-to-end test confirms the 4-part response shape (underneath / what to avoid / try this / why it works). Add an MCP-driven test that pastes a "help me reply to Maya" turn and asserts the response shape. |
| 8 | **Admin needs to /link or be allowlisted** | trivial | The admin (Barak, TG id 521866882) needs to either send `/link` from Telegram and redeem in iOS, OR send their iOS user_id (visible in `/v1/me` response) so it goes into `LAYLA_ADMIN_USER_IDS`. Until then, the build banner won't fire for them. |
| 9 | **App Store Connect / EAS Build / TestFlight** | user-only | Blocked on $99 Apple Dev account enrollment. bundle id `app.layla.ios`, eas.json profiles ready. |
| 10 | **Real designer pass on app icon** | TBD | The 2026-05-04 stopgap (italic gold L + sparkle) is fine for TestFlight; replace before public submission. |
| 11 | **Anonymous-iOS users get morning push too** | ~half day | `services/daily_runner.py` only iterates `layla_users` (Telegram-keyed). Pure-anonymous users with chart in `layla_user_records.data.natal_chart` get nothing until they /link or sign in with Apple. |
| 12 | **Move Northflank to a us-east cluster** | ~30 min | Drops Neon round-trip from ~30ms to <5ms. Service-recreate (no in-place region change). Do at the next staging-needed moment. |
| 13 | **Skia / interactive chart (v2)** | ~2 days | `@shopify/react-native-skia` would let us pinch-zoom the wheel, animate planet highlights as Layla reads each placement, tap a planet to dive in. NOT v1. Bookmark for after launch. |
| – | **Chat-first Map+Moment+Orbit redesign** | DONE | Shipped 2026-05-08. spec.md saved; new prompt + data layer + onboarding rewrite + free_chat overhaul + iOS doorway chips + paginated 9-section reveal. SHA `0565530b` then `400b80c`. |
| – | **Viewport-stable scroll + Latest pill threshold** | DONE | Shipped 2026-05-08. Completed bot bubbles never yank; pill only shows when user is more than one viewport above bottom. (botella commits f8fb6af + later) |
| – | **Section-aware Continue chip labels** | DONE | Shipped 2026-05-08. "The whole picture (2/9) →" through "Your life instruction (9/9) →". Hebrew labels included. (commit 0565530) |
| – | **`ask_name_if_needed` always asks** | DONE | Shipped 2026-05-08. (commit 75dbe57) Removed the `record.get("name")` shortcut that made /newchart users skip the prompt. |
| – | **Welcome-back chips on checkin** | DONE | Shipped 2026-05-07. (commits 5578ad1, 4453787) |
| – | **iOS Settings as overlay (not swap)** | DONE | Shipped 2026-05-07. (commit 22570b6) |
| – | **`/healthz` LB liveness probe** | DONE | Shipped 2026-05-07. (commit 3eb14ec) |
| – | **Detached LLM survives WS drops** | DONE | Shipped 2026-05-06. |
| – | **Markdown rendering for bot messages** | DONE | Shipped 2026-05-06. (botella commit c72eb60) |
| – | **start_trigger /start race throttle** | DONE | Shipped 2026-05-06. (commit 246d69f) |
| – | **Telegram → iOS link via `/link`** | DONE | Ship'd 2026-05-04. |
| – | **Push notifications (server-side wiring)** | DONE | Ship'd 2026-05-04. |
| – | **save_natal_chart UNIQUE(user_id)** | DONE | Migration applied 2026-05-04. |
| – | **Settings flow port + awaiting_settings_city removal** | DONE | Ship'd 2026-05-04. |
| – | **Round natal-wheel chart + birth info + balance** | DONE | Ship'd 2026-05-06. |
| – | **LLM provider abstraction + tier system** | DONE | Ship'd 2026-05-06. Currently on OpenAI (gpt-4.1 / gpt-5.4). |
| – | **/v1/me + admin build banner** | DONE | Ship'd 2026-05-06. Build env stamping is manual after push (see §6). |

---

## 10. User context

The user is a **solo builder**, product-first / PM-style. Running multiple
Telegram bots:

- **Layla** (`~/Desktop/Coding/GombiStar/`) — astrology-lensed personal
  advisor. Production. 30-day free trial → $8.88/mo.
- **event-e-fire** (`~/Desktop/Coding/event-e-fire/`) — WhatsApp event
  forwards → Calendar links. Stateless. Not yet ported to botella.
- **Gombi Creations** — separate React+Vite web project, not bot-related.

**Working preferences:**
- Terse responses with concrete recommendations.
- No planning docs unless asked.
- No backwards-compat hacks.
- Deep Python experience; comfortable with React Native conceptually,
  less hands-on with mobile.
- **Always end every reply with a `## Summary` block** (what I did /
  decisions needed / what you need to do).
- **Push and deploy myself** — don't end with "git pull / restart"
  TODO lists. Backend changes auto-deploy via Northflank push to main.
- **Native iOS APIs (Photos, Sharing, Notifications, mic) need device
  verification.** I can't simulate them; surface that explicitly when
  shipping such code. Don't claim done without a device tap.
- **Cross-project paste alert.** If a message in this terminal is
  obviously about another project (event-e-fire, Gombi Creations), pause
  and flag — they probably picked the wrong terminal tab.
- **Wait, then test, before declaring done.** Even for non-native
  paths, a quick smoke is cheap insurance.

---

## 11. References

- `~/Desktop/Coding/GombiStar/CUTOVER.md` — original cutover runbook
- `~/Desktop/Coding/GombiStar/personality/` — character bible (the
  authoritative source for Layla's voice; `personality.py` mirrors)
- `~/Desktop/Coding/event-e-fire/context.md` — second bot
- `~/.claude/projects/-Users-barakben-ezer-Desktop-Coding-botella/memory/MEMORY.md`
  — auto-loaded user/feedback/project memory

---

## 12. SUPERSEDED — old "After the mirror, life coach" stub

> **Note:** This section described the redesign as PENDING. It SHIPPED
> on 2026-05-08 in a more ambitious form (chat-first Map / Moment /
> Orbit per `spec.md`). The text below is left intact for historical
> reference; trust `spec.md` and §0 above for current product state.
> The "drill chips → tracks" model in this section was replaced with
> "doorway chips → free_chat with Map+Moment+Orbit context" — see
> §0 / §4 / §5 for what actually shipped.

**Status: agreed, NOT BUILT.** The user said "do it" 2026-05-07, then
interrupted before any code shipped and asked for this handoff. Pick
this up first if you're returning to a productive session.

### The thesis (user's words)

> "After the mirror, Layla becomes a life coach."

The natal reading is the static **mirror** — it shows the user themselves.
What comes next is the moving **coach** — ongoing dialogue Layla owns
over weeks, not a one-shot consultation.

### The product gap we're fixing

Current onboarding ends with a 14-section linear walk: Continue →
Continue → Continue, then closing chips. Two problems:
1. **Slow first impression.** User waits ~80s for the LLM, then walks
   through 14 sections. Wow happens (if at all) somewhere in the middle.
2. **No durable relationship.** Each session is a fresh consultation.
   No memory of "what we were working through last time."

### The new flow (initial-read redesign)

```
[place input] → typing → [2 LLM calls fire in parallel]
                          ↓                       ↓
                  Highlights (~15s)     Full reading (~80s)
                          ↓                       ↓
                  Show 3-4 aha hooks    Cache to user_record
                  + drill-down chips    (for "read my full reading")
                          ↓
                  User taps a chip
                          ↓
                  3-act response (reflection → hypothesis → question)
                          ↓
                  free_chat picks up; track state persists
```

**Highlights call.** New prompt `personality/highlights_prompt.md`
extracts 3-4 short, surprising synthesis points from the chart (each
~50 words, naming a *contradiction the user lives inside without
naming*). The user gets value in ~15s instead of waiting for the full
reading. Example shape:

> *"Your chart is loud about leadership, but you keep choosing roles
> where you're second-in-command. The gift is invisible — your power
> lands when you're not the title."*

**Full reading still generates** in parallel and gets cached as a
durable artifact (`user_record["full_reading"]`). Surfaced via a
"📖 Read my full reading" affordance — chip on welcome-back, or
header link, or both. Free_chat can read from it for deep context on
later turns.

**Drill-down chips.** Five visible + "More →" affordance. Each is a
domain-specific entry to a stateful conversation. v1 set:

```
💼 What career suits me
❤️ Who I match with romantically
🗣 How I communicate
🏠 Where I'll thrive
✈️ Where to travel
🌑 My blind spots                    (depth/shadow chip — gives permission for the hard look)
💭 Something specific on my mind     (escape hatch / open-ended)
```

### The 3-act response structure

Every chip's first response follows the same shape:

1. **Reflection** (2-3 sentences): names the structural pattern from
   the chart — specific placements, specific implication. The user
   gets *language* for something they've felt but couldn't name.
2. **Hypothesis** (1-2 sentences): Layla risks a guess about what's
   *currently true* for them based on the chart. Specific, not generic.
3. **Question** (1 sentence): asks them to confirm, correct, or
   extend. Turns monologue into dialogue.

This is what a real coach does: name the pattern, name the bet, ask.
After turn 1, the conversation continues as normal free_chat with
that domain's context loaded.

**Worked example** (Sun in Scorpio in 10th, Saturn square Sun, North
Node in 10th — user taps **💼 What career suits me**):

> *Your work signature is built around transformation under pressure
> — you're drawn to roles where the stakes are real and the story
> matters. The 10th-house Sun says you become yourself by being seen
> doing serious work. Saturn squaring it means you've often had to
> earn that visibility through pain or proof, and you may have learned
> to distrust ease.*
>
> *My guess about you right now: you're either in a role that pays you
> well but doesn't feel like the real story, or you're standing
> between two paths — one stable, one that scares you. The scary one
> is closer to your chart's center.*
>
> *Am I close?*

### Per-chip chart anchors

Each chip's prompt frame tells Layla which placements to lean on:

- **💼 Career** → 10th house, MC, 6th house, Saturn, work-side aspects
- **❤️ Romantic** → 7th house, Venus, Mars, descendant, synastry-relevant placements
- **🗣 Communication** → Mercury, 3rd house, Mercury aspects, air-element strength
- **🏠 Where I'll thrive** → 4th house, IC, Moon, planetary location lines (astrocartography hints)
- **✈️ Travel** → 9th house, Jupiter, Sagittarius placements, lines that activate growth
- **🌑 Blind spots** → 12th house, Saturn squares, Pluto aspects, what the user can't see
- **💭 Something on my mind** → no anchor, full free-form

### Track persistence (the magic that compounds value)

Each chip is also a **track**. After every turn, a small parallel
summarizer call (cheap, JSON-only, no UI impact) updates:

```python
user_record["tracks"]["career"] = {
  "first_entered": "...",
  "last_visited": "...",
  "depth": 1,                                    # turn count
  "open_thread": "talked himself out of the scary path; ready to
                  look at why",
  "last_question_layla_asked": "What's the specific story you tell
                                yourself when you're about to choose
                                the safer one?",
}
```

Next visit, when the user taps the same chip, server injects:

> *Continuing 'career' thread. Last open thread: [open_thread]. Last
> question Layla asked: [last_question]. Pick up from there — don't
> restart.*

Layla resumes the conversation by name. That's what makes Layla
someone the user *develops a relationship with* over weeks, not a
service they consult.

### Implementation map (MVP, ~4-6h work)

**Server-side:**
1. `personality/highlights_prompt.md` — new prompt for the 3-4 hook
   extraction. Use `natal_reading_prompt.md` as voice reference; rules:
   no horoscope generalities, no flattery, must contain a contradiction
   or unexpected angle, must be specific to this chart.
2. `personality/drill_chips/career.md` (etc, 7 files) — per-chip prompt
   frames defining the chart anchor + 3-act instruction.
3. `services/claude_service.py`: add `generate_highlights(chart_data,
   ...)` + `generate_drill_response(chart_data, full_reading, chip_slug,
   ...)`.
4. `flows/onboarding.py:_llm_and_save` → fire 2 detached LLM tasks in
   parallel (highlights + full read). The waiting state should resolve
   on highlights, NOT on full read (which keeps generating in
   background and writes to user_record on completion).
5. `flows/onboarding.py:build_chart`: emit highlights text + drill
   chips when highlights ready; full-reading emit goes away from the
   default flow (it's available via "📖 Read my full reading" chip
   later).
6. `botella_manifest.py:free_chat`: detect drill-chip values, prepend
   the chip's chart-anchor frame + 3-act instruction to the system
   prompt. After turn 1, switch to plain free_chat with track context.
7. `services/track_summarizer.py` (new): post-turn summarizer call.
   Updates `user_record["tracks"][chip_slug]`.
8. `flows/checkin.py`: replace (or merge with) current welcome-back
   chips. Welcome-back should now show the user's *active tracks*
   (most-recently-visited 3) + the open chips for tracks they haven't
   touched yet + escape.

**iOS (probably no changes needed):**
- Existing chips + text emits handle this already.
- The "📖 Read my full reading" chip is just another chip with a
  special `value` token (e.g. `"__show_full_reading"`) that the server
  catches and emits the cached sections.

### Decisions still pending (user hadn't answered when interrupted)

1. **Hooks count**: 3 or 4 per chart? (3 = punchier; 4 = one for each
   major life domain.) Default to 3 unless the user comes back with
   a preference.
2. **Chip set**: ship the 7 above, or modify? My read of the user's
   message: he listed 5 (career, romantic partner, communication,
   where to live, where to travel) and added "think about more." I
   added "blind spots" + "something on my mind" — both feel right
   but worth confirming.
3. **"Read my full reading" chip**: show on first emit (with the
   highlights), or only on welcome-back? First-emit makes the full
   read visible; welcome-back-only keeps the highlights moment cleaner.
4. **Track persistence on day 1, or v2?** Persistence is the magic;
   without it each tap is one-shot. With it, Layla resumes threads.
   Ship with persistence — the summarizer call is small.

### Tradeoffs surfaced

- **Cost**: 2 LLM calls per onboarding instead of 1, plus a small
  summarizer per drill turn. Layla's a paid product; this is fine.
- **Loss**: the ceremonious 14-section walk. Some users may have
  valued the ritual. Mitigation: write hooks really well — slow voice,
  give the user space, let the surprise land.
- **Risk**: hooks that don't actually feel surprising → flat experience.
  Mitigation: explicit prompt rules (no generalities, no flattery,
  must contain a contradiction or unexpected angle).

### Related: the existing welcome-back chips ship'd 2026-05-07

The chips that just ship'd in `flows/checkin.py` (Love / Work / Self
question pools, 36 hand-drafted) are good in their own right but are
**superseded** by the redesign above when it ships. The new
welcome-back surface should show the user's active tracks (resumable
threads) instead of random first-person questions. **Don't delete the
question pools yet** — they make a good fallback for users who
haven't entered any tracks. Keep both layers in `flows/checkin.py`:
1. If user has any active tracks: show 2-3 most-recently-visited
   tracks + 1 question chip + escape.
2. If user has zero tracks: show 3 random questions (current behavior)
   + escape.

---

**End of handoff.** A fresh agent reading this should be ready to take
any task on this codebase. Top of the open-work list right now is **§12
— the after-the-mirror redesign**. The user said "do it" but stopped
me before any code shipped — read §12 carefully, confirm decisions
1-4 with the user (or default per the recommendations there), then
build the MVP.
