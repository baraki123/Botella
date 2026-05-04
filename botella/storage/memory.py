"""In-memory Storage for tests and toy bots.

Production bots implement Storage against their own database (Postgres for Layla).
"""

from __future__ import annotations

import asyncio
import uuid
from copy import deepcopy
from typing import Any

from botella.contract import SessionState


class MemoryStorage:
    def __init__(self) -> None:
        self._sessions: dict[str, SessionState] = {}
        self._identities: dict[tuple[str, str], str] = {}
        self._users: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    # ─── Sessions ────────────────────────────────────────────────────────

    async def load_session(self, user_id: str) -> SessionState:
        async with self._lock:
            existing = self._sessions.get(user_id)
            if existing is None:
                return SessionState(user_id=user_id)
            # Hand out a copy so callers can mutate without racing other turns
            return deepcopy(existing)

    async def save_session(self, session: SessionState) -> None:
        async with self._lock:
            self._sessions[session.user_id] = deepcopy(session)

    # ─── Identity ────────────────────────────────────────────────────────

    async def resolve_identity(self, provider: str, external_id: str) -> str:
        async with self._lock:
            key = (provider, external_id)
            existing = self._identities.get(key)
            if existing is not None:
                return existing
            user_id = str(uuid.uuid4())
            self._identities[key] = user_id
            self._users.setdefault(user_id, {})
            return user_id

    async def link_identity(
        self, provider: str, external_id: str, target_user_id: str
    ) -> str:
        async with self._lock:
            key = (provider, external_id)
            existing = self._identities.get(key)
            if existing is not None:
                return existing
            self._identities[key] = target_user_id
            self._users.setdefault(target_user_id, {})
            return target_user_id

    # ─── User data ───────────────────────────────────────────────────────

    async def get_user(self, user_id: str) -> dict[str, Any]:
        async with self._lock:
            return deepcopy(self._users.get(user_id, {}))

    async def update_user(self, user_id: str, patch: dict[str, Any]) -> None:
        async with self._lock:
            current = self._users.setdefault(user_id, {})
            current.update(patch)

    # ─── Reverse identity lookup (used by Layla/PostgresStorage too) ─────

    async def external_id_for(self, user_id: str, provider: str) -> str | None:
        """Return the (provider, external_id) pair's external_id given the
        internal user_id, or None if no such identity is registered."""
        async with self._lock:
            for (p, ext_id), uid in self._identities.items():
                if uid == user_id and p == provider:
                    return ext_id
        return None

    async def telegram_id_for(self, user_id: str) -> int | None:
        """Convenience: external_id_for(user_id, 'telegram') as int."""
        ext = await self.external_id_for(user_id, "telegram")
        return int(ext) if ext is not None else None

    # ─── Deletion (App Store-required) ───────────────────────────────────

    async def delete_user(self, user_id: str) -> None:
        async with self._lock:
            self._sessions.pop(user_id, None)
            self._users.pop(user_id, None)
            self._identities = {
                k: v for k, v in self._identities.items() if v != user_id
            }
