/**
 * Audio playback for Layla — fetches synthesized speech from
 * /v1/tts/synthesize and plays it through expo-audio.
 *
 * The backend caches per-text on its end (see services/tts.py); the
 * client caches the resulting blob URL per (text, voice) so a tap-to-
 * replay doesn't even hit the network. Cache is in-memory only —
 * survives navigation, doesn't survive app reload, which is fine.
 *
 * Singleton player: only one bubble plays at a time. Tapping a
 * different bubble while one is playing stops the first and starts
 * the second. This is the right UX for chat — overlapping voices is
 * confusing.
 *
 * Settings toggle: `voicePlaybackEnabled` (default false). When false,
 * the play button still appears on long bot bubbles but tapping it
 * does nothing — the toggle gates *initiation*, not visibility, so
 * users discover the affordance even before turning it on. Tweak this
 * decision later if the gold play-button-on-every-bubble feels noisy.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  AudioModule,
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from "expo-audio";
import { Platform } from "react-native";

import { product } from "../config/product";

const VOICE_TOGGLE_KEY = "layla:voice_playback_enabled";
const VOICE_DEFAULT = false;
// Mirror auth/anonymous.ts so playback can fetch its own JWT without a
// prop-drill from ChatScreen down through Bubble.
const JWT_KEY = "botella.jwt";


/** Read the active JWT from storage. Returns null if not authenticated
 * (in which case Layla wouldn't have rendered anything to play). */
export async function getCurrentJwt(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(JWT_KEY);
  } catch {
    return null;
  }
}

// LRU map of (cache_key) → blob URL (web) or local file URI (native).
// Bound at 64 entries so a long session doesn't leak memory.
const _audioCache = new Map<string, string>();
const _CACHE_MAX = 64;

let _currentPlayer: AudioPlayer | null = null;
// Subscribers get notified when the playing-state changes so bubbles
// can reflect "▶ → ⏸" without prop-drilling. Identifier is the bubble's
// cache_key (text + voice). At most one is "playing" at any moment.
let _playingKey: string | null = null;
const _listeners = new Set<(playingKey: string | null) => void>();

function _notify(key: string | null) {
  _playingKey = key;
  for (const l of _listeners) l(key);
}

export function subscribePlaybackState(
  cb: (playingKey: string | null) => void,
): () => void {
  _listeners.add(cb);
  // Replay current state on subscribe so a remounted bubble knows.
  cb(_playingKey);
  return () => _listeners.delete(cb);
}

export function isPlaying(cacheKey: string): boolean {
  return _playingKey === cacheKey;
}

// ─── Settings toggle ───────────────────────────────────────────────────────


export async function getVoicePlaybackEnabled(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(VOICE_TOGGLE_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
    return VOICE_DEFAULT;
  } catch {
    return VOICE_DEFAULT;
  }
}


export async function setVoicePlaybackEnabled(enabled: boolean): Promise<void> {
  try {
    await AsyncStorage.setItem(VOICE_TOGGLE_KEY, enabled ? "1" : "0");
  } catch {
    // best effort — toggle just won't persist; UI still reflects current
    // session.
  }
}


// ─── Cache key ────────────────────────────────────────────────────────────


export function bubbleCacheKey(text: string, voice = "shimmer"): string {
  // Keep it human — voice + first 80 chars + length so different
  // bubbles with similar prefixes don't collide.
  const head = text.slice(0, 80);
  return `${voice}:${text.length}:${head}`;
}


// ─── Stop / pause ─────────────────────────────────────────────────────────


export function stopPlayback() {
  if (_currentPlayer) {
    try {
      _currentPlayer.pause();
    } catch {}
    try {
      // expo-audio doesn't have an explicit "release" via the imperative
      // API, but pause + null-out is sufficient for our usage.
    } catch {}
    _currentPlayer = null;
  }
  _notify(null);
}


// ─── Fetch + play ─────────────────────────────────────────────────────────


async function _fetchAudioBlobUrl(
  text: string,
  voice: string,
  jwt: string,
): Promise<string> {
  const key = bubbleCacheKey(text, voice);
  const cached = _audioCache.get(key);
  if (cached) {
    // Move to end (LRU touch).
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
  const blob = await res.blob();
  // On web, URL.createObjectURL gives us a local URL the audio
  // element can stream from. On native, expo-audio accepts data: or
  // file: URIs — we use a base64 data URI as the simplest path.
  let url: string;
  if (Platform.OS === "web" && typeof URL !== "undefined" && URL.createObjectURL) {
    url = URL.createObjectURL(blob);
  } else {
    // Convert blob → base64 data URI for native playback.
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    // btoa exists on RN's Hermes runtime via the polyfill we already
    // import at the top of index.ts (see CLAUDE.md notes).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base64 = (globalThis as any).btoa
      ? (globalThis as any).btoa(binary)
      : Buffer.from(binary, "binary").toString("base64");
    url = `data:audio/mpeg;base64,${base64}`;
  }
  _audioCache.set(key, url);
  if (_audioCache.size > _CACHE_MAX) {
    const oldest = _audioCache.keys().next().value;
    if (oldest) _audioCache.delete(oldest);
  }
  return url;
}


/**
 * Play (or stop) the given text via Layla's voice.
 *
 * If the bubble is already playing → stops.
 * If a different bubble is playing → stops it, plays this one.
 *
 * Throws on auth/synth errors — caller decides how to surface.
 */
export async function togglePlay(opts: {
  text: string;
  voice?: string;
  jwt: string;
}): Promise<void> {
  const voice = opts.voice ?? "shimmer";
  const key = bubbleCacheKey(opts.text, voice);

  // Tap on already-playing bubble → stop.
  if (_playingKey === key && _currentPlayer) {
    stopPlayback();
    return;
  }

  // Always stop any existing playback before starting new.
  stopPlayback();

  // On native, set audio mode so playback works in silent mode + over
  // calls etc. (no-op on web). Best-effort.
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch {}

  const url = await _fetchAudioBlobUrl(opts.text, voice, opts.jwt);
  const player = createAudioPlayer({ uri: url });
  _currentPlayer = player;
  _notify(key);

  // Auto-clear when the track finishes. expo-audio fires `playbackStatusUpdate`
  // events; we listen for `didJustFinish`.
  const sub = player.addListener("playbackStatusUpdate", (status) => {
    if (status?.didJustFinish) {
      sub?.remove?.();
      if (_currentPlayer === player) {
        _currentPlayer = null;
        _notify(null);
      }
    }
  });
  player.play();
}


export async function ensureAudioPermissions(): Promise<boolean> {
  // No microphone permission needed for playback; we just touch the
  // module so it initializes on first use.
  try {
    return !!AudioModule;
  } catch {
    return false;
  }
}
