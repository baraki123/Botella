/**
 * GET /v1/me — current user info plus deployed-build provenance.
 *
 * Used by the chat screen to show the admin a one-shot build banner
 * the first time they open Layla after a deploy.
 */
import { product } from "../config/product";

export interface MeBuild {
  sha: string;
  note: string;
  commit_time: string;
  boot_time: string;
}

export interface MeResponse {
  user_id: string;
  is_admin: boolean;
  build: MeBuild;
}

export async function fetchMe(jwt: string): Promise<MeResponse | null> {
  try {
    const r = await fetch(`${product.apiUrl}/v1/me`, {
      headers: { Authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return null;
    const body = (await r.json()) as MeResponse;
    return body;
  } catch {
    return null;
  }
}
