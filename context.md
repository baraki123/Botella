# botella — context

> **Handoff doc.** A fresh Claude session can read this top-to-bottom and pick up the work cold. Last updated 2026-05-03 mid-day. Read `LAUNCH_PLAN.md` next for the night-of-2026-05-02 progress log.

---

## 0. Current state — 2026-05-03 (read this first)

The Layla iOS app + botella refactor are **functionally end-to-end** on a local backend talking to live Neon Postgres + Anthropic + OpenAI. Production `laylabot` on Northflank is untouched (still polling Telegram on the old code). The cutover hasn't happened.

**Live demo right now:**
- Layla web build: `http://localhost:8082` (Expo Metro on 8082)
- Real Layla brain backend: `http://localhost:8000` (`bot_botella.py` against Neon)
- The web build's anonymous-auth flow works end-to-end. Walked: SignIn → onboarding (lang/name/gender/date/time/place) → real kerykeion chart compute → three-beat headline (full sign names) → 90-120 word Claude teaser via `generate_chart_teaser` → free chat with `chat_with_advisor` keeping chat-history continuity per turn.

**What's `mobile-shim` branch in GombiStar carrying** (12 commits ahead of main, never pushed):
- Schema migration (3 new tables): `layla_user_identities`, `layla_sessions`, `layla_user_records`
- `database/storage.py` — `PostgresStorage` impl of botella's Storage Protocol
- `flows/onboarding.py` (9 tests) — language → name → gender → date → time → place → save_chart
- `flows/invite.py` (8 tests) — pre-mapped + invite-first paths
- `flows/people.py` (7 tests) — add-friend yes-path + invite-first stub
- `flows/intake.py` (6 tests) — 7-question Q&A with Claude-driven Q2-7
- `botella_manifest.py` — wires all four flows + `chat_with_advisor` as `free_chat` + Whisper as `voice_handler`
- `bot_botella.py` — parallel uvicorn entry; **does NOT replace `bot.py`**
- `services/transcribe.py` — Whisper extracted out of `handlers/voice.py`
- `services/chart_service.py` — `build_natal_chart` got `online=False` (geonames default username was rate-limited; was hanging the chart compute)

**What's botella main carrying** (committed, no remote, never pushed):
- New: `botella/auth/apple.py` (Apple Sign-In identity-token verifier with PyJWKClient)
- New: `botella/push.py` (`POST /v1/push/register` + `proactive_send` Expo Push helper)
- New: `botella/auth/routes.py` extended with `/v1/auth/apple` + `/v1/account` (delete-account, App Store 5.1.1(v))
- New: `botella/storage/memory.py` extended with `external_id_for`, `telegram_id_for`, `delete_user`
- New: `Start.init_data` field — triggers can seed `session.data` when entering a flow (was clobbered to `{}` before)
- New: `botella/contract.py` — `Storage.delete_user` Protocol method
- New: `pyproject.toml` adds `websockets>=12` + `pyjwt[crypto]>=2.8` + `httpx>=0.27` (the WS upgrade was 404-ing without `websockets`)
- `layla-app/` — full Layla-branded Expo fork from `mobile-template/`, dark warm-twilight design (Cochin italic mark, gold accent, no-bubble Layla messages with gold-dot prefix, charcoal-rose user pills, SignInScreen with serif heading, Settings with delete-account)
- Mobile WS client now queues messages when WS is not open + flushes on reconnect (was silently dropping)
- Composer always editable; small "Reconnecting…" banner above when status != open
- ChatScreen auto-fires `/start` once on first WS open (so Layla begins the conversation, no greeting echo)

**What's running on the laptop right now** (will need restart if it crashes):
- `:8000` — `uvicorn bot_botella:app` from `~/Desktop/Coding/GombiStar/`. Tail: `/tmp/botella-real.log`.
- `:8081` — `npx expo start` from `~/Desktop/Coding/botella/mobile-template/`. Tail: `/tmp/expo-restart.log`. (Generic Echo template, not Layla-branded.)
- `:8082` — `npx expo start` from `~/Desktop/Coding/botella/layla-app/`. Tail: `/tmp/layla-expo.log`. **This is the Layla demo.**

To restart any of those: `lsof -nP -iTCP:<port> -sTCP:LISTEN | awk 'NR>1 {print $2}' | xargs kill`, then re-run the corresponding command.

**Verified bugs fixed this session:**
- `websockets` lib not in GombiStar venv → WS handshake 404. Added explicit dep.
- `build_natal_chart` defaulted to `online=True` → kerykeion hung on geonames rate limit. Added `online=False`.
- `Start` clobbered `session.data = {}` → invite flow trigger couldn't pre-stash `invite_token`. Added `init_data`.
- Composer was `editable={!disabled}` and `disabled = status !== "open"` → users couldn't type during WS reconnect. Always editable now; outbox queues messages.
- ChatScreen seeded `messages` with `product.greeting` → duplicated SignInScreen tagline. Removed; auto-`/start` instead.
- Sign abbreviation "Pis"/"Sco" leaked from kerykeion. Imported `_full_sign` from `services.chart_table`.
- "Looking up nyc…" echoed user's raw input ugly. Changed to "Looking that up…".
- `_chart_intro` was a one-line stub. Replaced with three-beat headline + Claude teaser via `generate_chart_teaser`.
- `PostgresStorage.update_user` bailed for users without a Telegram identity → anonymous iOS users' `Done(carry={...})` was a no-op → free_chat saw an empty user record → "I haven't met you yet, send /start" loop. Added `layla_user_records` table; `update_user` now always upserts there + mirrors known columns to `layla_users` only when telegram-linked.
- `free_chat` for anonymous users had `chat_history=[]` → after the teaser said "We'll start with your Sun", user's "ok" → Claude pivoted to generic "What's on your mind?" with no continuity. Now seeds `chat_history` in onboarding's `Done(carry=...)` and persists turns into `layla_user_records.data.chat_history` (last 20 turns).

**What's deferred / known TODOs:**
- Streaming tokens — Claude responses arrive as one ~200-word bubble after 6-8s. The most awkward beat in the flow. Switching to token-by-token streaming would be the single biggest perceived-quality win.
- Real "welcome back" — if a returning user reloads, the greeting is generic. Production has `generate_checkin_opener` that produces a transit-aware opener. Not wired into `start_trigger` yet.
- Voice messages on mobile — server's `voice_handler` is wired (`services/transcribe.py`); mobile-side `expo-av` recorder + multipart upload UI is the missing half. ~half day.
- Account linking — anonymous → Apple, Telegram → Apple, Telegram → iOS via `/link <code>`. Without this, existing Telegram users can't keep their data on iOS.
- Cutover deploy — `bot_botella.py` running locally needs to become production. Plan: `laylabot-staging` Northflank service against a Neon branch, validate, then swap.
- chat regex layers — `handlers/chat.py` has invite-intent / name-recognition / update-notes / awaiting_settings_city detection that the manifest's `free_chat` doesn't have yet. Cutover loses these features without porting.
- Sign abbreviation in `_chart_ready_headline` uses `_full_sign` which works fine, but the fallback `_chart_intro` (older path) is gone. Both paths now use `_chart_ready_messages`. Ignore prior context warning.
- App icon + splash — still Echo template defaults in `layla-app/assets/`.
- App Store Connect / Apple Developer enrollment / EAS Build setup — user-only, blocked on $99 Apple Dev account.

---

## 1. What we're building

**botella** is a Python library that wraps a Telegram-bot's brain (handlers, services, prompts) so the same logic can serve **three transports** at once:

- **Telegram** (existing channel — long-polling or webhook)
- **Native iOS / Android** via HTTPS + WebSocket (anonymous-first auth)
- **Web** via the same HTTPS + WS surface

Each forked product (Layla.app, EventFire.app, …) is its **own standalone app** built from the same template (`mobile-template/`), pointed at its own bot's backend. **Not a multi-bot launcher.** That distinction matters — the user has corrected this misread before.

Plus an Expo (React Native + TypeScript) chat-shell template that consumes botella's API. Forked per product with theme + endpoint changes only.

## 2. Why

The user is a **solo builder** running multiple Telegram bots:

- **Layla** (codebase at `~/Desktop/Coding/GombiStar/`) — astrology-lensed personal advisor. Python, python-telegram-bot 21.6, Anthropic Claude, Postgres on Neon, deployed to **Northflank** (project `gombibot`, service `laylabot`). 30-day free trial → $8.88/mo. Already in production on Telegram. Read `GombiStar/context.md` for full product detail.
- **event-e-fire** (`~/Desktop/Coding/event-e-fire/`) — converts WhatsApp event forwards into Google Calendar links. Python, stateless, no DB.
- **Gombi Creations** — separate React+Vite web project (not bot-related).

He's built these as Telegram bots for fast traction validation. Now wants them in the **App Store** as native apps — both iOS and Android, polished, paid, App Store-compliant. Doing this per-bot from scratch would be ~1 month each. botella reduces it to: **fork a template, swap a config, ship.**

The other product context that matters: the user is **product-first / PM-style**, prefers terse responses with concrete recommendations, doesn't want planning docs unless asked, and doesn't want backwards-compat hacks. He's deep-Python-experienced, comfortable with React Native conceptually, less hands-on with mobile.

## 3. Architecture

```
                ┌─────────────────────────────────┐
                │  bot's existing Python brain    │
                │  (handlers, services, claude_*) │
                │  — UNCHANGED in spirit —        │
                └─────────────┬───────────────────┘
                              │
                  ┌───────────▼───────────┐
                  │   BotManifest         │  ← the ONE integration point per bot
                  │   - flows[]           │      (each bot writes a botella_manifest.py
                  │   - triggers{}        │       and a 3-line bot.py: create_app(manifest))
                  │   - free_chat         │
                  │   - voice_handler     │
                  │   - storage           │
                  └───────────┬───────────┘
                              │
                  ┌───────────▼───────────┐
                  │   runtime.run()       │  ← async dispatcher
                  │   triggers > flows >  │     trigger > flow state > free_chat
                  │   free_chat           │     Goto/Start auto-execute next state
                  └───────────┬───────────┘
                              │
                              │  yields OutboundEvents
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
   ┌────▼─────┐         ┌─────▼─────┐         ┌─────▼─────┐
   │ Telegram │         │   HTTP    │         │ WebSocket │
   │ adapter  │         │  adapter  │         │  adapter  │
   │  (PTB)   │         │ POST /v1/ │         │ WSS /v1/  │
   │  buffer  │         │ messages  │         │  stream   │
   │ tokens,  │         │ (collect  │         │ (live     │
   │ flush on │         │  events,  │         │  token-by-│
   │ complete │         │  return)  │         │  token)   │
   └──────────┘         └───────────┘         └───────────┘
```

**Storage** is a Protocol the bot implements (sessions, identity, per-user data). botella ships `MemoryStorage` for tests + toy bot. For Layla, Postgres-backed implementation will live in GombiStar's repo.

## 4. What's built (v0.0.1, all green)

### Python package `botella/`

| File | What it does |
|---|---|
| `contract.py` | `InboundMessage`, `OutboundEvent` + helpers (`text/typing/token/complete/quick_replies/media`), `SessionState`, transitions (`WaitFor/Stay/Goto/Done/Start`), `Flow` (decorator-based state registration), `Storage` Protocol, `BotManifest` |
| `runtime.py` | `async run(msg, manifest)` — the dispatcher. Triggers preempt, then in-flow state, then free chat. `Goto` and `Start` auto-execute the next state with empty input so flows can prompt without wasting a turn. `Done` pops the flow stack (or resets) and merges `carry` into the user record. |
| `storage/memory.py` | `MemoryStorage` — sessions (deepcopied per load to prevent mid-turn races), identity resolver, per-user dict store. For tests. |
| `auth/jwt.py` | HS256 mint/verify. 90-day TTL. `BOTELLA_JWT_SECRET` env var; falls back to a known dev secret iff `BOTELLA_ENV in ("", "dev", "test")`. |
| `auth/routes.py` | `POST /v1/auth/anonymous {device_id}` → JWT. `current_user_id` FastAPI dependency for protected routes. |
| `adapters/http.py` | `POST /v1/messages {text?, callback_data?, transport}` (Bearer JWT). Runs the dispatcher to completion, returns events as JSON. |
| `adapters/ws.py` | `WSS /v1/stream?token=<jwt>`. Each inbound JSON frame runs the dispatcher; events stream back as JSON frames. Sends `{"type":"turn_end"}` sentinel after each turn. |
| `adapters/telegram.py` | Wraps python-telegram-bot 21.x. `build_telegram_application()` for polling; `setup_telegram_webhook()` mounts a webhook receiver inside an existing FastAPI app with optional secret-token validation. `TokenBuffer.ever_added` flag handles complete-text correctly. |
| `app.py` | `create_app(manifest)` → FastAPI app with CORS, auth router, HTTP router, WS router, `/health`. |

### Examples + tooling

| File | What it does |
|---|---|
| `examples/echo_bot/manifest.py` | Toy bot exercising EVERY primitive: `/start` trigger, `intro` flow with `WaitFor`/`Goto`/`Stay`, `Done(carry={...})`, pure-streaming free chat (typing → tokens → complete), `/reset`. |
| `examples/echo_bot/run.py` | uvicorn entrypoint. |
| `tests/test_runtime.py` | 3 unit tests: trigger starts flow + entry state, Stay preserves state on validation failure, free chat fires when no flow active. |
| `tests/test_echo_bot_e2e.py` | 6 tests through the actual HTTP API via Starlette TestClient. Covers auth, full conversation, returning user, reset, two-user isolation. |
| `tests/test_telegram_adapter.py` | 12 tests: 8 render-event units (typing/text/token-buffer/complete/quick_replies/media + flush rules) + 4 e2e via `drive_inbound` + a `FakeBot` that records every call. |
| `tests/test_ws_adapter.py` | 4 tests: auth gate, full streaming flow, two parallel WS connections isolated. |
| `scripts/smoke.py` | Live integration: boots real uvicorn (not TestClient), walks full conversation through HTTPS+WS via `httpx` and `websockets`. **All 12 checks ✓ in ~6ms.** |
| `scripts/demo.sh` | Boots backend on `0.0.0.0:8000` + Expo dev server on `:8081`. Prints LAN IP for iPhone connection. Uses portable bash 3.2-compatible wait loop. |
| `scripts/monitor.py` | Drives the Expo web build via Python Playwright. Walks the conversation, saves screenshots to `/tmp/botella-shots/`, prints browser console + page errors. **Works without MCP — same capability.** |

### Mobile template `mobile-template/`

Vanilla Expo SDK 54 + React Native 0.81 + React 19 (TypeScript), web target enabled.

| File | What it does |
|---|---|
| `index.ts` | Entry. Imports `react-native-get-random-values` polyfill (Hermes lacks `crypto.getRandomValues`) BEFORE `App`. Order matters — auth's UUID gen needs it. |
| `App.tsx` | Mounts `<ChatScreen />` inside `<SafeAreaView>`. |
| `src/config/product.ts` | **The single per-fork file.** name, accent, greeting. `apiUrl` derived dynamically: web uses `window.location.hostname:8000`, native (Expo Go) uses `Constants.expoConfig.hostUri` host. Fork swaps to `https://api.<product>.app` for prod. |
| `src/config/theme.ts` | Visual tokens (colors, spacing, radius). |
| `src/auth/anonymous.ts` | Generates a UUID device-id, exchanges for JWT via `POST /v1/auth/anonymous`, stores both in AsyncStorage. `clearSession()` for /reset-style flows. |
| `src/api/types.ts` | `BotEvent` mirroring `botella.contract.OutboundEvent`. |
| `src/api/stream.ts` | WS client. Reconnect with exponential backoff. `onEvent` and `onStatus` listener hooks. |
| `src/chat/ChatScreen.tsx` | The brain. Bootstraps session → opens WS → renders messages. Streaming bubble fills token-by-token; flips off `streaming` flag on complete. Quick-reply chips removed on tap so they can't be tapped twice. Auto-scrolls. Header status dot (green/amber/red). |
| `src/chat/Bubble.tsx` | User and bot bubbles. Strips HTML tags from bot text (Layla emits `<b>`/`<i>` for Telegram parity; mobile renders plain). Caret `▍` while streaming. |
| `src/chat/QuickReplies.tsx` | Pill chips below the bubble carrying them. |
| `src/chat/TypingIndicator.tsx` | Three-dot animated indicator using `Animated`. |
| `src/chat/Composer.tsx` | TextInput + send button. **On web, Enter sends, Shift+Enter newlines** (multiline TextInput on web defaults to newline-on-Enter — bad chat UX). Native uses keyboard's send key. |

## 5. Contract specifics a new agent must know

These are the parts most likely to be wrong without context.

### `WaitFor` takes only `next_state`

The original design had `WaitFor(next_state, input_type)`. `input_type` was YAGNI for v0 and I dropped it after a real test caught me writing `WaitFor("text", "got_name")` — the test was storing "text" as next_state. Now: `WaitFor("got_name")`.

### `quick_replies` carries its own prompt

Don't emit `text("Pick one") + quick_replies(options, prompt="")` — that's two separate UI cards on Telegram and mobile. Use **one** event: `quick_replies(options, prompt="Pick one")`.

### Free chat is pure streaming

Pattern: `yield typing(); yield token(...); yield token(...); yield complete(full_text)`. Don't yield a separate `text(...)` event at the end — that renders as a duplicate message on Telegram. The `complete` event's text is **only** used when no tokens were streamed (the `TokenBuffer.ever_added` flag tracks this in `adapters/telegram.py`).

### `Done(carry={...})` is the data-out path

When a flow ends, transient `session.data` is wiped. Anything that should persist in the user record must be passed via `Done(carry={...})` — the runtime calls `storage.update_user(user_id, carry)` before resetting.

### Identity resolution at the edge

Adapters resolve `(provider, external_id) → internal user_id` BEFORE calling `runtime.run`. Handlers ALWAYS see the internal `user_id`. The Telegram adapter does `storage.resolve_identity("telegram", str(update.effective_user.id))`. The HTTP/WS adapters do it via JWT `sub`. Bots never see telegram_chat_id, apple_sub, or device_id directly.

### Goto vs Start

- `Goto("state")` moves within the current flow; runtime invokes the new state immediately with empty input.
- `Start("flow", nest=True)` enters a new flow; if `nest`, current flow is pushed onto `session.flow_stack` and `Done` pops back.

## 6. What's NOT built (and why)

| Feature | Why deferred |
|---|---|
| **Apple Sign-In** | Anonymous-first ships faster. Required before App Store launch. ~2 days. Tables already shaped right (`provider, external_id` are flexible). |
| **Google Sign-In** | Same as Apple. App Store requires Apple Sign-In if any third-party login is offered. |
| **Account linking** (`/link <code>` on Telegram → settings on iOS) | Not blocking v0; new mobile-first users don't have Telegram threads to link yet. ~50 LOC + a `link_codes` table when ready. |
| **Push notifications (Expo Push)** | Required for Layla's "morning reading" to fire on mobile. Need: register expo_push_token endpoint, `proactive_send()` API on manifest, swap Layla's `send_daily_readings` to emit through it. ~1 day. |
| **Voice transcription on mobile** | Layla already has it for Telegram via OpenAI Whisper. Mobile path: `expo-av` records OGG/M4A, multipart POST `/v1/voice`, server reuses existing `transcribe.py`, returns text. ~half day. |
| **Image upload from mobile** | event-e-fire needs this (flyer images → calendar links). ~half day. |
| **The Layla refactor itself** | This is the cross-repo work. Botella is now real and tested; the next step is to extract Layla's onboarding `ConversationHandler` (27 state IDs) into botella `Flow`s. Plan in §8. |
| **Telegram-specific: groups, mini-apps, payments, inline mode** | Layla is DM-only and uses Telegram Stars or Stripe (deferred to post-beta). Not building these. |
| **WebSocket reconnect with message replay** | If the WS drops mid-stream, the client misses the rest. Acceptable for v0; production may want server-side buffering keyed by message_id. |
| **MS Bot Framework / Rasa / Stream Chat** | Evaluated and rejected. See §9. |

## 7. Layla integration plan (cross-repo, NOT yet started)

This is the next big body of work. Two repos run two agents in parallel:

**Botella agent** (this repo): owns the `botella` package + Expo template + cross-product abstractions. Voice agent never opens this repo.

**Voice agent** (in `GombiStar/`): owns prompts, personality, character voice, `claude_service.py`, `handlers/chat.py`, `personality/*.md`. Botella agent never edits these once integration is done.

**The contract between them is `botella_manifest.py`** in GombiStar. ~30 lines wiring Layla's flows + handlers into a `BotManifest`.

### Phase 1 — Botella agent does a one-time refactor in GombiStar

Estimated 3 days. **Voice work continues in parallel** — earlier draft of this doc said "voice agent paused"; that was overcautious. Voice tweaking lives in prompt/personality territory, which is orthogonal to the structural refactor. The narrower rule is the **conflict-zone files** below.

1. **Schema:** add `layla_user_identities (provider, external_id, internal_user_id UUID)` and `layla_sessions (internal_user_id PK, flow, state, data JSONB, flow_stack JSONB)`. Keep existing `layla_users.user_id BIGINT` (it's already the Telegram user ID, not chat_id — confirmed by the Explore agent dig).
2. **Migrate** the ~10 hot DAL functions in `database/db.py` to take internal `user_id` (UUID) instead of Telegram user ID. Resolve at entry point.
3. **Extract flows:** rewrite onboarding (state IDs 0–7), invite (20–27), add-friend (10–17) `ConversationHandler` flows into botella `Flow(...)` definitions. The 42 `context.user_data` keys move to `session.data` (JSONB). Sketch already proven in `botella/examples/layla_sketch/` against MemoryStorage.
4. **`botella_manifest.py`:** wire flows + commands + free-chat handler.
5. **Collapse `bot.py`:** ~3 lines invoking `create_app(manifest)`.
6. **Switch Telegram from polling to webhook** in Northflank service config. Add `EXPOSE 8000` to Dockerfile, `CMD ["uvicorn", "bot:app", ...]`. Set Telegram webhook URL.
7. **Verify:** existing MCP testing setup (`mcp/test_newchart_flow.py`) should still pass against the new architecture.

### Conflict-zone files — voice agent should NOT edit these during the refactor window

- `handlers/onboarding.py` — being deleted, replaced by Flow defs in `botella_manifest.py`
- `handlers/invite.py` — same
- `handlers/people.py` — same (add-friend flow)
- `database/db.py` — DAL signatures changing from `telegram_user_id BIGINT` to internal `user_id` UUID
- `bot.py` — collapsing from current PTB wiring to ~3 lines

**Safe to keep editing in parallel:**
- `personality/*.md` — pure prompt files, zero overlap
- `claude_service.py` — prompt-string / function-body edits are fine; avoid changing function *signatures*
- `locales/strings.py` — UI string audits
- `tests/`

### Phase 2 — full parallel resumes

After Phase 1, the conflict zone goes away — `bot.py` is a stub, `handlers/*.py` are gone, `database/db.py` settles. Botella agent shifts to the Expo mobile shell + push + Apple Sign-In here in this repo.

### Critical context for the cross-repo refactor

- **Northflank deploy auto-fires on push to main.** Do refactor on a `mobile-shim` branch, merge only when tested.
- **Northflank runtime env-var POST replaces the entire env** — if you ever update env vars via API, GET first, merge, POST the full set, or you'll wipe `OPENAI_API_KEY` etc.
- **Layla's MCP test fixtures** (`mcp/telegram_user_mcp.py`, Telethon-based) test against the live `@laylastarbot`. Should keep working post-refactor.

## 8. Repo layout

```
botella/                          ← THIS REPO (git-tracked, branch `main`, no remote)
├── pyproject.toml                  Python package config (deps: fastapi, uvicorn,
│                                   websockets, pyjwt[crypto], pydantic,
│                                   python-multipart, httpx)
├── LAUNCH_PLAN.md                  Night-of-2026-05-02 progress log
├── botella/                        the installable package
│   ├── __init__.py                 public exports (incl. Start with init_data)
│   ├── contract.py                 (incl. Storage.delete_user, Start.init_data)
│   ├── runtime.py
│   ├── app.py                      mounts auth + account + push + http + ws
│   ├── push.py                     POST /v1/push/register + proactive_send()
│   ├── storage/
│   │   └── memory.py               in-memory impl (telegram_id_for, external_id_for,
│   │                               delete_user)
│   ├── auth/
│   │   ├── jwt.py
│   │   ├── apple.py                Apple Sign-In identity-token verifier
│   │   └── routes.py               /v1/auth/{anonymous,apple} + /v1/account
│   └── adapters/
│       ├── http.py                 /v1/messages
│       ├── ws.py                   /v1/stream
│       └── telegram.py             PTB wrapper (HTML parse_mode, lifespan-safe)
├── examples/
│   └── echo_bot/                   toy bot exercising every primitive
│       ├── manifest.py
│       └── run.py
├── tests/                          25 tests, all green
│   ├── test_runtime.py
│   ├── test_echo_bot_e2e.py
│   ├── test_telegram_adapter.py
│   └── test_ws_adapter.py
├── scripts/
│   ├── demo.sh                     boots backend + Expo together
│   ├── smoke.py                    live integration check via real sockets
│   └── monitor.py                  drives the Expo web build via Playwright
├── mobile-template/                Generic Expo (RN+TS) chat-shell, the canonical
│   │                               template. Apple Sign-In capable.
│   ├── App.tsx                     signin → chat routing
│   ├── app.json                    Echo template (slug "mobile-template")
│   ├── package.json
│   ├── tsconfig.json
│   ├── index.ts                    react-native-get-random-values polyfill
│   └── src/
│       ├── config/{product,theme}.ts
│       ├── auth/{anonymous,apple,SignInScreen}.tsx
│       ├── api/{types,stream}.ts
│       └── chat/{ChatScreen,Bubble,Composer,QuickReplies,TypingIndicator,types}.tsx
├── layla-app/                      First product fork. Layla branding, dusk purple,
│   │                               app.layla.ios bundle id, eas.json for builds.
│   ├── App.tsx                     signin → chat ↔ settings routing
│   ├── app.json                    name "Layla", bundle id, splash, infoPlist,
│   │                               usesAppleSignIn, expo-apple-authentication plugin
│   ├── eas.json                    development / preview / production profiles
│   ├── package.json                "layla-app"
│   └── src/
│       ├── config/{product,theme}.ts  Layla strings + dusk purple
│       ├── auth/                   inherited from mobile-template (anonymous, apple, SignIn)
│       ├── chat/                   inherited; ChatScreen has ⋯ Settings button
│       └── settings/SettingsScreen.tsx  account / signout / delete / privacy / terms
├── venv/                           Python 3.11 venv (gitignored)
├── .mcp.json                       Playwright MCP config
├── MORNING.md                      morning brief from the build session
├── PLAYWRIGHT_MCP.md               manual MCP setup notes
└── context.md                      THIS FILE
```

## 9. Decisions made (don't relitigate without new info)

- **Build, don't buy.** Evaluated MS Bot Framework, Rasa, Botpress, Stream Chat, Vercel AI SDK, Chainlit — none fit. MS Bot Framework was closest but Python SDK is second-class and Azure pull is too heavy for solo dev. Rasa is built for NLU/intent bots, not LLM-driven free chat. Botpress is Node.js. Stream Chat is human↔human chat with bots bolted on. Build it ourselves: ~2,000 LOC of Python that fits Layla's existing shape exactly.
- **Stay on Northflank** for Layla. Auto-deploy on push to main, Neon Postgres already wired, Docker-friendly, APScheduler runs cleanly. No host migration during the iOS port — too many things changing at once.
- **Anonymous-first auth.** Apple Sign-In and Google Sign-In before App Store launch but not for v0.
- **Fork-per-product, not multi-bot launcher.** User has corrected this misread before; the side-menu in mobile-template is reserved for in-app nav (settings, threads, account, paywall), NOT bot-switching.
- **No streaming on Telegram.** Token events buffer; flush on complete or before any non-token event. Telegram's typing indicator covers the wait.
- **No refresh tokens for v0.** 90-day JWTs are simpler; re-auth UX on expiry is acceptable.
- **`WaitFor` takes only `next_state`.** Dropped `input_type` after a test caught the arg-order ambiguity.
- **`quick_replies` carries its own prompt.** Don't emit `text + quick_replies` separately.
- **Pure-streaming free chat** (`typing → token… → complete`). Don't emit a final `text(...)` after streaming — duplicates on Telegram.

## 10. Commands cheat sheet

```bash
# === backend ===
source venv/bin/activate
python -m pytest                              # 25 tests, ~1s
python scripts/smoke.py                       # live integration, ~1s
uvicorn examples.echo_bot.run:app --reload    # local dev (127.0.0.1:8000)

# === full stack demo (backend + Expo dev server) ===
bash scripts/demo.sh                          # binds to 0.0.0.0 for phone access

# === mobile template ===
cd mobile-template
npm install                                   # one-time
npx tsc --noEmit                              # type-check (no errors = good)
npx expo export --platform web                # static web build to dist/
npx expo start --port 8081                    # dev server (web + Expo Go)

# === web monitoring (in this session, no MCP needed) ===
python scripts/monitor.py                     # walks canned conversation
python scripts/monitor.py --interactive       # opens browser, leaves it
python scripts/monitor.py --shot only         # one screenshot

# === Playwright MCP (after Claude Code restart, the .mcp.json kicks in) ===
# Tools become available as mcp__playwright__*
# `playwright-mcp` binary is at /usr/local/bin/playwright-mcp

# === Layla (separate repo) ===
cd ~/Desktop/Coding/GombiStar
source venv/bin/activate
python -m pytest tests/ -v                    # Layla's existing tests (32, all passing)

# === Layla deployment ===
# Push to main → Northflank auto-deploys
# Logs: curl -H "Authorization: Bearer $NORTHFLANK_TOKEN" \
#         https://api.northflank.com/v1/projects/gombibot/services/laylabot/logs?lines=100
```

## 11. Known issues / gotchas

### iPhone Expo Go discoverability

Bonjour/mDNS auto-discovery is flaky on some networks. Three fallbacks:

1. **iPhone Camera app** scans QR code at `/tmp/botella-qr.png` (regenerate with `python -c "import qrcode; qrcode.make('exp://192.168.5.81:8081').save('/tmp/botella-qr.png')"; open /tmp/botella-qr.png`)
2. **iPhone Safari** → enter `exp://<LAN_IP>:8081` directly
3. **Expo Go "Enter URL manually"** if it surfaces in their version

User's LAN IP at last build session: `192.168.5.81`. May change.

### iPhone connectivity — diagnostic order (resolved 2026-05-02)

When the phone can't reach the laptop, check these in this order — this is the order that actually fired in the wild:

1. **Phone on Wi-Fi at all?** First time around, phone was on cellular, not Wi-Fi. Toggle cellular off temporarily to force Wi-Fi. Easy to miss because the phone "feels" connected.
2. **Same SSID as the laptop, exact match.** Watch for `_5G` / `_guest` variants on routers that split bands or have a guest network. Settings → Wi-Fi.
3. **Sanity check from phone Safari**: open `http://<LAN_IP>:8081` — if Safari loads the Metro page, network is fine and the issue is app-side. If it fails, it's network.
4. **macOS firewall** (`defaults read /Library/Preferences/com.apple.alf globalstate` — 0 = off). Was OFF in this case, so not the cause; still worth checking.
5. **Router client isolation** — some ISP routers block phone-to-laptop traffic. Last to suspect, hard to verify without admin access.

### iPhone Expo Go — entering the URL manually

In Expo Go's "Enter URL manually" field, use the **`exp://`** scheme, not `http://`:
```
exp://<LAN_IP>:8081
```
`http://...:8081` makes Expo Go show "start a local development server with `npx expo start`" — that message is misleading; Metro IS running, the URL just had the wrong scheme.

Phone Safari can also load `http://<LAN_IP>:8081` directly — that serves the React Native Web build of the chat shell. Useful as a fallback demo path when Expo Go is being picky.

### Hermes runtime needs `react-native-get-random-values` polyfill

`globalThis.crypto.getRandomValues` doesn't exist in Hermes by default — the auth flow's UUID generator (`mobile-template/src/auth/anonymous.ts`) needs it. Polyfill is imported at the top of `mobile-template/index.ts` and `layla-app/index.ts`. If you swap auth code, keep that import in place.

### `websockets` is NOT a uvicorn base-install dep

uvicorn ships HTTP only by default; WS upgrades return 404 from a route that's clearly registered. Botella's `pyproject.toml` now declares `websockets>=12` explicitly, but if you're in a venv that has botella but `pip list | grep websockets` is empty, install it: `pip install websockets`. Symptom: `WebSocket handshake: Unexpected response code: 404` in the browser console while the route map shows `/v1/stream *` registered.

### kerykeion `online=True` hangs on geonames rate limit

`AstrologicalSubject(...)` defaults to `online=True` which calls geonames for tz lookup. The default username is rate-limited and currently hangs indefinitely on Tel Aviv. We already get the IANA tz from `services.chart_service.geocode_candidates` (timezonefinder), so always pass `online=False, tz_str=geo["timezone"]`. Both `build_natal_chart` and `generate_chart_png` are fixed; if you write new code that calls `AstrologicalSubject`, do the same.

### Sign abbreviation leak ("Sun in Pis")

kerykeion returns 3-letter sign codes (`Pis`, `Sco`, `Aqu`). For user-facing strings, run them through `_full_sign` in `services/chart_table.py`. Anywhere you see "Sun in Pis", that's the bug.

### `Start` clobbers `session.data` — use `init_data`

When a trigger returns `Start("flow_name")`, the runtime resets `session.data = {}` before entering the flow. If your trigger needs to seed the flow's data (e.g. an invite token, the user's lang/gender), pass it via `Start("flow", init_data={"key": value})`. Direct mutation of `session.data` in the trigger before returning `Start(...)` is silently lost.

### Anonymous users vs `layla_users` rows

`layla_users.id` is BIGINT (Telegram user ID). Anonymous (iOS) users have NO row there. Two consequences in code that touches the legacy DAL:
1. `save_chat_message(tid, ...)` is FK'd to `layla_users` — you can't pass `None`. Gate on `if tid is not None`.
2. Persistent state for anonymous users goes into `layla_user_records.data` (JSONB) via `storage.update_user(uuid, patch)`. The same `update_user` ALSO mirrors known column updates (language/gender/current_timezone) to `layla_users` IF the user has a Telegram identity — but for anonymous users, only the records-table write happens.

### Composer-disabled-during-connecting (fixed)

Before 2026-05-03 fix: `editable={!disabled}` where `disabled = status !== "open"`, so during the WS handshake (~200ms) the input silently rejected keystrokes. Now: input is always editable; `StreamClient` queues messages in an `outbox` and flushes on the next `open` event. If you redo the chat shell, keep this contract: never block typing on transport state.

### Northflank env-var replace footgun

Per `GombiStar/context.md`: `POST /v1/projects/gombibot/services/laylabot/runtime-environment` **replaces** the entire env, doesn't merge. Always GET first when modifying.

### The `useNativeDriver` warning on web

Visible in browser console: `Animated: 'useNativeDriver' is not supported because the native animated module is missing`. Coming from `TypingIndicator.tsx`. Cosmetic, no impact on web. On native it uses the native driver fine. Could conditionally set `useNativeDriver: Platform.OS !== 'web'` if it ever bothers anyone.

## 12. Lessons learned during the build (worth carrying forward)

- **A real test caught what design-doc walkthroughs missed.** I had `WaitFor(input_type, next_state)` in my head but `WaitFor(next_state, input_type)` in the dataclass. Toy bot tests caught it on first run. Lesson: build the toy bot ALONGSIDE the contract, not after.
- **The TokenBuffer "buffer-emptiness as flush signal" heuristic was broken.** Couldn't distinguish "just flushed" from "never had tokens." Replaced with explicit `ever_added` flag. Lesson: don't infer state from absence; track it.
- **Multiline TextInput on web makes Enter insert a newline.** Real-world chat UX needs Enter=send, Shift+Enter=newline, with the platform check. Caught by Playwright driving the chat.
- **Quick-replies UX foot-gun:** emitting `text("Pick one") + quick_replies(options, prompt="")` looks fine on HTTP but renders as two separate cards on Telegram (the second a useless `" "` placeholder). Use one event with `prompt="..."`.
- **`wait -n`** isn't in macOS bash 3.2. Use a portable `kill -0` polling loop in shell scripts.
- **Expo CLI rejects `--silent`.** Use the bare command and pipe to `tail`.

## 13. Next concrete moves (priority order — UPDATED 2026-05-03)

DONE since the overnight session:
- ✅ Onboarding / invite / add-friend / intake flows all ported to botella `Flow` defs (mobile-shim, 30 tests)
- ✅ Manifest wires all 4 flows + chat_with_advisor + Whisper + 6 triggers
- ✅ `bot_botella.py` running locally against live Neon, end-to-end verified
- ✅ Layla design pass — warm twilight aesthetic, Cochin italic mark, no-bubble Layla messages, gold accent
- ✅ ChatScreen auto-`/start` on first WS open (no manual "/start" needed)
- ✅ WS reconnect / outbox queue (silent-failure mode killed)
- ✅ `layla_user_records` table — botella owns its own per-user JSONB store; anonymous users now persist properly
- ✅ Three-beat chart-ready headline + Claude `generate_chart_teaser` for the 90-120 word architectural read
- ✅ Anonymous chat-history continuity through `chat_history` in `layla_user_records.data` (seeded from save_chart's Done carry)
- ✅ Bugs that bit during testing: websockets dep missing, kerykeion `online=True` hang, `Start` clobbering session.data, sign abbreviation leaks, Composer disabled-during-connect, free_chat empty-history after teaser

OPEN — ranked (recommended order):

1. **Streaming tokens.** Layla currently lands as one ~200-word bubble after 6-8s. The single biggest perceived-quality win. `chat_with_advisor` returns the full string today; need to either:
   (a) switch the Anthropic SDK call to `client.messages.stream(...)` and yield `token()` events from `free_chat`, OR
   (b) split chat_with_advisor into a streaming wrapper that does the same work and yields tokens.
   The chat-shell already handles `token` events token-by-token (echo_bot proves it). Backend side: ~1 hour. Visual upgrade: huge.

2. **Real welcome-back / smart check-in.** Returning users currently get a generic "Welcome back, {name}." Production has `services.claude_service.generate_checkin_opener` that takes transits + recent chat + life_context and produces a transit-aware opener. Wire it into `start_trigger` in `botella_manifest.py` for users with an existing chart.

3. **Voice messages on mobile.** Server's `voice_handler` is ready. Mobile-side `expo-av` recorder + multipart upload UI is missing. ~half day. Layla is supposed to feel like talking to a person; voice unlocks that.

4. **Cutover to staging.** Stand up `laylabot-staging` on Northflank, point at a separate Neon branch, deploy `bot_botella.py`, set Telegram webhook URL, validate end-to-end including the `mcp/test_newchart_flow.py` Telethon test against the staging bot. Then swap `laylabot` when calm.

5. **Port chat-handler regex layers.** `handlers/chat.py` has invite-intent / name-recognition / update-notes detection that the manifest's `free_chat` doesn't have. Current Telegram production has these; cutover loses them without porting. ~1 day.

6. **Account linking.** Anonymous → Apple, Telegram → iOS via `/link <code>`. ~1 day. Important before announcing the iOS app to existing Telegram users.

7. **App icon + splash.** Still Echo template defaults. Designer task; can scaffold a placeholder gold-on-twilight L. ~30 min for a stopgap.

8. **App Store Connect setup.** Apple Developer account ($99/yr) → bundle id `app.layla.ios` → EAS Build → TestFlight. User-only, blocked on the Apple Dev enrollment.

9. **save_natal_chart orphan rows.** Known data hygiene; `ON CONFLICT DO NOTHING` doesn't fire because no unique constraint. Not user-visible.

## 14. References

- `LAUNCH_PLAN.md` — App Store launch tracker with the overnight wake-up brief at the top.
- `MORNING.md` — what was working at the end of the original build session (substantially outdated; LAUNCH_PLAN.md supersedes).
- `PLAYWRIGHT_MCP.md` — manual MCP setup notes
- `~/Desktop/Coding/GombiStar/context.md` — Layla's full product + tech context
- `~/Desktop/Coding/event-e-fire/context.md` — second bot we'll port later
- `~/.claude/projects/-Users-barakben-ezer-Desktop-Coding-botella/memory/MEMORY.md` — auto-memory index (loaded automatically)

## 15. Auto-memory awareness

The user's `MEMORY.md` (auto-loaded) already includes:

- **User profile** — solo builder, multi-bot, product-first/PM-style
- **Project portfolio** — Layla, event-e-fire, Gombi, GombiStar live; botella is the new Expo+FastAPI scaffold
- **Botella iOS app scaffold** — the chat-oriented template, fork-per-product, scaffold not launcher
- **Scaffold-not-launcher feedback** — explicit correction: "deploy my bots into an app" means fork-the-template-per-product, NOT one app hosting many bots

Don't relitigate any of those. They're settled.

---

**End of handoff.** A fresh agent reading this should be able to pick up immediately. If something's missing, update this file as you go.
