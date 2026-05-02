# Morning brief — botella v0

## TL;DR

**botella is now end-to-end working.** A native chat shell (Expo) talks to a
Python bot brain via HTTPS + WebSocket, with token-by-token streaming. The
same brain is wrappable for Telegram via the Telegram adapter. A toy bot
proves every primitive: triggers, multi-step flows, validation, persistence,
streaming free chat, quick-reply chips.

## See it working — one command

```bash
bash scripts/demo.sh
```

Then open **http://127.0.0.1:8081** in a browser. You should see a chat
screen named "Echo." Try this conversation:

| You type     | What happens                                                         |
|--------------|----------------------------------------------------------------------|
| `/start`     | "What's your name?"                                                  |
| `Barak`      | "Nice to meet you, Barak." then "What's your favorite color?" + chips |
| `blue` (or tap chip) | "Got it — Barak likes blue. We're done."                     |
| `hello`      | "echo to Barak (blue): hello" — **streamed token-by-token**          |
| `/start`     | "Welcome back, Barak." (carry-over from `Done(carry=...)`)           |
| `/reset`     | clears state, next /start re-runs the flow                           |

`Ctrl+C` stops both servers.

If the demo script fails the prereq check, the missing-step instructions
print directly. Most likely you just need:

```bash
# backend
python3.11 -m venv venv && source venv/bin/activate && pip install -e ".[dev]"

# frontend
cd mobile-template && npm install && npx expo install \
  @react-native-async-storage/async-storage react-native-web react-dom @expo/metro-runtime
```

## Verify with no UI

```bash
source venv/bin/activate && python scripts/smoke.py
```

Boots a real uvicorn (not TestClient), walks the full conversation through
HTTP + WebSocket, prints checkmarks. Last run: **all 12 checks ✓ in 6 ms.**

```bash
source venv/bin/activate && python -m pytest
```

**25 unit + integration tests pass** across runtime, HTTP adapter, WS
adapter, and Telegram adapter.

## What's now in the repo

```
botella/                      ← installable Python package
├── contract.py               ← InboundMessage, OutboundEvent, Flow, BotManifest, Storage
├── runtime.py                ← dispatcher: triggers > flows > free-chat
├── storage/memory.py         ← in-memory impl for tests + toy bot
├── auth/                     ← anonymous JWT (Apple/Google deferred)
├── adapters/
│   ├── http.py               ← POST /v1/messages (collects events as JSON)
│   ├── ws.py                 ← WSS /v1/stream (streams tokens live)
│   └── telegram.py           ← wraps python-telegram-bot 21.x
└── app.py                    ← create_app(manifest) → FastAPI

mobile-template/              ← Expo template (fork-per-product)
├── App.tsx
├── src/
│   ├── config/product.ts     ← name, apiUrl, accent — the per-fork file
│   ├── config/theme.ts       ← all visual tokens
│   ├── auth/anonymous.ts     ← device-id → JWT, AsyncStorage
│   ├── api/stream.ts         ← WS client with reconnect + backoff
│   └── chat/                 ← ChatScreen, Bubble, QuickReplies, TypingIndicator, Composer
└── (vanilla Expo SDK 54 + RN 0.81 + React 19, web target enabled)

examples/echo_bot/            ← toy bot proving the contract
├── manifest.py               ← intro flow + /start + /reset + streaming free chat
└── run.py                    ← uvicorn entry

tests/                        ← 25 tests, all green
scripts/
├── demo.sh                   ← boots backend + Expo together
└── smoke.py                  ← live integration check w/ real sockets
```

## Architecture in one sentence

A `BotManifest` (declared by the bot) is consumed by `runtime.run()`, which
emits `OutboundEvent`s; **adapters** translate those to/from any transport
(HTTP, WS, Telegram). One brain, three transports.

## What I deliberately did NOT build overnight

- **Apple / Google sign-in** — anonymous-first is fine for v0. Same tables,
  add provider rows later.
- **The GombiStar refactor** — the contract is now real and tested, but
  porting Layla's onboarding `ConversationHandler` into a botella `Flow` is
  the cross-repo work that should happen next, awake.
- **expo-secure-store on native** — AsyncStorage works on web + native for
  the demo. Swap in SecureStore before App Store submission.
- **APNs / FCM push** — Layla's APScheduler proactive messages will need
  Expo Push wired up before the mobile app feels "alive." Day's work.

## Two things that surprised me during the build

1. **The `WaitFor` arg-order bug** my first toy bot test caught. I had
   `WaitFor(input_type, next_state)` in my head but `WaitFor(next_state,
   input_type)` in the dataclass — state names were being stored in the
   wrong field. Dropped `input_type` entirely (YAGNI for v0). Lesson: a real
   test catches what a design-doc walkthrough misses.

2. **The `quick_replies` UX foot-gun.** Emitting `text("Pick a color:") +
   quick_replies([...], prompt="")` looked sensible on HTTP (two events) but
   rendered as two messages on Telegram, the second being a useless `" "`
   placeholder. Fixed the toy bot to emit one `quick_replies(options,
   prompt="...")` event. Real bots should follow that pattern.

## Suggested first move when you're back

Pick one:

- **Sketch the GombiStar refactor in this repo** (no cross-repo risk yet) —
  extract Layla's onboarding states into a botella `Flow` against the toy
  bot's storage, prove the abstraction holds for the real complexity. ~3
  hours.
- **Wire push notifications** — Expo Push receiver token registration
  endpoint, a `proactive_send()` API on the manifest, swap APScheduler to
  emit through it. Required before any "morning reading" feature can fire on
  mobile. ~1 day.
- **Apple Sign-In** — needed before App Store submission. Standard path:
  expo-apple-authentication client-side, JWT verification against Apple's
  JWKS server-side. ~1 day.

I'd lean toward **the GombiStar refactor** — it's the only one that proves
botella is actually load-bearing for Layla, and it unblocks everything else.
