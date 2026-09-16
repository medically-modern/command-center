/**
 * The Care Coordinator card's pill row — fixed columns, fixed order, colours.
 *
 * Brandon, 2026-09-16: the row was `string[]` built by two helpers that dropped
 * blanks, rendered `flex flex-wrap`. Because blanks were removed the pills slid
 * left, so no two cards lined up and nothing said which field a pill was. It is
 * now a SLOT per field — always rendered, a faint em dash when blank, a caption
 * underneath — laid out on a grid with fixed tracks.
 *
 * ⚠️ **HIS TWO NOTES CONTRADICT EACH OTHER AND THE COLOURS WIN.** The layout
 * spec ends "All pills neutral gray"; the note immediately above it asks for
 * Completed green / Partial gray, Insulin green / Hypo yellow / Neither light
 * red, and Insurance green whenever anything is listed. Josh resolved it the
 * same day: "take #6's layout and #5's colours". So the grid is his, and the
 * one line about neutral pills is not.
 *
 * ⚠️ Two states he did not give a colour to stay NEUTRAL rather than being
 * guessed at, and both are real values on the live board:
 *  · CGM Coverage Path's fourth label, **"Not Serving"** (the column is
 *    Insulin · Hypo · Not Serving · Neither Applies).
 *  · Every label of the Insulin **Pump** path column, which is a different
 *    vocabulary entirely (Not Serving · IW New Insurance · Omnipod Switch ·
 *    OOW Pump · 1st Pump >6M · 1st Pump <6M · Supplies Only). His
 *    Insulin/Hypo/Neither rule is about the CGM column.
 * A wrong colour reads as a judgement the app has not made; neutral reads as
 * "no rule for this yet", which is the truth.
 */

/** One field per slot, in the order they sit on the card. */
export type PillSlotKey = "requestType" | "insurance" | "ipPath" | "cgmPath" | "status";

export type PillSlots = Partial<Record<PillSlotKey, string>>;

export type PillTone = "neutral" | "green" | "yellow" | "red";

export interface PillSlotDef {
  key: PillSlotKey;
  /** The small caption under the pill. */
  caption: string;
  /** The full field name, used in the tooltip so a shortened label is never lossy. */
  field: string;
  /** 1-based CSS grid column. The gaps between them are spacer tracks. */
  column: number;
}

/**
 * ⚠️ The spacer tracks are why these are 1 · 3 · 5 · 6 · 8 rather than 1–5.
 * `PILL_GRID_TEMPLATE` interleaves fixed `.5rem` columns so Request type,
 * Insurance, the two paths and Form read as four groups rather than five
 * evenly spread cells. Change one and change the other.
 */
export const PILL_SLOTS: readonly PillSlotDef[] = [
  { key: "requestType", caption: "Request type", field: "Request type", column: 1 },
  { key: "insurance", caption: "Insurance", field: "Insurance", column: 3 },
  { key: "ipPath", caption: "Pump path", field: "Insulin pump coverage path", column: 5 },
  { key: "cgmPath", caption: "CGM path", field: "CGM coverage path", column: 6 },
  { key: "status", caption: "Form", field: "Web form", column: 8 },
];

export const PILL_GRID_TEMPLATE =
  "minmax(0,1.1fr) .5rem minmax(0,1fr) .5rem minmax(0,.95fr) minmax(0,.95fr) .5rem 5.1rem";

/**
 * Display labels, so a long board value does not blow out a fixed track.
 *
 * ⚠️ The FULL value always survives in the pill's `title`, so shortening is
 * never lossy — which is the only reason it is safe to do at all on a column
 * whose vocabulary reps recognise by sight.
 */
const SHORT: Record<string, string> = {
  "Insulin Pump + CGM": "Pump + CGM",
  "1st Pump >6M Diagnosed": "1st Pump >6M",
  "1st Pump <6M Diagnosed": "1st Pump <6M",
  "United Healthcare": "UHC",
  "Anthem / BCBS": "Anthem/BCBS",
  "Health Plans Inc (PHCS)": "PHCS",
  "Neither Applies": "Neither",
};

export function shortLabel(value: string): string {
  const v = (value || "").trim();
  return SHORT[v] ?? v;
}

/**
 * The colour a slot's value earns (Brandon, 2026-09-16).
 *
 * Matched on the board's own label text, exactly — these are status columns
 * with fixed vocabularies, and a loose match would colour a future label by
 * accident. Anything unrecognised is neutral.
 */
export function pillTone(slot: PillSlotKey, value: string): PillTone {
  const v = (value || "").trim();
  if (!v) return "neutral";
  if (slot === "status") return v === "Completed" ? "green" : "neutral";
  if (slot === "insurance") return "green";
  if (slot === "cgmPath") {
    if (v === "Insulin") return "green";
    if (v === "Hypo") return "yellow";
    if (v === "Neither Applies") return "red";
    return "neutral";
  }
  return "neutral";
}

/**
 * What the Insurance slot says for a Patient Intake lead.
 *
 * ⚠️ **A CARD PHOTO IS AN ANSWER.** Of the 20 live rows that answered "Photo
 * of card", 18 have a BLANK General Insurance — the carrier is on the photo and
 * nobody has typed it in yet — so reading the status column alone rendered
 * nothing at all for exactly the patients who had supplied the most (Brandon,
 * on Debra Collins). "Card on file" is the honest thing to say about them.
 *
 * ⚠️ **"Not provided" must stay BLANK.** It is a real answer, and it is the one
 * answer that is not insurance information; showing it would put a green pill
 * on a patient who has given us nothing. Blank with a faint em dash is right.
 *
 * ⚠️ A General Insurance of **"Other"** is a routing bucket, not a carrier, so
 * the free-text column behind it wins where it has anything (3 live rows:
 * "Health partners", "QualChoice", "CHRISTUS HEALTH PLAN").
 */
export function intakeInsurance(lead: {
  generalInsurance: string;
  insuranceProvidedVia: string;
  insuranceOther: string;
}): string {
  const general = (lead.generalInsurance || "").trim();
  const other = (lead.insuranceOther || "").trim();
  if (general && general !== "Other") return general;
  if (general === "Other") return other || "Other";

  switch ((lead.insuranceProvidedVia || "").trim()) {
    case "Photo of card": return "Card on file";
    case "Entered manually": return other || "Entered manually";
    default: return "";
  }
}
