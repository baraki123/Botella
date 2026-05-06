# botella — handoff

> A fresh Claude session can read this top-to-bottom and pick up the work
> cold. Last updated 2026-05-06. If anything disagrees with the running
> system, trust the system and update this file.

---

## 0. Where we are right now

**Layla is fully live, served from Northflank, independent of the dev
laptop.** Telegram (`@laylastarbot`) and the iOS/web app both speak to
the same FastAPI service on `bot_botella.py`. The legacy PTB-polling
path (`bot.py`) is dead code kept for reference; production runs on
the botella runtime.

**Production endpoint:** `https://http--laylabot--28ttnydqvqwp.code.run`
- `GET /health` → `{"ok": true, "bot": "layla"}`
- `GET /v1/me` → `{user_id, is_admin, build:{sha, note, commit_time, boot_time}}` (JWT)
- `POST /v1/auth/anonymous` / `POST /v1/auth/apple` / `DELETE /v1/account`
- `POST /v1/account/link/redeem` (Telegram→iOS migration)
- `POST /v1/messages` (HTTP request-collection)
- `WSS /v1/stream` (token streaming chat, with 8s typing keep-alive injected)
- `POST /v1/voice` (multipart audio → transcript)
- `POST /v1/push/register` (Expo push token)
- `POST /webhooks/telegram` (validates `X-Telegram-Bot-Api-Secret-Token`)

**LLM provider:** OpenAI (env `LAYLA_LLM_PROVIDER=openai`). Two tiers:
chat / extractions ride **`gpt-4.1`**, marquee outputs (chart cards,
daily readings, transit alerts, teaser, lessons, compatibility) ride
**`gpt-5.4`**. Anthropic + Gemini paths exist behind the same env knob
(see §6).

**Build provenance:** `/v1/me` returns the deployed git SHA + commit
subject + timestamp, sourced from `LAYLA_BUILD_VERSION/_NOTE/_TIME`
env vars stamped on Northflank after every push. iOS shows admin a
one-shot "✦ Layla {sha} · {time} is live" banner on session open.

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
│       │   ├── ChatScreen.tsx        sticky-bottom scroll + jump-pill;
│       │   │                         pings /v1/me on session, fires
│       │   │                         AdminBuildBanner one-shot
│       │   ├── Bubble.tsx            Layla msg = no bubble, gold dot,
│       │   │                         fade-up animation; user pill w/ shadow.
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
│       │   │                         (telegram=inline btn url=, iOS=Linking)
│       │   ├── TypingIndicator.tsx   3 breathing gold dots
│       │   ├── atmosphere/
│       │   │   ├── Starfield.tsx     scattered SVG sparkles, twinkle loop
│       │   │   └── Glow.tsx          stacked LinearGradients, fake radial
│       │   └── types.ts              QuickReplyOption = string|{url}|{value}
│       ├── push/registerPush.ts      registers Expo token on session change.
│       │                             expo-notifications + expo-device deps
│       │                             installed; works in dev-client / TF.
│       ├── settings/SettingsScreen.tsx  has "Link Telegram account" row
│       └── voice/recorder.ts         expo-audio + MediaRecorder web fallback;
│                                     setAudioModeAsync(allowsRecording=true)
│                                     before record(); native upload uses
│                                     {uri,type,name} multipart shape (web
│                                     uses the Blob path); transcribe()
│                                     posts /v1/voice
│
├── mobile-template/                  Generic fork-point (kept in sync)
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
│                                       free_chat (regex layers + Claude
│                                         streaming via llm.complete_stream)
│                                       voice_handler (Whisper)
│                                       link_code_resolver (mint/redeem
│                                         codes against layla_link_codes)
│
├── flows/
│   ├── onboarding.py                 lang → name → gender → date → time
│                                       → place → save_chart (emits
│                                       "Reading the stars…") → build_chart
│                                       (heavy work + chart wheel image
│                                       + headline + Claude teaser) →
│                                       read_sun → read_moon → read_ascendant
│                                       → read_mercury → read_venus →
│                                       read_mars (each emits typing then a
│                                       Claude placement card) → closing
│                                       + chips (Jupiter/Saturn/outer/love/
│                                       this week) + Done(carry={...})
│   ├── settings.py                   menu/lang/gender/city. Replaces the
│   │                                 dead handlers/settings.py path.
│   ├── invite.py                     legacy invite flow (Telegram-anchored)
│   ├── intake.py                     get-to-know-me Q&A
│   ├── checkin.py                    smart returning-user opener
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
│   ├── claude_service.py             ALL Layla-side LLM functions —
│   │                                 generate_chart_teaser,
│   │                                 generate_placement_card (one of
│   │                                 these per beat in the auto-reading),
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
├── tests/                            128 passing
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

### Build-info stamping (do this after every GombiStar push)

```bash
cd ~/Desktop/Coding/GombiStar
SHA=$(git rev-parse --short=8 HEAD)
NOTE=$(git log -1 --pretty=%s)
TIME=$(git log -1 --pretty=%cI)
NF=$(grep NORTHFLANK_TOKEN .env | cut -d= -f2)
curl -s -H "Authorization: Bearer $NF" \
  https://api.northflank.com/v1/projects/gombibot/services/laylabot/runtime-environment \
  > /tmp/env.json
SHA="$SHA" NOTE="$NOTE" TIME="$TIME" python3 -c "
import json, os
with open('/tmp/env.json') as f: d=json.load(f)
env=d['data']['runtimeEnvironment']
env['LAYLA_BUILD_VERSION']=os.environ['SHA']
env['LAYLA_BUILD_NOTE']=os.environ['NOTE']
env['LAYLA_BUILD_TIME']=os.environ['TIME']
json.dump({'runtimeEnvironment': env}, open('/tmp/env_new.json','w'))"
curl -s -X POST -H "Authorization: Bearer $NF" -H 'Content-Type: application/json' \
  -d @/tmp/env_new.json \
  https://api.northflank.com/v1/projects/gombibot/services/laylabot/runtime-environment
```

This must run AFTER the build SUCCEEDs (otherwise the running container
restarts on stale code). Wait for `BUILD: SUCCESS | DEPLOYMENT: COMPLETED`
before stamping.

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
| 1 | **Personality + reading-quality rewrite** (asked 2026-05-06, NOT STARTED) | ~3-4h | Direction from user: readings should always identify aspects + patterns (T-squares, stelliums, conjunctions, oppositions) — not just placements. Always have a thesis (unifying tension or developmental arc). Name shadow material with care but without flinching; pair every challenge with mature expression / healing path. Include nodes + Chiron + retrogrades. Tone: direct, literary, slightly intense — not corporate, not bubbly. Voice register example: "you are not here to skim the surface of life" / "the immature version argues with reality... the mature version is a spiritual warrior-intellectual". Touches `personality.py` + the prompt fields in `services/claude_service.py` (`generate_chart_teaser`, `generate_placement_card`, `interpret_natal_chart`, the chat persona). Also `services/chart_service.py:build_natal_chart` needs to capture nodes + Chiron (kerykeion has `mean_node`, `true_node`, `chiron`) so the prompts can reference them. The auto-reading chain in `flows/onboarding.py` (read_sun → read_mars) probably needs to add a thesis-opener state and at least one aspects-pattern beat. |
| 2 | **Admin needs to /link or be allowlisted** | trivial | The admin (Barak, TG id 521866882) needs to either send `/link` from Telegram and redeem in iOS, OR send their iOS user_id (visible in `/v1/me` response) so it goes into `LAYLA_ADMIN_USER_IDS`. Until then, the build banner won't fire for them. |
| 3 | **App Store Connect / EAS Build / TestFlight** | user-only | Blocked on $99 Apple Dev account enrollment. bundle id `app.layla.ios`, eas.json profiles ready. |
| 4 | **Real designer pass on app icon** | TBD | The 2026-05-04 stopgap (italic gold L + sparkle) is fine for TestFlight; replace before public submission. |
| 5 | **Anonymous-iOS users get morning push too** | ~half day | `services/daily_runner.py` only iterates `layla_users` (Telegram-keyed). Pure-anonymous users with chart in `layla_user_records.data.natal_chart` get nothing until they /link or sign in with Apple. |
| 6 | **Move Northflank to a us-east cluster** | ~30 min | Drops Neon round-trip from ~30ms to <5ms. Service-recreate (no in-place region change). Do at the next staging-needed moment. |
| 7 | **Skia / interactive chart (v2)** | ~2 days | `@shopify/react-native-skia` would let us pinch-zoom the wheel, animate planet highlights as Layla reads each placement, tap a planet to dive in. NOT v1 — current PNG works. Bookmark for after launch. |
| 8 | **Telegram → iOS link via `/link`** | DONE | Ship'd 2026-05-04. Kept here for traceability. |
| 9 | **Push notifications (server-side wiring)** | DONE | Ship'd 2026-05-04. |
| 10 | **save_natal_chart UNIQUE(user_id)** | DONE | Migration applied 2026-05-04. |
| 11 | **Settings flow port + awaiting_settings_city removal** | DONE | Ship'd 2026-05-04. |
| 12 | **Round natal-wheel chart + birth info + balance** | DONE | Ship'd 2026-05-06. |
| 13 | **LLM provider abstraction + tier system** | DONE | Ship'd 2026-05-06. Currently on OpenAI (gpt-4.1 / gpt-5.4). |
| 14 | **/v1/me + admin build banner** | DONE | Ship'd 2026-05-06. Build env stamping is manual after push (see §6). |

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

**End of handoff.** A fresh agent reading this should be ready to take
any task on this codebase. Top of the open-work list right now is the
**personality + reading-quality rewrite** — review §9 item 1 carefully,
read the user's exact direction (it's there verbatim in the issue
description), then dig in.
