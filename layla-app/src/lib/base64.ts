/**
 * Base64 conversion for binary blobs that need to land in
 * `expo-file-system/legacy.writeAsStringAsync` (which expects a base64
 * string with `encoding: Base64`).
 *
 * Why a helper: two callers (chat/ImageLightbox.tsx, voice/playback.ts)
 * both fetch raw bytes from the network and need to write them as
 * `file://` URIs on iOS / Android (data: URIs and direct Blob writes
 * don't work with AVPlayer / SDImage in practice). Both used to do
 * the same byte-by-byte loop inline; centralising avoids the foot-gun
 * of "did the unchunked variant slip back in" — large payloads (>~64KB)
 * stack-overflow `String.fromCharCode.apply` if not chunked.
 *
 * Hermes ships `btoa` as a global (via `react-native-get-random-values`
 * polyfill chain we already import in `index.ts`). Web has it natively.
 */

const CHUNK = 0x8000;


/** Convert a Uint8Array (or ArrayBuffer) to a base64 string. Chunked
 * to avoid the stack-overflow that hits `String.fromCharCode.apply`
 * on large buffers (>~64KB). */
export function bytesToBase64(input: Uint8Array | ArrayBuffer): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      bytes.subarray(i, i + CHUNK) as any,
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any;
  return g.btoa
    ? g.btoa(bin)
    : Buffer.from(bin, "binary").toString("base64");
}
