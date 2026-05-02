/**
 * Anonymous-first auth.
 *
 * On first launch, generate a random device ID and exchange it for a JWT.
 * Both are stored in AsyncStorage (which uses localStorage on web,
 * NSUserDefaults/SharedPreferences on native).
 *
 * Real production builds will swap AsyncStorage for expo-secure-store on
 * native platforms — but for the v0 web demo, AsyncStorage is enough.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { product } from "../config/product";

const DEVICE_KEY = "botella.deviceId";
const JWT_KEY = "botella.jwt";
const USER_KEY = "botella.userId";

function randomId(): string {
  // RFC4122-ish v4 — good enough for a stable per-device handle.
  const bytes = new Uint8Array(16);
  // crypto.getRandomValues is available in modern RN (Hermes) and on web.
  (globalThis.crypto || (globalThis as any).msCrypto).getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function getOrCreateDeviceId(): Promise<string> {
  const existing = await AsyncStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const fresh = randomId();
  await AsyncStorage.setItem(DEVICE_KEY, fresh);
  return fresh;
}

export interface Session {
  jwt: string;
  userId: string;
}

export async function loadCachedSession(): Promise<Session | null> {
  const [jwt, userId] = await Promise.all([
    AsyncStorage.getItem(JWT_KEY),
    AsyncStorage.getItem(USER_KEY),
  ]);
  if (jwt && userId) return { jwt, userId };
  return null;
}

export async function ensureSession(): Promise<Session> {
  const cached = await loadCachedSession();
  if (cached) return cached;

  const deviceId = await getOrCreateDeviceId();
  const r = await fetch(`${product.apiUrl}/v1/auth/anonymous`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId }),
  });
  if (!r.ok) {
    throw new Error(`auth failed: ${r.status} ${await r.text()}`);
  }
  const body = (await r.json()) as { jwt: string; user_id: string };
  await Promise.all([
    AsyncStorage.setItem(JWT_KEY, body.jwt),
    AsyncStorage.setItem(USER_KEY, body.user_id),
  ]);
  return { jwt: body.jwt, userId: body.user_id };
}

export async function clearSession(): Promise<void> {
  await Promise.all([
    AsyncStorage.removeItem(JWT_KEY),
    AsyncStorage.removeItem(USER_KEY),
    AsyncStorage.removeItem(DEVICE_KEY),
  ]);
}
