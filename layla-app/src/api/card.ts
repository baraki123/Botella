/**
 * Insight-card API — fetches a 1080×1080 PNG rendered by the server
 * from a chunk of Layla's prose. Backend lives at GombiStar's
 * `POST /v1/card/render` (services/insight_card.py:render_card).
 */
import { product } from "../config/product";

/** Fetch the rendered PNG as base64 (no leading data: prefix). The
 *  caller decides what to do with it — typically wrap in a data URL
 *  for inline display, then write to disk via expo-file-system for
 *  Save-to-Photos / system Share. */
export async function renderInsightCard(jwt: string, text: string): Promise<string> {
  const r = await fetch(`${product.apiUrl}/v1/card/render`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => "");
    throw new Error(`render card failed: ${r.status} ${detail.slice(0, 200)}`);
  }
  const buf = await r.arrayBuffer();
  // Manual base64 encode — keeps web + native on the same path. The
  // shared bytesToBase64 helper in lib/base64 already does this for
  // voice playback; reusing it.
  const { bytesToBase64 } = await import("../lib/base64");
  return bytesToBase64(new Uint8Array(buf));
}
