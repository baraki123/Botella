// One voice at a time. Both the bubble "Listen" player (playback.ts) and the
// episode player (player.ts) register a stop handler here; whenever one starts
// playing it calls stopOthers(ownerId) so the other goes silent. This lives in
// its own module so playback.ts and player.ts don't import each other (which
// would be a cycle).

type Stopper = () => void;

const _registry = new Map<string, Stopper>();

export function setStopper(owner: string, fn: Stopper): void {
  _registry.set(owner, fn);
}

export function stopOthers(owner: string): void {
  for (const [key, fn] of _registry) {
    if (key === owner) continue;
    try {
      fn();
    } catch {
      // best effort — a failing stopper must not block the new playback
    }
  }
}
