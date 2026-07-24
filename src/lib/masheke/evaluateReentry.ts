/**
 * Returning-patient self-heal for the Evaluate MN stage.
 *
 * A patient moved back to Evaluate MN for re-review (new clinicals arrived)
 * must show up in the rep's ACTIVE Evaluate queue. But both the sidebar
 * (lib/masheke/sidebarList.ts) and the burndown counts (hooks/useRoleCounts.ts)
 * hide any patient whose Escalation is "Escalation Required" — so a patient who
 * returns still carrying that flag from a PRIOR stage (Send Request / Confirm
 * Receipt / Chase Clinicals — where Attempt 4+ escalates; the flag column
 * color_mm1x7997 is board-wide) is invisible even though their Stage Advancer
 * reads "Evaluate MN".
 *
 * The app-owned return path (Update Clinicals "Submit") clears the flag itself
 * (see returnToEvaluateVerified) UNCONDITIONALLY, so it needs no counter check.
 * But a patient can also be moved back to Evaluate MN directly on Monday (e.g. a
 * manager advancing the item), which the app can't intercept at write time.
 * `hasStaleEvaluateEscalation` is the self-heal predicate the masheke poll uses
 * to catch those: it flags an Evaluate MN patient whose escalation is a STALE
 * carry-over so the hook can reset it (→ Done) and re-stamp Next Action Date.
 *
 * WHY counter < 3 IS THE SAFE SIGNAL. The ONLY thing that escalates a patient
 * while KEEPING them in Evaluate MN is the "3rd-attempt SOP" in
 * components/masheke/EvaluatePanel.tsx: it fires only when `attemptNum >= 3`,
 * where `attemptNum = Number(evaluationCounter ?? 1) || 1` (the Evaluation
 * Counter column numeric_mm4bhjc8). Evaluate's manual Escalate button + form are
 * both commented out, so the SOP is the sole in-Evaluate source. Therefore a
 * *legitimate* Evaluate-MN escalation ALWAYS has counter >= 3, and an Evaluate
 * MN patient escalated with a concrete counter < 3 can only be a flag carried in
 * from another stage — clearing it never un-escalates a real 3rd-attempt SOP
 * patient. (Oversight's own "evaluate-escalated-3rd" chart is likewise gated on
 * counter >= 3, oversightApi CHART_FILTERS.) This DOES remove a stale
 * carry-over from the counter-agnostic manager surfaces — the ?manager=1 /
 * ?filter=all sidebar escalatedList and the role Escalated bar — which is the
 * intended outcome for a stale flag; no supported in-app workflow ever creates
 * a legitimate counter < 3 Evaluate-MN escalation.
 *
 * LIMITATIONS (documented, not bugs):
 *  - We deliberately do NOT self-heal a counter >= 3 escalation: it's ambiguous
 *    (a real SOP escalation vs. a patient who has cycled back to Evaluate 3+
 *    times), so we leave it for a manager. Those returns should come back
 *    through Update Clinicals "Submit" (which clears unconditionally).
 *  - REQUIRES numeric_mm4bhjc8 to be in mondayApi READ_COLUMN_IDS. We treat a
 *    BLANK / unreadable counter as "not stale" (fail safe): if the column were
 *    ever dropped from the read set, a blank-as-attempt-1 rule would wrongly
 *    clear real >= 3 SOP escalations, so a blank counter means "leave it".
 */
import type { Patient } from "./workflow";
import { ESCALATION_INDEX } from "./mondayMapping";

/**
 * The Evaluation Counter parsed to a concrete number, or `null` when it is
 * blank / non-numeric. Distinct from EvaluatePanel's `Number(x ?? 1) || 1`
 * (which defaults a missing counter to attempt 1) because the self-heal must
 * NOT act on a merely-absent counter — see the module comment's fail-safe note.
 */
export function evaluationCounterValue(
  p: Pick<Patient, "evaluationCounter">,
): number | null {
  const raw = (p.evaluationCounter ?? "").trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * True when `p` is an Evaluate MN patient carrying a STALE "Escalation
 * Required" flag (one that arrived from a prior stage, not Evaluate's own
 * 3rd-attempt SOP) and can be safely reset. See the module comment for why a
 * concrete `counter < 3` provably excludes the legitimate 3rd-attempt
 * escalation, and why a blank counter is left untouched.
 */
export function hasStaleEvaluateEscalation(p: Patient): boolean {
  if (p.subStage !== "Evaluate MN") return false;
  // Match by INDEX, not label text. The board renamed index 0 to "Manager
  // Escalation Required" (2026-07), so the old `escalation === "Escalation
  // Required"` string match silently returned false for every real patient and
  // the self-heal never fired (sidebar/counts already migrated to index — see
  // sidebarList isEscalatedIndex). A stale carry-over from a prior stage is the
  // Attempt-4+ flag = ESCALATION_INDEX.required (0).
  if (p.escalationIndex !== ESCALATION_INDEX.required) return false;
  const counter = evaluationCounterValue(p);
  return counter !== null && counter < 3;
}
