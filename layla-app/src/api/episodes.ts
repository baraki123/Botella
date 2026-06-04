/**
 * Episodes API client — the podcast shelf reads from GET /v1/episodes.
 *
 * Backend lives in GombiStar's bot_botella.py + services/episodes.py:
 *   GET /v1/episodes → { lang, episodes: Episode[] }
 *
 * Each episode is metadata + chapter TEXT (no audio). The client
 * synthesizes audio per chapter via /v1/tts/synthesize (player.ts),
 * prefetching the next chapter while the current plays.
 */
import { product } from "../config/product";

export interface EpisodeChapter {
  title: string;
  text: string;
  char_count: number;
}

export interface Episode {
  id: string;
  type: string;
  title: string;
  subtitle: string | null;
  chapters: EpisodeChapter[];
  created_at: string | null;
}

export interface EpisodesFetchResult {
  lang: string;
  episodes: Episode[];
}

// The backend can cold-start (~30s) when it's been idle, so give the request a
// generous timeout rather than letting the shelf spin forever. 50s clears a
// cold start; beyond that we surface a retry.
const EPISODES_TIMEOUT_MS = 50_000;

export async function fetchEpisodes(jwt: string): Promise<EpisodesFetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EPISODES_TIMEOUT_MS);
  let r: Response;
  try {
    r = await fetch(`${product.apiUrl}/v1/episodes`, {
      headers: { Authorization: `Bearer ${jwt}` },
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("The server took too long to wake up. Tap to try again.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) throw new Error(`fetch episodes failed: ${r.status}`);
  const j = (await r.json()) as { lang?: string; episodes?: Episode[] };
  return {
    lang: j?.lang === "he" ? "he" : "en",
    episodes: Array.isArray(j?.episodes) ? j.episodes : [],
  };
}

/** Wake the backend (cheap, unauth'd) so a subsequent /v1/episodes call hits a
 * warm instance instead of cold-starting. Fire-and-forget. */
export function prewarmBackend(): void {
  fetch(`${product.apiUrl}/healthz`).catch(() => {});
}

export interface EpisodeChapterMark {
  title: string;
  start: number; // seconds into the stitched episode
}

export interface EpisodeTrack {
  audioUri: string;
  total: number;
  chapters: EpisodeChapterMark[];
}

// The first fetch triggers the server to synthesize + stitch all chapters
// (cached after), so allow generous time before surfacing a retry.
const TRACK_TIMEOUT_MS = 70_000;

/**
 * Fetch an episode as ONE stitched audio track + chapter start offsets. Meta
 * first (this triggers the server build), then the audio (served from the
 * server's cache). Returns a playable audioUri + the chapter marks.
 */
export async function fetchEpisodeTrack(
  jwt: string,
  episodeId: string,
): Promise<EpisodeTrack> {
  const { responseToPlayableUri } = await import("../voice/audioCache");
  const headers = { Authorization: `Bearer ${jwt}` };
  const q = `id=${encodeURIComponent(episodeId)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TRACK_TIMEOUT_MS);
  try {
    const mr = await fetch(`${product.apiUrl}/v1/episode-track-meta?${q}`, {
      headers,
      signal: controller.signal,
    });
    if (!mr.ok) throw new Error(`track meta failed: ${mr.status}`);
    const meta = (await mr.json()) as { total?: number; chapters?: EpisodeChapterMark[] };
    const ar = await fetch(`${product.apiUrl}/v1/episode-track?${q}`, {
      headers,
      signal: controller.signal,
    });
    if (!ar.ok) throw new Error(`track audio failed: ${ar.status}`);
    const audioUri = await responseToPlayableUri(ar, episodeId);
    return {
      audioUri,
      total: typeof meta?.total === "number" ? meta.total : 0,
      chapters: Array.isArray(meta?.chapters) ? meta.chapters : [],
    };
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("The episode took too long to prepare. Tap to try again.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
