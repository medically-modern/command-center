/**
 * Which intake patients a queue shows, and which one it opens.
 *
 * Both rules lived inline in `UnverifiedReferralsPage`, and between them they
 * produced the 2026-09-30 report: Janelle followed a link to Mary Terrell
 * (12895923748) and the page opened **Kayla Carey** instead, with every
 * control live. Three things had to line up, and all three were one-liners:
 *
 *  1. the link did not carry `?source=partial`, so the page fetched the
 *     Completed group and Mary (Partial Leads) was not in it —
 *     `intakeLink.intakeProfileHref`, fixed at the call site;
 *  2. `useMondayPatients` fetched her anyway, because a deep link is exempt
 *     from this board's queue split (§5.10) — and then the escalation filter
 *     dropped her again, because she still carried "Manager Escalation
 *     Required" from having been marked stuck;
 *  3. the row lookup fell through to `ordered[0]`, so a patient nobody asked
 *     for was rendered as though they were the one clicked.
 *
 * (2) and (3) are here, as functions, because a rule that decides WHICH
 * PATIENT a rep is writing to should be testable without rendering a
 * four-thousand-line page.
 */

/** Just enough of a row for these rules; the page passes its full Patient. */
export interface IntakeRow {
  id: string;
  intakeEscalation?: string;
}

const ESCALATED = ["Manager Escalation Required", "Final Escalation Required"];

export const isEscalated = (p: IntakeRow): boolean =>
  !!p.intakeEscalation && ESCALATED.includes(p.intakeEscalation);

/**
 * The queue's own rule, with ONE exemption: a patient the URL names by id is
 * always admitted.
 *
 * ⚠️ The exemption is scoped to that single id, so the queue rule itself does
 * not move — a rep's sidebar still hides escalated patients and a manager
 * column still shows only its own rung. What it stops is the app answering a
 * request for a named patient with a different patient.
 *
 * `namedId` is `?patientId=`. Null (no deep link) leaves every filter exactly
 * as it was.
 */
export function visibleIntakeRows<T extends IntakeRow>(
  rows: T[],
  managerOrigin: string | null,
  namedId: string | null,
): T[] {
  const named = (p: T) => !!namedId && p.id === namedId;
  if (managerOrigin === "manager-intervention") {
    return rows.filter((p) => named(p) || p.intakeEscalation === "Manager Escalation Required");
  }
  if (managerOrigin === "final-decisions") {
    return rows.filter((p) => named(p) || p.intakeEscalation === "Final Escalation Required");
  }
  return rows.filter((p) => named(p) || !isEscalated(p));
}

/**
 * The row to open.
 *
 * ⚠️ **A selection that is not in the list opens NOTHING.** The previous
 * `?? ordered[0]` meant "show somebody" — and the somebody it showed had a
 * full pane, a live Advance and a live notes box, under a name the rep had
 * not chosen. `ordered[0]` is still right when nothing has been selected,
 * which is the ordinary page-open case and the post-advance one (the advance
 * clears the selection itself), so that default is kept exactly there.
 */
export function intakeRowForSelection<T extends IntakeRow>(
  ordered: T[],
  selectedId: string | null,
): T | null {
  if (selectedId) return ordered.find((p) => p.id === selectedId) ?? null;
  return ordered[0] ?? null;
}
