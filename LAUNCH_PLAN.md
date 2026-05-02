# Layla iOS App Store launch plan

**Started:** 2026-05-02 evening · **Mode:** autonomous overnight session
**Last updated:** 2026-05-02 ~early AM, end of session

---

## ☕ Wake-up brief — read this first

### Big picture
You went to bed pointing me at the App Store. By morning the foundation is in place: the botella runtime, the Layla refactor, an Apple-Sign-In path, an Apple-compliant settings + delete-account flow, push-notification plumbing, and a Layla-branded Expo app fork. **Nothing was pushed to main. Northflank wasn't touched. No Neon migrations were run.** Everything is on local branches and committed.

### What's in your repos right now

**`~/Desktop/Coding/botella/` — now a git repo (initialized tonight, branch `main`, never pushed):**
- `botella/` — the runtime (FastAPI app, contract, runtime, telegram + http + ws adapters, JWT auth, Apple Sign-In verifier, account delete, push notifications)
- `mobile-template/` — generic Expo + RN chat shell (renamed `Echo`), Apple Sign-In capable, includes the polyfill that fixed your iPhone last night
- **`layla-app/` — the actual Layla iOS app fork.** Layla branded, dusk-purple accent, app.json with bundle id `app.layla.ios`, eas.json with development/preview/production profiles, Settings screen with Apple-required Delete Account flow.
- 64 botella tests, all green.

**`~/Desktop/Coding/GombiStar/` — branch `mobile-shim` (4 commits ahead of main, not pushed):**
- New `database/schema.sql` tables: `layla_user_identities` + `layla_sessions`. There's a commented-out `INSERT INTO layla_user_identities ... SELECT FROM layla_users` for backfilling existing users — **DO NOT run yet**, that's a one-time op for when you cut over.
- New `database/storage.py` — Postgres-backed `Storage` impl reusing your `get_conn()` Neon resilience fix.
- New `flows/onboarding.py` — Layla onboarding states 0–7 (lang/name/gender/date/time/place + disambiguation + save_chart) ported as a botella `Flow`. Uses real Layla `chart_service`, `locales`, and the legacy DAL via UUID→BIGINT translation.
- New `botella_manifest.py` + `bot_botella.py` — **parallel** entry point. Doesn't replace `bot.py`. Production keeps polling on the existing `bot.py`. When you're ready: rename `bot.py` → `bot_legacy.py`, `bot_botella.py` → `bot.py`, set the Telegram webhook URL, redeploy.
- New `services/transcribe.py` — Whisper extracted out of `handlers/voice.py` so the manifest's `voice_handler` can call it.
- 96/96 GombiStar tests green (87 prior + 9 new onboarding flow tests).

### What you can do right now
1. **Open `~/Desktop/Coding/botella/layla-app/` and run `bash scripts/demo.sh`** (after pointing it at layla-app, or just `cd layla-app && npx expo start --port 8082`) — you'll see Layla branded and connecting to whatever backend is on `:8000`.
2. **Visit `http://localhost:8082` in any browser** to see the SignInScreen → "Continue without an account" → Layla chat → ⋯ Settings → Sign out / Delete account flow.
3. **Tap "Delete account"** in Settings and watch the local AsyncStorage clear + the server (if running) call `DELETE /v1/account`.

### What you have to do (I can't, you're the human)
The plumbing is done; the credential / account / asset work needs you:

- **Apple Developer account** ($99/year) — enroll if you haven't.
- **App Store Connect**: create a record for "Layla", bundle id `app.layla.ios`, primary category Lifestyle (or Health & Fitness if you want to push the wellness angle).
- **EAS Build** — `npm i -g eas-cli`, `cd layla-app && eas init` (this fills in `app.json` `expo.extra.eas.projectId`), then `eas build --platform ios --profile development` to generate a development build, or `--profile production` when ready.
- **Replace `eas.json` placeholders** (REPLACE_WITH_APPLE_ID_EMAIL, ascAppId, appleTeamId).
- **Privacy policy + Terms URLs** — Settings.tsx has placeholders pointing at `https://layla.app/privacy` and `https://layla.app/terms`. Host these (Notion + a domain forward works for v1) and update `SettingsScreen.tsx`.
- **App icon** — `layla-app/assets/icon.png` is still the Echo template's icon. Designer task: 1024×1024 + adaptive variants.
- **`APPLE_SIGN_IN_AUDIENCE` env var** on the production backend — set it to `app.layla.ios` (the bundle id). Without this, `/v1/auth/apple` refuses to verify tokens.
- **Production API URL** — `layla-app/src/config/product.ts` switches to `https://api.layla.app` when EAS builds with profile `production`. You need to actually serve from that URL (Northflank custom domain).

### What I deliberately did NOT do
- **Did not push to GombiStar's main** — Northflank auto-deploys; I'm not risking production overnight.
- **Did not run the schema migration on Neon** — the SQL is in `database/schema.sql`. Apply it via psql when you're ready.
- **Did not modify Northflank env vars** — there's a known `POST replaces all` footgun documented in your context.md.
- **Did not collapse `bot.py` in GombiStar** — created `bot_botella.py` parallel instead. Cutover is your call.
- **Did not extract the full PTB chat handler** — `handlers/chat.py`'s regex-based name recognition / invite-intent / update-notes detection still lives in PTB. The manifest's `free_chat` wraps `chat_with_advisor` directly. Those features will lose detection if you cut over today; port them as follow-ups.
- **Did not extract invite, add-friend, settings, intake, smart-checkin flows** — these are 2,000+ LOC of handler code. Onboarding (the entry point) is ported as the proof of pattern; the others follow the same shape and can be ported one at a time.
- **Did not touch `mcp/test_*` files** — those are voice-agent's untracked work-in-progress.
- **Did not implement voice-record-and-upload on mobile** — server-side `voice_handler` accepts `voice_audio` bytes; mobile-side `expo-av` recording UI + multipart upload is a half-day chunk I deferred.
- **Did not fix the `save_natal_chart` orphan-row bug** — known data hygiene issue, not blocking.

### Three things I want your judgment on before continuing
1. **Cutover timing.** When are you comfortable having Layla's production traffic flow through botella instead of PTB-polling? Low-risk path: deploy webhook+manifest in parallel on a staging Northflank service first (`laylabot-staging`), point a TestFlight build at it, ship to App Store from there. Bigger-risk-but-faster path: cut over `laylabot` directly off-hours.
2. **Voice agent's conflict-zone files.** `handlers/onboarding.py` still exists and the voice agent might tweak prompt strings inside it. If they edit it during the next phase of flow extraction, we'll have a merge to do. Worth a quick Slack/note to them.
3. **Design assets.** Layla's brand is currently a placeholder dusk-purple. The whole `layla-app/assets/` folder is template defaults. You can ship to TestFlight with these but the App Store screenshots will look amateur.

### If something is broken
- `cd ~/Desktop/Coding/botella && source venv/bin/activate && python -m pytest -q` — should be 64/64.
- `cd ~/Desktop/Coding/GombiStar && source venv/bin/activate && python -m pytest -q` — should be 96/96.
- `cd ~/Desktop/Coding/botella/layla-app && npx tsc --noEmit` — should be clean.
- The local Expo + uvicorn from earlier may still be running on `:8081`/`:8082`/`:8000`. Kill with `lsof -nP -iTCP:8081 -sTCP:LISTEN | awk 'NR>1 {print $2}' | xargs kill`.
- Last commits: `mobile-shim` branch in GombiStar at `be0e4ae`; `botella` main at the latest commit (run `git log --oneline -5` to see).

---

## Plan structure

The launch breaks into five phases. Engineering phases (A, B) are done; phases C-E mix engineering with user-only steps.

### Phase A — Finish botella ↔ Layla integration ✅ DONE

- [x] **A1.** DAL migration → established convention; flow code calls `storage.telegram_id_for(session.user_id)` and uses existing db.py with the resolved BIGINT. No db.py rewrite.
- [x] **A2.** Onboarding `Flow` extracted → `flows/onboarding.py`, 9 tests green.
- [x] **A3.** Invite Flow extraction → SCAFFOLD ONLY. Skipped full port; `handlers/invite.py` keeps running for now.
- [x] **A4.** Add-friend Flow extraction → SCAFFOLD ONLY. Same.
- [x] **A5.** `botella_manifest.py` → wires onboarding, free_chat (chat_with_advisor), voice_handler (Whisper).
- [x] **A6.** `bot_botella.py` parallel entry → does NOT replace bot.py.
- [x] **A7.** Webhook switch already in botella (`setup_telegram_webhook`); Dockerfile change deferred to your cutover.
- [x] **A8.** Telegram adapter HTML parse_mode → already in botella.
- [x] **A9.** save_natal_chart orphan-row fix → DEFERRED. Known data hygiene; not blocking.
- [x] **A10.** Full test suite green → 64 botella + 96 GombiStar = 160 tests.

### Phase B — App Store gates ✅ DONE

- [x] **B1.** Apple Sign-In server → `botella/auth/apple.py` + `POST /v1/auth/apple`. 12 tests including signature/issuer/audience/expiry/nonce verification.
- [x] **B2.** Apple Sign-In mobile → `mobile-template/src/auth/apple.ts` + `SignInScreen.tsx` + App.tsx routing. Verified in browser.
- [x] **B3.** Account-linking endpoint → PARTIAL: `link_anonymous_user_id` field passed through `/v1/auth/apple`. Full bidirectional code-based linking (Telegram users → iOS) deferred — needs a UX decision on the linking path.
- [x] **B4.** Push notification scaffold → `botella/push.py` (`POST /v1/push/register` + `proactive_send()` helper) with 7 tests.
- [x] **B5.** Voice messages on mobile → DEFERRED. Server-side `voice_handler` ready; mobile recorder UI is a half-day chunk.
- [x] **B6.** Settings screen → `layla-app/src/settings/SettingsScreen.tsx` with sign-out + delete-account (Apple-required) + privacy/terms links. 4 server tests for `DELETE /v1/account`.
- [x] **B7.** End-to-end Playwright run → verified mid-night: SignInScreen → Continue without an account → ChatScreen → /start → Layla onboarding's "Hi! Pick your language." with English / עברית chips. Screenshots in `.playwright-mcp/` and project root (gitignored).

### Phase C — Layla-branded fork ✅ DONE

- [x] **C1-C7.** `layla-app/` forked from `mobile-template/`. Layla name + greeting + dusk-purple accent + app.json (bundle id, splash, infoPlist, plugins) + eas.json (development/preview/production). Symlinked node_modules to mobile-template's so the install was free.

### Phase D — App Store submission prep (USER ACTIONS)

- [ ] **D1.** Apple Developer account — USER
- [ ] **D2.** App Store Connect app record — USER
- [ ] **D3.** Bundle ID + provisioning profile via EAS — USER
- [ ] **D4.** Privacy policy URL + support URL — USER (template TODO note in `SettingsScreen.tsx`)
- [ ] **D5.** App Store screenshots (6.9" + 6.7") — USER
- [ ] **D6.** Marketing description + keywords — USER (Layla voice in `personality/`)
- [ ] **D7.** Age rating + content disclosures — USER
- [ ] **D8.** Submit for review — USER

### Phase E — Documentation handoff ✅ DONE

- [x] **E1.** `botella/context.md` — updated with phase 1 outcomes.
- [x] **E2.** `GombiStar/context.md` — updated with mobile-shim branch state.
- [x] **E3.** This wake-up brief.

---

## Live progress log

**B6 — Settings screen.** Pressable ⋯ in chat header opens Settings. Account block lists provider (Anonymous / Apple), Sign out, Delete account (red, confirm modal). About block: Privacy + Terms (placeholder URLs). Server: `DELETE /v1/account` wipes sessions, identities, and (for Telegram-linked users) the legacy `layla_*` table chain in dependency order. 4 tests. Verified in browser via Playwright MCP.

**B4 — Push notifications.** `botella/push.py`. Mobile registers via `POST /v1/push/register` after the user grants permission; `proactive_send(manifest, user_id, title=, body=, data=)` is the server-side fire-and-forget for Layla's morning-reading scheduler. 7 tests including HTTP-error and Expo-error paths.

**B2 — Apple Sign-In mobile.** `signInWithApple()` in `apple.ts` opens the Apple sheet via `expo-apple-authentication`, hashes the nonce with `expo-crypto`, posts to `/v1/auth/apple`, caches the JWT. `SignInScreen` renders the Apple button on iOS and "Continue without an account" everywhere. App.tsx routes signin → chat → settings. Verified in browser via Playwright MCP (Apple button correctly hidden on web).

**B1 — Apple Sign-In server.** `botella/auth/apple.py` + the `/v1/auth/apple` POST route. Real RS256 signature verification via `pyjwt[crypto]` + `PyJWKClient` against Apple's published keys. 12 tests including bad-signature, wrong-audience, wrong-issuer, expired, nonce mismatch, missing-sub, and end-to-end through the FastAPI route with an in-memory keypair.

**Layla mobile fork (C1-C7).** `cp -r mobile-template layla-app`, removed embedded .git, symlinked node_modules to save the install. Updated app.json with `app.layla.ios`, splash, infoPlist privacy descriptions, `usesAppleSignIn: true`, the `expo-apple-authentication` plugin. Added `eas.json` with three profiles. Themed product.ts (Layla name, Layla-voice greeting, dusk purple, prod URL switch). theme.ts subtle tweaks (warmer bot bubble background). TS clean. Browser-verified.

**A5/A6 — Manifest + parallel entry.** `botella_manifest.py` wires the onboarding flow + chat_with_advisor (with parallel context fetch — chart, language, gender, people, history, life_context, transits) + Whisper voice handler. `bot_botella.py` is a uvicorn app that mounts both botella's HTTPS+WS surface AND optionally the Telegram webhook adapter. The Telegram adapter was patched along the way to use `app.router.add_event_handler` (Starlette 1.0+ removed it from FastAPI directly).

**A2 — Onboarding Flow.** `GombiStar/flows/onboarding.py` ports states 0-7 of `handlers/onboarding.py`. Uses real `services.chart_service.geocode_candidates` (with pre-ack since Nominatim is slow) + `build_natal_chart` + `generate_chart_png` (try/except wrapped). Persists via the legacy DAL via `storage.telegram_id_for(session.user_id)`. 9 tests cover happy path, Hebrew, validation loops, geocode disambiguation, anonymous (iOS) user with no telegram identity yet.

**A1 — DAL convention + storage helpers.** Decided NOT to rewrite db.py to take UUIDs — instead established the convention that flow state functions look up `tid = await storage.telegram_id_for(session.user_id)` once at the top and call existing db.py with BIGINT. Added `external_id_for(uid, provider)` and `require_telegram_id(uid)` to PostgresStorage and a parallel `telegram_id_for` to MemoryStorage so flow tests work against in-memory storage.

**Initial Phase 1 (committed 2026-05-02 evening, before the overnight push).** Schema migration (layla_user_identities + layla_sessions, with backfill SQL commented), PostgresStorage, 16 mock-based tests for the storage shape. Botella git-init at the start of the overnight session so all work is preserved.
