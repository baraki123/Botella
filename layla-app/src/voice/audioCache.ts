// Shared TTS fetch + cache layer for BOTH the bubble "Listen" button
// (playback.ts) and the episode player (player.ts). Extracted so a chapter the
// user previewed via a bubble is already warm when they open the episode (and
// vice-versa) — there's one cache keyed by (text, voice).
//
// Fetches MP3 bytes from /v1/tts/synthesize and returns a playable URI:
//   - web:    a blob: object URL (works as <audio> src directly)
//   - native: a file:// URI (AVPlayer/ExoPlayer reject data: URIs in practice;
//             we write the bytes to a temp file via expo-file-system/legacy)

import { Platform } from "react-native";

import { product } from "../config/product";
import { bytesToBase64 } from "../lib/base64";

// LRU map of cacheKey → blob URL (web) / file URI (native). Bound so a long
// session doesn't leak memory. Shared by bubbles and episode chapters.
const _audioCache = new Map<string, string>();
const _CACHE_MAX = 96;

// In-flight prefetch keys — stops a duplicate request before the first lands.
const _prefetchInFlight = new Set<string>();

export function audioCacheKey(text: string, voice = "shimmer"): string {
  // Human-readable: voice + length + first 80 chars so similar prefixes
  // don't collide.
  return `${voice}:${text.length}:${text.slice(0, 80)}`;
}

export function isAudioCached(text: string, voice = "shimmer"): boolean {
  return _audioCache.has(audioCacheKey(text, voice));
}

/**
 * Fetch (or return cached) a playable audio URI for the given text+voice.
 * Throws on auth/synth/network errors — callers decide how to surface.
 */
export async function fetchAudioUri(
  text: string,
  voice: string,
  jwt: string,
): Promise<string> {
  const key = audioCacheKey(text, voice);
  const cached = _audioCache.get(key);
  if (cached) {
    // LRU touch.
    _audioCache.delete(key);
    _audioCache.set(key, cached);
    return cached;
  }

  const res = await fetch(`${product.apiUrl}/v1/tts/synthesize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text, voice }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`TTS synth failed (${res.status}): ${detail.slice(0, 200)}`);
  }

  let url: string;
  if (Platform.OS === "web" && typeof URL !== "undefined" && URL.createObjectURL) {
    const blob = await res.blob();
    url = URL.createObjectURL(blob);
  } else {
    // Native: write bytes to a real file and play from file:// (see the
    // CLAUDE.md note — typed expo-file-system 19+ methods throw; use /legacy).
    const FS = require("expo-file-system/legacy");
    const buf = await res.arrayBuffer();
    const base64 = bytesToBase64(buf);
    const safeKey = key.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const fileUri = `${FS.cacheDirectory}tts-${safeKey}.mp3`;
    await FS.writeAsStringAsync(fileUri, base64, {
      encoding: FS.EncodingType.Base64,
    });
    url = fileUri;
  }

  _audioCache.set(key, url);
  if (_audioCache.size > _CACHE_MAX) {
    const oldest = _audioCache.keys().next().value;
    if (oldest) _audioCache.delete(oldest);
  }
  return url;
}

/**
 * Fire-and-forget prefetch — warms the cache so a later fetch is instant.
 * Idempotent: a no-op while in flight or once cached. Errors swallowed.
 */
export async function prefetchAudioUri(
  text: string,
  voice: string,
  jwt: string,
): Promise<void> {
  const key = audioCacheKey(text, voice);
  if (_audioCache.has(key) || _prefetchInFlight.has(key)) return;
  _prefetchInFlight.add(key);
  try {
    await fetchAudioUri(text, voice, jwt);
  } catch {
    // Silent — the on-demand fetch will surface the error if it matters.
  } finally {
    _prefetchInFlight.delete(key);
  }
}
