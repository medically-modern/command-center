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
