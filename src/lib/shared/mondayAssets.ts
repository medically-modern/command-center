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
  "https://monday-file-proxy.medicallymodern.workers.dev";

/**
 * Download a Monday asset's bytes. Tries a direct fetch first (in case the
 * URL happens to be CORS-readable); Monday's S3 URLs are CORS-blocked in
 * browsers, so on failure it relays through the worker's GET /asset endpoint.
 */
export async function fetchAssetBytes(url: string, name = "file"): Promise<Uint8Array> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (res.ok) return new Uint8Array(await res.arrayBuffer());
  } catch {
    /* CORS-blocked — fall through to the proxy */
  }
  const res = await fetch(`${FILE_PROXY_URL}/asset?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    if (res.status === 405 || res.status === 404) {
      throw new Error(
        `Browser blocked the download of "${name}" (CORS) and the file proxy worker doesn't support downloads yet — deploy the updated worker/src/index.js.`,
      );
    }
    throw new Error(`Failed to download "${name}" via proxy (${res.status})`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
