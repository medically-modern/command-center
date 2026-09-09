/**
 * Order Frequency — Brandon, 2026-09-09: *"call it that, not 'Supply length',
 * so it matches the boards"*.
 *
 * This is the same number the notes block used to carry as `supplyLength`. It
 * is now a real Monday column, which changes what "is this the rep's answer or
 * ours?" means: the COLUMN is the record, so the payer default only fills a
 * blank and there is no `supplyLengthManual` flag to keep honest (§5.31 records
 * how hard that was to get right when the value lived only in a note).
 */
import { supplyLengthDays, supplyLengthOptions } from "./payerRules";

/** ⚠️ Read off the LIVE column 2026-09-09. Monday assigned these from the
 *  label COLOUR, not the `index` the create call asked for — the §5.12/§5.20
 *  trap — and a write to an index the column doesn't have is dropped without
 *  an error. Never infer these; read them back. */
export const ORDER_FREQUENCY_INDEX: Record<string, number> = {
  "30-Days": 154,
  "60-Days": 16,
  "75-Days": 3,
  "90-Days": 107,
};

/** "60" → "60-Days". The board speaks in labels, the rules in days. */
export function daysToLabel(days: string): string {
  const d = (days ?? "").trim();
  return d ? `${d}-Days` : "";
}

/** "60-Days" → "60". */
export function labelToDays(label: string): string {
  const m = /^(\d+)-Days$/.exec((label ?? "").trim());
  return m ? m[1] : "";
}

export interface FrequencyState {
  /** Days, as the card shows them: "30" · "60" · "75" · "90". */
  days: string;
  /** What may be picked for this payer — 75 is Aetna-only (§5.31). */
  options: string[];
  /** No answer on the board and none from the rep: we are showing OUR guess. */
  auto: boolean;
  /** The rep has changed it this session. */
  edited: boolean;
  /** The muted hint Brandon asked for, or "" when neither applies. */
  hint: string;
}

/**
 * What the card should show.
 *
 * ⚠️ Precedence is rep → board → payer default, and the HINT follows from which
 * one answered. Brandon: *"one muted hint only while the value is auto-set…
 * that flips to 'edited' once the rep changes it"* — so a value already on the
 * board gets no hint at all: it is neither our guess nor this call's edit.
 */
export function frequencyState(args: {
  boardLabel: string;
  edited: string | null;
  primaryInsurance: string;
  secondaryInsurance: string;
}): FrequencyState {
  const options = supplyLengthOptions(args.primaryInsurance);
  const derived = String(supplyLengthDays(args.primaryInsurance, args.secondaryInsurance));
  const fromBoard = labelToDays(args.boardLabel);

  /* ⚠️ An ineligible value is ignored WHEREVER IT CAME FROM, and that is the
     whole rule: 75 days is Aetna-only, so a patient already carrying 75-Days on
     the board whose payer is corrected away from Aetna must not keep it. The
     first cut only re-checked the rep's own edit and returned the board value
     untouched — so the correction changed the payer, the card went on showing
     75, and the send wrote its index again. Checking here rather than in an
     effect means the card and the send read the same answer and neither can
     drift (Greptile, PR #56). */
  if (args.edited !== null && options.includes(args.edited)) {
    return { days: args.edited, options, auto: false, edited: true, hint: "edited" };
  }
  if (fromBoard && options.includes(fromBoard)) {
    return { days: fromBoard, options, auto: false, edited: false, hint: "" };
  }
  const medicaid = derived === "60";
  return {
    days: derived,
    options,
    auto: true,
    edited: false,
    hint: medicaid ? "default for Medicaid" : `default — ${derived} days`,
  };
}

/**
 * A payer correction can strand a choice the new payer doesn't offer — pick 75
 * for Aetna, then fix the plan to a non-Aetna one. Same rule §5.31 needed for
 * the notes-block version, and it has to survive the move to a column: nothing
 * downstream re-checks the value, so the send would write a cadence that payer
 * will not pay for.
 */
export function frequencyInvalidated(days: string, primaryInsurance: string): boolean {
  const d = (days ?? "").trim();
  if (!d) return false;
  return !supplyLengthOptions(primaryInsurance).includes(d);
}
