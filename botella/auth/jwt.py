"""JWT mint + verify. HS256, single secret, 90-day expiry.

Refresh tokens deliberately omitted: at this scale the complexity isn't worth it.
A simple long-lived token with a 're-auth' UX on expiry is enough.
"""

from __future__ import annotations

import os
import time
from typing import Literal

import jwt as pyjwt

AuthProvider = Literal["anonymous", "telegram", "apple", "google"]

DEFAULT_TTL_SECONDS = 90 * 24 * 3600


class JWTError(Exception):
    pass


def _secret() -> str:
    secret = os.environ.get("BOTELLA_JWT_SECRET")
    if not secret:
        # Loud warning in dev, hard fail in any non-dev env.
        if os.environ.get("BOTELLA_ENV") in (None, "", "dev", "test"):
            return "dev-only-secret-do-not-use-in-production-environments"
        raise JWTError(
            "BOTELLA_JWT_SECRET is required when BOTELLA_ENV is not 'dev' or 'test'"
        )
    return secret


def mint_jwt(
    user_id: str,
    auth: AuthProvider,
    ttl_seconds: int = DEFAULT_TTL_SECONDS,
) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "auth": auth,
        "iat": now,
        "exp": now + ttl_seconds,
    }
    return pyjwt.encode(payload, _secret(), algorithm="HS256")


def verify_jwt(token: str) -> dict:
    try:
        return pyjwt.decode(token, _secret(), algorithms=["HS256"])
    except pyjwt.ExpiredSignatureError as e:
        raise JWTError("token expired") from e
    except pyjwt.InvalidTokenError as e:
        raise JWTError(f"invalid token: {e}") from e
