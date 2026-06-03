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

export async function fetchEpisodes(jwt: string): Promise<EpisodesFetchResult> {
  const r = await fetch(`${product.apiUrl}/v1/episodes`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) throw new Error(`fetch episodes failed: ${r.status}`);
  const j = (await r.json()) as { lang?: string; episodes?: Episode[] };
  return {
    lang: j?.lang === "he" ? "he" : "en",
    episodes: Array.isArray(j?.episodes) ? j.episodes : [],
  };
}
