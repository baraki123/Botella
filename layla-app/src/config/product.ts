/**
 * Layla product configuration. The single fork-specific file (alongside
 * theme.ts + assets/).
 *
 * - `apiUrl` derived dynamically in dev (web → page hostname, Expo Go →
 *   the laptop's LAN IP from Constants.expoConfig.hostUri). For the App
 *   Store build, override via EAS profile env var (botellaEnv=production)
 *   to lock to https://api.layla.app. NEVER ship a build with localhost.
 *
 * - `name` and `greeting` are user-visible. Keep them in Layla's voice
 *   (warm, direct, not gushy). The greeting shows on the SignInScreen
 *   so it's the first impression for someone who hasn't met her yet.
 */
import Constants from "expo-constants";
import { Platform } from "react-native";

function deriveApiHost(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.hostname || "localhost";
  }
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) return hostUri.split(":")[0];
  return "localhost";
}

const PRODUCTION_API_URL = "https://api.layla.app";
const apiHost = deriveApiHost();

const isProd =
  // EAS build profile sets this; in dev / Expo Go it stays undefined.
  (Constants.expoConfig?.extra as any)?.botellaEnv === "production";

export const product = {
  name: "Layla",
  // First-impression copy — shown on the SignInScreen. Layla voice:
  // direct, warm, no marketing-speak. Tightened from
  // GombiStar/locales/strings.py "welcome".
  greeting:
    "I'm Layla. Tell me when you were born and I'll see what I see — then bring me whatever's actually on your mind.",
  apiUrl: isProd ? PRODUCTION_API_URL : `http://${apiHost}:8000`,
  accent: "#D4A574", // warm gold — used for Layla's signature touches
} as const;

export type Product = typeof product;
