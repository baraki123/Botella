// Episode player — plays an episode as ONE continuous stitched audio track
// (chapters concatenated server-side) with chapter start offsets, so a "skip to
// chapter" is just a seek to that chapter's start time — instant, no per-chapter
// loading. Like a real podcast.
//
// One voice at a time: starting playback stops the bubble "Listen" player via
// the coordinator (and registers our own stopper so the bubble can stop us).

import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from "expo-audio";

import { fetchEpisodeTrack, type EpisodeChapterMark } from "../api/episodes";
import { setStopper, stopOthers } from "./coordinator";

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
  chapters: EpisodeChapterMark[]; // {title, start} over the whole track
  index: number; // current chapter, derived from position
  status: PlayerStatus;
  positionSec: number; // GLOBAL position in the episode
  durationSec: number; // total episode length
  rate: number;
  error: string | null;
}

export interface LoadOptions {
  episodeId: string;
  episodeTitle?: string;
  jwt: string;
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
let _loadToken = 0;

function _emit(patch: Partial<PlayerState>) {
  _state = { ..._state, ...patch };
  for (const cb of _subs) cb(_state);
}

function _chapterIndexAt(posSec: number): number {
  const ch = _state.chapters;
  let idx = 0;
  for (let i = 0; i < ch.length; i++) {
    if (ch[i].start <= posSec + 0.25) idx = i;
    else break;
  }
  return idx;
}

function _clearPoll() {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

function _startPoll() {
  // expo-audio fires playbackStatusUpdate, but its cadence is coarse on web.
  // Poll currentTime while playing so the scrubber + active chapter track
  // smoothly. Cheap (4×/s, only while playing).
  _clearPoll();
  _pollTimer = setInterval(() => {
    const p = _player as any;
    if (!p) return;
    const position = typeof p.currentTime === "number" ? p.currentTime : _state.positionSec;
    const idx = _chapterIndexAt(position);
    if (position !== _state.positionSec || idx !== _state.index) {
      _emit({ positionSec: position, index: idx });
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

function _attachStatus(player: AudioPlayer, token: number) {
  _statusSub = player.addListener("playbackStatusUpdate", (status: any) => {
    if (token !== _loadToken) return;
    const patch: Partial<PlayerState> = {};
    if (typeof status?.currentTime === "number") {
      patch.positionSec = status.currentTime;
      patch.index = _chapterIndexAt(status.currentTime);
    }
    if (typeof status?.duration === "number" && status.duration > 0) {
      patch.durationSec = status.duration;
    }
    if (Object.keys(patch).length) _emit(patch);
    if (status?.didJustFinish) {
      _clearPoll();
      _emit({ status: "ended" });
    }
  });
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

function _seek(sec: number) {
  if (!_player) return;
  const clamped = Math.max(0, _state.durationSec > 0 ? Math.min(sec, _state.durationSec) : sec);
  try {
    (_player as any).seekTo?.(clamped);
  } catch {}
  _emit({
    positionSec: clamped,
    index: _chapterIndexAt(clamped),
    status: _state.status === "ended" ? "paused" : _state.status,
  });
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
    const startPos = opts.startPositionSec ?? 0;
    _state = {
      episodeId: opts.episodeId,
      episodeTitle: opts.episodeTitle ?? "",
      chapters: [],
      index: 0,
      status: "loading",
      positionSec: startPos,
      durationSec: 0,
      rate: _state.rate, // keep the user's chosen rate across episodes
      error: null,
    };
    for (const cb of _subs) cb(_state);

    let track;
    try {
      track = await fetchEpisodeTrack(opts.jwt, opts.episodeId);
    } catch (e: any) {
      if (token !== _loadToken) return;
      _emit({ status: "error", error: String(e?.message || e) });
      return;
    }
    if (token !== _loadToken) return;

    try {
      _player = createAudioPlayer({ uri: track.audioUri });
      _attachStatus(_player, token);
    } catch (e: any) {
      _emit({ status: "error", error: String(e?.message || e) });
      return;
    }
    _applyRate(_player);
    if (startPos > 0) {
      try {
        await (_player as any).seekTo?.(startPos);
      } catch {}
    }
    if (token !== _loadToken) return;
    _emit({
      chapters: track.chapters,
      durationSec: track.total,
      positionSec: startPos,
      index: _chapterIndexAt(startPos),
      status: "paused",
    });
  },

  play(): void {
    if (_state.status === "ended") _seek(0);
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
    _seek(sec);
  },

  jumpTo(index: number): void {
    const ch = _state.chapters[index];
    if (!ch) return;
    _seek(ch.start);
  },

  next(): void {
    const i = _state.index + 1;
    if (i < _state.chapters.length) this.jumpTo(i);
  },

  prev(): void {
    const cur = _state.chapters[_state.index];
    const intoChapter = cur ? _state.positionSec - cur.start : _state.positionSec;
    if (intoChapter > PREV_RESTART_THRESHOLD_SEC) {
      this.jumpTo(_state.index);
      return;
    }
    const i = _state.index - 1;
    if (i >= 0) this.jumpTo(i);
    else _seek(0);
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
    _loadToken++; // invalidate any in-flight load
    _detachPlayer();
    _emit({ status: "idle", positionSec: 0 });
  },
};

// Let the bubble player silence us when it starts.
setStopper("episode", () => episodePlayer.pause());
