#!/usr/bin/env bash
# Boot the toy bot backend + the Expo web template + print URLs.
# Ctrl+C to stop both.

set -euo pipefail
cd "$(dirname "$0")/.."

REPO_ROOT="$(pwd)"
BACKEND_PORT=8000
EXPO_PORT=8081

if [ ! -d "venv" ]; then
  echo "✗ no venv — run:  python3.11 -m venv venv && source venv/bin/activate && pip install -e '.[dev]'"
  exit 1
fi

if [ ! -d "mobile-template/node_modules" ]; then
  echo "✗ no node_modules — run:  cd mobile-template && npm install && npx expo install @react-native-async-storage/async-storage react-native-web react-dom @expo/metro-runtime"
  exit 1
fi

# Clean up children on exit.
PIDS=()
cleanup() {
  echo
  echo "→ stopping…"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  exit 0
}
trap cleanup EXIT INT TERM

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "127.0.0.1")
echo "→ booting backend (toy echo bot) on 0.0.0.0:${BACKEND_PORT}  (reachable at http://${LAN_IP}:${BACKEND_PORT} from phones on the same wifi)"
(
  source venv/bin/activate
  exec uvicorn examples.echo_bot.run:app --host 0.0.0.0 --port ${BACKEND_PORT} --log-level warning
) &
PIDS+=($!)

# Wait for backend to be reachable.
for _ in $(seq 1 50); do
  if curl -sf "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done

echo "→ booting Expo dev server (web + LAN for iPhone) on port ${EXPO_PORT}"
(
  cd mobile-template
  # --web opens a browser, --lan exposes for phone scanning, both at once.
  exec npx expo start --port ${EXPO_PORT}
) &
PIDS+=($!)

cat <<EOF

────────────────────────────────────────────────────────────
  botella demo

  Backend health:     http://${LAN_IP}:${BACKEND_PORT}/health
  Web (browser):      press 'w' in the Expo prompt below, OR open
                      http://localhost:${EXPO_PORT}
  iPhone (Expo Go):   scan the QR code below, OR open Expo Go and
                      enter:  exp://${LAN_IP}:${EXPO_PORT}

  Once the chat screen opens, try:
    /start            → walks you through onboarding
    Barak             → your name
    blue              → tap a chip or type
    hello             → free chat, streamed token-by-token

  Ctrl+C to stop both.
────────────────────────────────────────────────────────────

EOF

# Block until any child exits (portable across bash 3.2 / 4 / 5).
while true; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" 2>/dev/null; then
      exit 0
    fi
  done
  sleep 1
done
