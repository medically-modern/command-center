/**
 * Is this patient Cash Pay? — the ONE rule, shared by every surface.
 *
 * A cash pay patient has no insurance and no benefit check. They are marked by
 * **General Insurance = "Cash Pay"** at intake, which the page mirrors into
 * **Primary Insurance = "Cash Pay"**; that second value is what travels to
 * Welcome Call, Subscription and the Order board, and it is what the order
 * board's cash-pay actions key on (Brandon, 2026-08-18).
 *
 * Lives in `lib/shared` because five slices read it — `profile`,
 * `welcomeCall`, `finalConfirm`, `orders` and the Comms Hub dossier. A copy
 * per slice is the §5.7/§5.17 hand-synced hazard, and here its failure mode is
 * money: a surface that stops recognising a cash pay patient either bills them
 * nothing or lets their order reach Cardinal unpaid.
 *
 * ⚠️⚠️ **THE LABEL ID IS PER BOARD AND THE FOUR BOARDS AGREEING IS A
 * COINCIDENCE.** Monday assigns a status label's id from the lowest free slot
 * at creation time, so the id is a property of that COLUMN's history and never
 * of the payer (§5.33, which records this trap costing a whole pipeline's
 * worth of blank payer cells). All four columns below happened to have slot
 * 152 free on 2026-09-21 — that is luck, not a rule. Never collapse
 * `CASH_PAY_LABEL_ID` to a single constant, and never infer a fifth board's id
 * from these; read it back from `settings_str` (§5.12 · §5.20 · §5.31c ·
 * §5.31d · §5.33 — six times now).
 */

/** The board's own spelling. Every write goes out as this exact string. */
export const CASH_PAY_LABEL = "Cash Pay";

/**
 * Per-board label ids, each read back from the live `settings_str` on the date
 * shown. Written by index, never by text, because a write to a label id a
 * column does not have is dropped at HTTP 200 with nothing in the logs.
 */
export const CASH_PAY_LABEL_ID = {
  /** Profile Send Off `color_mm24ap4j` General Insurance — pre-existing. */
  profileSendOffGeneral: 16,
  /** Profile Send Off `color_mm1xg10n` Primary Insurance — added 2026-09-21. */
  profileSendOffPrimary: 152,
  /** Welcome Call `color_mm1x157j` Primary Insurance — added 2026-09-21. */
  welcomeCall: 152,
  /** Subscription `color_mm254qxj` Primary Insurance — added 2026-09-21. */
  subscription: 152,
  /** New Order `color_mm18jhq5` Primary Insurance — pre-existing. */
  newOrder: 152,
} as const;

/**
 * Deliberately an EXACT match on the trimmed, case-folded label — not a
 * prefix, not a substring.
 *
 * §5.32c took the opposite call for Humana (`/^humana\b/i`) because there the
 * safe direction is to keep checking: an over-broad match costs a rep one
 * question. Here the safe direction is the reverse. A substring rule would
 * make any future payer whose name contains "cash pay" — a "Cash Pay Plan",
 * say — silently skip the benefit check and route past Medical Necessity and
 * Insurance. Widening this is a decision with a population behind it, not a
 * tidy-up.
 */
export function isCashPay(payer: string | null | undefined): boolean {
  return (payer ?? "").trim().toLowerCase() === CASH_PAY_LABEL.toLowerCase();
}

/**
 * A patient is cash pay if EITHER payer column says so.
 *
 * Both are checked because the two are set at different moments and either can
 * be the only one filled in: General Insurance is what the rep picks at intake,
 * Primary Insurance is what the page mirrors and what travels downstream. A
 * board row that arrived by some other route may carry only one. Reading just
 * one column is how a cash pay patient reads as insured on one screen and cash
 * pay on the next.
 */
export function isCashPayPatient(p: {
  generalInsurance?: string | null;
  primaryInsurance?: string | null;
}): boolean {
  return isCashPay(p.generalInsurance) || isCashPay(p.primaryInsurance);
}
