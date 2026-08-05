/**
 * verify-live.mjs — is the deployed stack actually working?
 *
 *   node scripts/verify-live.mjs            # test repo (default)
 *   node scripts/verify-live.mjs --prod     # prod repo
 *
 * Written for the 2026-08-05 public → private repo switch, and kept because
 * the same checks answer "did that deploy break anything?" in general.
 *
 * ── What it covers, and why only this ───────────────────────────────────────
 * Repo visibility can ONLY affect GitHub-mediated paths. Monday, RingCentral,
 * Stedi and the worker's asset proxy hold no GitHub credential and cannot be
 * affected by it, so they are deliberately not tested here — a check that
 * cannot fail for the reason you are investigating is noise.
 *
 * ⚠️ Every check is UNAUTHENTICATED on purpose: it needs no secrets, so it can
 * be run by anyone, from anywhere, including CI. The consequence is that it
 * proves READ paths only. Writes — saving access.json, committing baseline.json
 * — are listed at the end as manual steps, because probing them for real means
 * modifying production data.
 *
 * Exits non-zero if anything fails, so it can gate a workflow.
 */

const PROD = process.argv.includes("--prod");
const REPO = PROD ? "command-center" : "command-center-test";
const PAGES = `https://medically-modern.github.io/${REPO}`;
const WORKER = "https://monday-file-proxy.medically-modern.workers.dev";
const GATEWAY = "https://monday-gateway-production.up.railway.app";
const TIMEOUT_MS = 20_000;

async function get(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: "no-store" });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch (e) {
    return { ok: false, status: 0, text: String((e && e.message) || e) };
  } finally {
    clearTimeout(t);
  }
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  ok  " : " FAIL "} ${name.padEnd(42)} ${detail}`);
}

/**
 * The load-bearing check.
 *
 * ⚠️ Status alone is NOT enough here, which is the whole reason this decodes
 * the body. `accessStore.fetchAccess` treats a 404 — and `useAccess` treats a
 * thrown error — as EMPTY_ACCESS, and an empty config means `noManagers()`,
 * which puts the SPA in bootstrap mode where EVERY signed-in user is treated
 * as a manager. So a broken token doesn't lock people out, it silently hands
 * everyone the keys. Proving real managers came back is the only way to tell
 * that apart from a healthy config.
 */
async function checkAccess() {
  const r = await get(`${WORKER}/gh-state?repo=${REPO}&file=access&t=${Date.now()}`);
  if (!r.ok) return record("worker /gh-state (access.json)", false, `HTTP ${r.status} — SPA would fall into bootstrap mode`);
  try {
    const wrapper = JSON.parse(r.text);
    const cfg = JSON.parse(Buffer.from(wrapper.content, "base64").toString("utf8"));
    const managers = (cfg.managers || []).length;
    const processors = Object.keys(cfg.processors || {}).length;
    // Zero managers is indistinguishable from a failed read, and has the same
    // effect, so it fails here rather than reading as a healthy empty config.
    record(
      "worker /gh-state (access.json)",
      managers > 0,
      managers > 0
        ? `${managers} managers, ${processors} processors`
        : "0 managers — everyone would be treated as a manager",
    );
  } catch (e) {
    record("worker /gh-state (access.json)", false, `unparseable: ${e.message}`);
  }
}

async function checkPages() {
  const idx = await get(`${PAGES}/`);
  record("pages index.html", idx.ok && /<div id="root"/.test(idx.text), `HTTP ${idx.status}`);

  const b = await get(`${PAGES}/data/baseline.json?t=${Date.now()}`);
  if (!b.ok) return record("pages data/baseline.json", false, `HTTP ${b.status}`);
  try {
    const j = JSON.parse(b.text);
    // Stale is the interesting failure: the file keeps serving happily while
    // whatever writes it has quietly stopped.
    const ageDays = Math.floor((Date.now() - new Date(j.takenAt).getTime()) / 86_400_000);
    record(
      "pages data/baseline.json",
      ageDays <= 4,
      `dateKey=${j.dateKey} source=${j.source} (${ageDays}d old)`,
    );
  } catch (e) {
    record("pages data/baseline.json", false, `unparseable: ${e.message}`);
  }
}

async function checkGateway() {
  const h = await get(`${GATEWAY}/health`);
  record("gateway /health", h.ok, `HTTP ${h.status}`);

  const c = await get(`${GATEWAY}/calls/health`);
  if (!c.ok) return record("gateway /calls/health", false, `HTTP ${c.status}`);
  try {
    const j = JSON.parse(c.text);
    const ev = j.events || {};
    // `ok` already requires RingCentral to call the subscription Active right
    // now, so this is a live answer rather than a cached one.
    record(
      "gateway /calls/health",
      j.ok === true,
      `${j.subscriptionStatus} · ${j.subscribers} browser(s) · seen=${ev.seen} rings=${ev.rings} unparsed=${ev.unparsed}`,
    );
    // Deliveries arriving and all failing to parse is the envelope bug's
    // signature; it looks identical to a quiet line if you only check `ok`.
    if (ev.seen > 0) {
      record("call events parse", ev.unparsed !== ev.seen, `${ev.unparsed}/${ev.seen} unparsed`);
    }
  } catch (e) {
    record("gateway /calls/health", false, `unparseable: ${e.message}`);
  }
}

/** The webhook must echo RingCentral's handshake or the subscription is
 *  eventually blacklisted — a slow-motion failure worth catching early. */
async function checkWebhookHandshake() {
  const token = `verify-${Date.now()}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${GATEWAY}/calls/webhook`, {
      method: "POST",
      headers: { "Validation-Token": token },
      signal: ctl.signal,
    });
    const echoed = res.headers.get("validation-token");
    record("webhook validation handshake", res.ok && echoed === token, `HTTP ${res.status}`);
  } catch (e) {
    record("webhook validation handshake", false, String((e && e.message) || e));
  } finally {
    clearTimeout(t);
  }
}

console.log(`\nVerifying ${REPO}\n${"-".repeat(72)}`);
await checkAccess();
await checkPages();
await checkGateway();
await checkWebhookHandshake();

const failed = results.filter((r) => !r.pass);
console.log("-".repeat(72));
console.log(`${results.length - failed.length}/${results.length} passed\n`);

if (failed.length) {
  console.error("FAILED:\n" + failed.map((f) => ` - ${f.name}: ${f.detail}`).join("\n") + "\n");
}

console.log(`Not covered here — these need a browser or would modify production data:
  1. Sign in at ${PAGES}/ and confirm you land on YOUR roles, not the full
     manager view. The manager view for everyone is what a broken access.json
     read looks like.
  2. Save something on /access — the only real proof the GitHub token can
     WRITE, not just read.
  3. Open a patient in Patient Texting: the thread loads (RingCentral) and the
     board data resolves (Monday).
  4. Confirm tomorrow's 9 AM ET baseline lands — re-run this and check the
     dateKey moved.
`);

process.exit(failed.length ? 1 : 0);
