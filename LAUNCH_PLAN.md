# Layla iOS App Store launch plan

**Started:** 2026-05-02 evening · **Mode:** autonomous overnight session

## Wake-up brief (updated as work lands)

_Will be filled with what's done, what's blocked, what needs your decisions — read this first when you wake up._

**STATUS: IN PROGRESS**

---

## Plan structure

The launch breaks into five phases. Engineering phases (A, B) run autonomously; phases C-E mix engineering with user-only steps (Apple Developer account, App Store Connect submission, etc).

### Phase A — Finish botella ↔ Layla integration (refactor)

The mobile app is useless until it talks to a real Layla backend running on botella. Phase A is the structural plumbing.

- [ ] **A1.** DAL migration: `database/db.py` hot functions take internal `user_id` UUID. Resolve at entry point. ~10 functions.
- [ ] **A2.** Extract Layla onboarding `ConversationHandler` (states 0–7) into a botella `Flow`. Sketch already exists at `botella/examples/layla_sketch/` — port the real version into GombiStar referencing the Layla strings, claude calls, and chart_service stubs replaced with real implementations.
- [ ] **A3.** Extract invite flow (states 20–27) into a botella `Flow`. Includes the geocode-disambiguation branch.
- [ ] **A4.** Extract add-friend flow (states 10–17) into a botella `Flow`.
- [ ] **A5.** `botella_manifest.py` in GombiStar root — wires flows + commands + `chat_with_advisor` as `free_chat` + Whisper as `voice_handler`.
- [ ] **A6.** Collapse `bot.py` to ~3 lines using `create_app(manifest)`.
- [ ] **A7.** Webhook switch: Dockerfile EXPOSE 8000 + uvicorn entrypoint + Telegram webhook URL setter (NOT calling Telegram API; just code path ready).
- [ ] **A8.** Telegram adapter parse_mode extension — Layla emits `<b>` / `<i>` HTML; current adapter doesn't pass parse_mode.
- [ ] **A9.** Fix the orphan-row bug in `save_natal_chart` (`ON CONFLICT DO NOTHING` on a column with no unique constraint).
- [ ] **A10.** Verify full GombiStar test suite + the layla_sketch tests + botella tests all green.

### Phase B — App Store gates (auth, push, voice)

iOS App Store has hard requirements. Build the pieces.

- [ ] **B1.** Apple Sign-In on the botella backend: `auth/apple.py` route that verifies Apple identity tokens, creates/links identity in storage, returns a botella JWT. Needs `apple-id-tokens` lib or manual JWK verification.
- [ ] **B2.** Apple Sign-In in mobile-template: `expo-apple-authentication`, replace anonymous auth, fall back to anonymous if user declines.
- [ ] **B3.** Account-linking endpoint: existing telegram users who download the iOS app can link via a code so they continue with their data.
- [ ] **B4.** Push notification scaffold:
  - Server: `POST /v1/push/register` (stores `expo_push_token` keyed on user_id) + `proactive_send(user_id, title, body)` API on manifest.
  - Mobile: `expo-notifications` registration on first launch, request permissions, post the token.
- [ ] **B5.** Voice messages on mobile: `expo-av` records OGG/M4A, multipart `POST /v1/voice` returns transcription text, then runs the chat path. Server reuses Layla's existing `transcribe.py` code.
- [ ] **B6.** Settings screen: language toggle, sign-out, delete-account stub (App Store requires "delete account" on apps with sign-in), open privacy policy URL.
- [ ] **B7.** End-to-end mobile test: full Layla onboarding through chart explore + intake + a couple of chat turns, all on Expo web build via Playwright.

### Phase C — Layla-branded fork of mobile-template

The template is currently labeled "Echo." Fork it into a real Layla app.

- [ ] **C1.** Decide fork strategy: rename `mobile-template/` to `layla-app/` OR keep template + fork. Recommend rename (we'll add other product templates later by copying back).
- [ ] **C2.** `src/config/product.ts` Layla-themed: name "Layla", accent color, greeting from `personality/`, real production API URL.
- [ ] **C3.** `src/config/theme.ts` Layla brand colors. Reference `personality/layla-personality-and-behavior.md` for tone (mentor, warm, dark mode aesthetic).
- [ ] **C4.** App icon: placeholder PNG, 1024×1024 + adaptive variants. Spec for designer to replace.
- [ ] **C5.** Splash screen: solid Layla color + white logo placeholder.
- [ ] **C6.** `app.config.js` (replacing `app.json`) with bundle id `app.layla.ios`, iOS infoPlist privacy descriptions, Apple Sign-In capability.
- [ ] **C7.** `eas.json` build config (development/preview/production profiles).

### Phase D — App Store submission prep (mostly user-only)

Items I can't do without your credentials. I will leave a detailed checklist.

- [ ] **D1.** Apple Developer account ($99/year) — USER
- [ ] **D2.** App Store Connect app record — USER
- [ ] **D3.** Bundle ID + provisioning profile — USER (via EAS Build using Apple Developer credentials)
- [ ] **D4.** Privacy policy URL + support URL — USER (template will be in `legal/privacy.md`)
- [ ] **D5.** App Store screenshots (6.9" + 6.7") — USER (I can drive the web build via Playwright but iOS-specific status bar / chrome can't be faked perfectly)
- [ ] **D6.** Marketing description + keywords — USER (Layla voice is on `personality/`)
- [ ] **D7.** Age rating + content disclosures — USER
- [ ] **D8.** Submit for review — USER

### Phase E — Documentation handoff

- [ ] **E1.** Update `botella/context.md` with everything done.
- [ ] **E2.** Update `GombiStar/context.md` with Phase 1 outcomes.
- [ ] **E3.** Detailed wake-up brief at the top of THIS file.

---

## Live progress log

Each task gets a one-paragraph entry: what shipped, what tests, what's next.

