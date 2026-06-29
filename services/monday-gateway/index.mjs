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
import { registerSend } from "./send.mjs";
import { verifyGoogleToken, authEnforced } from "./auth.mjs";

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
ALTER TABLE gql_log ADD COLUMN IF NOT EXISTS columns JSONB;  -- {colId: value} a mutation wrote (note: patient values = PHI)

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

// Extract the column writes from a mutation as { columnId: value }. The app
// builds inline mutations (value JSON inline, not variables), so parse the text.
function extractColumns(query) {
  const q = String(query || "");
  const out = {};
  // change_multiple_column_values(column_values: "{...json...}")
  const multi = q.match(/column_values:\s*("(?:[^"\\]|\\.)*")/);
  if (multi) {
    try { Object.assign(out, JSON.parse(JSON.parse(multi[1]))); } catch { /* ignore */ }
  }
  // change_(simple_)column_value(column_id: "X", value: <"json" | literal>)
  const col = q.match(/column_id:\s*"([^"]+)"/);
  if (col) {
    let val = null;
    const vm = q.match(/value:\s*("(?:[^"\\]|\\.)*")/);
    if (vm) {
      try { val = JSON.parse(JSON.parse(vm[1])); }     // double-encoded JSON string
      catch { try { val = JSON.parse(vm[1]); } catch { val = vm[1]; } }
    }
    out[col[1]] = val;
  }
  return Object.keys(out).length ? out : null;
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
          monday_status, monday_errors, ok, duration_ms, columns)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
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
        rec.columns ? JSON.stringify(rec.columns) : null,
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
    "Content-Type, Authorization, API-Version, X-MM-User, X-MM-Auth, X-MM-Key",
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

  // Verify the Google token if present (attributes the request to a real user).
  // Enforcement is applied on /send (where the SPA always sends the token).
  // /gql is left non-blocking so reads + inline panel actions keep working
  // until the per-board gql() calls are wired to send the token too.
  const gUser = await verifyGoogleToken(req.headers["x-mm-auth"]);
  const actor = gUser?.email || req.headers["x-mm-user"] || null;

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
    actor,
    client_ip: clientIp(req),
    origin: req.headers.origin || null,
    user_agent: req.headers["user-agent"] || null,
    operation: opType(query),
    operation_name: opName(query),
    board_id: extractBoardId(query, variables),
    item_id: extractItemId(query, variables),
    columns: opType(query) === "mutation" ? extractColumns(query) : null,
    query_text: query,
    variables: variables || null,
    monday_status: status,
    monday_errors: errors,
    ok: status >= 200 && status < 300 && !errors,
    duration_ms: duration,
  });
});

// ── /audit — key-protected log viewer ───────────────────────

/* Resolve ids → human labels for the audit view, using the server-side token.
 * Item names are fetched per render; column titles are cached (they're stable). */
async function callMondayRead(query) {
  try {
    const r = await fetch(MONDAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: MONDAY_API_TOKEN, "API-Version": MONDAY_API_VERSION },
      body: JSON.stringify({ query }),
    });
    const j = await r.json();
    return j?.data || null;
  } catch { return null; }
}

async function resolveItemNames(itemIds) {
  const out = new Map();
  // Resolve up to 1000 distinct patient names per render, batched in chunks of
  // 100 (Monday's items() query gets expensive/complex past that). Rows beyond
  // this still display — they just show "—" for the patient name. The stored
  // log is complete regardless; this only bounds the name lookup.
  const ids = itemIds.filter(Boolean).slice(0, 1000);
  if (!ids.length) return out;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const data = await callMondayRead(`query { items(ids: [${chunk.join(",")}]) { id name } }`);
    for (const it of data?.items || []) out.set(String(it.id), it.name);
  }
  return out;
}

const titleCache = new Map(); // `${boardId}:${colId}` -> column title
async function resolveColumnTitles(pairs) {
  const byBoard = new Map();
  for (const [b, c] of pairs) {
    if (titleCache.has(`${b}:${c}`)) continue;
    if (!byBoard.has(b)) byBoard.set(b, new Set());
    byBoard.get(b).add(c);
  }
  for (const [b, cols] of byBoard) {
    const data = await callMondayRead(`query { boards(ids: [${b}]) { columns { id title } } }`);
    for (const col of data?.boards?.[0]?.columns || []) titleCache.set(`${b}:${col.id}`, col.title);
    for (const c of cols) if (!titleCache.has(`${b}:${c}`)) titleCache.set(`${b}:${c}`, c); // give up → show id
  }
  return titleCache;
}

/** Render a written column value compactly. */
function fmtColVal(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    if ("text" in v) return String(v.text);
    if ("date" in v) return String(v.date);
    if ("label" in v) return String(v.label);
    if ("index" in v) return "index " + v.index;
    return JSON.stringify(v);
  }
  return String(v);
}

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
  // Every row is stored in Postgres forever (no pruning) — `limit` only bounds
  // how many the viewer renders at once. Default 1000; cap 50000 so a stray
  // ?limit= can't try to render the entire table into one HTML page.
  const limit = Math.min(parseInt(req.query.limit, 10) || 1000, 50000);
  const onlyWrites = req.query.all !== "1";
  const where = onlyWrites ? "WHERE operation = 'mutation'" : "";
  const r = await pool.query(
    `SELECT created_at, actor, client_ip, operation, operation_name,
            item_id, board_id, ok, monday_status, duration_ms, columns
     FROM gql_log ${where} ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return { rows: r.rows, onlyWrites, limit };
}

/** Format a TIMESTAMPTZ as Eastern Time (auto-handles EDT/EST). */
function fmtET(ts) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ts));
  const g = (t) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")} ${g("hour")}:${g("minute")}:${g("second")}`;
}

function renderAudit(rows, opts) {
  const k = encodeURIComponent(opts.key);
  const names = opts.names || new Map();
  const titles = opts.titles || new Map();
  const body = rows
    .map((r) => {
      const nm = names.get(String(r.item_id));
      const first = nm ? esc(nm.split(/\s+/)[0]) : "—";
      let cols = "—";
      if (r.columns && typeof r.columns === "object") {
        const parts = Object.entries(r.columns).map(([c, v]) => {
          const t = titles.get(`${r.board_id}:${c}`) || c;
          return `<span class="kv"><b>${esc(t)}</b>: ${esc(fmtColVal(v))}</span>`;
        });
        if (parts.length) cols = parts.join(" ");
      }
      return `<tr>
      <td class="t">${esc(fmtET(r.created_at))}</td>
      <td>${esc(r.actor || "—")}</td>
      <td><b>${first}</b></td>
      <td class="mono">${esc(r.client_ip || "—")}</td>
      <td><span class="op ${r.operation === "mutation" ? "mut" : "qry"}">${esc(r.operation || "")}</span></td>
      <td class="mono">${esc(r.item_id || "—")}</td>
      <td class="cols">${cols}</td>
      <td>${r.ok ? '<span class="ok">ok</span>' : '<span class="bad">FAIL</span>'}</td>
      <td class="num">${esc(r.duration_ms || "")}</td>
    </tr>`;
    })
    .join("");
  // Only auto-refresh small views — re-running the query + name resolution
  // every 30s for thousands of rows would hammer the DB and Monday.
  const autoRefresh = (opts.limit || 0) <= 1000;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
${autoRefresh ? '<meta http-equiv="refresh" content="30">' : ""}
<title>monday-gateway · audit</title>
<style>
 body{font:14px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#0f1115;color:#e6e6e6}
 header{padding:14px 18px;background:#171a21;border-bottom:1px solid #262b36;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
 h1{font-size:15px;margin:0;font-weight:600}
 .pill{font-size:12px;color:#9aa4b2}
 a.btn{color:#7cc4ff;text-decoration:none;font-size:13px;border:1px solid #2a3340;padding:4px 10px;border-radius:6px}
 .rows{display:flex;gap:0;align-items:center}
 .rows a{color:#9aa4b2;text-decoration:none;font-size:12px;border:1px solid #2a3340;border-right:0;padding:4px 9px}
 .rows a:first-child{border-radius:6px 0 0 6px}
 .rows a:last-child{border-right:1px solid #2a3340;border-radius:0 6px 6px 0}
 .rows a.cur{background:#243043;color:#cfe6ff;font-weight:600}
 .rows .lbl{border:0;color:#6b7484;padding-right:6px}
 table{border-collapse:collapse;width:100%}
 th,td{padding:7px 10px;border-bottom:1px solid #20242e;text-align:left;vertical-align:top;white-space:nowrap}
 th{position:sticky;top:0;background:#11141a;color:#9aa4b2;font-weight:600;font-size:12px}
 tr:hover td{background:#151922}
 .mono{font-family:ui-monospace,Menlo,monospace;font-size:12px}
 .t{color:#9aa4b2}.num{text-align:right}
 .op{font-size:11px;padding:2px 6px;border-radius:4px}
 .mut{background:#3a2540;color:#f0a6ff}.qry{background:#1f2a3a;color:#86b9ff}
 .ok{color:#5ad17a}.bad{color:#ff6b6b;font-weight:700}
 .cols{white-space:normal;max-width:560px}
 .kv{display:inline-block;background:#1a1f29;border:1px solid #262c38;border-radius:4px;padding:1px 6px;margin:1px 2px;font-size:12px}
 .kv b{color:#9fd0ff;font-weight:600}
</style></head><body>
<header>
 <h1>monday-gateway · audit log</h1>
 <span class="pill">${rows.length} rows shown · ${opts.onlyWrites ? "writes only" : "all traffic"} · ${autoRefresh ? "auto-refresh 30s" : "no auto-refresh"}</span>
 <span class="rows">
  <span class="lbl">show:</span>
  ${[200, 1000, 5000, 20000, 50000]
    .map((n) => `<a class="${opts.limit === n ? "cur" : ""}" href="?key=${k}&limit=${n}${opts.onlyWrites ? "" : "&all=1"}">${n >= 1000 ? n / 1000 + "k" : n}</a>`)
    .join("")}
 </span>
 <a class="btn" href="?key=${k}&limit=${opts.limit}${opts.onlyWrites ? "&all=1" : ""}">${opts.onlyWrites ? "Show all traffic" : "Show writes only"}</a>
 <a class="btn" href="/audit.json?key=${k}&limit=${opts.limit}${opts.onlyWrites ? "" : "&all=1"}">JSON</a>
</header>
<table><thead><tr>
 <th>time (ET)</th><th>who</th><th>patient</th><th>ip</th><th>op</th><th>item</th><th>columns written → value</th><th>ok</th><th>ms</th>
</tr></thead><tbody>${body || '<tr><td colspan="9" style="padding:20px;color:#9aa4b2">No rows yet.</td></tr>'}</tbody></table>
</body></html>`;
}

app.get("/audit", async (req, res) => {
  if (auditDenied(req, res)) return;
  try {
    const { rows, onlyWrites, limit } = await fetchAudit(req);
    const names = await resolveItemNames([...new Set(rows.map((r) => r.item_id).filter(Boolean))]);
    const pairs = [];
    for (const r of rows) if (r.board_id && r.columns) for (const c of Object.keys(r.columns)) pairs.push([r.board_id, c]);
    const titles = await resolveColumnTitles(pairs);
    res.type("html").send(renderAudit(rows, { onlyWrites, limit, key: process.env.AUDIT_KEY, names, titles }));
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

// ── Phase 2: server-side transactional /send (durable, idempotent) ──
registerSend({ app, pool, clientIp });

ensureSchema().finally(() => {
  app.listen(PORT, () =>
    console.log(
      `monday-gateway listening on :${PORT} | origins=${ALLOWED_ORIGINS.join(
        ",",
      )} | logMode=${LOG_MODE} | storePayload=${STORE_PAYLOAD}`,
    ),
  );
});
