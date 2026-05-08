# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these first

- `context.md` — long-form, frequently-updated handoff for the current state of the system across **both** repos. Anything in this CLAUDE.md that disagrees with `context.md` is stale; trust `context.md` and update CLAUDE.md.
- `spec.md` — active product spec (the Laila chat-first Map + Moment + Orbit redesign). Source of truth for product behavior and copy. Core value: *"we add value to the user."*

## Two-repo system

This repo is **infrastructure** for a sister product repo. Layla, the live product, lives in `~/Desktop/Coding/GombiStar/` (private, `baraki123/GombiStar`). That repo:

- imports botella at runtime via `pip install git+https://github.com/baraki123/Botella.git@main`,
- defines all the prompts, flows, services, and personality in its own tree,
- auto-deploys to Northflank on push to `main`.

This repo (`baraki123/Botella`, public) holds:

- the `botella/` Python package (transport-neutral chat runtime + adapters + auth + storage protocol),
- `layla-app/` — the production Expo iOS/web client (Layla branding),
- `mobile-template/` — generic fork point, kept in sync with `layla-app/`,
- `examples/echo_bot/` and `examples/layla_sketch/` — exercise the runtime primitives,
- `tests/` — 72 tests for the framework itself.

The pattern is **fork-per-product**, not multi-bot launcher: each new product is its own standalone client app + brain repo. The botella runtime stays generic.

## Architecture (botella package)

```
Bot's Python brain (handlers, services, prompts)
        │
        ▼
  BotManifest             ← single integration point
   - flows[]              ← state machines, e.g. flows/onboarding
   - triggers{}           ← /start, /newchart, …
   - free_chat            ← async generator (yields events)
   - voice_handler        ← optional msg → msg pre-processor
   - link_code_resolver   ← Telegram→iOS migration codes
   - storage              ← Storage Protocol impl
        │
        ▼
  runtime.run()           ← async dispatcher; yields OutboundEvents
        │
   ┌────┴───────────────────┐
   ▼                        ▼
 Telegram adapter     iOS/web adapters
 (PTB webhook)        HTTP /v1/messages
                      WSS /v1/stream  ← keepalive every 8s
```

Storage Protocol (`botella/contract.py`): `load_session`, `save_session`, `resolve_identity`, `link_identity`, `get_user`, `update_user`, `delete_user`, `merge_users`. Identity is `(provider, external_id) → internal_user_id (UUID)`; bots only see `internal_user_id`. Adapters resolve at the edge.

Each `Flow` is a dict of `state_name → async (msg, session, storage) → (events, transition)` where transition is `WaitFor("state")`, `Goto("state")`, `Stay()`, `Start("flow")`, or `Done(carry={...})`.

WS adapter (`botella/adapters/ws.py`) injects a `typing` frame every 8s of runtime silence so proxies don't drop the socket during slow LLM calls.

## Commands

### Python (botella runtime)
```bash
# bootstrap
python3.11 -m venv venv && source venv/bin/activate
pip install -e '.[dev]'

# tests (72 expected)
pytest -q
pytest tests/test_runtime.py -q                  # one file
pytest tests/test_runtime.py::test_flow_done -q  # one test

# live integration smoke (boots uvicorn, drives WS+HTTP for echo_bot)
python scripts/smoke.py
```

### iOS / Web client (`layla-app/`)
```bash
cd layla-app
npm install
npx expo install   # if any expo-* dep was bumped

# run
npx expo start --port 8081 --web    # open http://localhost:8081
npx expo start --tunnel             # iOS Expo Go via HTTPS tunnel
npx tsc --noEmit                    # type-check (no separate test suite)
```

`apiUrl` resolution (`src/config/product.ts`):
1. `EXPO_PUBLIC_API_URL` (manual override) — works in Expo Go.
2. EAS profile `botellaEnv=production` → Northflank URL.
3. iOS / Android dev → Northflank URL (ATS blocks plain HTTP to LAN).
4. Web dev → `${window.location.hostname}:8000`.

### Local dev against the real Layla backend
```bash
# Terminal 1 — backend (uses the GombiStar repo, hits prod Neon)
cd ~/Desktop/Coding/GombiStar && source venv/bin/activate
LAYLA_DISABLE_SCHEDULER=1 uvicorn bot_botella:app --host 127.0.0.1 --port 8000

# Terminal 2 — Expo web
cd ~/Desktop/Coding/botella/layla-app && npx expo start --port 8081 --web
# Open http://localhost:8081 (web dev hits localhost:8000 automatically)
```

### MCP — Playwright
`.mcp.json` registers `playwright-mcp`. Tools are exposed as `mcp__playwright__browser_*` (navigate, click, type, snapshot, evaluate, take_screenshot). Use these to drive the Expo web app and verify flows visually.

If the MCP isn't restarted yet, `scripts/monitor.py` is the same capability via Python.

### Dev orchestration
```bash
./scripts/demo.sh   # boots backend + Expo web + prints URLs
```

## Tests

- **Framework tests** (this repo, `tests/`): in-memory storage, fake adapters. Fast (<10s for 72 tests). Run on every change.
- **Layla brain tests** (sister repo, `~/Desktop/Coding/GombiStar/tests/`): `pytest -q` from there. ~166 tests; covers flows + helpers.
- **Live smoke** (`scripts/smoke.py`): real uvicorn + real WS, walks echo_bot end-to-end. Use to verify framework changes haven't broken the wire shape.
- **End-to-end visual** (Playwright MCP): drive the Expo web build through onboarding, verify section pagination + chip rendering, screenshot for visual review. Plan ~75-90s for runs that hit the real LLM (the first map read is a ~60s reasoning-tier call).

## When you ship code

Backend changes auto-deploy via Northflank on push to GombiStar's `main`. The deployed container's `.git` is stripped, so build provenance comes from env vars stamped via the Northflank API after push completes — see `context.md` §6 for the exact runbook (`SHA = git rev-parse --short=8 HEAD`, GET runtime-env, merge `LAYLA_BUILD_VERSION/_NOTE/_TIME`, POST it back). The iOS Settings → Admin · Build banner reads these.

iOS app: changes here ship via Expo Go (reload) for dev, EAS Update (JS-only OTA) or a fresh TestFlight build for users.

## Conventions and gotchas (worth knowing before changing things)

- **Layla messages render WITHOUT a bubble** (just text on the canvas with a tiny gold dot). User messages get a charcoal-rose pill. Keep this asymmetry — it's the brand.
- **Bubble.tsx `stripHtml`** converts `<b>`/`<i>` → markdown so server copy works on Telegram (HTML-rendered) and iOS (markdown-rendered) without branching.
- **No auto-scroll on completed bot bubbles.** New content lands below the viewport; the "↓ Latest" pill nudges. Streaming tokens and user-msg echoes only sticky-bottom while the user is actually at the bottom (`isAtBottomRef`). See `ChatScreen.tsx:handleContentSizeChange` — don't reintroduce yanking.
- **WS auto-resume** at the top of `botella/adapters/ws.py` re-runs `start_trigger` on every fresh connection. Server-side state-restoring flows (onboarding section pagination, etc.) re-emit the current state. Triggers/flows that should NOT re-fire on reconnect must opt out via the throttle pattern in `start_trigger`.
- **iOS `expo-file-system` 19+ legacy methods are stubs that throw.** Use the `/legacy` submodule's `writeAsStringAsync` instead. The new `File.write(Uint8Array)` overload crashes Hermes for larger payloads.
- **Hermes runtime needs `react-native-get-random-values`** imported at the top of `index.ts` — the polyfill for `crypto.getRandomValues` used by JWT decode etc.
- **Apple Sign-In `aud` claim** differs by build context: Expo Go = `host.exp.Exponent`, built apps = `app.layla.ios`. `APPLE_SIGN_IN_AUDIENCE` is comma-separated to validate both.
- **`websockets` is not a uvicorn base-install dep.** Declared in `pyproject.toml`. If WS upgrades 404 in a fresh venv, `pip install websockets`.
- **Anonymous-iOS users have NO `layla_users` row** (that table is Telegram-keyed). Their state lives in `layla_user_records.data` JSONB. `save_chat_message(tid, ...)` is FK'd to `layla_users` — gate on `if tid is not None` before calling DAL writes.
- **iOS app's `apiUrl` defaults to PROD** on native dev because iOS App Transport Security blocks plain HTTP. Use `EXPO_PUBLIC_API_URL` or `expo start --tunnel` to point native at a LAN backend.

## Working preferences (carried from project memory)

- **End every reply with a `## Summary` block** — what you did / decisions needed / what the user needs to do.
- **Deploy, don't delegate.** When a task completes, commit + push yourself; don't end with a "git pull / restart" todo for the user. Backend pushes auto-deploy via Northflank; stamp build env after build success.
- **Native iOS APIs** (Photos, Sharing, Notifications, mic, Apple Sign-In native paths) can't be verified from the dev box. Surface that explicitly when shipping; don't claim "done" without a device tap.
- **Cross-project paste alert.** This terminal is for Layla / botella. If a message is clearly about another project (event-e-fire, passion website, etc.), pause and flag — they probably picked the wrong terminal tab.
- **"Run the MCP" / drive end-to-end** means the iOS/web path (FastAPI + WS), not Telegram, unless the user explicitly says Telegram.
- **Scaffold, not launcher.** "Deploy my bots into an app" means fork the template per product, not host many bots in one app.
