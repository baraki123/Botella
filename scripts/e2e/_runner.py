"""Shared helpers for Playwright E2E tests.

Pattern: each e2e_*.py file defines `def run(page) -> None` which
asserts its way through one user-state-machine path. `run_all.py`
imports each, drives them in sequence against a single browser, and
prints a PASS/FAIL summary + saves screenshots to screenshots/e2e/.

All tests assume the backend is reachable at http://127.0.0.1:8000 and
Metro is at http://localhost:8081 — verify via _check_servers() before
running. Each test gets a fresh anonymous JWT (seeded into the page's
localStorage) so they don't pollute each other.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path
from typing import Any, Callable

# Backend + Metro endpoints. Override via env if you ever point at prod.
BACKEND = "http://127.0.0.1:8000"
METRO = "http://localhost:8081"

SHOTS_DIR = Path(__file__).resolve().parents[2] / "screenshots" / "e2e"
SHOTS_DIR.mkdir(parents=True, exist_ok=True)


# ─── Server-side helpers ───────────────────────────────────────────────────


def check_servers() -> None:
    """Verify both backend and Metro are up before running anything.
    Fails fast with a clear message rather than letting tests timeout."""
    try:
        r = urllib.request.urlopen(f"{BACKEND}/healthz", timeout=2)
        if r.status != 200:
            raise RuntimeError(f"backend /healthz returned {r.status}")
    except Exception as e:
        raise RuntimeError(
            f"backend not reachable at {BACKEND}: {e}.\n"
            "Start it: LAYLA_DISABLE_SCHEDULER=1 uvicorn bot_botella:app "
            "--host 127.0.0.1 --port 8000 (from GombiStar)"
        ) from e
    try:
        urllib.request.urlopen(METRO, timeout=2)
    except Exception as e:
        raise RuntimeError(
            f"Metro not reachable at {METRO}: {e}.\n"
            "Start it: npx expo start --port 8081 --web (from layla-app)"
        ) from e


def mint_anon_session() -> dict:
    """POST /v1/auth/anonymous and return the response (jwt + user_id)."""
    req = urllib.request.Request(
        f"{BACKEND}/v1/auth/anonymous",
        data=json.dumps({"device_id": f"e2e-{int(time.time() * 1000)}"}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read())


def http_get(path: str, jwt: str) -> dict:
    req = urllib.request.Request(
        f"{BACKEND}{path}",
        headers={"Authorization": f"Bearer {jwt}"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def http_delete(path: str, jwt: str) -> tuple[int, str]:
    req = urllib.request.Request(
        f"{BACKEND}{path}",
        method="DELETE",
        headers={"Authorization": f"Bearer {jwt}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


# ─── Browser helpers ───────────────────────────────────────────────────────


def seed_session(page, jwt: str, user_id: str) -> None:
    """Inject the anon session into localStorage. Run BEFORE navigating
    so the JWT is present when ChatScreen mounts and calls fetchMe."""
    page.add_init_script(
        f"""
        try {{
            localStorage.setItem('botella.jwt', {json.dumps(jwt)});
            localStorage.setItem('botella.userId', {json.dumps(user_id)});
            // Wipe any prior chat cache so each test starts clean.
            Object.keys(localStorage)
                .filter(k => k.startsWith('layla:chat_messages:'))
                .forEach(k => localStorage.removeItem(k));
        }} catch (e) {{}}
        """
    )


def open_chat(page) -> None:
    """Navigate to Metro + wait for the composer to render."""
    page.goto(METRO, wait_until="networkidle", timeout=15000)
    page.wait_for_selector(
        '[data-testid="composer-input"]',
        timeout=15000,
        state="attached",
    )


def shot(page, label: str) -> Path:
    """Screenshot to screenshots/e2e/<label>.png. Returns the path."""
    path = SHOTS_DIR / f"{label}.png"
    page.screenshot(path=str(path), full_page=False)
    return path


def visible_bubbles(page) -> list[dict]:
    """Return [{testid, text}] for every chat bubble currently rendered."""
    return page.evaluate(
        """() => {
            const nodes = document.querySelectorAll('[data-testid^="bubble-"]');
            return Array.from(nodes).map(n => ({
                testid: n.getAttribute('data-testid'),
                text: n.innerText,
            }));
        }"""
    )


def wait_for_bubble_text(page, substring: str, timeout_ms: int = 10000) -> bool:
    """Poll the rendered bubbles until any contains `substring`. Returns
    True on success, False on timeout."""
    end = time.time() + timeout_ms / 1000
    while time.time() < end:
        bubbles = visible_bubbles(page)
        for b in bubbles:
            if substring in b["text"]:
                return True
        time.sleep(0.2)
    return False


# ─── Direct DB seeding for tests that bypass onboarding ───────────────────


def seed_orbit(user_id: str, people: list[dict]) -> None:
    """Write a list of OrbitPerson dicts to the user's user_record.orbit
    via GombiStar's PostgresStorage (different venv). We pass the
    people payload via stdin so quoting is bulletproof regardless of
    free-text content. The subprocess inherits this process's env;
    if DATABASE_URL isn't already in our env we eagerly load it from
    GombiStar/.env before spawning."""
    import os
    import subprocess

    env = os.environ.copy()
    if "DATABASE_URL" not in env:
        gs_env = Path("/Users/barakben-ezer/Desktop/Coding/GombiStar/.env")
        if gs_env.exists():
            for line in gs_env.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, _, v = line.partition("=")
                # Strip surrounding quotes if present
                v = v.strip().strip("'\"")
                env.setdefault(k.strip(), v)

    py = "/Users/barakben-ezer/Desktop/Coding/GombiStar/venv/bin/python"
    script = (
        "import asyncio, json, sys\n"
        'sys.path.insert(0, "/Users/barakben-ezer/Desktop/Coding/GombiStar")\n'
        "from database.storage import PostgresStorage\n"
        "payload = json.load(sys.stdin)\n"
        "async def go():\n"
        "    s = PostgresStorage()\n"
        '    rec = await s.get_user(payload["user_id"]) or {}\n'
        '    rec["orbit"] = payload["people"]\n'
        '    await s.update_user(payload["user_id"], rec)\n'
        "asyncio.run(go())\n"
    )
    stdin_payload = json.dumps({"user_id": user_id, "people": people})
    proc = subprocess.run(
        [py, "-c", script],
        input=stdin_payload,
        text=True,
        capture_output=True,
        env=env,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"seed_orbit failed (exit {proc.returncode}):\n"
            f"stdout: {proc.stdout}\nstderr: {proc.stderr}"
        )


# ─── Test reporter ─────────────────────────────────────────────────────────


class TestResult:
    def __init__(self, name: str):
        self.name = name
        self.passed: bool | None = None
        self.error: str | None = None
        self.duration_ms: int = 0

    def __str__(self) -> str:
        if self.passed is None:
            return f"  ⏳ {self.name}"
        if self.passed:
            return f"  ✅ {self.name}  ({self.duration_ms} ms)"
        return f"  ❌ {self.name}  ({self.duration_ms} ms)\n     {self.error}"


def run_one(page, name: str, fn: Callable[[Any], None]) -> TestResult:
    """Run one test function with timing + error capture."""
    r = TestResult(name)
    start = time.time()
    try:
        fn(page)
        r.passed = True
    except Exception as e:
        r.passed = False
        r.error = f"{type(e).__name__}: {e}"
    finally:
        r.duration_ms = int((time.time() - start) * 1000)
    return r
