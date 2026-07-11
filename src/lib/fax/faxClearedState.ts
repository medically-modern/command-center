/**
 * Shared "fax cleared today" latch for the FAX burndown bar.
 *
 * Persisted to the repo (**`public/data/fax-state.json`**) via the GitHub
 * Contents API (via the worker's /gh-state proxy), exactly like `accessStore` — so the
 * FAX bar reads the SAME state for everyone (the fax handler, Brandon, every
 * device), not a per-device localStorage flag.
 *
 * Behavior: the bar shows **0 / "Done!"** for the rest of the ET day once the
 * unread inbox first hits zero (she's read them all, or it was already empty).
 * New faxes arriving after that are **suppressed in the bar** until ET midnight;
 * when the date rolls over (or the page is first opened on the new day) the
 * stored date no longer matches `etToday()`, so the live unread count shows
 * again (e.g. 3). Purely a display latch — RingCentral and the Fax Inbox
 * (`/fax-inbox`) are untouched, so nothing is ever actually hidden from view.
 */
import { dataRepoName } from "../shared/dataRepo";
import { FILE_PROXY_URL } from "../shared/mondayAssets";

// Persisted through the monday-file-proxy worker's /gh-state endpoint, which
// holds the GitHub token SERVER-SIDE — the browser no longer ships one. The
// worker allowlists repo + file, so this only ever touches fax-state.json.
const BRANCH = "main";
const STATE_URL = `${FILE_PROXY_URL}/gh-state?repo=${dataRepoName()}&file=fax`;

interface FaxState {
  /** ET date (YYYY-MM-DD) the inbox was last cleared, or null. */
  clearedDate: string | null;
}

let cachedSha: string | null = null;

/** Read the shared cleared-date (null when the file is missing or unparseable). */
export async function fetchFaxClearedDate(): Promise<string | null> {
  const res = await fetch(`${STATE_URL}&t=${Date.now()}`, {
    cache: "no-store",
  });
  if (res.status === 404) {
    cachedSha = null;
    return null;
  }
  if (!res.ok) throw new Error(`fax-state fetch failed: ${res.status}`);
  const json = await res.json();
  cachedSha = json.sha;
  try {
    return (JSON.parse(atob(json.content)) as FaxState).clearedDate ?? null;
  } catch {
    return null;
  }
}

/** Write today's cleared-date (SHA-based optimistic concurrency, like accessStore). */
async function writeFaxClearedDate(date: string): Promise<void> {
  const body = (sha: string | null) => ({
    message: `Fax inbox cleared ${date}`,
    content: btoa(JSON.stringify({ clearedDate: date }, null, 2)),
    ...(sha ? { sha } : {}),
    branch: BRANCH,
  });
  const put = (sha: string | null) =>
    fetch(STATE_URL, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body(sha)) });
  let res = await put(cachedSha);
  if (res.status === 409 || res.status === 422) {
    await fetchFaxClearedDate(); // someone else wrote concurrently — refresh SHA
    res = await put(cachedSha);
  }
  if (!res.ok) throw new Error(`fax-state save failed: ${res.status}`);
  const json = await res.json();
  cachedSha = json.content?.sha ?? cachedSha;
}

// ── Pure latch logic (unit-tested in faxClearedState.test.ts) ──────────────

/** The count to display given the shared latch: 0 once cleared today, else live. */
export function faxDisplayCount(liveUnread: number, clearedDate: string | null, today: string): number {
  return clearedDate === today ? 0 : liveUnread;
}

/** Whether we should latch now: the inbox just hit zero and isn't yet marked today. */
export function shouldMarkCleared(liveUnread: number, clearedDate: string | null, today: string): boolean {
  return liveUnread === 0 && clearedDate !== today;
}

/**
 * Resolve the count to show on the FAX bar. Reads the shared cleared-date and,
 * the first time the inbox hits zero today, writes today's date so EVERY viewer
 * latches to "Done!". On any GitHub error it falls back to the live count — we
 * never hide faxes just because the state file was unreachable.
 */
export async function resolveFaxBurndownCount(liveUnread: number, today: string): Promise<number> {
  let clearedDate: string | null;
  try {
    clearedDate = await fetchFaxClearedDate();
  } catch {
    return liveUnread; // GitHub unreachable → show the real count
  }
  if (shouldMarkCleared(liveUnread, clearedDate, today)) {
    try {
      await writeFaxClearedDate(today);
      clearedDate = today;
    } catch {
      /* best-effort; the live count is 0 right now anyway, retried next poll */
    }
  }
  return faxDisplayCount(liveUnread, clearedDate, today);
}
