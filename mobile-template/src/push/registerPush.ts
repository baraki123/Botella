/**
 * Expo Push registration. Call once after sign-in / app foreground; idempotent.
 *
 * The native build needs:
 *   npx expo install expo-notifications expo-device
 *
 * Web is a no-op — Expo Push doesn't support browser endpoints. We don't
 * blow up if the package is missing either; we resolve to "skipped" and
 * the app keeps running.
 */
import { Platform } from "react-native";

import { product } from "../config/product";

export interface PushRegisterResult {
  ok: boolean;
  reason?: string;
  token?: string;
}

export async function registerForPushNotifications(args: {
  jwt: string;
}): Promise<PushRegisterResult> {
  if (Platform.OS === "web") {
    return { ok: false, reason: "web-not-supported" };
  }

  let Notifications: any;
  let Device: any;
  try {
    // @ts-ignore — install with `npx expo install expo-notifications expo-device`
    Notifications = await import("expo-notifications");
    // @ts-ignore — same as above
    Device = await import("expo-device");
  } catch {
    return { ok: false, reason: "expo-notifications-not-installed" };
  }

  if (!Device.isDevice) {
    return { ok: false, reason: "simulator" };
  }

  // Ask for permission if we don't already have it.
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const next = await Notifications.requestPermissionsAsync();
    status = next.status;
  }
  if (status !== "granted") {
    return { ok: false, reason: "permission-denied" };
  }

  const { data: token } = await Notifications.getExpoPushTokenAsync();
  if (!token) {
    return { ok: false, reason: "no-token" };
  }

  // Mirror to the backend; idempotent (last write wins on the user record).
  const r = await fetch(`${product.apiUrl}/v1/push/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.jwt}`,
    },
    body: JSON.stringify({ expo_push_token: token }),
  });
  if (!r.ok) {
    return { ok: false, reason: `http-${r.status}`, token };
  }
  return { ok: true, token };
}
