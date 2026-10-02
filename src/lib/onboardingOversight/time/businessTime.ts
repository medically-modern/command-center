/**
 * Business-time arithmetic (BUILD-SPEC §3.1).
 * "Business hours" = elapsed time minus Saturdays, Sundays and configured holidays,
 * judged on America/New_York calendar days. Not 9-to-5: work hours are not recorded.
 * WHY the caches: this runs for every span of every item; Intl formatters are expensive, so each ET day
 * boundary and working-day flag is computed once and memoized.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const FMT_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
const FMT_HOUR = new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", hour12: false });

/** ET calendar date (YYYY-MM-DD) for a UTC instant. */
export function etDateKey(ms: number): string { return FMT_DATE.format(new Date(ms)); }

const midnightCache = new Map<string, number>();
/** UTC ms of 00:00 America/New_York on the ET date containing `ms`. */
export function etMidnight(ms: number): number {
  const key = etDateKey(ms);
  const hit = midnightCache.get(key); if (hit != null) return hit;
  let out = Date.parse(`${key}T00:00:00Z`) + 5 * HOUR;
  for (const off of [4, 5]) {
    const cand = Date.parse(`${key}T00:00:00Z`) + off * HOUR;
    if (etDateKey(cand) === key && FMT_HOUR.format(new Date(cand)).startsWith("00")) { out = cand; break; }
  }
  midnightCache.set(key, out); return out;
}

interface DayInfo { start: number; next: number; working: boolean }
const dayCache = new Map<string, DayInfo>(); // key: holidays-signature|dayStart
function dayInfo(dayStart: number, holidays: ReadonlySet<string>, sig: string): DayInfo {
  const k = `${sig}|${dayStart}`; const hit = dayCache.get(k); if (hit) return hit;
  const key = etDateKey(dayStart + HOUR); // +1h guards DST edge
  const wd = new Date(`${key}T12:00:00Z`).getUTCDay();
  const info = { start: dayStart, next: etMidnight(dayStart + DAY + 2 * HOUR), working: !(wd === 0 || wd === 6 || holidays.has(key)) };
  dayCache.set(k, info); return info;
}

const setCache = new Map<string, Set<string>>();
/** Business hours between a and b (0 if b <= a). */
export function businessHoursBetween(aMs: number, bMs: number, holidays: readonly string[] = [], clock: "business" | "calendar" = "business"): number {
  if (!(bMs > aMs)) return 0;
  if (clock === "calendar") return (bMs - aMs) / HOUR;
  const sig = holidays.join(",");
  let hs = setCache.get(sig); if (!hs) { hs = new Set(holidays); setCache.set(sig, hs); }
  let total = 0; let dayStart = etMidnight(aMs); let guard = 0;
  while (dayStart < bMs && guard++ < 5000) {
    const d = dayInfo(dayStart, hs, sig);
    if (d.working) { const s = Math.max(aMs, dayStart); const e = Math.min(bMs, d.next); if (e > s) total += e - s; }
    dayStart = d.next;
  }
  return total / HOUR;
}

export const bdFromBh = (bh: number) => bh / 24;
export const cdBetween = (aMs: number, bMs: number) => Math.max(0, bMs - aMs) / DAY;

/** "5 h" under one business day, else "1.3 bd". */
export function formatDuration(bh: number | null): string {
  if (bh == null || Number.isNaN(bh)) return "—";
  if (bh < 24) return `${Math.round(bh)} h`;
  return `${(bh / 24).toFixed(1)} bd`;
}

export function periodBounds(snapshotAt: number, periodDays: number): { start: number; end: number; priorStart: number } {
  return { end: snapshotAt, start: snapshotAt - periodDays * DAY, priorStart: snapshotAt - 2 * periodDays * DAY };
}
