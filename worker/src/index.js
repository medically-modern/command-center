/**
 * monday-file-proxy — Cloudflare Worker
 *
 * Routes:
 *   GET  /asset?url=…   → Monday asset download (allowlisted Monday hosts)
 *   POST /              → relay multipart upload to Monday's file API
 *   POST /send-message  → send an email (with attachments) as GMAIL_SENDER via
 *                         the Gmail API. Used by the Send Request composer.
 *                         Recipients may be normal emails OR <number>@rcfax.com
 *                         (RingCentral turns those into faxes). Gated to
 *                         signed-in medicallymodern.com users (no open relay).
 *
 * Secrets (wrangler secret put …):
 *   GMAIL_CLIENT_ID  GMAIL_CLIENT_SECRET  GMAIL_REFRESH_TOKEN  GMAIL_SENDER
 *   GMAIL_SENDER e.g. records@medicallymodern.com
 *
 * Deploy:  cd worker && npx wrangler deploy
 */

const ALLOWED_ORIGINS = [
  "https://medically-modern.github.io",
  "http://localhost:5173",
  "http://localhost:8080",
];
const ALLOWED_SENDER_DOMAIN = "medicallymodern.com";

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-MM-Auth",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** Only Monday-owned asset hosts may be proxied. */
function isAllowedAssetHost(hostname) {
  if (hostname === "files-monday-com.s3.amazonaws.com") return true;
  if (hostname.startsWith("files-monday-com.s3") && hostname.endsWith(".amazonaws.com")) return true;
  if (hostname === "monday.com" || hostname.endsWith(".monday.com")) return true;
  return false;
}

// ── Gmail helpers ───────────────────────────────────────────────────
async function getGmailAccessToken(env) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID,
      client_secret: env.GMAIL_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    throw new Error(`Gmail token exchange failed (${r.status}): ${JSON.stringify(j).slice(0, 200)}`);
  }
  return j.access_token;
}

/** ArrayBuffer → base64 (chunked to avoid call-stack limits). */
function bytesToBase64(buf) {
  const arr = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    bin += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
  }
  return btoa(bin);
}
const foldB64 = (s) => s.replace(/(.{76})/g, "$1\r\n");
/** String → base64 of its UTF-8 bytes (keeps non-ASCII intact in headers/bodies). */
const strB64 = (s) => bytesToBase64(new TextEncoder().encode(String(s ?? "")).buffer);
/** Address headers (From/To): strip CR/LF only — must stay a valid addr-spec. */
const cleanAddr = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").trim();
/** Text headers (Subject): RFC 2047 encoded-word when non-ASCII, else plain.
 *  Without this a UTF-8 em-dash / smart quote in the subject renders as mojibake. */
const encHeader = (s) => {
  const str = String(s ?? "").replace(/[\r\n]+/g, " ").trim();
  // eslint-disable-next-line no-control-regex
  return /[^\x00-\x7F]/.test(str) ? `=?UTF-8?B?${strB64(str)}?=` : str;
};
const htmlEscape = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Plain body → clean HTML: blank lines become paragraphs, single newlines <br>.
 *  Long lines reflow naturally (no forced wrapping). */
function bodyToHtml(body) {
  const paras = htmlEscape(body || "")
    .split(/\r?\n\r?\n/)
    .map((p) => `<p style="margin:0 0 12px;">${p.replace(/\r?\n/g, "<br>")}</p>`)
    .join("");
  return (
    '<!doctype html><html><body style="margin:0;padding:0;">' +
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;">' +
    paras +
    "</div></body></html>"
  );
}
/** multipart/alternative body part (UTF-8 plain + HTML, both base64). */
function altPart(body) {
  const alt = "alt_" + Math.random().toString(36).slice(2);
  return [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    foldB64(strB64(body || "")),
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    foldB64(strB64(bodyToHtml(body || ""))),
    `--${alt}--`,
  ];
}

/** Build an RFC-822 message — HTML+text body, optional base64 attachments. */
function buildMime({ from, to, subject, body, attachments }) {
  const headers = [
    `From: ${cleanAddr(from)}`,
    `To: ${cleanAddr(to)}`,
    `Subject: ${encHeader(subject)}`,
    "MIME-Version: 1.0",
  ];
  if (!attachments.length) {
    return [...headers, ...altPart(body)].join("\r\n");
  }
  const b = "mm_" + Math.random().toString(36).slice(2);
  const L = [...headers, `Content-Type: multipart/mixed; boundary="${b}"`, "", `--${b}`, ...altPart(body), ""];
  for (const a of attachments) {
    L.push(`--${b}`);
    L.push(`Content-Type: ${a.type || "application/octet-stream"}; name="${a.name}"`);
    L.push("Content-Transfer-Encoding: base64");
    L.push(`Content-Disposition: attachment; filename="${a.name}"`);
    L.push("");
    L.push(foldB64(a.b64));
  }
  L.push(`--${b}--`);
  return L.join("\r\n");
}

/** Verify the caller's Google ID token via tokeninfo; return their email if
 *  it's a verified medicallymodern.com user, else null. Prevents open relay. */
async function verifyIdToken(idToken) {
  if (!idToken) return null;
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken));
    if (!r.ok) return null;
    const c = await r.json();
    const email = String(c.email || "").toLowerCase();
    const ok =
      (c.email_verified === true || c.email_verified === "true") &&
      (c.hd === ALLOWED_SENDER_DOMAIN || email.endsWith("@" + ALLOWED_SENDER_DOMAIN));
    return ok ? email : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);

    // ── POST /send-message — send email as GMAIL_SENDER via Gmail API ──
    if (request.method === "POST" && url.pathname === "/send-message") {
      const actor = await verifyIdToken(request.headers.get("X-MM-Auth"));
      if (!actor) {
        return json({ error: "Sign in with your medicallymodern.com account is required." }, 401, cors);
      }
      if (!env.GMAIL_REFRESH_TOKEN || !env.GMAIL_SENDER) {
        return json({ error: "Gmail sending is not configured on the server (missing secrets)." }, 503, cors);
      }
      let form;
      try {
        form = await request.formData();
      } catch {
        return json({ error: "Expected multipart/form-data." }, 400, cors);
      }
      let recipients;
      try {
        recipients = JSON.parse(form.get("recipients") || "[]");
      } catch {
        return json({ error: "recipients must be a JSON array." }, 400, cors);
      }
      recipients = (Array.isArray(recipients) ? recipients : [])
        .map((s) => String(s).trim())
        .filter(Boolean);
      if (!recipients.length) return json({ error: "No recipients provided." }, 400, cors);

      const subject = form.get("subject") || "";
      const body = form.get("body") || "";
      const attachments = [];
      for (const f of form.getAll("files")) {
        if (typeof f === "string") continue;
        attachments.push({ name: f.name || "attachment", type: f.type, b64: bytesToBase64(await f.arrayBuffer()) });
      }

      let accessToken;
      try {
        accessToken = await getGmailAccessToken(env);
      } catch (e) {
        return json({ error: String(e.message || e) }, 502, cors);
      }

      // One message per recipient — keeps addresses private and lets each
      // @rcfax fax independently.
      const results = [];
      for (const to of recipients) {
        const mime = buildMime({ from: env.GMAIL_SENDER, to, subject, body, attachments });
        const resp = await fetch(
          "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media",
          { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "message/rfc822" }, body: mime },
        );
        const jr = await resp.json().catch(() => ({}));
        results.push({ to, ok: resp.ok, id: jr.id || null, error: resp.ok ? null : (jr.error?.message || `HTTP ${resp.status}`) });
      }
      const allOk = results.every((r) => r.ok);
      return json({ ok: allOk, sender: env.GMAIL_SENDER, actor, results }, allOk ? 200 : 207, cors);
    }

    // ── GET /asset?url=<encoded Monday asset URL> ───────────────────────
    if (request.method === "GET" && url.pathname === "/asset") {
      const target = url.searchParams.get("url");
      if (!target) return new Response("Missing url param", { status: 400, headers: cors });
      let targetUrl;
      try { targetUrl = new URL(target); } catch { return new Response("Invalid url param", { status: 400, headers: cors }); }
      if (targetUrl.protocol !== "https:" || !isAllowedAssetHost(targetUrl.hostname)) {
        return new Response("Host not allowed", { status: 403, headers: cors });
      }
      const upstream = await fetch(targetUrl.toString(), {
        headers: request.headers.has("Authorization") ? { Authorization: request.headers.get("Authorization") } : {},
      });
      if (!upstream.ok) return new Response(`Upstream ${upstream.status}`, { status: upstream.status, headers: cors });
      // Guard against S3 returning an AccessDenied / expired-URL XML body with a
      // 200 status — passing that through as file bytes makes the viewer render
      // a blank page. Surface it as an error instead.
      const upstreamType = upstream.headers.get("Content-Type") || "application/octet-stream";
      if (/xml|html/i.test(upstreamType)) {
        return json({ error: "asset_unavailable", detail: "The file link appears to have expired." }, 502, cors);
      }
      return new Response(upstream.body, {
        status: 200,
        headers: { ...cors, "Content-Type": upstreamType, "Cache-Control": "no-store" },
      });
    }

    // ── POST / — relay multipart upload to Monday's file API ────────────
    if (request.method === "POST") {
      const token = request.headers.get("Authorization");
      if (!token) return new Response("Missing Authorization header", { status: 401, headers: cors });
      const headers = { Authorization: token };
      const ct = request.headers.get("Content-Type");
      if (ct) headers["Content-Type"] = ct;
      const upstream = await fetch("https://api.monday.com/v2/file", { method: "POST", headers, body: request.body });
      const body = await upstream.text();
      return new Response(body, {
        status: upstream.status,
        headers: { ...cors, "Content-Type": upstream.headers.get("Content-Type") || "application/json" },
      });
    }

    return new Response("Method not allowed", { status: 405, headers: cors });
  },
};
