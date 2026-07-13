/**
 * Shared Monday asset helpers.
 *
 * Monday's file endpoints and S3 asset URLs don't send CORS headers, so the
 * browser app relays through our Cloudflare Worker (worker/src/index.js):
 *   - uploads:   POST  <proxy>/
 *   - downloads: GET   <proxy>/asset?url=<encoded asset URL>
 */

export const FILE_PROXY_URL =
  (import.meta.env.VITE_MONDAY_FILE_PROXY_URL as string | undefined) ||
  "https://monday-file-proxy.medically-modern.workers.dev";

/**
 * Download a Monday asset's bytes. Tries a direct fetch first (in case the
 * URL happens to be CORS-readable); Monday's S3 URLs are CORS-blocked in
 * browsers, so on failure it relays through the worker's GET /asset endpoint.
 */
const ASSET_FETCH_TIMEOUT_MS = 25_000;

/** Fetch with an abort timeout so a stalled link can't hang the viewer forever. */
async function fetchWithTimeout(input: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASSET_FETCH_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** True when bytes look like an S3/HTML error page (XML/HTML) rather than a real
 *  file — e.g. an expired signed URL that returns an AccessDenied XML body with a
 *  200 status. Rendering that as a "file" is the silent-blank failure we avoid. */
function looksLikeErrorBody(bytes: Uint8Array, contentType: string | null): boolean {
  const ct = (contentType || "").toLowerCase();
  // Anchored to real error-page MIMEs (application/xml, text/html, …). Do NOT
  // substring-match "xml", or a real Office file whose type merely CONTAINS it
  // (application/vnd.openxmlformats-officedocument… → .docx/.xlsx/.pptx) gets
  // wrongly treated as a corrupt/expired body. The leading-'<' scan below still
  // catches genuine XML/HTML error bodies regardless of content-type.
  if (ct.startsWith("text/html") || ct.startsWith("application/xhtml") ||
      ct.startsWith("text/xml") || ct.startsWith("application/xml")) return true;
  for (let i = 0; i < Math.min(bytes.length, 64); i++) {
    const b = bytes[i];
    // skip leading whitespace + UTF-8 BOM
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d || b === 0xef || b === 0xbb || b === 0xbf) continue;
    return b === 0x3c; // '<' → XML/HTML, not a binary file
  }
  return false;
}

export async function fetchAssetBytes(url: string, name = "file"): Promise<Uint8Array> {
  // Direct fetch first (some URLs are CORS-readable). `no-store` avoids serving a
  // previously-cached error body; we reject error bodies so an expired signed URL
  // returning a 200 XML page falls through to the proxy instead of rendering blank.
  try {
    const res = await fetchWithTimeout(url, { mode: "cors", cache: "no-store" });
    if (res.ok) {
      const buf = new Uint8Array(await res.arrayBuffer());
      if (!looksLikeErrorBody(buf, res.headers.get("content-type"))) return buf;
    }
  } catch {
    /* CORS-blocked / timeout — fall through to the proxy */
  }
  const res = await fetchWithTimeout(`${FILE_PROXY_URL}/asset?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    if (res.status === 405 || res.status === 404) {
      throw new Error(
        `Browser blocked the download of "${name}" (CORS) and the file proxy worker doesn't support downloads yet — deploy the updated worker/src/index.js.`,
      );
    }
    if (res.status === 403) {
      throw new Error(`Couldn't load "${name}" — the file link has expired. Refresh the page and try again.`);
    }
    throw new Error(`Failed to download "${name}" via proxy (${res.status})`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  if (looksLikeErrorBody(buf, res.headers.get("content-type"))) {
    throw new Error(`Couldn't load "${name}" — the file link may have expired. Refresh the page and try again.`);
  }
  return buf;
}
