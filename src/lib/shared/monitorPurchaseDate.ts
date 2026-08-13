/**
 * Monitor Purchase Date — the CGM twin of "Medicare Prior Pump Date".
 *
 * WHY IT EXISTS (Brandon, 2026-08-13). When we are not selling a monitor
 * (Monitor Qty ≠ 1) an Original-Medicare patient already owns one, and Medicare
 * needs an obtained-date on file to bill the sensors (A4239) against that
 * patient-owned monitor (E2103). Same argument as the pump's prior-purchase
 * date, one product over.
 *
 * WHY IT AUTO-FILLS, unlike the pump. The pump path writes the literal "TBD"
 * and makes the Welcome Call rep ask the patient for the real date. The monitor
 * deliberately does NOT: when the Same-or-Similar check comes back with no
 * billing history there is no record to source a date from, so rather than
 * leave the field blank we stamp a rolling placeholder ~24 months back. That
 * is an explicit product decision (Josh relaying Brandon, 2026-08-13) — do not
 * "align" it with the pump's TBD behaviour without asking them first.
 *
 * WHY 24 MONTHS. A monitor's reasonable useful lifetime under Medicare is
 * 5 years (`samantha/benefitsDerive.ts` `sosLookbackDays`), so a two-year-old
 * date sits inside the lifetime — it asserts the patient owns a monitor that is
 * still current, which is what justifies billing sensors without billing a new
 * monitor. The window is ROLLING (today − 24 months), not the fixed 05/2024
 * from the original request: a hardcoded constant drifts further from "two
 * years ago" every month it survives.
 *
 * WHY THIS IS ONE SHARED MODULE and not the pump's duplicate-and-test-agreement
 * shape: the rule carries date math, and the newer convention in this codebase
 * is extraction over duplication (CLAUDE.md §5.12, `masheke/attemptLog.ts`).
 * Welcome Call and Final Confirm both re-export from here, so they cannot
 * drift. `monitorPurchaseDate.test.ts` still pins the rule against both roles'
 * own `isOriginalMedicare` / `servingIncludesCgm` helpers.
 */

/** How far back the placeholder sits when SoS reports no billing history. */
export const MONITOR_PLACEHOLDER_MONTHS_BACK = 24;

/**
 * ET today as YYYY-MM-DD. Monday dates are timezone-naive ET (CLAUDE.md §9),
 * so a bare `new Date()` in a UTC runtime lands on the wrong day either side of
 * midnight — which, for a month-granularity field, silently shifts the
 * placeholder into the previous month on the 1st.
 */
export function etTodayYmd(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** "2024-05-17" → "05/2024". Returns "" for anything unparseable. */
export function toMonthYear(ymd: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ymd.trim());
  return m ? `${m[2]}/${m[1]}` : "";
}

/**
 * MM/YYYY for `months` before a YYYY-MM-DD date. Pure integer month math — no
 * Date object, so it cannot be pushed across a boundary by DST or the runtime
 * timezone.
 */
export function monthYearMonthsBefore(ymd: string, months: number): string {
  const m = /^(\d{4})-(\d{2})/.exec(ymd.trim());
  if (!m) return "";
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) - months;
  if (total < 0) return "";
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  return `${String(month).padStart(2, "0")}/${year}`;
}

/**
 * Monitor Purchase Date applies only when all three hold: Original Medicare
 * (Medicare A&B — Advantage plans are private Part C and excluded), no monitor
 * being sold (Monitor Qty ≠ 1), AND serving includes CGM — a pump-only patient
 * is never asked for it.
 *
 * Blank serving is trusted as CGM-served, mirroring `needsPriorPumpDate`: a
 * column that failed to read must not hide the field and wipe a date that was
 * already collected.
 */
export function needsMonitorPurchaseDate(
  primaryInsurance: string,
  monitorQty: string,
  serving: string,
): boolean {
  // Mirrors welcomeCall/finalConfirm `isOriginalMedicare` + `servingIncludesCgm`
  // (agreement pinned by monitorPurchaseDate.test.ts).
  if (primaryInsurance.trim() !== "Medicare A&B") return false;
  // Anything that is not exactly "1" counts as "no monitor being sold" — blank
  // included. The Welcome Call toggle only ever writes "0" or "1", so a blank
  // means an item no rep has touched yet, not an unknown. Same rule the pump
  // uses for Pump Qty.
  if (monitorQty.trim() === "1") return false;
  return serving.trim() === "" || serving.toLowerCase().includes("cgm");
}

export interface MonitorPurchaseDateInput {
  /** Current field value (MM/YYYY free text) as the rep has it. */
  current: string;
  primaryInsurance: string;
  monitorQty: string;
  serving: string;
  /** "CGM Monitor SoS Last Bill" `date_mm599gk8` — YYYY-MM-DD or "". */
  sosLastBillMonitor: string;
  /** "CGM Monitor SoS No Billing History" `boolean_mm5ad9rm`. */
  sosNeverBilledMonitor: boolean;
  /** ET today as YYYY-MM-DD. Injected by tests; defaults to the real clock. */
  todayYmd?: string;
}

/**
 * The whole rule, in precedence order:
 *
 *   1. Not eligible          → "" (clears a value that no longer applies)
 *   2. Already has a value   → keep it. A rep's real answer always wins, and
 *                              nothing here ever overwrites one.
 *   3. Real SoS last bill    → use it. An actual billing date beats a
 *                              placeholder whenever we have one.
 *   4. SoS says never billed → the rolling ~24-months-back placeholder.
 *   5. No SoS answer yet     → "". Benefits has not reached this patient, so
 *                              there is nothing to assert; the rep asks.
 *
 * Because step 2 keys on emptiness, clearing the field re-fills it on the next
 * pass (Josh, 2026-08-13). The rep's escape hatch is to overwrite it with the
 * real date, not to blank it.
 */
export function deriveMonitorPurchaseDate(i: MonitorPurchaseDateInput): string {
  if (!needsMonitorPurchaseDate(i.primaryInsurance, i.monitorQty, i.serving)) return "";
  const current = i.current.trim();
  if (current !== "") return current;
  const lastBill = toMonthYear(i.sosLastBillMonitor);
  if (lastBill) return lastBill;
  if (i.sosNeverBilledMonitor) {
    return monthYearMonthsBefore(i.todayYmd ?? etTodayYmd(), MONITOR_PLACEHOLDER_MONTHS_BACK);
  }
  return "";
}
