"""Apple Sign-In verification tests.

Generates an RS256 keypair in-memory, signs a fake "Apple" identity_token
with it, hands the test a JWK client that returns the matching public key.
Lets us exercise the real verify_apple_identity_token + the FastAPI route
without faking the network or skipping signature checks.
"""
from __future__ import annotations

import time
from unittest.mock import MagicMock, patch

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from botella import BotManifest, create_app
from botella.auth.apple import (
    APPLE_ISSUER,
    AppleAuthError,
    AppleIdentity,
    verify_apple_identity_token,
)
from botella.storage import MemoryStorage


# ─── Helpers — mint a realistic Apple-style RS256 token ─────────────────────


def _generate_keypair():
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_key = private_key.public_key()
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return private_key, public_key, private_pem


def _mint_token(private_pem, *, audience: str, sub: str = "001234.deadbeef.5678",
                nonce: str | None = None, expired: bool = False, aud_override=None,
                iss_override=None, email: str | None = "user@privaterelay.appleid.com",
                kid: str = "TESTKID"):
    now = int(time.time())
    claims = {
        "sub": sub,
        "iss": iss_override or APPLE_ISSUER,
        "aud": aud_override or audience,
        "iat": now - 5,
        "exp": now - 3600 if expired else now + 3600,
        "email": email,
        "email_verified": "true",
        "is_private_email": "true",
    }
    if nonce is not None:
        claims["nonce"] = nonce
    return pyjwt.encode(claims, private_pem, algorithm="RS256", headers={"kid": kid})


def _fake_jwk_client(public_key):
    """Returns a MagicMock that satisfies PyJWKClient.get_signing_key_from_jwt."""
    client = MagicMock()
    fake_signing_key = MagicMock()
    fake_signing_key.key = public_key
    client.get_signing_key_from_jwt.return_value = fake_signing_key
    return client


@pytest.fixture
def keypair():
    return _generate_keypair()


@pytest.fixture
def aud():
    return "app.layla.ios"


# ─── verify_apple_identity_token directly ────────────────────────────────────


def test_verify_returns_identity_for_valid_token(keypair, aud):
    private_key, public_key, pem = keypair
    token = _mint_token(pem, audience=aud)
    identity = verify_apple_identity_token(
        token, audience=aud, jwk_client=_fake_jwk_client(public_key)
    )
    assert isinstance(identity, AppleIdentity)
    assert identity.sub == "001234.deadbeef.5678"
    assert identity.email_verified is True
    assert identity.is_private_email is True


def test_verify_rejects_expired_token(keypair, aud):
    private_key, public_key, pem = keypair
    token = _mint_token(pem, audience=aud, expired=True)
    with pytest.raises(AppleAuthError, match="expired"):
        verify_apple_identity_token(
            token, audience=aud, jwk_client=_fake_jwk_client(public_key),
            leeway_seconds=0,
        )


def test_verify_rejects_wrong_audience(keypair, aud):
    private_key, public_key, pem = keypair
    token = _mint_token(pem, audience=aud, aud_override="some.other.app")
    with pytest.raises(AppleAuthError, match="aud"):
        verify_apple_identity_token(
            token, audience=aud, jwk_client=_fake_jwk_client(public_key)
        )


def test_verify_rejects_wrong_issuer(keypair, aud):
    private_key, public_key, pem = keypair
    token = _mint_token(pem, audience=aud, iss_override="https://evil.example.com")
    with pytest.raises(AppleAuthError, match="iss"):
        verify_apple_identity_token(
            token, audience=aud, jwk_client=_fake_jwk_client(public_key)
        )


def test_verify_rejects_nonce_mismatch(keypair, aud):
    private_key, public_key, pem = keypair
    token = _mint_token(pem, audience=aud, nonce="real-nonce")
    with pytest.raises(AppleAuthError, match="nonce"):
        verify_apple_identity_token(
            token, audience=aud, jwk_client=_fake_jwk_client(public_key),
            expected_nonce="different-nonce",
        )


def test_verify_accepts_matching_nonce(keypair, aud):
    private_key, public_key, pem = keypair
    token = _mint_token(pem, audience=aud, nonce="abc123")
    identity = verify_apple_identity_token(
        token, audience=aud, jwk_client=_fake_jwk_client(public_key),
        expected_nonce="abc123",
    )
    assert identity.sub == "001234.deadbeef.5678"


def test_verify_rejects_token_signed_by_wrong_key(keypair, aud):
    # Bad guy signs a token with their own key; we verify against the
    # legit Apple public key. Should fail signature check.
    private_a, public_a, pem_a = keypair
    private_b, public_b, _pem_b = _generate_keypair()
    token = _mint_token(pem_a, audience=aud)  # signed by A
    with pytest.raises(AppleAuthError, match="invalid apple token"):
        verify_apple_identity_token(
            token, audience=aud, jwk_client=_fake_jwk_client(public_b),  # but verify with B
        )


def test_verify_rejects_missing_sub(keypair, aud):
    private_key, public_key, pem = keypair
    # Mint manually without sub.
    now = int(time.time())
    claims = {
        "iss": APPLE_ISSUER, "aud": aud,
        "iat": now, "exp": now + 3600,
    }
    # PyJWT's `options.require=["sub"]` should reject this with InvalidTokenError
    token = pyjwt.encode(claims, pem, algorithm="RS256", headers={"kid": "TESTKID"})
    with pytest.raises(AppleAuthError):
        verify_apple_identity_token(
            token, audience=aud, jwk_client=_fake_jwk_client(public_key)
        )


# ─── Through the FastAPI route ───────────────────────────────────────────────


def _make_app() -> tuple[TestClient, MemoryStorage]:
    storage = MemoryStorage()
    manifest = BotManifest(name="t", storage=storage, flows=[], triggers={})
    return TestClient(create_app(manifest)), storage


def test_apple_route_exchanges_valid_token_for_botella_jwt(keypair, aud, monkeypatch):
    private_key, public_key, pem = keypair
    monkeypatch.setenv("APPLE_SIGN_IN_AUDIENCE", aud)

    client, storage = _make_app()
    token = _mint_token(pem, audience=aud)

    fake_client = _fake_jwk_client(public_key)
    with patch("botella.auth.apple._default_jwk_client", return_value=fake_client):
        r = client.post("/v1/auth/apple", json={
            "identity_token": token,
            "given_name": "Yael",
            "family_name": "Cohen",
        })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["auth"] == "apple"
    assert body["user_id"]
    assert body["jwt"]

    # Same Apple sub posted again → same user_id (sticky identity).
    with patch("botella.auth.apple._default_jwk_client", return_value=fake_client):
        r2 = client.post("/v1/auth/apple", json={
            "identity_token": _mint_token(pem, audience=aud),  # fresh token, same sub
        })
    assert r2.status_code == 200
    assert r2.json()["user_id"] == body["user_id"]

    # Profile fields landed in user record on first call.
    user = storage._users[body["user_id"]]
    assert user["apple_given_name"] == "Yael"
    assert user["apple_family_name"] == "Cohen"
    assert user["email"] == "user@privaterelay.appleid.com"


def test_apple_route_rejects_expired_token(keypair, aud, monkeypatch):
    private_key, public_key, pem = keypair
    monkeypatch.setenv("APPLE_SIGN_IN_AUDIENCE", aud)

    client, _storage = _make_app()
    token = _mint_token(pem, audience=aud, expired=True)
    fake_client = _fake_jwk_client(public_key)
    with patch("botella.auth.apple._default_jwk_client", return_value=fake_client):
        r = client.post("/v1/auth/apple", json={"identity_token": token})
    assert r.status_code == 401
    assert "expired" in r.json()["detail"]


def test_apple_route_rejects_missing_audience_env(keypair, monkeypatch):
    """If APPLE_SIGN_IN_AUDIENCE isn't configured, verification refuses to run."""
    private_key, public_key, pem = keypair
    monkeypatch.delenv("APPLE_SIGN_IN_AUDIENCE", raising=False)

    client, _storage = _make_app()
    token = _mint_token(pem, audience="anything")
    fake_client = _fake_jwk_client(public_key)
    with patch("botella.auth.apple._default_jwk_client", return_value=fake_client):
        r = client.post("/v1/auth/apple", json={"identity_token": token})
    assert r.status_code == 401
    assert "AUDIENCE" in r.json()["detail"]


def test_apple_route_rejects_nonce_mismatch(keypair, aud, monkeypatch):
    private_key, public_key, pem = keypair
    monkeypatch.setenv("APPLE_SIGN_IN_AUDIENCE", aud)

    client, _ = _make_app()
    token = _mint_token(pem, audience=aud, nonce="real-nonce")
    fake_client = _fake_jwk_client(public_key)
    with patch("botella.auth.apple._default_jwk_client", return_value=fake_client):
        r = client.post("/v1/auth/apple", json={
            "identity_token": token,
            "nonce": "tampered-nonce",
        })
    assert r.status_code == 401
    assert "nonce" in r.json()["detail"]
