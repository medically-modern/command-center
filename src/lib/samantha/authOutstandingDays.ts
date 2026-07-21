/**
 * Days Auth Outstanding — days since the EARLIEST Auth Submission Date
 * across the patient's products (Auth Outstanding redesign handoff §12).
 *
 * Two sources, one number:
 *   - The board column `COL.daysAuthOutstanding` (numeric_mm5f5ars) is
 *     recalculated daily by the baseline-cron Railway service so Monday
 *     filters/automations can use it (e.g. auto-escalate at N days).
 *   - The SPA prefers a LIVE computation from the per-product Auth
 *     Submission Dates it already reads, falling back to the column when
 *     the dates aren't hydrated (or the patient predates them).
 *
 * COUNTING CONTRACT: services/baseline-cron/index.mjs
 * (recalcDaysAuthOutstanding) mirrors this math for the daily column
 * write — change both together or the badge and the board will disagree.
 */
import type { Patient } from "./workflow";
import { etTodayYmd } from "./benefitsDerive";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** Normalize an Auth Submission Date string to YYYY-MM-DD.
 *  The columns are TEXT filled from `<input type="date">` (ISO), but accept
 *  MM/DD/YYYY too — Monday text hops have been known to reformat dates. */
export function normalizeSubmissionYmd(raw: string | undefined | null): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  if (ISO_RE.test(s)) return s;
  const us = US_RE.exec(s);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  return "";
}

/** Earliest normalized Auth Submission Date across the patient's products,
 *  or "" when none is recorded. */
export function earliestAuthSubmissionYmd(p: Patient): string {
  const dates = Object.values(p.insurance?.codes ?? {})
    .map((s) => normalizeSubmissionYmd(s?.authSubmissionDate))
    .filter(Boolean)
    .sort();
  return dates[0] ?? "";
}

/** Whole days from `fromYmd` to `toYmd` (UTC math, DST-safe). Null on bad input. */
export function daysBetweenYmd(fromYmd: string, toYmd: string): number | null {
  const a = ISO_RE.exec(fromYmd);
  const b = ISO_RE.exec(toYmd);
  if (!a || !b) return null;
  const from = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const to = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((to - from) / 86_400_000);
}

/** Days the auth has been outstanding: live-computed from the earliest Auth
 *  Submission Date when available, else the cron-maintained board column.
 *  Clamped at 0 (a future-dated submission shows 0, not a negative).
 *  Returns null when neither source has data. */
export function daysAuthOutstanding(
  p: Patient,
  todayYmd: string = etTodayYmd(),
): number | null {
  const earliest = earliestAuthSubmissionYmd(p);
  if (earliest) {
    const d = daysBetweenYmd(earliest, todayYmd);
    if (d !== null) return Math.max(0, d);
  }
  if (typeof p.daysAuthOutstanding === "number") {
    return Math.max(0, Math.round(p.daysAuthOutstanding));
  }
  return null;
}
