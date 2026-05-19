# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read these first

- `context.md` — long-form, frequently-updated handoff for the current state of the system across **both** repos. Anything in this CLAUDE.md that disagrees with `context.md` is stale; trust `context.md` and update CLAUDE.md.
- `spec.md` — active product spec (the Laila chat-first Map + Moment + Orbit redesign). Source of truth for product behavior and copy. Core value: *"we add value to the user."*
- `UI_UX_GUIDE.md` — typography + color + motion + accessibility rules. Read before sizing chip labels, picking a font for a new surface, or styling markdown in `Bubble.tsx`. Distinguishes **UI controls** (Inter/system, 14-15px base, 12px floor) from **brand voice** (serif — Cochin/Fraunces).

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

### MCP — XcodeBuildMCP (iOS simulator)
Drives the iOS Simulator end-to-end: build/run, boot, tap, type, swipe, screenshot, runtime log capture, and (the magic) `describe_ui` — a structured accessibility tree of the iOS app with element text + coords. This is what lets a fresh agent verify chat behavior in the native simulator without you tapping.

Already registered in `~/.claude.json` for this project, with the `ui-automation` workflow group enabled (default registration enables only `simulator`, which is missing `tap`/`type`/`swipe`/`key_sequence`):
```bash
claude mcp add XcodeBuildMCP \
  -e XCODEBUILDMCP_ENABLED_WORKFLOWS=simulator,ui-automation \
  -- npx -y xcodebuildmcp@latest mcp
# verify:
claude mcp list   # XcodeBuildMCP should show ✓ Connected
```
After registering you must restart the Claude Code session for the new tools to surface in the deferred-tool set. Other workflow groups exist (`debugging`, `xcode-ide`) — add them to the env-var list if needed.

Driving pattern for chat verification:
1. `simulator-management:boot` an iPhone 16 Plus (the canonical sim for Layla).
2. `simulator:install` + `simulator:launch` Expo Go, deep-link via `simctl openurl exp://127.0.0.1:8081`, or use Layla's TestFlight/EAS build.
3. `ui-automation:describe_ui` to find the "Tell Layla…" input by accessibility-label, `tap` at its coords.
4. `ui-automation:type` the onboarding answer; tap Send (or rely on the auto-submit on Enter).
5. After each Layla reply, `describe_ui` again to read the bubble text — **prefer this over screenshot** (saves ~2–6k image tokens; a structured tree gives you message text + sender + chip labels). Only screenshot when pixels matter (smart-snap Case B visual check, dark-mode rendering, bubble alignment).
6. For runtime errors, runtime logs are captured automatically on `build_run_sim`.

To make the agent's life easier when adding new chat UI: set `accessibilityLabel` (and ideally `testID`) on the Composer `TextInput`, Send/Mic buttons, Bubble container, doorway chips, and any other element the agent would need to target. Without these the agent ends up guessing at coordinates.

**Why XcodeBuildMCP and not AppleScript**: iOS apps inside the simulator render via Metal, so the macOS Accessibility tree shows the Simulator process with 0 windows / 0 UI elements. AppleScript can only send raw keystrokes when something is already focused. XcodeBuildMCP talks to CoreSimulator's private API directly, bypassing macOS AX, so it can both *see* iOS-level UI and tap at iOS device coords.

### Dev orchestration
```bash
./scripts/demo.sh   # boots backend + Expo web + prints URLs
```

## Tests

- **Framework tests** (this repo, `tests/`): in-memory storage, fake adapters. Fast (<10s for 72 tests). Run on every change.
- **Layla brain tests** (sister repo, `~/Desktop/Coding/GombiStar/tests/`): `pytest -q` from there. ~268 tests; covers flows + helpers + chart-pattern detection + intent regexes.
- **Live smoke** (`scripts/smoke.py`): real uvicorn + real WS, walks echo_bot end-to-end. Use to verify framework changes haven't broken the wire shape.
- **End-to-end visual** (Playwright MCP): drive the Expo web build through onboarding, verify section pagination + chip rendering, screenshot for visual review. Plan ~75-90s for runs that hit the real LLM (the first map read is a ~60s reasoning-tier call). Save screenshots under `botella/screenshots/`.
- **User-POV rubric** (`~/Desktop/Coding/GombiStar/mcp/user_pov_test_plan.md`): the felt-quality contract. 10 scenarios scored across Attention / Helpfulness / Voice / Continuity. Pytest catches code bugs; this catches LLM-behavior gaps that code can't see.

### Ship gate for prompt / directive changes

Any change to `personality/layla_system_prompt.md`, the per-call directives in `services/laila_chat.py` / `services/claude_service.py`, or the dispatch order in `botella_manifest.py:free_chat` must be verified against the user-POV rubric before shipping:

- Re-run any rubric scenario the change *intends* to fix — must move from FAIL to PASS.
- Spot-check at least 1–2 unrelated PASSING scenarios to confirm no regression. Tuning the prompt for one mode often shifts behavior in another.
- A scenario that drops from 5/5 on any axis to ≤3/5 is a ship-blocker; investigate before pushing.
- LLM output is non-deterministic — rerun any borderline scenario at least twice before treating one run as a verdict.

Append the verdict (which scenarios passed/failed/regressed) to the commit message so the rubric history travels with the code. Save the relevant screenshots under `botella/screenshots/userpov-{NN}-{slug}.png` so the moment is reviewable later.

## When you ship code

Backend changes auto-deploy via Northflank on push to GombiStar's `main`. Build provenance is stamped automatically by `.github/workflows/stamp-build.yml` (in the GombiStar repo) — that workflow polls until the new image is deployed, then merges `LAYLA_BUILD_VERSION/_NOTE/_TIME` into Northflank's runtime-environment via the API. No manual ritual. See `context.md` §6 for the (one-time) `gh secret set NORTHFLANK_TOKEN` setup that bootstraps the workflow.

iOS app: changes here ship via Expo Go (reload) for dev, EAS Update (JS-only OTA) or a fresh TestFlight build for users.

## Conventions and gotchas (worth knowing before changing things)

- **Layla messages render WITHOUT a bubble** (just text on the canvas with a tiny gold dot). User messages get a charcoal-rose pill. Keep this asymmetry — it's the brand.
- **Bubble.tsx `stripHtml`** converts `<b>`/`<i>` → markdown so server copy works on Telegram (HTML-rendered) and iOS (markdown-rendered) without branching.
- **Chat scroll AND keyboard behavior is owned by `mobile-template/src/chat/useChatScroll.ts`** (canonical) and copied verbatim into `layla-app/src/chat/useChatScroll.ts`. The hook's top-of-file contract block is the single source of truth. Key rules: smart-snap on new content — Case A (latest bubble fits viewport) → `scrollToEnd`; Case B (latest bubble overflows) → scroll so its top edge sits one line below the chrome (`lastBubbleTop - ONE_LINE_PX`) so the user sees the START of the new block plus one line of prior context as a visual anchor. Bulk arrivals (session restore, history load) bypass smart-snap and use plain `scrollToEnd`. Never yank away from active reading (gated on `isAtBottomRef` + `userOverrideRef`). "↓ Latest" pill only on user-driven scroll-up of >1 viewport. Re-run smart-snap on FlatList shrink (keyboard rise / sticky chip row) and on `Keyboard.didShow / didHide`. The required `KeyboardAvoidingView` props (behavior + `KEYBOARD_VERTICAL_OFFSET_IOS`) are exported from the hook so screens import them — never re-decide. **Do not add ad-hoc `scrollToEnd` / `scrollToIndex` / `Keyboard.addListener` calls in product ChatScreens, Bubble, or Composer.** Edit the hook + sync both copies.
- **WS auto-resume** at the top of `botella/adapters/ws.py` re-runs `start_trigger` on every fresh connection. Server-side state-restoring flows (onboarding section pagination, etc.) re-emit the current state. Triggers/flows that should NOT re-fire on reconnect must opt out via the throttle pattern in `start_trigger`.
- **iOS `expo-file-system` 19+ legacy methods are stubs that throw.** Use the `/legacy` submodule's `writeAsStringAsync` instead. The new `File.write(Uint8Array)` overload crashes Hermes for larger payloads.
- **Hermes runtime needs `react-native-get-random-values`** imported at the top of `index.ts` — the polyfill for `crypto.getRandomValues` used by JWT decode etc.
- **Apple Sign-In `aud` claim** differs by build context: Expo Go = `host.exp.Exponent`, built apps = `app.layla.ios`. `APPLE_SIGN_IN_AUDIENCE` is comma-separated to validate both.
- **`websockets` is not a uvicorn base-install dep.** Declared in `pyproject.toml`. If WS upgrades 404 in a fresh venv, `pip install websockets`.
- **Anonymous-iOS users have NO `layla_users` row** (that table is Telegram-keyed). Their state lives in `layla_user_records.data` JSONB. `save_chat_message(tid, ...)` is FK'd to `layla_users` — gate on `if tid is not None` before calling DAL writes.
- **iOS app's `apiUrl` defaults to PROD** on native dev because iOS App Transport Security blocks plain HTTP. Use `EXPO_PUBLIC_API_URL` or `expo start --tunnel` to point native at a LAN backend.

## Working preferences (carried from project memory)

- **End every reply with a `## Summary` block** — what you did / decisions needed / what the user needs to do.
- **Deploy, don't delegate.** When a task completes, commit + push yourself; don't end with a "git pull / restart" todo for the user. Backend pushes auto-deploy via Northflank, and the stamp-build GH Actions workflow updates the build banner after deploy — no human ritual.
- **Native iOS APIs** (Photos, Sharing, Notifications, mic, Apple Sign-In native paths) can't be verified from the dev box. Surface that explicitly when shipping; don't claim "done" without a device tap.
- **Cross-project paste alert.** This terminal is for Layla / botella. If a message is clearly about another project (event-e-fire, passion website, etc.), pause and flag — they probably picked the wrong terminal tab.
- **"Run the MCP" / drive end-to-end** means the iOS/web path (FastAPI + WS), not Telegram, unless the user explicitly says Telegram.
- **Scaffold, not launcher.** "Deploy my bots into an app" means fork the template per product, not host many bots in one app.
- **Prefer `describe_ui` over `screenshot` for iOS chat verification.** A screenshot costs ~2–6k image tokens; an accessibility-tree dump is a few hundred and gives you the exact bubble text, sender labels, and element coords. Reserve screenshots for moments where *pixels* matter — smart-snap Case B layout, bubble alignment, dark-mode rendering. Same applies to Playwright on web (`browser_snapshot` > `browser_take_screenshot`).
- **Spell-check on, autocorrect off** in the chat composer's `TextInput`. The iOS QuickType suggestion bar (which `autoCorrect` enables) steals ~50px and is off-brand for the advisor voice. The red squiggle (`spellCheck`) is fine and helpful for names/places.
