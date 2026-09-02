/**
 * What a rep needs on screen while the patient is on the phone — per stage.
 *
 * The dossier's notes say what has happened. This says what is TRUE right now,
 * and it differs completely by stage: on an intake call the question is "what
 * insurance are we running and did it come back active", on a Welcome Call it
 * is "what is this going to cost you and where are we shipping it", and on
 * Subscription it is "when is your next order and is your auth still valid".
 * Showing all of it everywhere would bury the four facts that matter.
 *
 * Pure and data-driven: a board is a list of sections, a section is a list of
 * columns. `dossierApi` reads exactly the columns named here, so adding a field
 * is one line and cannot go silently blank the way a hand-maintained read set
 * does (§5.11's trap).
 *
 * ⚠️ **Only boards whose column ids are verified in this repo are mapped.**
 * DTC Intake and Secondary Claims have none: they are not stages a rep calls
 * from, and guessing ids produces a permanently blank row rather than an error.
 * An unmapped board simply renders no detail — the notes and the path still do
 * their job.
 */

/** How a value is rendered. Everything is TEXT off Monday; this only decides
 *  presentation. */
export type FieldKind = "text" | "phone" | "fax";

export interface StageField {
  label: string;
  /** Monday column id on that board. */
  col: string;
  kind?: FieldKind;
  /** Give it the eye first — the one or two facts a rep is usually after. */
  lead?: boolean;
}

export interface StageSection {
  title: string;
  fields: StageField[];
}

/* Column ids below are copied from each board slice's own `COL` map. They are
 * the contract (§9: ids, never titles), so they are written out rather than
 * imported — pulling six board modules into this one just to read constants
 * would drag their whole dependency graphs into every bundle that shows a
 * dossier. */

const PROFILE_SEND_OFF: StageSection[] = [
  {
    title: "What they asked for",
    fields: [
      { label: "Request type", col: "color_mm1w1978", lead: true },
      { label: "Serving", col: "color_mm1w1cm9", lead: true },
      { label: "CGM type", col: "color_mm1w7pmf" },
      { label: "Referral source", col: "color_mm1w5wxr" },
    ],
  },
  {
    title: "Insurance",
    fields: [
      { label: "Insurance", col: "color_mm24ap4j", lead: true },
      { label: "Member ID", col: "text_mm4t8gbq" },
      // The two Stedi answers a rep is asked about on the call. ⚠️ "In network"
      // reads back the literal string the service wrote — `Unknown` is what
      // Original Medicare returns and is NOT a no (§5.20).
      { label: "Eligibility active", col: "text_mm1xpgy2", lead: true },
      { label: "In network", col: "text_mm1xehx8" },
    ],
  },
  {
    title: "Where we are with them",
    fields: [
      { label: "Address", col: "location_mm1xhw17" },
      { label: "Scheduled call", col: "date_mm63na19", lead: true },
      { label: "Call attempts", col: "numeric_mm5ze82q" },
      { label: "Automated texts", col: "numeric_mm67822b" },
      { label: "Already in system", col: "color_mm2xe7r8" },
      { label: "Duplicate check", col: "color_mm65tv1m" },
    ],
  },
  {
    title: "Doctor as provided",
    fields: [
      { label: "Doctor", col: "text_mm5z586h" },
      { label: "Clinic phone", col: "text_mm5zjh88", kind: "phone" },
    ],
  },
];

const MEDICAL_EVALUATION: StageSection[] = [
  {
    title: "Chasing clinicals",
    fields: [
      { label: "MN attempts", col: "color_mm1wz0vg", lead: true },
      { label: "Clinicals method", col: "color_mm1xw7y5", lead: true },
      { label: "Appointment date", col: "date_mm5w2vsf" },
      { label: "Escalation", col: "color_mm1x7997" },
    ],
  },
  {
    title: "Doctor",
    fields: [
      { label: "Doctor", col: "text_mm1x46et", lead: true },
      { label: "Clinic", col: "dropdown_mm1xbvas" },
      { label: "Phone", col: "phone_mm1xz8c0", kind: "phone" },
      { label: "Fax", col: "email_mm1xdzcj", kind: "fax" },
    ],
  },
  {
    title: "Order",
    fields: [
      { label: "Serving", col: "color_mm1w1cm9" },
      { label: "Request type", col: "color_mm1w1978" },
      { label: "Pump type", col: "color_mm1wjjtk" },
      { label: "CGM type", col: "color_mm1w7pmf" },
    ],
  },
];

const INSURANCE: StageSection[] = [
  {
    title: "Coverage",
    fields: [
      { label: "Primary", col: "color_mm1x157j", lead: true },
      { label: "Member ID", col: "text_mm1x2qk2" },
      { label: "Secondary", col: "color_mm241kqp" },
      { label: "Member ID 2", col: "text_mm1xaccx" },
    ],
  },
  {
    title: "Authorisation",
    fields: [
      { label: "Days outstanding", col: "numeric_mm5f5ars", lead: true },
      { label: "Not clear", col: "dropdown_mm2vez5a", lead: true },
      { label: "Statement of svc", col: "color_mm2vemyy" },
      { label: "Escalation", col: "color_mm2vsh2f" },
    ],
  },
  {
    title: "Claims / DVS",
    fields: [
      { label: "Claims status", col: "color_mm284z0b" },
      { label: "Pump claims", col: "color_mm5g8085" },
      { label: "DVS denial", col: "long_text_mm27hjey" },
    ],
  },
  { title: "Order", fields: [{ label: "Serving", col: "color_mm1w1cm9" }] },
];

/**
 * Welcome Call is the widest of these on purpose (Josh, 2026-09-02: *"we have
 * more room on here for welcome call patients, we can fill it with more
 * info"*). It is the one stage where the rep is on a scheduled call with the
 * patient rather than chasing an office, so every question they will be asked —
 * what am I getting, what does it cost, is it approved, where is it going — has
 * to be answerable without leaving the hub.
 *
 * ⚠️ Every id below is read off the LIVE board (2026-09-02), not inferred from
 * a sibling board. Welcome Call's auth block is per-product and its ids are its
 * own; guessing one produces a permanently blank row rather than an error
 * (§5.11). Empty values and then empty sections are dropped by
 * `buildStageDetail`, so a stage with nothing filled in still renders short.
 */
const WELCOME_CALL: StageSection[] = [
  {
    title: "The order",
    fields: [
      { label: "Serving", col: "color_mm1w1cm9", lead: true },
      { label: "Subscription type", col: "color_mm1xbqth", lead: true },
      { label: "Request type", col: "color_mm1w1978" },
      { label: "Pump type", col: "color_mm1wjjtk" },
      { label: "CGM type", col: "color_mm1w7pmf" },
      { label: "Pump qty", col: "numeric_mm1xa0z2" },
      { label: "Monitor qty", col: "numeric_mm1xyfhc" },
      { label: "Infusion set", col: "color_mm1x9paw" },
      { label: "Inf. set qty", col: "numeric_mm1xv7wr" },
      { label: "Infusion set 2", col: "color_mm1xekaz" },
      { label: "Inf. set 2 qty", col: "numeric_mm1xkq3b" },
      { label: "Cartridge qty", col: "numeric_mm515sqv" },
      // A split order ships as two Cardinal orders (§5.22), which changes what
      // the rep tells the patient to expect in the post.
      { label: "Split order", col: "color_mm381bgy" },
      { label: "Order handling", col: "color_mm2776fg" },
    ],
  },
  {
    // The question every patient asks, so it leads its own section.
    title: "What it costs them",
    fields: [
      { label: "Deductible left", col: "text_mm1xdzxw", lead: true },
      { label: "OOP max left", col: "text_mm1xx5f", lead: true },
      { label: "Deductible", col: "text_mm1xkbqc" },
      { label: "OOP max", col: "text_mm1xdtj7" },
      { label: "Coinsurance", col: "text_mm391jq8" },
      // QMB means Medicaid covers the patient's share — i.e. the answer to
      // "what do I owe" is nothing, and saying otherwise is a real harm.
      { label: "QMB", col: "text_mm2wms12", lead: true },
    ],
  },
  {
    title: "Coverage",
    fields: [
      { label: "Primary", col: "color_mm1x157j", lead: true },
      { label: "Member ID", col: "text_mm1x2qk2" },
      { label: "Secondary", col: "color_mm241kqp" },
      { label: "Member ID 2", col: "text_mm1xaccx" },
      { label: "Plan", col: "dropdown_mm2wrzrk" },
      { label: "Plan begins", col: "date_mm4w5hbc" },
      { label: "POS", col: "color_mm5wq0ys" },
    ],
  },
  {
    // "Is it approved, and how long for?" — the question that stops an order
    // downstream, and the one a rep can only answer from these columns.
    title: "Authorisations",
    fields: [
      { label: "Monitor auth", col: "color_mm1wgjd1" },
      { label: "Monitor ends", col: "date_mm1whebp" },
      { label: "Sensors auth", col: "color_mm1x5c99" },
      { label: "Sensors ends", col: "date_mm1xvnqb" },
      { label: "Pump auth", col: "color_mm1xnzmn" },
      { label: "Pump ends", col: "date_mm1x2q3" },
      { label: "Inf. set auth", col: "color_mm1xr2j1" },
      { label: "Inf. set ends", col: "date_mm1xj3wp" },
      { label: "Cartridge auth", col: "color_mm1xybvt" },
      { label: "Cartridge ends", col: "date_mm1xznf9" },
      { label: "MN expires", col: "date_mm1ymthz", lead: true },
    ],
  },
  {
    title: "First orders",
    fields: [
      { label: "Sensors", col: "date_mm35bdf8" },
      { label: "Supplies", col: "date_mm351tva" },
      { label: "Pump", col: "date_mm356crn" },
    ],
  },
  {
    title: "Ship to / doctor",
    fields: [
      { label: "Address", col: "location_mm1xhw17", lead: true },
      { label: "Doctor", col: "text_mm1x46et" },
      { label: "Doctor phone", col: "phone_mm1xz8c0", kind: "phone" },
      { label: "Clinic", col: "dropdown_mm1xbvas" },
      { label: "Clinic address", col: "location_mm1xjnfv" },
      { label: "Prior pump date", col: "text_mm58k9x9" },
      { label: "Monitor purchased", col: "text_mm6693sn" },
    ],
  },
  {
    title: "Who they are",
    fields: [
      { label: "DOB", col: "text_mm1xvxst" },
      { label: "Email", col: "text_mm1xc140" },
      { label: "Diagnosis", col: "color_mm1wf7rv" },
      { label: "Call attempts", col: "text_mm322fg9" },
      { label: "Follow up", col: "date_mm38a7k7" },
    ],
  },
];

const SUBSCRIPTION: StageSection[] = [
  {
    title: "Next order",
    fields: [
      { label: "Status", col: "color_mm2t7tdy", lead: true },
      { label: "Next order", col: "date_mkp0nvf1", lead: true },
      { label: "Days to order", col: "color_mkxmtv9c", lead: true },
      { label: "Cycle", col: "color_mkyjawhq" },
      { label: "Order type", col: "color_mm2w6kd" },
      { label: "Orders so far", col: "numeric_mkxtmtsy" },
    ],
  },
  {
    title: "What ships",
    fields: [
      { label: "Subscription", col: "color_mm273mv8", lead: true },
      { label: "Sensors", col: "color_mkxmdscr" },
      { label: "Supplies", col: "color_mkxmnheg" },
      { label: "Infusion set", col: "color_mkxm50f9" },
      { label: "Inf. qty", col: "numeric_mkw839ks" },
    ],
  },
  {
    // "Is their auth still good?" is the question that stops an order, so the
    // end dates sit beside the statuses rather than in a separate block.
    title: "Authorisation & MN",
    fields: [
      { label: "Sensors auth", col: "color_mm25t997", lead: true },
      { label: "Sensors auth ends", col: "date_mkwbvr6t" },
      { label: "Supplies auth", col: "color_mm27snkq", lead: true },
      { label: "Supplies auth ends", col: "date_mm255cs4" },
      { label: "MN expires", col: "date_mkp09gra", lead: true },
      { label: "Prior auth req.", col: "color_mm2pj23n" },
    ],
  },
  {
    title: "Coverage",
    fields: [
      { label: "Primary", col: "color_mm254qxj" },
      { label: "Member ID", col: "text_mkvp6zfg" },
      { label: "Eligibility active", col: "color_mm2nzm33" },
      { label: "Ded. remaining", col: "text_mm3g32ja" },
    ],
  },
  {
    title: "Ship to / doctor",
    fields: [
      { label: "Address", col: "location_mkp0rs0v", lead: true },
      { label: "Doctor", col: "text_mkxn3wza" },
      { label: "Doctor phone", col: "phone_mkxnv7e5", kind: "phone" },
      { label: "Doctor fax", col: "email_mkxn9af2", kind: "fax" },
    ],
  },
];

export const STAGE_DETAIL: Record<number, StageSection[]> = {
  18406352652: PROFILE_SEND_OFF,
  18406060017: MEDICAL_EVALUATION,
  18410601299: INSURANCE,
  18410804557: WELCOME_CALL,
  18407459988: SUBSCRIPTION,
};

/** Every column this board's detail needs, deduped — what `dossierApi` adds to
 *  its read. An unmapped board returns none. */
export function stageDetailColumns(boardId: number): string[] {
  const sections = STAGE_DETAIL[boardId];
  if (!sections) return [];
  return [...new Set(sections.flatMap((s) => s.fields.map((f) => f.col)))];
}

export interface RenderedField extends StageField {
  value: string;
}
export interface RenderedSection {
  title: string;
  fields: RenderedField[];
}

/**
 * Drop every empty value, then every section left empty.
 *
 * A call-center pane full of "—" is worse than a short one: the rep scans for
 * the fact they need, and blank rows are what makes that slow. A stage where
 * nothing has been filled in yet renders nothing at all, which is itself the
 * honest answer.
 */
export function buildStageDetail(
  boardId: number,
  values: Record<string, string> | undefined,
): RenderedSection[] {
  const sections = STAGE_DETAIL[boardId];
  if (!sections || !values) return [];
  return sections
    .map((s) => ({
      title: s.title,
      fields: s.fields
        .map((f) => ({ ...f, value: (values[f.col] ?? "").trim() }))
        .filter((f) => f.value.length > 0),
    }))
    .filter((s) => s.fields.length > 0);
}

/** Does this board show any detail at all? Lets a caller explain the absence
 *  rather than rendering a bare gap. */
export function hasStageDetail(boardId: number): boolean {
  return !!STAGE_DETAIL[boardId];
}
