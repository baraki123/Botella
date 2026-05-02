/**
 * Apple Sign-In on iOS (and the future macOS / web extensions).
 *
 * On platforms where Apple Sign-In isn't available (Android, simulator
 * sometimes, web), we fall back to anonymous auth.
 *
 * The flow:
 *   1. User taps "Continue with Apple"
 *   2. expo-apple-authentication opens the Apple sheet
 *   3. We get back identity_token + (first time only) name + email
 *   4. POST /v1/auth/apple → server verifies the token + returns botella JWT
 *   5. Cache jwt + userId in AsyncStorage
 */
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { product } from "../config/product";
import type { Session } from "./anonymous";

const JWT_KEY = "botella.jwt";
const USER_KEY = "botella.userId";
const AUTH_KEY = "botella.authProvider";

/** True if the device CAN do Apple Sign-In right now. */
export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Performs the full Apple Sign-In + token-exchange flow.
 *
 * Throws if cancelled / errors out — caller renders an error and lets the
 * user fall back to anonymous.
 */
export async function signInWithApple(opts: {
  /** Anonymous user_id from a prior /v1/auth/anonymous call, if any. The
   * server uses this to merge anonymous data into the new Apple identity
   * (best-effort — actual merging behavior is storage-defined). */
  linkAnonymousUserId?: string;
}): Promise<Session> {
  // Generate a nonce to bind the request → token pair (replay protection).
  const rawNonce = await randomNonce();
  const hashedNonce = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    rawNonce
  );

  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });

  if (!credential.identityToken) {
    throw new Error("Apple did not return an identity token");
  }

  const body = {
    identity_token: credential.identityToken,
    nonce: hashedNonce,
    given_name: credential.fullName?.givenName || undefined,
    family_name: credential.fullName?.familyName || undefined,
    email: credential.email || undefined,
    link_anonymous_user_id: opts.linkAnonymousUserId,
  };

  const r = await fetch(`${product.apiUrl}/v1/auth/apple`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`apple auth failed: ${r.status} ${await r.text()}`);
  }
  const session = (await r.json()) as { jwt: string; user_id: string; auth: string };

  await Promise.all([
    AsyncStorage.setItem(JWT_KEY, session.jwt),
    AsyncStorage.setItem(USER_KEY, session.user_id),
    AsyncStorage.setItem(AUTH_KEY, "apple"),
  ]);

  return { jwt: session.jwt, userId: session.user_id };
}

/** Returns whichever auth provider this device is currently signed in as,
 * or null if no session is cached. */
export async function currentAuthProvider(): Promise<string | null> {
  return await AsyncStorage.getItem(AUTH_KEY);
}

async function randomNonce(): Promise<string> {
  // 16 random bytes → 32-char hex string. Uses the polyfill from index.ts.
  const bytes = new Uint8Array(16);
  // @ts-ignore — globalThis.crypto exists at runtime via react-native-get-random-values.
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
