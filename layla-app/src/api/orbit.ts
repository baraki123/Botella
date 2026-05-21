/**
 * Orbit API client — the People tab reads from these endpoints.
 *
 * Backend lives in GombiStar's bot_botella.py:
 *   GET    /v1/orbit             → { people: OrbitPerson[] }
 *   DELETE /v1/orbit/:personId   → { ok, removed }
 *
 * Both endpoints are JWT-protected via the standard Bearer header. The
 * server already projects internal OrbitPerson dicts to the shape below
 * (no nulls, synastry capped at 5 strongest), so the client doesn't have
 * to defend against missing fields — empty strings come back instead.
 */
import { product } from "../config/product";

export interface OrbitPersonSynastryAspect {
  a?: string;
  b?: string;
  aspect?: string;
  orb?: number;
  meaning?: string;
}

export interface OrbitPerson {
  id: string;
  name: string;
  role: string;
  birth_data_status: "none" | "partial" | "full";
  has_chart: boolean;
  birth_date: string;
  birth_time: string;
  birth_place: string;
  current_dynamic: string;
  current_relationship_theme: string;
  /** Cached person-snapshot LLM output from the orbit-add flow. */
  snapshot?: string;
  /** Cached compatibility reading from the orbit-add flow. */
  compatibility_reading?: string;
  synastry_aspects: OrbitPersonSynastryAspect[];
  created_at: string;
  updated_at: string;
  /** Invite link minted when this person was added (or post-add).
   * Empty string if no token has been minted yet. iOS PersonDetailView
   * uses this to render the "Send NAME the link" share CTA. */
  invite_url?: string;
  invite_token?: string;
}

export interface OrbitFetchResult {
  /** User's preferred language (server-projected from session record).
   * "en" | "he" today; falls back to "en" for users whose record predates
   * the lang field. iOS uses this to render share-CTA copy correctly. */
  lang: string;
  people: OrbitPerson[];
}

export async function fetchOrbit(jwt: string): Promise<OrbitFetchResult> {
  const r = await fetch(`${product.apiUrl}/v1/orbit`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) throw new Error(`fetch orbit failed: ${r.status}`);
  const j = (await r.json()) as { lang?: string; people?: OrbitPerson[] };
  return {
    lang: j?.lang === "he" ? "he" : "en",
    people: Array.isArray(j?.people) ? j.people : [],
  };
}

export async function deleteOrbitPerson(jwt: string, id: string): Promise<void> {
  const r = await fetch(`${product.apiUrl}/v1/orbit/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) throw new Error(`delete orbit person failed: ${r.status}`);
}
