// React binding for the episode player singleton (player.ts). Subscribes to
// player state and exposes bound controls so the EpisodePlayerView stays
// declarative.

import { useEffect, useState } from "react";

import { episodePlayer, type LoadOptions, type PlayerState } from "./player";

export function usePlayer() {
  const [state, setState] = useState<PlayerState>(() => episodePlayer.getState());

  useEffect(() => episodePlayer.subscribe(setState), []);

  return {
    ...state,
    load: (opts: LoadOptions) => episodePlayer.load(opts),
    play: () => episodePlayer.play(),
    pause: () => episodePlayer.pause(),
    toggle: () => episodePlayer.toggle(),
    next: () => episodePlayer.next(),
    prev: () => episodePlayer.prev(),
    jumpTo: (i: number) => episodePlayer.jumpTo(i),
    seekTo: (s: number) => episodePlayer.seekTo(s),
    setRate: (r: number) => episodePlayer.setRate(r),
    cycleRate: () => episodePlayer.cycleRate(),
    stop: () => episodePlayer.stop(),
  };
}
