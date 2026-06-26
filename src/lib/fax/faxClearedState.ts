/**
 * Shared "fax cleared today" latch for the FAX burndown bar.
 *
 * Persisted to the repo (**`public/data/fax-state.json`**) via the GitHub
 * Contents API (bundled `VITE_GITHUB_PAT`), exactly like `accessStore` — so the
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
import { dataRepo } from "../shared/dataRepo";

const REPO = dataRepo(); // per-deployment: test→test repo, prod→prod repo (sync-safe)
const FILE_PATH = "public/data/fax-state.json";
const BRANCH = "main";
const PAT = import.meta.env.VITE_GITHUB_PAT as string | undefined;
const API_BASE = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

interface FaxState {
  /** ET date (YYYY-MM-DD) the inbox was last cleared, or null. */
  clearedDate: string | null;
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (PAT) h.Authorization = `token ${PAT}`;
  return h;
}

let cachedSha: string | null = null;

/** Read the shared cleared-date (null when the file is missing or unparseable). */
export async function fetchFaxClearedDate(): Promise<string | null> {
  const res = await fetch(`${API_BASE}?ref=${BRANCH}&t=${Date.now()}`, {
    headers: ghHeaders(),
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
  let res = await fetch(API_BASE, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body(cachedSha)) });
  if (res.status === 409 || res.status === 422) {
    await fetchFaxClearedDate(); // someone else wrote concurrently — refresh SHA
    res = await fetch(API_BASE, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body(cachedSha)) });
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
