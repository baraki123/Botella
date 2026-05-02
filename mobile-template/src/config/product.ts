/**
 * Per-product configuration. The ONLY file (along with theme.ts and assets/)
 * that needs to change when forking this template for a new bot.
 *
 * Layla.app would override the static values below; for production, replace
 * the dynamic dev-host derivation with a hardcoded production URL.
 */
import Constants from "expo-constants";
import { Platform } from "react-native";

/** Pick the API host for THIS run.
 *  - Web: same hostname as the page (so localhost dev works, AND the LAN
 *    URL works if you opened the dev page on a phone browser).
 *  - Native (Expo Go): derive from the dev server's hostUri so the iPhone
 *    on the same wifi reaches the laptop's LAN IP automatically.
 *  - Production: replace this with a hardcoded https://api.<product>.app.
 */
function deriveApiHost(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.hostname || "localhost";
  }
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) return hostUri.split(":")[0];
  return "localhost";
}

const apiHost = deriveApiHost();

export const product = {
  name: "Echo",
  apiUrl: `http://${apiHost}:8000`,
  accent: "#3B82F6",
  greeting: "Hi! Try /start to begin, or just say something.",
} as const;

export type Product = typeof product;
