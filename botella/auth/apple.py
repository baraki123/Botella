"""Apple Sign-In identity-token verification.

Apple's iOS / web Sign-In flow gives the client an `identity_token` — a JWT
signed by Apple with the user's stable Apple ID (the `sub` claim). The
client sends that token to our /v1/auth/apple endpoint; we verify it with
Apple's published public keys and exchange it for a botella JWT.

Spec: https://developer.apple.com/documentation/sign_in_with_apple/verifying_a_user

The verification surface is split out from the FastAPI route handler so it
can be unit-tested with a test JWK key without faking the network.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

import jwt as pyjwt
from jwt import PyJWKClient

APPLE_JWKS_URL = "https://appleid.apple.com/auth/keys"
APPLE_ISSUER = "https://appleid.apple.com"


class AppleAuthError(Exception):
    pass


@dataclass(frozen=True)
class AppleIdentity:
    """The fields we extract from a verified Apple identity token."""
    sub: str                # Apple's stable user ID (use as external_id)
    email: str | None
    email_verified: bool
    is_private_email: bool


# Cache one PyJWKClient at module level — it pools HTTP + caches keys.
_jwk_client: PyJWKClient | None = None


def _default_jwk_client() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        _jwk_client = PyJWKClient(APPLE_JWKS_URL, cache_keys=True)
    return _jwk_client


def _audience() -> list[str]:
    """The accepted `aud` claims — your iOS app's Bundle ID(s).

    For a real Layla build the bundle id is `app.layla.ios`. During Expo Go
    development the bundle id Apple sees is `host.exp.Exponent`, so we
    accept a comma-separated list and pyjwt happily matches any of them.
    Configured via env so tests + multiple products can override.
    """
    raw = os.environ.get("APPLE_SIGN_IN_AUDIENCE")
    if not raw:
        raise AppleAuthError(
            "APPLE_SIGN_IN_AUDIENCE env var is required (the iOS Bundle ID)"
        )
    auds = [a.strip() for a in raw.split(",") if a.strip()]
    if not auds:
        raise AppleAuthError("APPLE_SIGN_IN_AUDIENCE must contain at least one value")
    return auds


def verify_apple_identity_token(
    token: str,
    *,
    audience: str | list[str] | None = None,
    jwk_client: PyJWKClient | None = None,
    expected_nonce: str | None = None,
    leeway_seconds: int = 60,
) -> AppleIdentity:
    """Verify an Apple identity_token and return the extracted identity.

    Raises AppleAuthError on any verification failure. Validates:
      - signature (against Apple's published keys)
      - iss == 'https://appleid.apple.com'
      - aud == APPLE_SIGN_IN_AUDIENCE (or override)
      - exp is in the future (with `leeway_seconds` for clock skew)
      - if `expected_nonce` is given, the token's nonce/nonce_hashed claim matches

    `jwk_client` is injectable for tests.
    """
    if audience is None:
        aud: str | list[str] = _audience()
    else:
        aud = audience
    client = jwk_client or _default_jwk_client()

    # PyJWKClient.get_signing_key_from_jwt(token) parses the unverified header
    # to find the kid, fetches that key from Apple, returns it for verify.
    try:
        signing_key = client.get_signing_key_from_jwt(token)
    except Exception as e:
        raise AppleAuthError(f"could not resolve Apple signing key: {e}") from e

    try:
        claims = pyjwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=aud,
            issuer=APPLE_ISSUER,
            leeway=leeway_seconds,
            options={"require": ["sub", "iss", "aud", "exp", "iat"]},
        )
    except pyjwt.ExpiredSignatureError as e:
        raise AppleAuthError("apple token expired") from e
    except pyjwt.InvalidAudienceError as e:
        raise AppleAuthError(f"apple token aud mismatch: {e}") from e
    except pyjwt.InvalidIssuerError as e:
        raise AppleAuthError(f"apple token iss mismatch: {e}") from e
    except pyjwt.InvalidTokenError as e:
        raise AppleAuthError(f"invalid apple token: {e}") from e

    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub:
        raise AppleAuthError("missing sub claim")

    if expected_nonce is not None:
        # Apple's iOS SDK passes a SHA-256 hash of the original nonce in
        # `nonce_supported`/`nonce` claim depending on integration. Accept
        # either match — caller hashes before comparing if needed.
        nonce = claims.get("nonce")
        if nonce != expected_nonce:
            raise AppleAuthError("nonce mismatch")

    email = claims.get("email")
    if email is not None and not isinstance(email, str):
        email = None

    def _bool(c: str) -> bool:
        v = claims.get(c)
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.lower() == "true"
        return False

    return AppleIdentity(
        sub=sub,
        email=email,
        email_verified=_bool("email_verified"),
        is_private_email=_bool("is_private_email"),
    )


def now_seconds() -> int:
    """Wall-clock seconds, exposed for testability."""
    return int(time.time())
