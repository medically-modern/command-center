/**
 * monday-file-proxy — Cloudflare Worker
 *
 * Routes:
 *   GET  /asset?url=…   → Monday asset download (allowlisted Monday hosts)
 *   POST /              → relay multipart upload to Monday's file API
 *   POST /send-message  → send an email (with attachments) as GMAIL_SENDER via
 *                         the Gmail API. Used by the Send Request composer.
 *                         Recipients may be normal emails OR <number>@rcfax.com
 *                         (RingCentral turns those into faxes). All EMAIL
 *                         recipients go out as ONE message (To: everyone, plus
 *                         an optional `cc` list) so the Sent folder shows a
 *                         single email to the group; each @rcfax recipient
 *                         still gets its own message (a fax is point-to-point).
 *                         Gated to signed-in medicallymodern.com users (no
 *                         open relay).
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

/** Build an RFC-822 message — HTML+text body, optional Cc, optional base64
 *  attachments. `to`/`cc` may be comma-joined address lists; either may be
 *  empty (a Cc-only message is valid — used when a fax-only send carries a Cc). */
function buildMime({ from, to, cc, subject, body, attachments }) {
  const headers = [`From: ${cleanAddr(from)}`];
  if (to) headers.push(`To: ${cleanAddr(to)}`);
  if (cc) headers.push(`Cc: ${cleanAddr(cc)}`);
  headers.push(`Subject: ${encHeader(subject)}`, "MIME-Version: 1.0");
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

// Sign-in is the gate, NOT a ticking token. Google ID tokens expire ~1h after
// issuance and the SPA no longer refreshes them, so we must NOT reject on `exp`
// (that was making sends fail an hour into a shift). Instead we cryptographically
// verify the token is a genuine, unmodified Google ID token for a verified
// medicallymodern.com user — signature against Google's published JWKS + issuer
// + (optional) audience + domain. Neither `exp` nor `iat` is enforced: sign-in
// itself is the durable gate, so a signed-in rep can send indefinitely without
// re-authenticating, while a non-medicallymodern.com caller still can't (no open
// relay).

/** Google's RS256 signing keys (JWKS), cached per-isolate for an hour. */
let _googleKeys = { keys: null, exp: 0 };
async function getGoogleSigningKeys() {
  if (_googleKeys.keys && Date.now() < _googleKeys.exp) return _googleKeys.keys;
  const r = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!r.ok) throw new Error("jwks fetch failed");
  const { keys } = await r.json();
  _googleKeys = { keys, exp: Date.now() + 60 * 60 * 1000 };
  return keys;
}

function b64urlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Verify the caller's Google ID token (signature + issuer + domain; `exp` and
 *  `iat` ignored). Returns their email if it's a verified medicallymodern.com
 *  user, else null. Prevents open relay. */
async function verifyIdToken(idToken, env) {
  if (!idToken) return null;
  try {
    const [h, p, sig] = idToken.split(".");
    if (!h || !p || !sig) return null;
    const header = JSON.parse(new TextDecoder().decode(b64urlToBytes(h)));
    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));

    // 1) Signature must verify against Google's keys — proves it's a genuine,
    //    unmodified Google-issued token (replaces the tokeninfo call, which
    //    rejected anything past its 1h expiry).
    const jwk = (await getGoogleSigningKeys()).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!ok) return null;

    // 2) Issuer, and audience when GOOGLE_CLIENT_ID is configured on the worker
    //    (tightens acceptance to tokens minted for *our* app).
    if (claims.iss !== "accounts.google.com" && claims.iss !== "https://accounts.google.com") return null;
    if (env && env.GOOGLE_CLIENT_ID && claims.aud !== env.GOOGLE_CLIENT_ID) return null;

    // 3) Verified medicallymodern.com identity.
    const email = String(claims.email || "").toLowerCase();
    const domainOk =
      (claims.email_verified === true || claims.email_verified === "true") &&
      (claims.hd === ALLOWED_SENDER_DOMAIN || email.endsWith("@" + ALLOWED_SENDER_DOMAIN));
    if (!domainOk) return null;

    // `exp` and `iat` are both intentionally ignored — sign-in is the durable
    // gate, so a valid medicallymodern.com token sends however old it is.
    return email;
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
      const actor = await verifyIdToken(request.headers.get("X-MM-Auth"), env);
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
      let cc;
      try {
        cc = JSON.parse(form.get("cc") || "[]");
      } catch {
        return json({ error: "cc must be a JSON array." }, 400, cors);
      }
      // Dedupe across To + Cc (case-insensitive) so nobody gets two copies.
      const seen = new Set();
      const dedupe = (list) =>
        (Array.isArray(list) ? list : [])
          .map((s) => String(s).trim())
          .filter(Boolean)
          .filter((a) => {
            const k = a.toLowerCase();
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
      recipients = dedupe(recipients);
      cc = dedupe(cc);
      if (!recipients.length) return json({ error: "No recipients provided." }, 400, cors);
      // Validate every address BEFORE anything sends. The grouped To/Cc header
      // means one unparseable entry would make Gmail reject the message for
      // EVERY email recipient (after the faxes already went out — a retry then
      // re-faxes), and a comma/semicolon inside one entry could smuggle extra
      // addresses past the fax split. Lenient addr-spec: local@domain with no
      // spaces, list separators, or angle brackets.
      const ADDR = /^[^\s@,;<>]+@[^\s@,;<>]+$/;
      const badAddr = [...recipients, ...cc].filter((a) => !ADDR.test(a));
      if (badAddr.length) {
        return json({ error: `Invalid address${badAddr.length > 1 ? "es" : ""}: ${badAddr.join(", ")}` }, 400, cors);
      }

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

      // ONE message for all the email recipients (To: everyone, Cc: the cc
      // list) — the ops team wants the Sent folder to show a single email to
      // the group, and the group to see each other (reply-all works). Each
      // @rcfax recipient still gets its own message: a fax is point-to-point,
      // and grouping fax addresses into the email would expose the rcfax
      // addresses to the human recipients.
      const isFax = (a) => /@rcfax\.com$/i.test(a);
      const emailTo = recipients.filter((r) => !isFax(r));
      const faxTo = recipients.filter(isFax);
      // A fax address has no business in a Cc header — it would put the rcfax
      // gateway address in front of every human recipient (and a reply-all
      // would fire a junk fax). Route any stray one to its own fax instead.
      const emailCc = cc.filter((a) => !isFax(a));
      faxTo.push(...cc.filter(isFax));

      const sendOne = async (mime) => {
        const resp = await fetch(
          "https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media",
          { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "message/rfc822" }, body: mime },
        );
        const jr = await resp.json().catch(() => ({}));
        return { ok: resp.ok, id: jr.id || null, error: resp.ok ? null : (jr.error?.message || `HTTP ${resp.status}`) };
      };

      const results = [];
      if (emailTo.length || emailCc.length) {
        // Cc with no email To happens on a fax-only send that carries a Cc
        // (the rep wants a colleague to get a copy) — still one valid message.
        const mime = buildMime({
          from: env.GMAIL_SENDER,
          to: emailTo.join(", "),
          cc: emailCc.join(", "),
          subject,
          body,
          attachments,
        });
        const r = await sendOne(mime);
        results.push({ to: emailTo.join(", ") || emailCc.join(", "), cc: emailCc.join(", ") || null, ...r });
      }
      for (const to of faxTo) {
        const r = await sendOne(buildMime({ from: env.GMAIL_SENDER, to, subject, body, attachments }));
        results.push({ to, ...r });
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
