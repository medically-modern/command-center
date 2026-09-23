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
 * ⚠️ **…EXCEPT ON THE WELCOME CALL SIDE, FROM 2026-09-17** (Brandon: "get rid
 * of the highlights on the welcome call side for the pills, all should be
 * gray"). The colours are a TRIAGE aid for a calling queue: on Patient Intake
 * the coordinator is scanning hundreds of rows deciding who to ring, and green
 * "they gave us insurance" / red "neither applies" is what makes that scannable.
 * The Welcome Call column is a handful of booked patients she is working one at
 * a time, so the same colours are decoration there — and decoration on one
 * column and signal on the other is how a colour stops meaning anything. Hence
 * `variant`, not a second copy of the table.
 *
 * ⚠️ Two states with no colour of their own stay NEUTRAL rather than being
 * guessed at, on the intake side too, and both are real values on the live
 * board:
 *  · CGM Coverage Path's fourth label, **"Not Serving"** (the column is
 *    Insulin · Hypo · Not Serving · Neither Applies) — and see
 *    `coveragePathPill` below, which blanks it outright.
 *  · Every label of the Insulin **Pump** path column, which is a different
 *    vocabulary entirely (Not Serving · IW New Insurance · Omnipod Switch ·
 *    OOW Pump · 1st Pump >6M · 1st Pump <6M · Supplies Only). His
 *    Insulin/Hypo/Neither rule is about the CGM column.
 * A wrong colour reads as a judgement the app has not made; neutral reads as
 * "no rule for this yet", which is the truth.
 */

/** One field per slot, in the order they sit on the card. */
export type PillSlotKey =
  | "requestType" | "insurance" | "ipPath" | "cgmPath" | "status" | "referralSource";

export type PillSlots = Partial<Record<PillSlotKey, string>>;

export type PillTone = "neutral" | "green" | "yellow" | "red";

/** Which column's card this is. The two differ in slot 5 and in their colours. */
export type PillVariant = "intake" | "welcome";

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
 * Insurance, the two paths and the fifth slot read as four groups rather than
 * five evenly spread cells. Change one and change the other.
 */
const SHARED_SLOTS: readonly PillSlotDef[] = [
  { key: "requestType", caption: "Request type", field: "Request type", column: 1 },
  { key: "insurance", caption: "Insurance", field: "Insurance", column: 3 },
  { key: "ipPath", caption: "Pump path", field: "Insulin pump coverage path", column: 5 },
  { key: "cgmPath", caption: "CGM path", field: "CGM coverage path", column: 6 },
];

/**
 * Slot 5 is the one that differs, and it differs because the two boards hold
 * different facts (Brandon, 2026-09-17: "add referral source as a pill column
 * for the welcome call side only — it replaces the form column on the intake
 * side").
 *
 * ⚠️ A Welcome Call patient never filled in the DTC web form, so "Form" there
 * could only ever be an em dash implying one they skipped — which is why that
 * slot used to be omitted entirely on those cards. Referral Source is the fact
 * that slot is worth spending on for them: it is how the patient reached us,
 * and it is already in the Welcome Call read.
 */
export const PILL_SLOTS: Record<PillVariant, readonly PillSlotDef[]> = {
  intake: [...SHARED_SLOTS, { key: "status", caption: "Form", field: "Web form", column: 8 }],
  welcome: [...SHARED_SLOTS, { key: "referralSource", caption: "Referral", field: "Referral source", column: 8 }],
};

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
  "Health Plans Inc (PHCS)": "PHCS",
  "Neither Applies": "Neither",

  // ⚠️ TWO PAYER VOCABULARIES REACH THIS SLOT, not one. Patient Intake cards
  // carry **General** Insurance (`color_mm24ap4j`, the coarse bucket) and
  // Welcome Call cards carry **Primary** Insurance (`color_mm1x157j`, the named
  // plan) — different columns, different labels. Until 2026-09-16 only the
  // first was here, so every Anthem plan on the Welcome Call column rendered as
  // "Anthem BCBS Co…". Both lists are below, and the full value is always in
  // the pill's `title`, which is what makes shortening safe at all.
  // General Insurance:
  "Anthem / BCBS": "Anthem/BCBS",
  "United Healthcare": "UHC",
  // Primary Insurance (welcomeCall/workflow PRIMARY_INSURANCE_OPTIONS):
  "Anthem BCBS Commercial": "Anthem Comm.",
  "Anthem BCBS Medicare": "Anthem Mcare",
  "Anthem BCBS Medicaid (JLJ)": "Anthem Mcaid",
  "Anthem BCBS Low-Cost (JLJ)": "Anthem Low-Cost",
  "United Healthcare Commercial": "UHC Comm.",
  "United Commercial": "United Comm.",
  "United Medicare": "United Mcare",
  "United Medicaid": "United Mcaid",
  "Fidelis Commercial": "Fidelis Comm.",
  "Fidelis Medicare": "Fidelis Mcare",
  "Fidelis Medicaid": "Fidelis Mcaid",
  "Aetna Commercial": "Aetna Comm.",
  "Aetna Medicare": "Aetna Mcare",
};

export function shortLabel(value: string): string {
  const v = (value || "").trim();
  return SHORT[v] ?? v;
}

/**
 * The two coverage-path slots, normalised for display.
 *
 * ⚠️ **"NOT SERVING" RENDERS AS BLANK** (Brandon, 2026-09-17: "if cgm or pump
 * path is not serving on welcome call, just blank it out like it is on the
 * intake side"). It is the label the board uses for "this product isn't part of
 * this patient's order" — i.e. there is no coverage path, which is exactly what
 * the em dash already means in every other slot. Spelling it out spends a pill
 * on a non-answer, and on the Welcome Call column both path columns are filled
 * on essentially every row (30/31 and 31/31 live), so it was the most common
 * thing on the card.
 *
 * ⚠️ Applied to BOTH columns, though he only named the Welcome Call side. He
 * described the intake side as already blank, and it effectively is — those two
 * columns are usually empty on Profile Send Off rather than set to "Not
 * Serving" — so one rule keeps the two honest instead of leaving the intake
 * card to render a value he believes it does not.
 */
export function coveragePathPill(value: string): string {
  const v = (value || "").trim();
  return v.toLowerCase() === "not serving" ? "" : v;
}

/**
 * The colour a slot's value earns (Brandon, 2026-09-16), on the column that
 * earns colours at all (Brandon, 2026-09-17 — see the header).
 *
 * Matched on the board's own label text, exactly — these are status columns
 * with fixed vocabularies, and a loose match would colour a future label by
 * accident. Anything unrecognised is neutral.
 */
export function pillTone(slot: PillSlotKey, value: string, variant: PillVariant = "intake"): PillTone {
  const v = (value || "").trim();
  if (!v) return "neutral";
  // Every pill on a Welcome Call card is gray. Checked before the table rather
  // than by giving that variant an empty table, so there is one rule to read.
  if (variant === "welcome") return "neutral";
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
 * ⚠️ **A CARD PHOTO IS AN ANSWER.** Of the 23 live rows that answered "Photo
 * of card", 19 have a BLANK General Insurance — the carrier is on the photo and
 * nobody has typed it in yet — so reading the status column alone rendered
 * nothing at all for exactly the patients who had supplied the most (Brandon,
 * on Debra Collins).
 *
 * ⚠️ The words are **"Photo upload"** from 2026-09-18 (Brandon: *"Change to
 * 'Photo upload'"*), not "Card on file". On the card the pill is a BUTTON that
 * opens the photo (`cards.tsx` → `openFileViewer`), so it names the thing it
 * opens. ⚠️ It is also the string the intake filter offers, because
 * `intakeFilter.facetValue` calls this function rather than carrying a list —
 * rename it here and the facet renames itself.
 *
 * ⚠️ **"Not provided" must stay BLANK.** It is a real answer, and it is the one
 * answer that is not insurance information; showing it would put a green pill
 * on a patient who has given us nothing. Blank with a faint em dash is right.
 *
 * ⚠️ A General Insurance of **"Other"** is a routing bucket, not a carrier, so
 * the free-text column behind it wins where it has anything (3 live rows:
 * "Health partners", "QualChoice", "CHRISTUS HEALTH PLAN").
 */
/** The Insurance pill's words for a patient whose only answer was a card
 *  photo. Exported because `cards.tsx` keys the pill's open-the-photo action
 *  off it — two copies of the string is how the button stops matching. */
export const PHOTO_UPLOAD = "Photo upload";

/** Insurance Provided Via's answer for a patient who sent a card photo — the
 *  board's own words, not ours. Exported because `carrierAssign.carrierFromPhoto`
 *  keys the pill's photo glyph off the same answer: two spellings of one board
 *  label is how the marker stops matching the pill it sits on. */
export const PHOTO_OF_CARD = "Photo of card";

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
    case PHOTO_OF_CARD: return PHOTO_UPLOAD;
    case "Entered manually": return other || "Entered manually";
    default: return "";
  }
}
