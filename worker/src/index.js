/**
 * monday-file-proxy — Cloudflare Worker
 *
 * Monday.com's file endpoints don't send CORS headers, so the browser app
 * (GitHub Pages) can't talk to them directly. This worker relays:
 *
 *   POST /            → https://api.monday.com/v2/file   (file uploads)
 *   GET  /asset?url=… → Monday asset download (S3 / protected_static)
 *                       Used by per-file delete (download-keep-clear-reupload)
 *                       and the Download buttons.
 *
 * The /asset endpoint only proxies Monday-owned hosts (allowlist below) so
 * this can't be abused as an open proxy.
 *
 * Deploy:  cd worker && npx wrangler deploy
 */

const ALLOWED_ORIGINS = [
  "https://medically-modern.github.io",
  "http://localhost:5173",
  "http://localhost:8080",
];

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

/** Only Monday-owned asset hosts may be proxied. */
function isAllowedAssetHost(hostname) {
  if (hostname === "files-monday-com.s3.amazonaws.com") return true;
  // Regional S3 variants, e.g. files-monday-com.s3.us-east-1.amazonaws.com
  if (hostname.startsWith("files-monday-com.s3") && hostname.endsWith(".amazonaws.com")) return true;
  // protected_static asset URLs live on *.monday.com
  if (hostname === "monday.com" || hostname.endsWith(".monday.com")) return true;
  return false;
}

export default {
  async fetch(request) {
    const cors = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);

    // ── GET /asset?url=<encoded Monday asset URL> ───────────────────────
    if (request.method === "GET" && url.pathname === "/asset") {
      const target = url.searchParams.get("url");
      if (!target) {
        return new Response("Missing url param", { status: 400, headers: cors });
      }
      let targetUrl;
      try {
        targetUrl = new URL(target);
      } catch {
        return new Response("Invalid url param", { status: 400, headers: cors });
      }
      if (targetUrl.protocol !== "https:" || !isAllowedAssetHost(targetUrl.hostname)) {
        return new Response("Host not allowed", { status: 403, headers: cors });
      }

      const upstream = await fetch(targetUrl.toString(), {
        // Forward auth if the client sent it (protected_static URLs).
        headers: request.headers.has("Authorization")
          ? { Authorization: request.headers.get("Authorization") }
          : {},
      });
      if (!upstream.ok) {
        return new Response(`Upstream ${upstream.status}`, {
          status: upstream.status,
          headers: cors,
        });
      }
      return new Response(upstream.body, {
        status: 200,
        headers: {
          ...cors,
          "Content-Type": upstream.headers.get("Content-Type") || "application/octet-stream",
          "Cache-Control": "no-store",
        },
      });
    }

    // ── POST / — relay multipart upload to Monday's file API ────────────
    if (request.method === "POST") {
      const token = request.headers.get("Authorization");
      if (!token) {
        return new Response("Missing Authorization header", { status: 401, headers: cors });
      }
      const headers = { Authorization: token };
      // Multipart boundary lives in Content-Type — must be forwarded.
      const ct = request.headers.get("Content-Type");
      if (ct) headers["Content-Type"] = ct;
      const upstream = await fetch("https://api.monday.com/v2/file", {
        method: "POST",
        headers,
        body: request.body,
      });
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: {
          ...cors,
          "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        },
      });
    }

    return new Response("Method not allowed", { status: 405, headers: cors });
  },
};
