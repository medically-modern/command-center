/**
 * Is this tab running the build that is deployed right now? (§5.54)
 *
 * ⚠️⚠️ **WHY THIS EXISTS (2026-09-28).** A deploy never reaches a tab that is
 * already open: the browser keeps executing whatever JavaScript it loaded the
 * day the tab was opened. `chunkReload.ts` heals the one case where that
 * breaks visibly (a lazy navigation 404s on a replaced chunk), but a tab that
 * just SITS on one page runs old code indefinitely. On 2026-09-28 that cost a
 * whole morning: Katie's prod tab — opened before 2026-09-25 — showed the
 * forever-retrying registration AND the "Hanging up…" overlay that never
 * ends, both bugs whose fixes had been deployed for days (prod's live bundle
 * was checked: the 8s hang-up deadline was in it). Every fix shipped that day
 * would have missed her the same way.
 *
 * How it knows, with NO build changes: Vite names the entry script by content
 * hash (`assets/index-<hash>.js`). The running tab's own `<script>` tag says
 * which one it loaded; the deployed `index.html` says which one is current.
 * Different ⇒ a newer build is live.
 *
 * ⚠️ Deterministic by measurement, not assumption: two builds of unchanged
 * source produced the same entry hash (`index-B6vb6HvA.js` twice), and there
 * is no build-time stamp in vite.config.ts or deploy.yml. So the weekday cron
 * rebuild and the daily baseline/access data commits (runtime-fetched from
 * `public/data`, never bundled) do NOT nudge anybody — only a code change
 * does. A nudge that fired every morning for nothing would teach everyone to
 * ignore the one that matters. Adding a timestamp to the build breaks this;
 * `buildVersion.test.ts` says so.
 */

/** The content-hashed entry script, as Vite names it. */
const ENTRY_RE = /assets\/index-[A-Za-z0-9_-]+\.js/;

/** How often an open tab asks whether a newer build is live. The fetch is a
 *  small static file from GitHub Pages — no gateway, no RingCentral, no
 *  Monday — so the only reason not to ask more often is that nothing needs it. */
export const CHECK_EVERY_MS = 5 * 60_000;

/** "Later" hides the nudge this long, then it comes back. Coming back is the
 *  point: the whole failure is a tab nobody reloads for days. */
export const SNOOZE_MS = 30 * 60_000;

/** The entry filename in a page of HTML, or null. */
export function entryFromHtml(html: string): string | null {
  const m = ENTRY_RE.exec(String(html || ""));
  return m ? m[0] : null;
}

/**
 * The entry this tab is RUNNING, read from its own document. Null in dev (the
 * Vite dev server serves `/src/main.tsx`, no hash) and in tests — which is
 * what keeps the nudge silent everywhere except a real deployed build.
 */
export function runningEntry(doc: Pick<Document, "querySelectorAll"> | null | undefined): string | null {
  if (!doc) return null;
  for (const s of Array.from(doc.querySelectorAll('script[type="module"][src]'))) {
    const hit = entryFromHtml((s as HTMLScriptElement).getAttribute("src") || "");
    if (hit) return hit;
  }
  return null;
}

/**
 * A newer build is live. ⚠️ BOTH must be known: a failed fetch, a dev build or
 * a malformed page must read as "nothing to say", never as "reload" — a false
 * nudge every five minutes is how the real one gets ignored.
 */
export function isNewerBuild(running: string | null, deployed: string | null): boolean {
  return !!running && !!deployed && running !== deployed;
}

/**
 * The entry the DEPLOYED index.html points at, or null on any failure.
 *
 * ⚠️ Cache-busted twice on purpose. GitHub Pages serves index.html with a
 * ten-minute max-age through its CDN; `cache: "no-store"` covers the browser,
 * and the query string makes it a distinct URL at the CDN. Without both, a
 * tab could be told "you're current" by a cached copy of its own page.
 *
 * `base` is the app's own BASE_URL, so a test tab compares against test's
 * deployment and a prod tab against prod's — never across.
 */
export async function fetchDeployedEntry(base: string, now: number = Date.now()): Promise<string | null> {
  try {
    const res = await fetch(`${base.replace(/\/?$/, "/")}index.html?v=${now}`, { cache: "no-store" });
    if (!res.ok) return null;
    return entryFromHtml(await res.text());
  } catch {
    return null;
  }
}
