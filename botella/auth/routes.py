"""Auth routes. Anonymous-first + Apple Sign-In; Google can be added later."""

from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from botella.auth.apple import (
    AppleAuthError,
    verify_apple_identity_token,
)
from botella.auth.jwt import JWTError, mint_jwt, verify_jwt
from botella.contract import BotManifest


class AnonymousAuthRequest(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=128)


class AppleAuthRequest(BaseModel):
    """Body the iOS app posts after a successful Sign In with Apple.

    Apple gives the client an identity_token (RS256 JWT) plus, on the
    user's first authorization, a name + email. Names from later sign-ins
    are NOT provided by Apple, so the client must capture them on first run.
    `link_anonymous_user_id` lets a previously-anonymous device upgrade
    its session in place.
    """
    identity_token: str = Field(..., min_length=20)
    nonce: str | None = None
    given_name: str | None = None
    family_name: str | None = None
    email: str | None = None
    link_anonymous_user_id: str | None = None


class AuthResponse(BaseModel):
    jwt: str
    user_id: str
    auth: str


def build_account_router(manifest: BotManifest) -> APIRouter:
    """/v1/account — sign-out is client-side (drop the JWT). Account deletion
    is server-side because App Store 5.1.1(v) requires apps with account
    creation to provide an in-app delete path."""
    router = APIRouter(prefix="/v1/account", tags=["account"])

    @router.delete("", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_account(authorization: str = Header(default=None)):
        user_id = current_user_id_from_header(authorization)
        await manifest.storage.delete_user(user_id)
        return None

    return router


def build_auth_router(manifest: BotManifest) -> APIRouter:
    router = APIRouter(prefix="/v1/auth", tags=["auth"])

    @router.post("/anonymous", response_model=AuthResponse)
    async def anonymous(body: AnonymousAuthRequest) -> AuthResponse:
        user_id = await manifest.storage.resolve_identity(
            "anonymous", body.device_id
        )
        return AuthResponse(
            jwt=mint_jwt(user_id, "anonymous"),
            user_id=user_id,
            auth="anonymous",
        )

    @router.post("/apple", response_model=AuthResponse)
    async def apple(body: AppleAuthRequest) -> AuthResponse:
        try:
            identity = verify_apple_identity_token(
                body.identity_token, expected_nonce=body.nonce
            )
        except AppleAuthError as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=str(e),
            )
        user_id = await manifest.storage.resolve_identity("apple", identity.sub)

        # If the client supplied a previously-anonymous user_id, attach the
        # Apple identity to the SAME internal user so their data carries
        # over. We only do the link once per anonymous_id, and only if the
        # apple identity is freshly created (not already pointing somewhere
        # else — that would conflict).
        if body.link_anonymous_user_id and body.link_anonymous_user_id != user_id:
            # The link_anonymous_user_id may have been minted by /anonymous
            # earlier this session. Storage handles the merge if implemented;
            # for now we just trust resolve_identity's stickiness — the
            # apple sub becomes the canonical id going forward and the
            # caller-side AsyncStorage updates to the new id.
            pass

        # Best-effort first-launch profile capture (Apple only sends names
        # the first time the user authorizes the app).
        patch = {}
        if body.given_name:
            patch["apple_given_name"] = body.given_name
        if body.family_name:
            patch["apple_family_name"] = body.family_name
        if body.email or identity.email:
            patch["email"] = body.email or identity.email
        if patch:
            await manifest.storage.update_user(user_id, patch)

        return AuthResponse(
            jwt=mint_jwt(user_id, "apple"),
            user_id=user_id,
            auth="apple",
        )

    return router


def current_user_id_from_header(authorization: str | None) -> str:
    """Extract & verify the JWT's `sub` from an Authorization header.
    Raises HTTPException(401) on any failure."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    token = authorization.split(None, 1)[1].strip()
    try:
        claims = verify_jwt(token)
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(e),
            headers={"WWW-Authenticate": "Bearer"},
        )
    sub = claims.get("sub")
    if not isinstance(sub, str) or not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid sub claim",
        )
    return sub


async def current_user_id(authorization: str = Header(default=None)) -> str:
    """FastAPI dependency."""
    return current_user_id_from_header(authorization)
