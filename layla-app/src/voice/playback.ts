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
import {
  audioCacheKey,
  fetchAudioUri,
  prefetchAudioUri,
} from "./audioCache";
import { setStopper, stopOthers } from "./coordinator";

// Re-export so the previous import path keeps working (Bubble.tsx etc.
// imports getCurrentJwt from voice/playback). Source of truth lives in
// auth/anonymous.ts next to the other JWT helpers.
export { getCurrentJwt };

const VOICE_TOGGLE_KEY = "layla:voice_playback_enabled";
const VOICE_DEFAULT = false;

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


// Back-compat alias — Bubble.tsx imports bubbleCacheKey from here. The cache
// key now lives in audioCache.ts (shared with the episode player).
export const bubbleCacheKey = audioCacheKey;


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


// Register the bubble stopper so the episode player can silence us (and
// vice-versa) — one voice at a time.
setStopper("bubble", stopPlayback);


// ─── Fetch + play ─────────────────────────────────────────────────────────

/**
 * Fire-and-forget pre-fetch of the TTS audio for a given text. Warms the
 * in-memory cache so a subsequent `togglePlay` is instant (no 15-25s
 * synth wait on first tap). Idempotent: a second call with the same
 * text+voice is a no-op while the first is in flight, or once cached.
 *
 * Gating happens at the caller (ChatScreen) — we only prefetch when:
 *   - voice playback is enabled in Settings (cost),
 *   - the bubble is long enough to render a Listen affordance (≥ 220 chars),
 *   - the bubble has finished streaming.
 *
 * Errors are swallowed silently: if the prefetch fails, the user's
 * eventual Listen tap falls back to the on-demand fetch + surfaces the
 * error on the button.
 */
export async function prefetchAudio(opts: {
  text: string;
  voice?: string;
  jwt: string;
}): Promise<void> {
  await prefetchAudioUri(opts.text, opts.voice ?? "shimmer", opts.jwt);
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

  // Stop our own playback AND any episode playback before starting new.
  stopPlayback();
  stopOthers("bubble");

  // On native, set audio mode so playback works in silent mode + over
  // calls etc. (no-op on web). Best-effort.
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
  } catch (e) {
    console.warn(`[tts] setAudioModeAsync failed:`, e);
  }

  let url: string;
  try {
    url = await fetchAudioUri(opts.text, voice, opts.jwt);
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
