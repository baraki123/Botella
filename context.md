# botella — handoff

> A fresh Claude session can read this top-to-bottom and pick up the work
> cold. Last updated 2026-05-04 (afternoon work block). If anything below
> disagrees with the running system, trust the system and update this file.

---

## 0. Where we are right now (post-cutover)

**Layla's Telegram bot is live on Botella.** As of 2026-05-04 16:45 UTC,
production `@laylastarbot` is served by `bot_botella.py` running on
Northflank, not the legacy `bot.py` polling path. All the work below has
shipped:

- Streaming token chat (Anthropic AsyncAnthropic, ~1.3s TTFT)
- Smart check-in opener (transit-aware, replaces the placeholder "Welcome back")
- Chart PNG inline in the chat shell on iOS/web (base64 data URL)
- Voice notes on web + native iOS (`expo-audio` hook + `MediaRecorder` web fallback)
- Voice-tagged free chat (warmer Layla persona when input came from a voice note)
- Anonymous → Apple Sign-In linking (Settings has the upgrade row)
- Telegram webhook (instead of long polling) — auto-set on container boot
- All 4 chat regex layers ported into `free_chat` (invite intent, notes
  update, new-person CTA, settings-city — except the last is still on the
  legacy path because Settings flow itself isn't ported)
- City retype path (typos fall back to a fresh geocode instead of nagging)

**Production endpoint:** `https://http--laylabot--28ttnydqvqwp.code.run`
- `/health` → `{"ok": true, "bot": "layla"}`
- `/webhooks/telegram` → Telegram webhook (validates `X-Telegram-Bot-Api-Secret-Token`)
- `/v1/auth/anonymous`, `/v1/auth/apple`, `/v1/account` (delete)
- `/v1/messages` (HTTP request-collection)
- `/v1/stream` (WebSocket — streaming chat)
- `/v1/voice` (multipart audio → transcript)
- `/v1/push/register` (Expo Push token registration)

**Code live in production = `main` branch of GombiStar at HEAD `55d768f`**
(as of cutover). Auto-deploys on push to `main`.

**Shipped 2026-05-04 afternoon (this batch — code in repo, NOT YET DEPLOYED):**
- `PRODUCTION_API_URL` set to the Northflank URL in `layla-app/src/config/product.ts`
- `layla_natal_charts` UNIQUE(user_id) added to schema; migration in `database/migrations/2026_05_04_natal_charts_unique.sql` (run against Neon manually)
- Settings ported to botella: new `flows/settings.py` with menu/lang/gender/city sub-states; `/settings` trigger added; `awaiting_settings_city` regex layer removed (the city sub-state captures the next text turn natively)
- Telegram → iOS `/link <code>` flow: new `layla_link_codes` table (migration in `database/migrations/2026_05_04_link_codes.sql`), `/link` trigger mints codes, `POST /v1/account/link/redeem` endpoint redeems, `Storage.merge_users` re-points identities and drops source data, Settings has a "Link Telegram account" row with input
- Daily reading scheduler revived under `bot_botella.py` startup hook (was off since cutover): `services/daily_runner.py` fans out to Telegram via the PTB Bot AND to iOS via Expo push for users who registered a token. Disable in dev with `LAYLA_DISABLE_SCHEDULER=1`.
- iOS push registration: `src/push/registerPush.ts` + `App.tsx` calls it on session change. Native deps not yet installed — see "Not yet shipped" below.
- Icon + splash + adaptive + favicon regenerated with a Layla-branded mark (italic gold serif L + sparkle on dusk purple)

**Not yet shipped:**
- Migrations not yet applied to Neon (`2026_05_04_natal_charts_unique.sql`, `2026_05_04_link_codes.sql`) — run manually then deploy
- iOS push native deps not installed — `cd layla-app && npx expo install expo-notifications expo-device` before the next EAS build, otherwise `registerForPushNotifications` resolves "expo-notifications-not-installed" silently
- App Store Connect / EAS Build / TestFlight (blocked on $99 Apple Dev enrollment)

---

## 1. Three repos, one product

```
~/Desktop/Coding/
├── botella/        ← THIS REPO. Public on GitHub: baraki123/Botella
│                     Framework + mobile-template + layla-app + this doc.
│                     No deploy target — used as a pip dep by GombiStar.
│
├── GombiStar/      ← Layla's Telegram brain. Private: baraki123/GombiStar
│                     Prompts, personality, handlers/, services/, manifest.
│                     Northflank deploys from main on push.
│
└── event-e-fire/   ← Second bot, not yet ported to botella.
                      Stateless WhatsApp event → Calendar link converter.
```

**Why Botella is public:** to let GombiStar's Docker build `pip install`
it anonymously without setting up auth. The framework code is generic
(no Layla logic, no API keys); secrets and prompts stay in GombiStar.
We discussed treating it as a real public framework with PyPI/docs and
decided no — internal infrastructure for our bots first, gloss later if
event-e-fire confirms the abstractions held up.

---

## 2. Architecture (unchanged since the original build)

```
                ┌─────────────────────────────────┐
                │  bot's Python brain             │
                │  (handlers, services, claude_*) │
                └─────────────┬───────────────────┘
                              │
                  ┌───────────▼───────────┐
                  │   BotManifest         │  ← single integration point
                  │   - flows[]           │     (one per bot)
                  │   - triggers{}        │
                  │   - free_chat         │
                  │   - voice_handler     │
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
   │ + buffer │         │           │         │ (streams  │
   │ tokens   │         │           │         │  tokens)  │
   └──────────┘         └───────────┘         └───────────┘
```

**Storage** is a Protocol the bot implements. Botella ships
`MemoryStorage` for tests. Layla uses `database/storage.py` →
`PostgresStorage` against Neon. The protocol now has 5 methods:
`load_session`, `save_session`, `resolve_identity`, `link_identity`
(new — for Apple linking), `get_user`, `update_user`, `delete_user`.

**Identity model:**
- `layla_user_identities (provider, external_id) → internal_user_id (UUID)`
- Providers: `telegram` (external_id = Telegram BIGINT), `anonymous` (external_id = device UUID), `apple` (external_id = Apple sub)
- One internal_user_id can have multiple identity rows after linking
- Bots see only `internal_user_id`. Adapters resolve at the edge.

---

## 3. What's where in this repo (Botella)

```
botella/                              public on GitHub: baraki123/Botella
├── pyproject.toml                    deps: fastapi, uvicorn, websockets,
│                                     pyjwt[crypto], pydantic, python-multipart,
│                                     httpx; [telegram] extra: python-telegram-bot
├── botella/                          installable package (`pip install
│   │                                 git+https://github.com/baraki123/Botella.git@main`)
│   ├── __init__.py                   public exports
│   ├── contract.py                   InboundMessage (now has `voice_origin` flag),
│   │                                 OutboundEvent, Storage Protocol (now has
│   │                                 `link_identity`), BotManifest, transitions
│   ├── runtime.py                    dispatcher (triggers > flow state > free_chat)
│   ├── app.py                        create_app(manifest) → FastAPI w/ all routes
│   ├── push.py                       /v1/push/register + proactive_send()
│   ├── storage/memory.py             in-memory impl (incl. link_identity)
│   ├── auth/
│   │   ├── jwt.py                    HS256 mint/verify, 90-day TTL
│   │   ├── apple.py                  Apple identity-token verifier (PyJWKClient)
│   │   └── routes.py                 /v1/auth/{anonymous,apple} + /v1/account.
│   │                                 link_anonymous_user_id wired through
│   │                                 storage.link_identity now (was a TODO).
│   └── adapters/
│       ├── http.py                   /v1/messages + /v1/voice (multipart). Encodes
│       │                             image bytes as base64 data URL.
│       ├── ws.py                     /v1/stream. Same data-URL trick. Inbound frame
│       │                             accepts `voice_origin: true` boolean.
│       └── telegram.py               PTB wrapper. Webhook path validated by secret.
│
├── examples/echo_bot/                toy bot exercising every primitive
├── tests/                            64 passing
│
├── mobile-template/                  Generic Expo (RN+TS) chat shell, the canonical
│   │                                 fork point. SDK 54.
│   └── src/
│       ├── config/{product,theme}.ts
│       ├── auth/{anonymous,apple,SignInScreen}
│       ├── api/{types,stream}.ts     (stream now ships `voice_origin` on outbound)
│       ├── voice/recorder.ts         useVoiceRecorder() — expo-audio native +
│       │                             MediaRecorder web; transcribe(blob) helper
│       └── chat/{ChatScreen,Bubble,Composer,QuickReplies,TypingIndicator,types}
│
├── layla-app/                        First product fork. Layla branding, dusk
│   │                                 purple, app.layla.ios bundle id.
│   ├── app.json                      includes expo-audio plugin + microphone perm
│   ├── eas.json                      development / preview / production profiles
│   └── src/                          mostly inherited from mobile-template, plus:
│       ├── settings/SettingsScreen.tsx  has the "Sign in with Apple to keep your
│       │                                data" linking row when provider=anonymous
│       └── chat/Bubble.tsx           Layla aesthetic (no-bubble messages, gold dot)
│
├── scripts/
│   ├── demo.sh                       boots backend + Expo together
│   ├── smoke.py                      live integration check via real sockets
│   └── monitor.py                    drives the Expo web build via Playwright
│
├── .mcp.json                         Playwright MCP config for this directory
├── LAUNCH_PLAN.md                    older, supplanted by this doc
├── MORNING.md                        older, supplanted by this doc
├── PLAYWRIGHT_MCP.md                 manual MCP setup notes
└── context.md                        THIS FILE
```

---

## 4. What's where in GombiStar (Layla's brain)

The same paragraphs, in summary form, lived in this doc before the cutover.
The full version is at `~/Desktop/Coding/GombiStar/context.md`. The
shape of GombiStar's botella integration:

- `requirements.txt` includes `botella[telegram] @ git+https://github.com/baraki123/Botella.git@main`
- `Dockerfile` → `Dockerfile.botella` from the cutover (the legacy
  Dockerfile is preserved as `Dockerfile.legacy` for rollback). Installs
  `git` via apt because the base image lacks it (pip needs git to clone
  Botella from the GitHub URL).
- `bot_botella.py` — the uvicorn entry. Auto-sets the Telegram webhook
  on boot if `TELEGRAM_BOT_TOKEN` + `TELEGRAM_WEBHOOK_URL` + `TELEGRAM_WEBHOOK_SECRET` are present.
- `botella_manifest.py` — wires:
  - 6 triggers: `/start` (smart check-in opener if user has chart), `/newchart`, `/addfriend`, `/addperson` (alias), `/gettoknow`, `/reset`
  - 5 flows: `onboarding`, `invite`, `add_person`, `intake`, `checkin`
  - `free_chat` — streams via `chat_with_advisor_stream`. Includes the
    ported regex layers (invite intent, notes update, add-person CTA).
    Voice-tagged when `msg.voice_origin` or `msg.voice_audio` is set.
  - `voice_handler` — Whisper transcription via `services/transcribe.py`
- `database/storage.py` — `PostgresStorage` impl (incl. `link_identity`)
- `flows/` — `onboarding.py`, `invite.py`, `people.py`, `intake.py`, `checkin.py`
- `services/claude_service.py` — `chat_with_advisor`, `chat_with_advisor_stream`,
  `_build_chat_with_advisor_prompt`, `generate_chart_teaser`, `generate_checkin_opener`
- `CUTOVER.md` — runbook from the staging-not-needed cutover. Useful for rollback procedure.

**Postgres schema** (Neon, us-east-1):
- `layla_users` (BIGINT user_id, name, language, gender, current_timezone, life_context JSONB, created_at, last_active) — Telegram users only
- `layla_natal_charts` (FK telegram user_id, chart_data JSONB, birth_date, birth_time, lat, lng, timezone)
- `layla_chat_history` (FK telegram user_id, role, content, created_at)
- `layla_people` (FK telegram user_id, person_name, relationship_type, gender, birth_date, notes, chart_data, invite_token)
- `layla_user_identities` (provider, external_id) → internal_user_id UUID  ← cross-transport
- `layla_sessions` (internal_user_id PK, flow, state, data JSONB, flow_stack JSONB)  ← botella sessions
- `layla_user_records` (internal_user_id PK, data JSONB)  ← botella per-user data; the only place anonymous-user data lives

---

## 5. Contract specifics a new agent must know

These are the parts most likely to be wrong without context.

### Storage protocol surface

```python
async def load_session(user_id: str) -> SessionState
async def save_session(session: SessionState) -> None
async def resolve_identity(provider, external_id) -> str    # creates if new
async def link_identity(provider, external_id, target_user_id) -> str
                                                            # binds existing internal_user_id
async def get_user(user_id) -> dict
async def update_user(user_id, patch: dict) -> None
async def delete_user(user_id) -> None                       # App Store 5.1.1(v)
```

### `WaitFor` takes only `next_state`

`WaitFor("got_name")`. The `input_type` second arg was YAGNI and removed.

### `quick_replies` carries its own prompt

One event: `quick_replies(["A","B"], prompt="Pick one")`. Don't emit
`text("Pick one")` separately — it'd render as two cards.

### Free chat is pure streaming

Pattern: `yield typing(); yield token(...); yield token(...); yield complete(full_text)`.
Don't yield a separate `text(...)` after streaming — duplicates on Telegram.
The `complete` event's text is only used when no tokens were streamed
(`TokenBuffer.ever_added` flag in `adapters/telegram.py`).

### `Done(carry={...})` is the data-out path

When a flow ends, transient `session.data` is wiped. Anything that should
persist in the user record must be passed via `Done(carry={...})`. The
runtime calls `storage.update_user(user_id, carry)` before resetting.

### `Start` clobbers `session.data` — use `init_data`

When a trigger returns `Start("flow_name")`, the runtime resets
`session.data = {}` before entering the flow. To seed: `Start("flow",
init_data={"key": value})`. Direct mutation before returning `Start(...)`
is silently lost.

### `voice_origin` flag

`InboundMessage.voice_origin: bool` — set by the WS adapter when the
client frame includes `voice_origin: true`. iOS/web mobile sets it after
uploading audio to `/v1/voice` and sending the transcript over WS.
Telegram path uses `msg.voice_audio is not None` (raw audio bytes still
attached after `voice_handler`). `free_chat` checks both:
`voice_origin = msg.voice_origin or msg.voice_audio is not None`.

### Identity resolution at the edge

Adapters resolve `(provider, external_id) → internal user_id` BEFORE
calling `runtime.run`. Handlers ALWAYS see the internal `user_id`.
- Telegram adapter: `storage.resolve_identity("telegram", str(update.effective_user.id))`
- HTTP/WS: via JWT `sub` claim
- Bots never see telegram_chat_id, apple_sub, or device_id directly

### Goto vs Start

- `Goto("state")` moves within the current flow; runtime invokes the new state immediately with empty input
- `Start("flow", nest=True)` enters a new flow; if `nest`, current flow is pushed onto `session.flow_stack` and `Done` pops back

---

## 6. Operational knowledge

### Production endpoint and how to reach it

```bash
# Health
curl https://http--laylabot--28ttnydqvqwp.code.run/health

# Webhook info
TG=$(grep TELEGRAM_BOT_TOKEN ~/Desktop/Coding/GombiStar/.env | cut -d= -f2)
curl "https://api.telegram.org/bot${TG}/getWebhookInfo" | python3 -m json.tool
```

### Northflank API patterns

```bash
NF=$(grep NORTHFLANK_TOKEN ~/Desktop/Coding/GombiStar/.env | cut -d= -f2)

# Service status (build + deployment)
curl -s -H "Authorization: Bearer $NF" \
  https://api.northflank.com/v1/projects/gombibot/services/laylabot \
  | python3 -m json.tool | head -50

# Runtime logs (last 200 lines)
curl -s -H "Authorization: Bearer $NF" \
  "https://api.northflank.com/v1/projects/gombibot/services/laylabot/logs?lines=200&type=runtime"

# Build logs (last 400 lines, ascending)
curl -s -H "Authorization: Bearer $NF" \
  "https://api.northflank.com/v1/projects/gombibot/services/laylabot/logs?lines=400&type=build" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); items=sorted(d['data'],key=lambda x:x['unixTs']); [print(it['log']) for it in items]"

# Runtime env: ALWAYS GET-merge-POST. POST replaces the entire env.
curl -s -H "Authorization: Bearer $NF" \
  https://api.northflank.com/v1/projects/gombibot/services/laylabot/runtime-environment \
  > /tmp/env.json
# ...edit /tmp/env.json...
curl -s -X POST -H "Authorization: Bearer $NF" -H "Content-Type: application/json" \
  -d @/tmp/env.json \
  https://api.northflank.com/v1/projects/gombibot/services/laylabot/runtime-environment

# Add a public port
curl -s -X POST -H "Authorization: Bearer $NF" -H "Content-Type: application/json" \
  -d '{"ports":[{"name":"http","internalPort":8000,"public":true,"protocol":"HTTP"}]}' \
  https://api.northflank.com/v1/projects/gombibot/services/laylabot/ports
```

### Telegram webhook config

The webhook is auto-set by `bot_botella.py` on every container boot via
`setup_telegram_webhook()` in the Telegram adapter. The env vars that
drive it:

- `TELEGRAM_BOT_TOKEN` — in Northflank runtime env (production token, `@laylastarbot`)
- `TELEGRAM_WEBHOOK_URL` — `https://http--laylabot--28ttnydqvqwp.code.run/webhooks/telegram`
- `TELEGRAM_WEBHOOK_SECRET` — random hex, validated by the adapter on each inbound

If you ever need to re-set manually:
```bash
TG=...; URL=...; SECRET=...
curl -X POST "https://api.telegram.org/bot${TG}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"${URL}\",\"secret_token\":\"${SECRET}\",\"drop_pending_updates\":false}"
```

### Rollback

If a deploy breaks production:

```bash
# 1. Drop the webhook so Telegram stops trying to deliver to a broken backend.
TG=$(grep TELEGRAM_BOT_TOKEN ~/Desktop/Coding/GombiStar/.env | cut -d= -f2)
curl -X POST "https://api.telegram.org/bot${TG}/deleteWebhook"

# 2. Revert Dockerfile to legacy.
cd ~/Desktop/Coding/GombiStar
git mv Dockerfile Dockerfile.botella
git mv Dockerfile.legacy Dockerfile
git commit -m "Revert: restore polling Dockerfile after regression"
git push origin main

# 3. Northflank rebuilds with the polling Dockerfile. bot.py polls.
#    No message loss because polling is pull-based.
```

### Local dev

```bash
cd ~/Desktop/Coding/GombiStar
source venv/bin/activate

# Tests
python -m pytest tests/ -q                        # 120 passing

# Local backend (still useful for testing iOS/web against the dev path)
uvicorn bot_botella:app --host 0.0.0.0 --port 8000

# Then in another shell, the Layla web app:
cd ~/Desktop/Coding/botella/layla-app
npx expo start --port 8082
# → http://localhost:8082
```

### Botella tests

```bash
cd ~/Desktop/Coding/botella && source venv/bin/activate && python -m pytest -q
# 64 passing
```

---

## 7. Known gotchas (carry-over)

- **`websockets` is not a uvicorn base-install dep.** Botella declares it in pyproject.toml. If you build a fresh venv and WS upgrades 404, `pip install websockets`.
- **Base image lacks `git`.** GombiStar's `Dockerfile` installs it via apt because pip needs git to clone Botella from GitHub. If you re-base off a different image, keep that line.
- **kerykeion `online=True` hangs on geonames rate limit.** Always pass `online=False, tz_str=geo["timezone"]` to `AstrologicalSubject(...)`. Both `build_natal_chart` and `generate_chart_png` are fixed; new code calling kerykeion must do the same.
- **kerykeion's 3-letter sign codes** (`Pis`, `Sco`, `Aqu`) leak into UI strings unless run through `_full_sign` in `services/chart_table.py`.
- **Anonymous users vs `layla_users` rows.** `layla_users.id` is BIGINT (Telegram). Anonymous (iOS) users have NO row there. `save_chat_message(tid, ...)` is FK'd to `layla_users` — gate on `if tid is not None`. Persistent state for anonymous users goes into `layla_user_records.data` (JSONB) via `storage.update_user(uuid, patch)`.
- **Northflank env-var POST replaces the entire env.** Always GET-merge-POST.
- **`pathIgnoreRules` skip .md changes from triggering builds.** Set on the laylabot service: `*.md` and `**/*.md`. Editing context.md alone won't redeploy. Useful (avoids needless rebuilds).
- **Region:** Northflank service runs on `nf-us-central`, Neon is on `aws.us-east-1`. ~30-40ms cross-region per query. Not the bottleneck (Claude TTFT dominates) but the next staging cutover is the moment to move to a us-east cluster if it ever bothers anyone.
- **Hermes runtime needs `react-native-get-random-values` polyfill.** `globalThis.crypto.getRandomValues` doesn't exist in Hermes by default — auth's UUID gen needs it. Polyfill imported at the top of `mobile-template/index.ts` and `layla-app/index.ts`.
- **Multiline TextInput on web makes Enter insert a newline.** Composer has a Platform.OS === "web" branch: Enter sends, Shift+Enter newlines. Native uses keyboard's send key.
- **`useNativeDriver` warning on web** (cosmetic, from TypingIndicator). Could conditionalize on Platform.OS but not worth it.

---

## 8. Decisions made (don't relitigate without new info)

- **Build, don't buy.** Evaluated MS Bot Framework, Rasa, Botpress, Stream Chat, Vercel AI SDK, Chainlit. None fit the "Telegram-bot brain → multi-transport" niche for a Python solo dev. Botella is ~2000 LOC of Python that fits Layla's existing shape.
- **Botella is internal infrastructure**, not a public framework. We're treating it as a private library used by GombiStar (and event-e-fire when it's ported). PyPI / docs / examples-investment is deferred until a second bot validates the abstractions. The repo went public on GitHub purely to let GombiStar's Docker build pip-install it without auth.
- **Stay on Northflank** for Layla. Auto-deploy on push to main, Neon Postgres already wired, Docker-friendly, APScheduler runs cleanly. No host migration during the iOS port.
- **Anonymous-first auth.** Apple Sign-In is required before App Store launch but not for v0; users start anonymous and link Apple via Settings later.
- **Fork-per-product, not multi-bot launcher.** Each product (Layla, EventFire, …) is its own standalone app. The mobile-template side menu is reserved for in-app nav (settings, threads, account, paywall), NOT bot-switching.
- **No streaming on Telegram.** Token events buffer; flush on complete or before any non-token event. Telegram's typing indicator covers the wait.
- **No refresh tokens for v0.** 90-day JWTs; re-auth UX on expiry is acceptable.

---

## 9. Open work, ranked

| # | Item | Size | Notes |
|---|------|------|-------|
| A | **Apply Neon migrations + deploy** | ~10 min | `psql $DATABASE_URL -f database/migrations/2026_05_04_natal_charts_unique.sql` and `…/2026_05_04_link_codes.sql`. Then `git push` to trigger Northflank rebuild. Without the migration the `/link` flow throws on first redeem and `save_natal_chart` keeps inserting duplicates. |
| B | **Install Expo push native deps** | ~5 min | `cd layla-app && npx expo install expo-notifications expo-device`. Until done, native iOS builds register no token and morning push is dark on the App Store. |
| C | **App Store Connect / EAS Build / TestFlight** | user-only | Blocked on $99 Apple Dev account enrollment. Once enrolled: bundle id `app.layla.ios`, eas.json profiles already in repo. |
| D | **Real icon designer pass** | TBD | The 2026-05-04 stopgap (italic gold L + sparkle) is fine for TestFlight; replace before public submission. |
| E | **Move Northflank to a us-east cluster** | ~30 min | Drops Neon round-trip from ~30ms to <5ms. Has to be a service recreate. Do at the next staging-needed moment. |
| F | **Anonymous-iOS users get morning push too** | ~half day | Current daily runner only iterates `layla_users` (Telegram-keyed). Pure-anonymous users with a chart in `layla_user_records.data.natal_chart` get nothing until they /link or sign in with Apple. Either backfill them into `layla_users`, or fork a parallel runner over `layla_user_records`. |

---

## 10. User context

The user is a **solo builder**, product-first / PM-style. Running multiple Telegram bots:

- **Layla** (`~/Desktop/Coding/GombiStar/`) — astrology-lensed personal advisor. Production. 30-day free trial → $8.88/mo.
- **event-e-fire** (`~/Desktop/Coding/event-e-fire/`) — WhatsApp event forwards → Calendar links. Stateless. Not yet ported to botella.
- **Gombi Creations** — separate React+Vite web project, not bot-related.

**Working preferences:**
- Terse responses with concrete recommendations
- No planning docs unless asked
- No backwards-compat hacks
- Deep Python experience; comfortable with React Native conceptually, less hands-on with mobile
- **Always end every response with a `## Summary` block** (what I did / decisions needed / what you need to do). See `feedback_response_format.md` in memory.

---

## 11. References

- `~/Desktop/Coding/GombiStar/CUTOVER.md` — the runbook used to do the cutover, useful for rollback patterns
- `~/Desktop/Coding/GombiStar/context.md` — Layla's product-side context
- `~/Desktop/Coding/event-e-fire/context.md` — second bot, port target
- `~/.claude/projects/-Users-barakben-ezer-Desktop-Coding-botella/memory/MEMORY.md` — auto-loaded user/feedback/project memory
- `~/.claude/skills/ui-ux-pro-max/SKILL.md` — UI/UX design intelligence skill installed 2026-05-04. 67 styles, 96 palettes, 57 font pairings. Auto-loaded on session start.

---

**End of handoff.** A fresh agent reading this should be ready to take any task on this codebase. If anything is wrong or missing, fix it in this file as you go.
