/**
 * Manager-only correction of a patient's insurance identity — Serving,
 * Primary/Secondary Insurance and the two Member IDs (2026-07-30).
 *
 * WHY THIS EXISTS. The Benefits header is deliberately read-only for reps
 * (`BenefitsPatientHeader`): those five facts are finalized at Profile Send-Off,
 * and a rep re-typing a payer mid-check is how the board drifts. But the
 * escalation queues are FULL of patients whose only problem is that one of those
 * five is wrong — "coverage came back inactive" is usually the wrong payer, not
 * no payer, and a Universal-check failure is often the wrong Serving. Before
 * this the manager's only route was to open Monday directly, which is the one
 * thing the Command Center exists to avoid.
 *
 * So the affordance is gated to the manager ESCALATION views only (oversight
 * columns 2 and 3 — `?mv=manager-intervention` / `?mv=final-decisions`), never
 * the rep page and never Processor Overview.
 *
 * ⚠️ THE ONE REAL CONSEQUENCE. Serving and Primary/Secondary Insurance are the
 * three inputs to `resolveHcpcs` — they decide WHICH products are in play and
 * who they bill to. Changing them changes the product set, so per-product
 * answers already recorded for a product that just dropped out are orphaned
 * (they stay on the board, invisible to the panel). `productImpact` below
 * computes that delta so the dialog can show it BEFORE the manager commits,
 * rather than having them discover it as a mysteriously-changed panel.
 *
 * No automation risk: every Insurance-board automation that mentions Serving or
 * Primary Insurance uses them as a CONDITION or a copy payload — all of their
 * triggers resolve to Stage Advancer (`color_mm1ws96t`), verified against the
 * live board 2026-07-30. Writing these columns therefore fires nothing, which is
 * why the write path needs no stage-advancer ordering (see
 * `saveManagerIdentityEdits` in mondayWrite).
 *
 * This module is the PURE half — diffing, note composition, product impact — so
 * it can be tested without touching Monday.
 */
import type { Patient } from "./workflow";
import { COL } from "./mondayApi";
import {
  resolveHcpcs,
  PRODUCT_LABELS,
  type PrimaryInsurance,
  type Serving,
} from "./hcpcRules";

export type IdentityFieldId =
  | "serving"
  | "primaryInsurance"
  | "secondaryInsurance"
  | "memberId1"
  | "memberId2";

/** The editable snapshot. Every field is a plain string so the form can hold
 *  an in-progress value that isn't yet a valid label. */
export interface IdentityDraft {
  serving: string;
  primaryInsurance: string;
  secondaryInsurance: string;
  memberId1: string;
  memberId2: string;
}

export interface IdentityChange {
  field: IdentityFieldId;
  /** Human label, as shown in the header and the confirmation. */
  label: string;
  from: string;
  to: string;
}

export const IDENTITY_FIELD_LABELS: Record<IdentityFieldId, string> = {
  serving: "Serving",
  primaryInsurance: "Primary Insurance",
  secondaryInsurance: "Secondary Insurance",
  memberId1: "Member ID",
  memberId2: "Member ID 2",
};

/** The three status fields, and the Monday column each one edits. Their
 *  dropdowns are built from the LIVE column labels (`fetchStatusOptions`), not
 *  from `PRIMARY_INSURANCE_OPTIONS` / `SERVING_OPTIONS` — those lists exist to
 *  parse machine-written values and have already drifted from the board
 *  ("Magnacare" vs "MagnaCare"; "Fidelis CHP" missing altogether), which is
 *  harmless for a reader and wrong for a picker. */
export const IDENTITY_STATUS_COLUMNS = {
  serving: COL.serving,
  primaryInsurance: COL.primaryInsurance,
  secondaryInsurance: COL.secondaryInsurance,
} as const;

export type IdentityStatusFieldId = keyof typeof IDENTITY_STATUS_COLUMNS;

/** Free-text fields, and their columns. */
export const IDENTITY_TEXT_COLUMNS = {
  memberId1: COL.memberId1,
  memberId2: COL.memberId2,
} as const;

/** Current board values as an editable draft. */
export function identityDraftFrom(p: Patient): IdentityDraft {
  return {
    serving: p.serving ?? "",
    primaryInsurance: p.primaryInsurance ?? "",
    secondaryInsurance: p.secondaryInsurance ?? "",
    memberId1: p.memberId1 ?? "",
    memberId2: p.memberId2 ?? "",
  };
}

const FIELDS: IdentityFieldId[] = [
  "serving",
  "primaryInsurance",
  "secondaryInsurance",
  "memberId1",
  "memberId2",
];

/**
 * Only the fields the manager actually changed. Member IDs are trimmed (a
 * trailing space is not a correction); status fields are compared verbatim
 * because their value IS a board label.
 */
export function diffIdentity(p: Patient, draft: IdentityDraft): IdentityChange[] {
  const before = identityDraftFrom(p);
  const norm = (f: IdentityFieldId, v: string) =>
    f === "memberId1" || f === "memberId2" ? v.trim() : v;
  return FIELDS.flatMap((field) => {
    const from = norm(field, before[field]);
    const to = norm(field, draft[field]);
    if (from === to) return [];
    return [{ field, label: IDENTITY_FIELD_LABELS[field], from, to }];
  });
}

const shown = (v: string) => (v ? `"${v}"` : "(blank)");

/**
 * The note body recorded on every correction. Unstamped — the caller runs it
 * through `appendStampedNote` so it lands in the shared Insurance notes column
 * with the ET timestamp, stage label and the manager's initials (CLAUDE.md §9:
 * every line in a notes column is attributed).
 */
export function identityNoteText(changes: IdentityChange[]): string {
  return `Manager correction — ${changes
    .map((c) => `${c.label}: ${shown(c.from)} → ${shown(c.to)}`)
    .join("; ")}`;
}

export interface ProductImpact {
  added: string[];
  removed: string[];
}

/**
 * Which products enter/leave play as a result of this edit, by display label.
 *
 * `removed` is the one that matters: those products' Auth Result / SoS answers
 * are already on the board and will simply stop being shown, so the manager
 * should know before they commit. Returns null when nothing shifts.
 */
export function productImpact(p: Patient, draft: IdentityDraft): ProductImpact | null {
  const setOf = (primary: string, serving: string, secondary: string) =>
    new Set(
      resolveHcpcs(
        (primary || null) as PrimaryInsurance | null,
        (serving || null) as Serving | null,
        secondary || null,
      ).map((r) => PRODUCT_LABELS[r.product]),
    );

  const before = setOf(p.primaryInsurance ?? "", p.serving ?? "", p.secondaryInsurance ?? "");
  const after = setOf(draft.primaryInsurance, draft.serving, draft.secondaryInsurance);

  const added = [...after].filter((x) => !before.has(x));
  const removed = [...before].filter((x) => !after.has(x));
  return added.length || removed.length ? { added, removed } : null;
}
