/**
 * lib/shared/monitorSale.ts — "can we send this patient a monitor?"
 *
 * ── WHY (Brandon + Josh, 2026-09-09) ──
 * Medicare pays for a CGM monitor (E2103) once per reasonable useful lifetime,
 * which is **5 years**. So the Same-or-Similar answer decides two things at
 * once on the Welcome Call, and until now the app only used it for one:
 *
 *   1. **Is a monitor sellable?** (Monitor Qty 1 vs 0)
 *   2. **What goes in Monitor Purchase Date?** (`shared/monitorPurchaseDate.ts`)
 *
 * Brandon asked for the first to be pre-filled and for the second to explain
 * itself: *"Filled from the monitor's SoS last bill date — [can/can't send
 * monitor] (based on if it's been 5-years or not)"*.
 *
 * ⚠️ **The verdict is computed from the SoS columns, NEVER from the purchase
 * date field.** The original spec said "default Monitor Qty to 1 when the
 * purchase date is empty", which is circular: `needsMonitorPurchaseDate`
 * returns false once Qty is 1, so `deriveMonitorPurchaseDate` clears the date,
 * which keeps the default latched on with no obvious way back for the rep.
 * Keying off the SoS facts breaks that loop — the two rules read different
 * inputs and can no longer chase each other.
 *
 * ⚠️ **An empty verdict is UNKNOWN, never "no".** No SoS answer means Benefits
 * has not reached this patient, not that they own nothing. Defaulting a sale on
 * absent data is the same class of harm as the pump that shipped to a
 * supplies-only patient (CLAUDE.md §5.22, $3,787): we would be billing Medicare
 * for a device we have no evidence they need. The rep is asked instead.
 *
 * ⚠️ **The cutoff is counted in DAYS, not calendar years** —
 * `MONITOR_LIFETIME_DAYS` mirrors `samantha/benefitsDerive.ts`
 * `sosLookbackDays("cgm-monitor", …, isMedicare = true)`, which is `365 * 5`,
 * and `daysBeforeYmd` mirrors that module's `addDaysYmd`. Subtracting five
 * CALENDAR years instead is off by one day for every span containing a leap
 * day: from 2026-09-09 the Insurance stage's cutoff is **2021-09-10** (1,825
 * days) while calendar math gives 2021-09-09, so a patient last billed
 * 2021-09-09 reads Clear on the Insurance board and `cannot-send` here — two
 * stages disagreeing about one patient, which is the drift this codebase keeps
 * getting bitten by. Caught by Greptile on PR #55 before it shipped.
 * ⚠️ It is duplicated rather than imported because `lib/shared/*` must not
 * depend on a role slice — the same call `monitorPurchaseDate.ts` makes one
 * file over. `monitorSale.test.ts` pins the two by comparing the actual
 * CUTOFF DATES across a range of days, not just the constant: the constant
 * matched all along while the arithmetic around it did not.
 *
 * ── WHAT THIS DOES NOT DO ──
 * It does not touch Monitor Purchase Date. The rolling ~24-month placeholder
 * that `deriveMonitorPurchaseDate` stamps when SoS reports no billing history
 * **stays exactly as it is** — Josh confirmed 2026-09-09 that it is SOP. The
 * two modules compose: the default here is to SELL (Qty 1), and a rep who flips
 * Qty back to 0 re-reveals the date field, where the placeholder fills in as it
 * always has.
 */

/** Medicare's reasonable useful lifetime for a CGM monitor, in years — for copy. */
export const MONITOR_LIFETIME_YEARS = 5;

/**
 * The same lifetime as the Insurance stage counts it: whole days, never
 * calendar years. Must equal `sosLookbackDays("cgm-monitor", …, isMedicare)`.
 */
export const MONITOR_LIFETIME_DAYS = 365 * MONITOR_LIFETIME_YEARS;

export type MonitorSaleState =
  /** The lifetime has run out (or Medicare has no record) — a monitor is billable. */
  | "can-send"
  /** They own one that is still inside its lifetime — do not sell another. */
  | "cannot-send"
  /** No Same-or-Similar answer yet. The rep asks. */
  | "unknown";

export interface MonitorSaleVerdict {
  state: MonitorSaleState;
  /** SoS last bill as YYYY-MM-DD, or "" when there is none. */
  lastBill: string;
  /** SoS positively reported no billing history. */
  neverBilled: boolean;
  /** What Monitor Qty should pre-fill to. "" means "make the rep answer". */
  defaultQty: "" | "0" | "1";
  /** The rep-facing sentence rendered under the field. */
  note: string;
  /** How to colour it: green = sellable, amber = already owns one, grey = unknown. */
  tone: "green" | "amber" | "grey";
}

export interface MonitorSaleInput {
  /** "CGM Monitor SoS Last Bill" `date_mm599gk8` — YYYY-MM-DD or "". */
  sosLastBillMonitor: string;
  /** "CGM Monitor SoS No Billing History" `boolean_mm5ad9rm`. */
  sosNeverBilledMonitor: boolean;
  /** ET today as YYYY-MM-DD. Injected by tests; defaults to the real clock. */
  todayYmd?: string;
}

/**
 * ET today as YYYY-MM-DD. Monday dates are timezone-naive ET (CLAUDE.md §9), so
 * a bare `new Date()` in a UTC container lands on the wrong day either side of
 * midnight — which here would move the 5-year cutoff by a day and flip a
 * borderline patient's verdict.
 */
export function etTodayYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * The date `days` before `todayYmd`, as YYYY-MM-DD.
 *
 * ⚠️ Deliberately the SAME implementation as `benefitsDerive.addDaysYmd` —
 * UTC-anchored day arithmetic — so the two stages' cutoffs are identical by
 * construction rather than by coincidence. Anchoring at UTC is safe here
 * because both operands are bare dates with no time component.
 */
export function daysBeforeYmd(todayYmd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayYmd.trim());
  if (!m) return "";
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** "2024-05-17" → "05/2024". "" for anything unparseable. */
function monthYear(ymd: string): string {
  const m = /^(\d{4})-(\d{2})/.exec((ymd ?? "").trim());
  return m ? `${m[2]}/${m[1]}` : "";
}

/**
 * The whole rule, in precedence order:
 *
 *   1. A real SoS last bill → compare it to the 5-year cutoff. An actual
 *      billing date beats everything; it is the only positive evidence of what
 *      the patient already has.
 *   2. SoS says never billed → Medicare has no record of a monitor, so one is
 *      billable. Sell (Josh, 2026-09-09: "never billed - sell them one").
 *   3. Nothing → unknown. Default no quantity and say so.
 *
 * ⚠️ Order matters: a patient can carry BOTH a last-bill date and the
 * never-billed flag if Benefits re-ran after a correction. The date wins,
 * because it is the more specific fact.
 */
export function monitorSaleVerdict(i: MonitorSaleInput): MonitorSaleVerdict {
  const lastBill = (i.sosLastBillMonitor ?? "").trim();
  const neverBilled = !!i.sosNeverBilledMonitor;
  const today = i.todayYmd ?? etTodayYmd();

  if (/^\d{4}-\d{2}-\d{2}$/.test(lastBill)) {
    const cutoff = daysBeforeYmd(today, MONITOR_LIFETIME_DAYS);
    // ISO dates compare lexically. STRICTLY before the cutoff clears it —
    // matching `sosCutoffYmd`'s own "a last bill strictly before this derives
    // Clear", so the two never disagree on a boundary date.
    const expired = !!cutoff && lastBill < cutoff;
    return expired
      ? {
          state: "can-send",
          lastBill,
          neverBilled,
          defaultQty: "1",
          tone: "green",
          note: `Last billed ${monthYear(lastBill)} — over ${MONITOR_LIFETIME_YEARS} years, so a monitor can be sent.`,
        }
      : {
          state: "cannot-send",
          lastBill,
          neverBilled,
          defaultQty: "0",
          tone: "amber",
          note: `Last billed ${monthYear(lastBill)} — inside the ${MONITOR_LIFETIME_YEARS}-year lifetime, so a monitor can't be sent.`,
        };
  }

  if (neverBilled) {
    return {
      state: "can-send",
      lastBill: "",
      neverBilled: true,
      defaultQty: "1",
      tone: "green",
      note: "No Medicare billing history for a monitor — one can be sent.",
    };
  }

  return {
    state: "unknown",
    lastBill: "",
    neverBilled: false,
    defaultQty: "",
    tone: "grey",
    note: "No Same-or-Similar answer yet — check with the patient before setting this.",
  };
}
