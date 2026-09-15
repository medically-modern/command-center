/**
 * Next Order Date cadence — ONE rule, shared by the Insurance stage and the
 * Welcome Call stage.
 *
 * ⚠️ **The two stages used to compute the same three columns by different
 * rules**, and the disagreement was invisible because Welcome Call only fills
 * a blank (`effectiveNextOrder` prefers an explicit edit, then the board
 * value). So Insurance's payer-aware answer normally won, and the Welcome Call
 * rule surfaced exactly where Insurance had written nothing — which is the
 * auth-deferred / Skip-SoS population, i.e. the patients whose reorder cadence
 * was least understood:
 *
 *                   │ Insurance (samantha/workflow) │ Welcome Call (before)
 *   ────────────────┼───────────────────────────────┼──────────────────────
 *   Insulin pump    │ last bill + 4 yr (5 Medicare) │ last bill + 90 DAYS
 *   Sensors         │ + 30 / 60 / 90 by units       │ + 90 days, flat
 *   Supplies        │ + 60 Medicaid / 90            │ + 90 days, flat
 *   No last bill    │ "" (blank — an honest gap)    │ TODAY (fabricated)
 *   Sensors input   │ the sensors bill              │ sensors OR THE MONITOR
 *
 * Measured on the live boards 2026-09-15: two Completed patients carried an
 * insulin-pump reorder 90 days after their last pump (Medicare's RUL is five
 * years), and **89 CGM-serving Welcome Call rows carried a Sensors Next Order
 * Date with no billing evidence of any kind behind it** — no sensors date, no
 * monitor date, no never-billed checkbox. Those 89 dates fall on a weekday
 * 89 times out of 89; the control group (rows with a real sensors last bill)
 * lands on a weekend 15 times in 93, as +90-day arithmetic must. They were not
 * computed from anything — they are the day the rep pressed Send.
 *
 * ⚠️ **No evidence must produce a BLANK, never today.** A blank is a gap
 * somebody can see and fill (Final Confirm's C29 flags one on a served line);
 * "today" is a reorder cadence that looks real and is not. That is the same
 * rule the Insurance stage has always followed, and the same reasoning as
 * `monitorSale`'s empty verdict (CLAUDE.md §5.31) — absent data is UNKNOWN,
 * never an answer.
 *
 * ⚠️ **The sensors line reads the SENSORS bill and nothing else.** Falling back
 * to the CGM MONITOR's date conflates a 90-day consumable with a five-year
 * device: a monitor billed last month would put sensors "due" in 90 days
 * whatever the sensors history says, and a monitor billed three years ago would
 * put them overdue. It is what produced Hope Hebb's wrong reorder date once her
 * sensors date had been erased (CLAUDE.md §5.32e). The SUPPLIES line still
 * takes the later of infusion sets and cartridges — those two genuinely ship as
 * one order, which is Brandon's own rule.
 *
 * Keep this in lockstep with `samantha/workflow.computeNextOrderDates`, which
 * is the same rule applied at Benefits; `nextOrderCadence.test.ts` pins the two
 * against each other so they cannot drift (the `monitorSale` /
 * `benefitsDerive` precedent — `lib/shared/*` must not import a role slice, so
 * the rule is stated once here and both slices call it).
 */

export type NextOrderLine = "insulin_pump" | "sensors" | "supplies";

export interface NextOrderCadence {
  line: NextOrderLine;
  /** CGM Sensors SoS Units. One billed unit is a 30-day supply, two is 60.
   *  Sensors only — ignored on the other two lines. */
  units?: string;
  /** Primary insurance is traditional Medicare A&B (5-year pump RUL, else 4). */
  isMedicare?: boolean;
  /** Medicaid on either policy — a 60-day supplies cadence, else 90. */
  isMedicaid?: boolean;
}

/** A4239 (CGM Sensors) offset — sensors ONLY. Mirrors
 *  `samantha/workflow.sensorsNextOrderOffsetDays`. */
export function sensorsOffsetDays(units: string | undefined): number {
  const n = Number((units ?? "").trim());
  if (n === 1) return 30;
  if (n === 2) return 60;
  return 90;
}

/** How many days after the governing last bill this line comes due. */
export function nextOrderOffsetDays(c: NextOrderCadence): number {
  switch (c.line) {
    // Reasonable useful lifetime, in 365-day multiples to match the
    // same-or-similar window (benefitsDerive.sosLookbackDays).
    case "insulin_pump":
      return c.isMedicare ? 365 * 5 : 365 * 4;
    case "sensors":
      return sensorsOffsetDays(c.units);
    case "supplies":
      return c.isMedicaid ? 60 : 90;
  }
}

/** Does either policy name Medicaid? Mirrors the Insurance stage's test. */
export function hasMedicaidPolicy(
  primaryInsurance: string | null | undefined,
  secondaryInsurance: string | null | undefined,
): boolean {
  return (
    (primaryInsurance ?? "").toLowerCase().includes("medicaid") ||
    (secondaryInsurance ?? "").toLowerCase().includes("medicaid")
  );
}

/**
 * Add days to a `YYYY-MM-DD` date, in UTC.
 *
 * ⚠️ Anchored with `Date.UTC` and read back with the UTC getters, never
 * `new Date("YYYY-MM-DDT00:00:00")` + `toISOString()`. That pattern builds a
 * LOCAL midnight and renders it in UTC, so east of UTC it hands back the day
 * BEFORE — CLAUDE.md §9's standing trap, and a next-order date that is a day
 * early reads as authoritative rather than as a bug. Anything that is not a
 * leading `YYYY-MM-DD` comes back "".
 */
export function addDaysUtc(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((ymd ?? "").trim());
  if (!m) return "";
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t + days * 86_400_000);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * This line's next order date: the LATEST governing last bill plus the line's
 * cadence — or `""` when there is no last bill to compute from.
 *
 * ⚠️ `""` is the whole point. See the header: an absent reorder date is a gap
 * somebody can fill, a fabricated one is not.
 */
export function computeNextOrderDate(
  lastBillDates: Array<string | undefined>,
  cadence: NextOrderCadence,
): string {
  const valid = lastBillDates
    .map((d) => (d ?? "").trim())
    .filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d))
    .map((d) => d.slice(0, 10));
  if (valid.length === 0) return "";
  // Lexicographic max is the chronological max for zero-padded YYYY-MM-DD.
  const latest = valid.reduce((a, b) => (a >= b ? a : b));
  return addDaysUtc(latest, nextOrderOffsetDays(cadence));
}
