/**
 * All dates in the app should be anchored to Eastern Time (America/New_York).
 * This module provides helpers so every "today" or "now" calculation uses ET
 * regardless of the user's local timezone.
 */

const ET = "America/New_York";

/** Return a YYYY-MM-DD string for "today" in Eastern Time. */
export function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Return a Date object whose local year/month/day match the current ET date.
 *  Useful when you need to do arithmetic (addBusinessDays, etc.). */
export function etNow(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return new Date(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
}

/** Format a Date as YYYY-MM-DD using its LOCAL components (so a Date produced
 *  by etNow() round-trips as the ET calendar day, not a UTC-shifted one). */
export function formatDateInput(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** "6/12/26" from a Date whose components are already ET (etNow). */
export function formatDateShort(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}

/** "6/12/26, 2:33 PM" — expects a Date whose components are already ET (etNow). */
export function formatDateTimeShort(d: Date): string {
  const h24 = d.getHours();
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 || 12;
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${formatDateShort(d)}, ${h}:${mins} ${ampm}`;
}

/** Add N business days (skipping Sat/Sun) to a Date, returning a new Date. */
export function addBusinessDays(date: Date, days: number): Date {
  const out = new Date(date);
  let added = 0;
  while (added < days) {
    out.setDate(out.getDate() + 1);
    const day = out.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return out;
}

/** Add N business days to a YYYY-MM-DD string, returning YYYY-MM-DD. */
export function addBusinessDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return formatDateInput(addBusinessDays(new Date(y, m - 1, d), days));
}

/** Add N CALENDAR days to a YYYY-MM-DD string, then weekend-clamp the result. */
export function addCalendarDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return clampToBusinessDay(formatDateInput(dt));
}

/**
 * Clamp a YYYY-MM-DD date string to the next business day if it falls on a
 * weekend (Sat → +2 days, Sun → +1 day). Weekday dates pass through
 * unchanged. Used so a Next Action Date can NEVER land on a Saturday or
 * Sunday, regardless of how it was produced (auto-computed or hand-picked).
 */
export function clampToBusinessDay(iso: string): string {
  if (!iso) return iso;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  const dt = new Date(y, m - 1, d);
  const dow = dt.getDay();
  if (dow === 6) dt.setDate(dt.getDate() + 2); // Saturday → Monday
  else if (dow === 0) dt.setDate(dt.getDate() + 1); // Sunday → Monday
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}
