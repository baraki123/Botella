// Episode player — a chapter-queue engine over a single expo-audio AudioPlayer.
//
// An episode is a list of chapters; each chapter is synthesized on demand via
// the shared TTS cache (audioCache.ts), one chapter at a time. The player:
//   - prepares chapter 0 (and prefetches chapter 1) on load,
//   - plays / pauses / seeks within the current chapter,
//   - sets playback rate (1×–2×),
//   - skips prev/next and jumps to any chapter,
//   - auto-advances when a chapter finishes, prefetching the next while the
//     current plays (so synth latency is hidden behind playback),
//   - notifies subscribers of position/duration/status changes.
//
// One voice at a time: starting playback stops the bubble "Listen" player via
// the coordinator (and registers our own stopper so the bubble can stop us).

import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from "expo-audio";

import { fetchAudioUri, prefetchAudioUri } from "./audioCache";
import { setStopper, stopOthers } from "./coordinator";

export interface ChapterRef {
  title: string;
  text: string;
  charCount?: number;
}

export type PlayerStatus =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "ended"
  | "error";

export interface PlayerState {
  episodeId: string | null;
  episodeTitle: string;
  chapters: ChapterRef[];
  index: number;
  status: PlayerStatus;
  positionSec: number;
  durationSec: number;
  rate: number;
  error: string | null;
}

export interface LoadOptions {
  episodeId: string;
  episodeTitle?: string;
  chapters: ChapterRef[];
  voice?: string;
  jwt: string;
  startIndex?: number;
  startPositionSec?: number;
}

export const RATE_STEPS = [1, 1.25, 1.5, 1.75, 2] as const;
const PREV_RESTART_THRESHOLD_SEC = 3;

let _state: PlayerState = {
  episodeId: null,
  episodeTitle: "",
  chapters: [],
  index: 0,
  status: "idle",
  positionSec: 0,
  durationSec: 0,
  rate: 1,
  error: null,
};

const _subs = new Set<(s: PlayerState) => void>();
let _player: AudioPlayer | null = null;
let _statusSub: { remove?: () => void } | null = null;
let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _voice = "shimmer";
let _jwt = "";
// Monotonic token so a stale async load/advance can't clobber a newer one.
let _loadToken = 0;

function _emit(patch: Partial<PlayerState>) {
  _state = { ..._state, ...patch };
  for (const cb of _subs) cb(_state);
}

function _clearPoll() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

function _startPoll() {
  // expo-audio fires playbackStatusUpdate, but its cadence is coarse on web.
  // Poll the player's currentTime/duration while playing so the scrubber moves
  // smoothly. Cheap (4×/s, only while playing).
  _clearPoll();
  _pollTimer = setInterval(() => {
    const p = _player as any;
    if (!p) return;
    const position = typeof p.currentTime === "number" ? p.currentTime : _state.positionSec;
    const duration =
      typeof p.duration === "number" && p.duration > 0 ? p.duration : _state.durationSec;
    if (position !== _state.positionSec || duration !== _state.durationSec) {
      _emit({ positionSec: position, durationSec: duration });
    }
  }, 250);
}

function _detachPlayer() {
  _clearPoll();
  try {
    _statusSub?.remove?.();
  } catch {}
  _statusSub = null;
  if (_player) {
    try {
      _player.pause();
    } catch {}
    try {
      (_player as any).remove?.();
    } catch {}
    _player = null;
  }
}

function _attachStatus(player: AudioPlayer, token: number) {
  _statusSub = player.addListener("playbackStatusUpdate", (status: any) => {
    if (token !== _loadToken) return;
    const patch: Partial<PlayerState> = {};
    if (typeof status?.currentTime === "number") patch.positionSec = status.currentTime;
    if (typeof status?.duration === "number" && status.duration > 0) {
      patch.durationSec = status.duration;
    }
    if (Object.keys(patch).length) _emit(patch);
    if (status?.didJustFinish) {
      _onChapterFinished(token);
    }
  });
}

function _applyRate(player: AudioPlayer | null) {
  if (!player) return;
  // shouldCorrectPitch keeps sped-up speech natural-pitched (no chipmunk).
  try {
    (player as any).shouldCorrectPitch = true;
  } catch {}
  try {
    (player as any).setPlaybackRate?.(_state.rate, "high");
  } catch {}
}

async function _loadChapterIntoPlayer(
  index: number,
  token: number,
  autoplay: boolean,
  startPositionSec = 0,
): Promise<void> {
  const chapter = _state.chapters[index];
  if (!chapter) return;
  // Stop the CURRENT chapter's audio immediately so a jump/skip doesn't keep
  // playing the old chapter while the new one loads. Show loading on the new
  // chapter (index updates now; the UI shows the new title + a spinner).
  _clearPoll();
  try {
    _player?.pause();
  } catch {}
  _emit({ status: "loading", index, positionSec: startPositionSec, durationSec: 0, error: null });

  let uri: string;
  try {
    uri = await fetchAudioUri(chapter.text, _voice, _jwt);
  } catch (e: any) {
    if (token !== _loadToken) return;
    _emit({ status: "error", error: String(e?.message || e) });
    return;
  }
  if (token !== _loadToken) return;

  // Swap source on the existing player if supported, else recreate.
  try {
    const p = _player as any;
    if (p && typeof p.replace === "function") {
      p.replace({ uri });
    } else {
      _detachPlayer();
      _player = createAudioPlayer({ uri });
      _attachStatus(_player, token);
    }
  } catch {
    _detachPlayer();
    _player = createAudioPlayer({ uri });
    _attachStatus(_player, token);
  }

  // Apply rate + seek (best-effort; not all platforms honor every call).
  _applyRate(_player);
  if (startPositionSec > 0) {
    try {
      await (_player as any)?.seekTo?.(startPositionSec);
    } catch {}
  }

  if (token !== _loadToken) return;

  if (autoplay) {
    _play();
  } else {
    _emit({ status: "paused" });
  }

  // Pipeline: warm the next chapter while this one plays.
  const next = _state.chapters[index + 1];
  if (next) prefetchAudioUri(next.text, _voice, _jwt);
}

function _onChapterFinished(token: number) {
  if (token !== _loadToken) return;
  const nextIndex = _state.index + 1;
  if (nextIndex < _state.chapters.length) {
    _loadChapterIntoPlayer(nextIndex, token, true, 0);
  } else {
    _clearPoll();
    _emit({ status: "ended", positionSec: _state.durationSec });
  }
}

function _play() {
  if (!_player) return;
  stopOthers("episode");
  setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  try {
    _player.play();
    _emit({ status: "playing" });
    _startPoll();
  } catch (e: any) {
    _emit({ status: "error", error: String(e?.message || e) });
  }
}

function _pause() {
  _clearPoll();
  if (!_player) return;
  try {
    _player.pause();
  } catch {}
  _emit({ status: "paused" });
}

export const episodePlayer = {
  getState(): PlayerState {
    return _state;
  },

  subscribe(cb: (s: PlayerState) => void): () => void {
    _subs.add(cb);
    cb(_state);
    return () => _subs.delete(cb);
  },

  async load(opts: LoadOptions): Promise<void> {
    const token = ++_loadToken;
    stopOthers("episode");
    _detachPlayer();
    _voice = opts.voice ?? "shimmer";
    _jwt = opts.jwt;
    const startIndex = Math.min(
      Math.max(0, opts.startIndex ?? 0),
      Math.max(0, opts.chapters.length - 1),
    );
    _state = {
      episodeId: opts.episodeId,
      episodeTitle: opts.episodeTitle ?? "",
      chapters: opts.chapters,
      index: startIndex,
      status: "loading",
      positionSec: opts.startPositionSec ?? 0,
      durationSec: 0,
      rate: _state.rate, // keep the user's chosen rate across episodes
      error: null,
    };
    for (const cb of _subs) cb(_state);
    if (!opts.chapters.length) {
      _emit({ status: "error", error: "Episode has no chapters" });
      return;
    }
    // Prepare (don't autoplay — web blocks autoplay outside a user gesture;
    // the play disc tap will start it).
    await _loadChapterIntoPlayer(startIndex, token, false, opts.startPositionSec ?? 0);
    // Prefetch the rest of the episode SEQUENTIALLY (one at a time) so chapter
    // jumps become instant without a 9-request burst saturating the browser's
    // ~6-connection limit — that burst was leaving an on-demand jump stuck
    // behind the others. The in-flight dedup (audioCache) means a jump to a
    // chapter still prefetching awaits the same request instead of duplicating.
    void (async () => {
      for (let i = 0; i < opts.chapters.length; i++) {
        if (token !== _loadToken) return; // a newer load superseded us
        if (i === startIndex) continue;
        await prefetchAudioUri(opts.chapters[i].text, _voice, _jwt);
      }
    })();
  },

  play(): void {
    if (_state.status === "ended") {
      // Replay from the top of the current chapter.
      this.seekTo(0);
    }
    _play();
  },
  pause(): void {
    _pause();
  },
  toggle(): void {
    if (_state.status === "playing") _pause();
    else this.play();
  },

  seekTo(sec: number): void {
    if (!_player) return;
    const clamped = Math.max(0, sec);
    try {
      (_player as any).seekTo?.(clamped);
    } catch {}
    _emit({ positionSec: clamped, status: _state.status === "ended" ? "paused" : _state.status });
  },

  async next(): Promise<void> {
    const i = _state.index + 1;
    if (i < _state.chapters.length) {
      await _loadChapterIntoPlayer(i, _loadToken, _state.status === "playing", 0);
    }
  },

  async prev(): Promise<void> {
    if (_state.positionSec > PREV_RESTART_THRESHOLD_SEC) {
      this.seekTo(0);
      return;
    }
    const i = _state.index - 1;
    if (i >= 0) {
      await _loadChapterIntoPlayer(i, _loadToken, _state.status === "playing", 0);
    } else {
      this.seekTo(0);
    }
  },

  async jumpTo(index: number): Promise<void> {
    if (index < 0 || index >= _state.chapters.length) return;
    await _loadChapterIntoPlayer(index, _loadToken, true, 0);
  },

  setRate(rate: number): void {
    _emit({ rate });
    _applyRate(_player);
  },

  cycleRate(): void {
    const idx = RATE_STEPS.indexOf(_state.rate as (typeof RATE_STEPS)[number]);
    const nextRate = RATE_STEPS[(idx + 1) % RATE_STEPS.length];
    this.setRate(nextRate);
  },

  stop(): void {
    _loadToken++; // invalidate any in-flight load/advance
    _detachPlayer();
    _emit({ status: "idle", positionSec: 0 });
  },
};

// Let the bubble player silence us when it starts.
setStopper("episode", () => episodePlayer.pause());
