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

const PRODUCTION_API_URL = "https://http--laylabot--28ttnydqvqwp.code.run";

const isProd =
  // EAS build profile sets this; in dev / Expo Go it stays undefined.
  (Constants.expoConfig?.extra as any)?.botellaEnv === "production";

// Resolve the backend URL with this priority:
//   1. EXPO_PUBLIC_API_URL — manual override (works in Expo Go too, but
//      only reliable when Metro sees it at bundle time).
//   2. EAS production profile — Northflank URL.
//   3. iOS / Android native dev → Northflank URL (ATS would block plain
//      HTTP to a LAN dev backend anyway).
//   4. Deployed web (Vercel preview/prod, custom domains) → Northflank.
//   5. localhost web dev → window.location.hostname:8000 — the
//      standard backend-dev loop on a laptop.
function resolveApiUrl(): string {
  const override = (process.env as any).EXPO_PUBLIC_API_URL;
  if (typeof override === "string" && override.length > 0) return override;
  if (isProd) return PRODUCTION_API_URL;
  if (Platform.OS !== "web") return PRODUCTION_API_URL;
  const host =
    typeof window !== "undefined" ? window.location.hostname || "localhost" : "localhost";
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host.endsWith(".local");
  if (!isLocal) return PRODUCTION_API_URL;
  return `http://${host}:8000`;
}

export const product = {
  name: "Layla",
  // First-impression copy — shown on the SignInScreen. Layla voice:
  // direct, warm, no marketing-speak. Tightened from
  // GombiStar/locales/strings.py "welcome".
  greeting:
    "I'm Layla. Tell me when you were born and I'll see what I see — then bring me whatever's actually on your mind.",
  apiUrl: resolveApiUrl(),
  accent: "#D4A574", // warm gold — used for Layla's signature touches
} as const;

export type Product = typeof product;
