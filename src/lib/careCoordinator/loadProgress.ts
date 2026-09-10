/**
 * "How much of this column has loaded, and how close are we?"
 *
 * The Patient Intake column reads **1,754 rows** (1,718 of them the 8/25 bulk
 * import — §5.30), and Monday caps `items_page` at 500, so it is FOUR sequential
 * round trips before anything can render. That is genuinely slow and the screen
 * said nothing about it: a spinner that looks identical at second 1 and second
 * 15 is why it reads as broken rather than busy.
 *
 * ⚠️ **Monday cannot tell us the total.** `ItemsResponse` has exactly two
 * fields, `cursor` and `items` (checked against the live schema 2026-09-10) —
 * there is no count, and `groups` has none either; only `boards { items_count }`
 * exists and that is the whole board. So a percentage can only come from
 * REMEMBERING what the last complete run returned.
 *
 * Which makes the honesty rules below the whole of this module:
 *
 *  · `loaded` is always real — it is rows we actually hold.
 *  · `expected` is a memory, so it can be wrong. It is never allowed to
 *    manufacture a finished-looking bar: the percentage is capped at 99 until
 *    the fetch actually resolves, and a run that overshoots its remembered
 *    total stays at 99 rather than reporting >100 or snapping backwards.
 *  · Nothing is remembered from a FAILED or partial run. A total poisoned low
 *    would make every later load hit "100%" early and then keep going, which is
 *    worse than having no bar at all.
 */

export interface LoadProgress {
  /** Rows received so far. Always a real count of things we hold. */
  loaded: number;
  /** Page responses completed — the unit the latency is actually in. */
  pages: number;
  /** What the last COMPLETE run returned, or null if we have never seen one. */
  expected: number | null;
  /** The fetch has resolved. */
  done: boolean;
}

export const emptyProgress = (expected: number | null = null): LoadProgress => ({
  loaded: 0, pages: 0, expected, done: false,
});

/**
 * 0-100, or **null meaning "we cannot say"** — which the bar renders as an
 * indeterminate shimmer rather than a number it made up.
 */
export function progressPercent(p: LoadProgress): number | null {
  if (p.done) return 100;
  if (!p.expected || p.expected <= 0) return null;
  // Capped at 99 on purpose: a bar sitting at 100% while rows are still
  // arriving is exactly the lie this exists to remove. Overshooting the
  // remembered total lands here too — we are past what we expected, so "nearly
  // there" is the truthful reading.
  return Math.max(1, Math.min(99, Math.round((p.loaded / p.expected) * 100)));
}

const fmt = (n: number) => n.toLocaleString();

/** The words beside the bar. Empty once there is nothing left to say. */
export function progressLabel(p: LoadProgress): string {
  if (p.done) return "";
  if (!p.loaded) return "Starting…";
  // "~" because the total is remembered, not reported — and it is dropped once
  // we are past it, since it is no longer an estimate of anything.
  if (p.expected && p.loaded <= p.expected) return `${fmt(p.loaded)} of ~${fmt(p.expected)} patients`;
  return `${fmt(p.loaded)} patients`;
}

/* ── The remembered total ─────────────────────────────────────── */

const KEY = (id: string) => `mm-cc-total:${id}`;

/**
 * ⚠️ Every access is wrapped. localStorage throws outright in a private window
 * and on a quota that another feature filled — and this is a progress bar, so
 * failing to read it must cost the bar its percentage and nothing else
 * (§5.25's swallowed `QuotaExceededError` is the same lesson from the
 * expensive direction).
 */
export function recallTotal(id: string): number | null {
  try {
    const raw = localStorage.getItem(KEY(id));
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/** Only ever called with the size of a run that COMPLETED. */
export function rememberTotal(id: string, total: number): void {
  if (!Number.isFinite(total) || total <= 0) return;
  try {
    localStorage.setItem(KEY(id), String(Math.round(total)));
  } catch {
    /* a bar without a percentage is the whole cost */
  }
}
