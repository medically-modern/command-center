/**
 * monday-gateway — Railway service (standalone; NOT part of baseline-cron)
 *
 * A transparent gateway between the Command Center SPA and the Monday.com
 * GraphQL API. Phase 1 goals:
 *
 *   1. Move the Monday API token OFF the public browser bundle. The token
 *      lives here as a Railway env var; the browser never holds it.
 *   2. Audit trail — every GraphQL request (who / what / from where / when /
 *      outcome) is logged to Postgres.
 *   3. Single choke point — one place to later add server-side retries,
 *      rate-limit handling, and the Phase 2 transactional /send endpoint.
 *
 * It is intentionally DUMB: POST /gql forwards whatever { query, variables }
 * the app sends straight to Monday and returns Monday's response verbatim.
 * New queries / columns / boards need NO changes here — that is the whole
 * point, given how fast the frontend churns.
 *
 * Endpoints:
 *   GET  /health   liveness + DB reachability + token presence (Railway healthcheck)
 *   POST /gql      transparent Monday GraphQL proxy (+ audit log)
 *
 * Required env:
 *   MONDAY_API_TOKEN   Monday.com API token (server-side secret)
 *   DATABASE_URL       Postgres connection string (Railway Postgres plugin)
 * Optional env:
 *   ALLOWED_ORIGINS    comma-separated CORS allowlist
 *                      (default: GitHub Pages site + localhost dev)
 *   MONDAY_API_VERSION default "2024-10"
 *   LOG_MODE           off | mutations | all          (default "all")
 *   LOG_PAYLOAD        "true" stores query text + variables — these contain
 *                      PATIENT DATA (PHI). Default false = metadata only.
 *   GATEWAY_CLIENT_KEY if set, requests must send a matching X-MM-Key header
 *   PORT               set by Railway
 */

import express from "express";
import pkg from "pg";
const { Pool } = pkg;

const {
  MONDAY_API_TOKEN,
  DATABASE_URL,
  MONDAY_API_VERSION = "2024-10",
  LOG_MODE = "all",
  LOG_PAYLOAD = "false",
  GATEWAY_CLIENT_KEY = "",
  PORT = 8080,
} = process.env;

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ||
  "https://medically-modern.github.io,http://localhost:5173,http://localhost:8080"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const MONDAY_URL = "https://api.monday.com/v2";
const STORE_PAYLOAD = String(LOG_PAYLOAD).toLowerCase() === "true";

if (!MONDAY_API_TOKEN) {
  console.error("FATAL: MONDAY_API_TOKEN not set");
  process.exit(1);
}

/* ── Postgres ─────────────────────────────────────────────── */

function sslFor(url) {
  // Railway's INTERNAL connection string needs no SSL; external ones do.
  return /sslmode=disable/.test(url || "") ? false : { rejectUnauthorized: false };
}

const pool = DATABASE_URL
  ? new Pool({ connectionString: DATABASE_URL, max: 5, ssl: sslFor(DATABASE_URL) })
  : null;
if (!pool) console.warn("WARN: DATABASE_URL not set — audit logging is DISABLED");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS gql_log (
  id             BIGSERIAL PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor          TEXT,          -- X-MM-User header (best-effort; unauthenticated today)
  client_ip      TEXT,          -- first hop of X-Forwarded-For
  origin         TEXT,          -- request Origin header
  user_agent     TEXT,
  operation      TEXT,          -- 'query' | 'mutation'
  operation_name TEXT,          -- parsed GraphQL operation name, if any
  board_id       TEXT,          -- best-effort from variables
  item_id        TEXT,          -- best-effort from variables
  query_text     TEXT,          -- only when LOG_PAYLOAD=true (PHI)
  variables      JSONB,         -- only when LOG_PAYLOAD=true (PHI)
  monday_status  INT,           -- HTTP status returned by Monday
  monday_errors  JSONB,         -- Monday GraphQL errors[], if any
  ok             BOOLEAN,       -- 2xx and no GraphQL errors
  duration_ms    INT
);
CREATE INDEX IF NOT EXISTS gql_log_created_at_idx ON gql_log (created_at DESC);
CREATE INDEX IF NOT EXISTS gql_log_operation_idx  ON gql_log (operation);
CREATE INDEX IF NOT EXISTS gql_log_item_idx       ON gql_log (item_id);
CREATE INDEX IF NOT EXISTS gql_log_actor_idx      ON gql_log (actor);

-- Convenience view: the writes people actually audit.
CREATE OR REPLACE VIEW gql_writes AS
  SELECT id, created_at, actor, client_ip, origin, item_id, board_id,
         operation_name, ok, monday_status, monday_errors, duration_ms,
         query_text, variables
  FROM gql_log
  WHERE operation = 'mutation';
`;

async function ensureSchema() {
  if (!pool) return;
  try {
    await pool.query(SCHEMA);
    console.log("Postgres schema ready");
  } catch (e) {
    console.error("Schema init failed:", e.message);
  }
}

/* ── helpers ──────────────────────────────────────────────── */

function opType(q) {
  return /^\s*mutation\b/i.test(String(q || "")) ? "mutation" : "query";
}
function opName(q) {
  const m = String(q || "").match(/^\s*(?:query|mutation)\s+([A-Za-z0-9_]+)/);
  return m ? m[1] : null;
}
function pick(vars, keys) {
  for (const k of keys) {
    if (vars && vars[k] != null) return String(vars[k]);
  }
  return null;
}
function clientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || null;
}

// Best-effort id extraction: prefer variables, fall back to scanning the query
// text (covers inline ids and short variable names like the app sometimes uses).
function extractItemId(query, vars) {
  const v = pick(vars, ["itemId", "item_id", "id", "i"]);
  if (v) return v;
  const q = String(query || "");
  const m =
    q.match(/\bitem_id\s*:\s*"?(\d{6,})/i) ||
    q.match(/\bitemId\s*:\s*"?(\d{6,})/i) ||
    q.match(/items?\s*\(\s*ids:\s*\[?\s*"?(\d{6,})/i);
  return m ? m[1] : null;
}
function extractBoardId(query, vars) {
  const v = pick(vars, ["boardId", "board_id", "bid", "b"]);
  if (v) return v;
  const m = String(query || "").match(/\bboard_id\s*:\s*"?(\d{6,})/i);
  return m ? m[1] : null;
}

function esc(s) {
  return String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]),
  );
}

async function logRequest(rec) {
  if (!pool || LOG_MODE === "off") return;
  if (LOG_MODE === "mutations" && rec.operation !== "mutation") return;
  try {
    await pool.query(
      `INSERT INTO gql_log
         (actor, client_ip, origin, user_agent, operation, operation_name,
          board_id, item_id, query_text, variables,
          monday_status, monday_errors, ok, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        rec.actor,
        rec.client_ip,
        rec.origin,
        rec.user_agent,
        rec.operation,
        rec.operation_name,
        rec.board_id,
        rec.item_id,
        STORE_PAYLOAD ? rec.query_text : null,
        STORE_PAYLOAD ? rec.variables : null,
        rec.monday_status,
        rec.monday_errors,
        rec.ok,
        rec.duration_ms,
      ],
    );
  } catch (e) {
    console.error("audit log insert failed:", e.message);
  }
}

/* ── app ──────────────────────────────────────────────────── */

const app = express();
app.use(express.json({ limit: "4mb" }));

// CORS (mirrors the existing monday-file-proxy worker's allowlist behavior)
app.use((req, res, next) => {
  const origin = req.headers.origin || "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.set("Access-Control-Allow-Origin", allow);
  res.set("Vary", "Origin");
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, API-Version, X-MM-User, X-MM-Key",
  );
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.get("/health", async (_req, res) => {
  let db = "disabled";
  if (pool) {
    try {
      await pool.query("SELECT 1");
      db = "ok";
    } catch {
      db = "error";
    }
  }
  res.json({
    ok: true,
    token: !!MONDAY_API_TOKEN,
    db,
    logMode: LOG_MODE,
    storePayload: STORE_PAYLOAD,
    origins: ALLOWED_ORIGINS,
  });
});

app.post("/gql", async (req, res) => {
  if (GATEWAY_CLIENT_KEY && req.headers["x-mm-key"] !== GATEWAY_CLIENT_KEY) {
    return res.status(401).json({ errors: [{ message: "Unauthorized" }] });
  }

  const { query, variables } = req.body || {};
  if (!query) return res.status(400).json({ errors: [{ message: "Missing query" }] });

  const started = Date.now();
  let status = 0;
  let text = "";
  let errors = null;

  try {
    const upstream = await fetch(MONDAY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Token injected SERVER-SIDE. Any Authorization the browser sent is ignored.
        Authorization: MONDAY_API_TOKEN,
        "API-Version": req.headers["api-version"] || MONDAY_API_VERSION,
      },
      body: JSON.stringify({ query, variables: variables || {} }),
    });
    status = upstream.status;
    text = await upstream.text();
    try {
      const json = JSON.parse(text);
      errors = json?.errors || null;
    } catch {
      /* non-JSON upstream body — pass through as-is */
    }
  } catch (e) {
    status = 502;
    text = JSON.stringify({ errors: [{ message: `Gateway upstream error: ${e.message}` }] });
    errors = [{ message: e.message }];
  }

  const duration = Date.now() - started;

  // Return Monday's response verbatim — same shape the SPA already handles.
  res.status(status || 502).type("application/json").send(text);

  // Fire-and-forget audit log (never blocks or fails the client response).
  logRequest({
    actor: req.headers["x-mm-user"] || null,
    client_ip: clientIp(req),
    origin: req.headers.origin || null,
    user_agent: req.headers["user-agent"] || null,
    operation: opType(query),
    operation_name: opName(query),
    board_id: extractBoardId(query, variables),
    item_id: extractItemId(query, variables),
    query_text: query,
    variables: variables || null,
    monday_status: status,
    monday_errors: errors,
    ok: status >= 200 && status < 300 && !errors,
    duration_ms: duration,
  });
});

// ── /audit — key-protected log viewer (metadata only) ────────

function auditDenied(req, res) {
  const key = process.env.AUDIT_KEY || "";
  if (!key) { res.status(503).send("AUDIT_KEY not configured"); return true; }
  if (req.query.key !== key) {
    res.status(401).send("Unauthorized — append ?key=YOUR_KEY to the URL");
    return true;
  }
  if (!pool) { res.status(503).send("No database configured (DATABASE_URL unset)"); return true; }
  return false;
}

async function fetchAudit(req) {
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 2000);
  const onlyWrites = req.query.all !== "1";
  const where = onlyWrites ? "WHERE operation = 'mutation'" : "";
  const r = await pool.query(
    `SELECT created_at, actor, client_ip, operation, operation_name,
            item_id, board_id, ok, monday_status, duration_ms
     FROM gql_log ${where} ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return { rows: r.rows, onlyWrites, limit };
}

function renderAudit(rows, opts) {
  const k = encodeURIComponent(opts.key);
  const body = rows
    .map(
      (r) => `<tr>
      <td class="t">${esc(new Date(r.created_at).toISOString().replace("T", " ").slice(0, 19))}</td>
      <td>${esc(r.actor || "—")}</td>
      <td class="mono">${esc(r.client_ip || "—")}</td>
      <td><span class="op ${r.operation === "mutation" ? "mut" : "qry"}">${esc(r.operation || "")}</span></td>
      <td>${esc(r.operation_name || "—")}</td>
      <td class="mono">${esc(r.item_id || "—")}</td>
      <td class="mono">${esc(r.board_id || "—")}</td>
      <td>${r.ok ? '<span class="ok">ok</span>' : '<span class="bad">FAIL</span>'}</td>
      <td>${esc(r.monday_status || "")}</td>
      <td class="num">${esc(r.duration_ms || "")}</td>
    </tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30">
<title>monday-gateway · audit</title>
<style>
 body{font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#0f1115;color:#e6e6e6}
 header{padding:14px 18px;background:#171a21;border-bottom:1px solid #262b36;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
 h1{font-size:15px;margin:0;font-weight:600}
 .pill{font-size:12px;color:#9aa4b2}
 a.btn{color:#7cc4ff;text-decoration:none;font-size:13px;border:1px solid #2a3340;padding:4px 10px;border-radius:6px}
 table{border-collapse:collapse;width:100%}
 th,td{padding:7px 10px;border-bottom:1px solid #20242e;text-align:left;white-space:nowrap}
 th{position:sticky;top:0;background:#11141a;color:#9aa4b2;font-weight:600;font-size:12px}
 tr:hover td{background:#151922}
 .mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}
 .t{color:#9aa4b2}.num{text-align:right}
 .op{font-size:11px;padding:2px 6px;border-radius:4px}
 .mut{background:#3a2540;color:#f0a6ff}.qry{background:#1f2a3a;color:#86b9ff}
 .ok{color:#5ad17a}.bad{color:#ff6b6b;font-weight:700}
</style></head><body>
<header>
 <h1>monday-gateway · audit log</h1>
 <span class="pill">${rows.length} rows · ${opts.onlyWrites ? "writes only" : "all traffic"} · auto-refresh 30s</span>
 <a class="btn" href="?key=${k}${opts.onlyWrites ? "&all=1" : ""}">${opts.onlyWrites ? "Show all traffic" : "Show writes only"}</a>
 <a class="btn" href="/audit.json?key=${k}${opts.onlyWrites ? "" : "&all=1"}">JSON</a>
</header>
<table><thead><tr>
 <th>time (UTC)</th><th>who</th><th>ip</th><th>op</th><th>name</th><th>item</th><th>board</th><th>ok</th><th>status</th><th>ms</th>
</tr></thead><tbody>${body || '<tr><td colspan="10" style="padding:20px;color:#9aa4b2">No rows yet.</td></tr>'}</tbody></table>
</body></html>`;
}

app.get("/audit", async (req, res) => {
  if (auditDenied(req, res)) return;
  try {
    const { rows, onlyWrites, limit } = await fetchAudit(req);
    res.type("html").send(renderAudit(rows, { rows, onlyWrites, limit, key: process.env.AUDIT_KEY }));
  } catch (e) {
    res.status(500).send("Query error: " + e.message);
  }
});

app.get("/audit.json", async (req, res) => {
  if (auditDenied(req, res)) return;
  try {
    const { rows } = await fetchAudit(req);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

ensureSchema().finally(() => {
  app.listen(PORT, () =>
    console.log(
      `monday-gateway listening on :${PORT} | origins=${ALLOWED_ORIGINS.join(
        ",",
      )} | logMode=${LOG_MODE} | storePayload=${STORE_PAYLOAD}`,
    ),
  );
});
