// Bundle-version probe — bump when we change the playback path so we can
// confirm in logs / on-screen which build is running on the device.
// (When debugging shows "playback v2" in Metro logs, the temp-file fix is
// live; if it shows "playback v1" or undefined, the device is on a stale
// bundle and needs a reload.)
export const PLAYBACK_VERSION = "v2-tempfile";

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

import { getCurrentJwt } from "../auth/anonymous";
import { product } from "../config/product";
import { bytesToBase64 } from "../lib/base64";

// Re-export so the previous import path keeps working (Bubble.tsx etc.
// imports getCurrentJwt from voice/playback). Source of truth lives in
// auth/anonymous.ts next to the other JWT helpers.
export { getCurrentJwt };

const VOICE_TOGGLE_KEY = "layla:voice_playback_enabled";
const VOICE_DEFAULT = false;

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

  let url: string;
  if (Platform.OS === "web" && typeof URL !== "undefined" && URL.createObjectURL) {
    // Web: object URL → <audio>'s src works directly. Blob is fine here.
    const blob = await res.blob();
    url = URL.createObjectURL(blob);
  } else {
    // Native (iOS/Android): AVPlayer / ExoPlayer reject `data:` URIs in
    // practice — passing one to createAudioPlayer stalls in a never-
    // loaded state (the bug: Listen button stuck on "Loading…"). Write
    // the bytes to a real file and play from `file://` instead.
    //
    // RN's Blob doesn't implement `.arrayBuffer()`; read the Response
    // directly via `res.arrayBuffer()`. Then base64 → temp file via
    // expo-file-system/legacy (the typed API on 19+ ships as throwing
    // stubs — see CLAUDE.md).
    const FS = require("expo-file-system/legacy");
    const buf = await res.arrayBuffer();
    const base64 = bytesToBase64(buf);
    // Hash-stable filename so repeated requests reuse the same file.
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
  // Visible breadcrumb in Metro / device logs so we can confirm the
  // bundle has reloaded after frontend ships. Temporary while
  // debugging; remove once playback is stable on iOS native.
  console.log(
    `[tts] togglePlay ${PLAYBACK_VERSION} (Platform.OS=${Platform.OS})`,
  );

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
  } catch (e) {
    console.warn(`[tts] setAudioModeAsync failed:`, e);
  }

  let url: string;
  try {
    url = await _fetchAudioBlobUrl(opts.text, voice, opts.jwt);
    console.log(`[tts] got audio URL (${url.slice(0, 60)}...)`);
  } catch (e) {
    console.warn(`[tts] _fetchAudioBlobUrl FAILED:`, e);
    _notify(null);
    throw e;
  }

  let player: AudioPlayer;
  try {
    player = createAudioPlayer({ uri: url });
  } catch (e) {
    console.warn(`[tts] createAudioPlayer FAILED for url ${url.slice(0, 60)}:`, e);
    _notify(null);
    throw e;
  }

  _currentPlayer = player;
  _notify(key);

  // Auto-clear when the track finishes. expo-audio fires `playbackStatusUpdate`
  // events; we listen for `didJustFinish`. Also log error states so we
  // can see in Metro why playback might fail to start.
  const sub = player.addListener("playbackStatusUpdate", (status: any) => {
    // Status shape varies; log the keys we care about so iOS-native
    // playback failures are diagnosable.
    if (status?.error || status?.didJustFinish || status?.isLoaded === false) {
      console.log(
        `[tts] status: loaded=${status?.isLoaded} playing=${status?.playing} `
        + `finished=${status?.didJustFinish} error=${status?.error}`,
      );
    }
    if (status?.didJustFinish) {
      sub?.remove?.();
      if (_currentPlayer === player) {
        _currentPlayer = null;
        _notify(null);
      }
    }
  });

  try {
    player.play();
  } catch (e) {
    console.warn(`[tts] player.play() FAILED:`, e);
    _notify(null);
    throw e;
  }
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
