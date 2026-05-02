"""Live integration smoke test.

Boots the toy bot via uvicorn, walks the entire conversation through HTTP +
WebSocket against the real sockets (not Starlette TestClient). Mirrors what
the Expo template does: anonymous auth → connect WS → send messages →
render streamed events.

Run:  python scripts/smoke.py
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from contextlib import suppress

import httpx
import uvicorn
import websockets

from botella import create_app
from examples.echo_bot.manifest import build_manifest


HOST, PORT = "127.0.0.1", 8765
BASE_URL = f"http://{HOST}:{PORT}"
WS_URL = f"ws://{HOST}:{PORT}/v1/stream"


class BackgroundServer:
    def __init__(self, app):
        config = uvicorn.Config(
            app, host=HOST, port=PORT, log_level="warning", access_log=False
        )
        self.server = uvicorn.Server(config)
        self._task: asyncio.Task | None = None

    async def __aenter__(self):
        self._task = asyncio.create_task(self.server.serve())
        # Wait until uvicorn signals startup complete.
        for _ in range(100):
            if self.server.started:
                break
            await asyncio.sleep(0.05)
        else:
            raise RuntimeError("server did not start in time")
        return self

    async def __aexit__(self, *exc):
        self.server.should_exit = True
        if self._task:
            with suppress(asyncio.CancelledError):
                await self._task


async def _drain_until(ws, sentinel: str = "turn_end") -> list[dict]:
    events: list[dict] = []
    while True:
        raw = await ws.recv()
        ev = json.loads(raw)
        if ev["type"] == sentinel:
            return events
        events.append(ev)


def _ok(label: str, ok: bool, detail: str = "") -> bool:
    sym = "✓" if ok else "✗"
    print(f"  {sym} {label}{(' — ' + detail) if detail else ''}")
    return ok


async def main() -> int:
    app = create_app(build_manifest())
    failures = 0

    print("→ booting backend on", BASE_URL)
    async with BackgroundServer(app):
        # 1. health
        async with httpx.AsyncClient() as http:
            r = await http.get(f"{BASE_URL}/health")
            if not _ok(
                "GET /health",
                r.status_code == 200 and r.json().get("ok") is True,
                str(r.json()),
            ):
                failures += 1

            # 2. anonymous auth
            r = await http.post(
                f"{BASE_URL}/v1/auth/anonymous", json={"device_id": "smoke-device"}
            )
            if not _ok(
                "POST /v1/auth/anonymous",
                r.status_code == 200 and "jwt" in r.json(),
            ):
                failures += 1
                return failures
            jwt = r.json()["jwt"]
            user_id = r.json()["user_id"]
            _ok("got user_id", True, user_id)

        # 3. WS streaming conversation
        async with websockets.connect(f"{WS_URL}?token={jwt}") as ws:
            # /start
            t0 = time.perf_counter()
            await ws.send(json.dumps({"text": "/start"}))
            evs = await _drain_until(ws)
            texts = [e["payload"]["text"] for e in evs if e["type"] == "text"]
            if not _ok(
                "/start → 'What's your name?'",
                texts == ["What's your name?"],
                f"got {texts}",
            ):
                failures += 1

            # name
            await ws.send(json.dumps({"text": "Smoke"}))
            evs = await _drain_until(ws)
            texts = [e["payload"]["text"] for e in evs if e["type"] == "text"]
            qrs = [e for e in evs if e["type"] == "quick_replies"]
            if not _ok(
                "name → 'Nice to meet you, Smoke.'",
                texts == ["Nice to meet you, Smoke."],
                f"got {texts}",
            ):
                failures += 1
            if not _ok(
                "quick_replies present with color options",
                len(qrs) == 1 and qrs[0]["payload"]["options"]
                == ["red", "green", "blue", "other"],
            ):
                failures += 1

            # color
            await ws.send(json.dumps({"text": "blue"}))
            evs = await _drain_until(ws)
            texts = [e["payload"]["text"] for e in evs if e["type"] == "text"]
            if not _ok(
                "color → 'Got it — Smoke likes blue. We're done.'",
                texts == ["Got it — Smoke likes blue. We're done."],
                f"got {texts}",
            ):
                failures += 1

            # free chat — should stream tokens
            await ws.send(json.dumps({"text": "ping"}))
            evs = await _drain_until(ws)
            types = [e["type"] for e in evs]
            tokens = [e["payload"]["text"] for e in evs if e["type"] == "token"]
            streamed = "".join(tokens)
            if not _ok(
                "free chat first event is 'typing'",
                types and types[0] == "typing",
                f"got {types[:3]}",
            ):
                failures += 1
            if not _ok(
                "free chat ends with 'complete'",
                types and types[-1] == "complete",
            ):
                failures += 1
            if not _ok(
                "stream reconstructs to 'echo to Smoke (blue): ping'",
                streamed == "echo to Smoke (blue): ping",
                f"got {streamed!r}",
            ):
                failures += 1
            if not _ok(
                "tokens streamed individually (not as a single chunk)",
                len(tokens) > 5,
                f"got {len(tokens)} tokens",
            ):
                failures += 1

            elapsed = time.perf_counter() - t0
            _ok("full conversation latency", True, f"{elapsed * 1000:.0f}ms")

    print()
    if failures:
        print(f"✗ {failures} check(s) failed")
        return 1
    print("✓ all checks passed — backend works end-to-end")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
