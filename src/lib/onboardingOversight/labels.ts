/**
 * THE plain-language mapping (Brandon CR-10): every stage name, sub-stage name, action phrase, attempt phrase,
 * next step and holder name shown to a person comes from this one file. Views never hard-code them.
 * Keyed by board + column + label INDEX (stable), never by label text (which monday lets people rename).
 * Swap the wording here when Brandon's new terminology arrives; `audience` lets a partner-facing view
 * (e.g. the referral-partner summary) share the same mapping with gentler wording where needed.
 */
import { OO_CONFIG } from "./config";

export type Audience = "internal" | "partner";
const C = OO_CONFIG;

/** Top-level steps of the journey (the stepper), in order. */
export const STEPS = [
  { key: "INT", name: "Intake", partner: "Referral intake" },
  { key: "MN", name: "Medical Necessity", partner: "Medical evaluation" },
  { key: "INS", name: "Insurance", partner: "Insurance" },
  { key: "WC", name: "Welcome Call", partner: "Welcome call" },
  { key: "REL", name: "Released", partner: "Delivery" },
] as const;
const STEP_SHORT: Record<string, string> = { INT: "Intake", MN: "Med. Necessity", INS: "Insurance", WC: "Welcome Call", REL: "Released" };
export const stepShort = (board: string) => STEP_SHORT[board] ?? board;
export const stepName = (board: string, a: Audience = "internal") => { const s = STEPS.find((x) => x.key === board); return s ? (a === "partner" ? s.partner : s.name) : board; };

/** Sub-stage (queue) names by taxonomy code. */
const SUB: Record<string, string> = {
  "1.1.1.1": "Collecting information", "1.1.1.2": "Profile clean-up", "1.1.1": "Intake",
  "1.1.2.1": "Evaluating medical necessity", "1.1.2.2": "Sending records request", "1.1.2.3": "Waiting for provider to confirm receipt",
  "1.1.2.4F": "Chasing clinicals by fax", "1.1.2.4P": "Chasing clinicals (Parachute, email, portal)", "1.1.2.4": "Chasing clinicals", "MN-DA": "Waiting on a doctor appointment",
  "1.1.3.1": "Benefits check", "1.1.3.2": "Authorization check", "1.1.3.1+2": "Benefits and authorization check", "1.1.3.3": "Submitting authorization",
  "1.1.3.4": "Waiting on insurance decision", "1.1.3.5": "Authorization denied", "1.1.3.6": "Fixing a denied authorization",
  "1.1.4.1": "Welcome call", "1.1.5.1": "Final profile check",
  UNMAPPED: "Status not recognised",
};
export const HOLDER = { MGR: "With Janelle (Manager Intervention)", FINAL: "With Katie (Final Decisions)", STUCK: "Dead lead (Stuck)", EXITED: "Moved on" } as const;
export const BUCKET = { MGR: "Janelle · Manager Intervention", FINAL: "Katie · Final Decisions" } as const;
export function subStageName(kind: string, code: string | null): string {
  if (kind === "QUEUE") return SUB[code ?? "UNMAPPED"] ?? SUB.UNMAPPED;
  return (HOLDER as Record<string, string>)[kind] ?? kind;
}

/** What should happen next, per queue (shown on the patient page). */
const NEXT: Record<string, string> = {
  "1.1.1.1": "Finish collecting referral details and send to Medical Necessity", "1.1.1.2": "Clean up the profile, then advance",
  "1.1.2.1": "Decide whether medical necessity is met", "1.1.2.2": "Send the records request to the provider", "1.1.2.3": "Confirm the provider received the request",
  "1.1.2.4F": "Follow up with the provider by fax", "1.1.2.4P": "Follow up with the provider (Parachute, email, portal)", "MN-DA": "Check the doctor appointment date",
  "1.1.3.1": "Check benefits", "1.1.3.2": "Check whether authorization is needed", "1.1.3.1+2": "Check benefits and authorization", "1.1.3.3": "Submit the authorization",
  "1.1.3.4": "Follow up with the insurer on the decision", "1.1.3.5": "Decide how to respond to the denial", "1.1.3.6": "Fix and resubmit the authorization",
  "1.1.4.1": "Call the patient to confirm details and the order", "1.1.5.1": "Do the final profile check and release",
};
export function nextStep(kind: string, code: string | null): string {
  if (kind === "MGR") return "Janelle decides: return to the queue with a plan, or approve as a dead lead";
  if (kind === "FINAL") return "Katie decides: return to the queue, or approve as a dead lead";
  if (kind === "STUCK") return "None (closed as a dead lead)";
  if (kind === "EXITED") return "None on this board";
  return NEXT[code ?? ""] ?? "Check the status in monday";
}

/** Action phrases: board -> column -> label index -> phrase. `{text}` = monday's label text. */
const esc = { 0: "Escalated to Janelle (Manager Intervention)", 2: "Sent to Katie for a final decision", 1: "Escalation marked done; back to the queue", 5: "Escalation cleared; back to the queue", null: "Escalation cleared; back to the queue" };
const ACTIONS: Record<string, Record<string, Record<string, string>>> = {
  INT: {
    [C.stageColumn.INT]: { 1: "Intake complete; sent to Medical Necessity", 6: "Intake complete; sent to Welcome Call", 2: "Can't serve; sent back to the referral source", 3: "Asked for more information", 0: "Already serving this patient", 5: "Intake decision cleared", null: "Intake decision cleared" },
    [C.intSubStageColumn]: { 1: "Profile clean-up started", 7: "Back to collecting information", null: "Profile clean-up finished" },
    [C.escalationColumn.INT]: esc,
    numeric_mm5ze82q: { "*": "Logged intake attempt {num}" }, numeric_mm67822b: { "*": "Sent drop-off reminder {num}" },
    color_mm3822qq: { "*": "Follow-up set: {text}" }, date_mm3874an: { "*": "Set a follow-up date" },
  },
  MN: {
    [C.stageColumn.MN]: { 8: "Referral entered medical review", 9: "Evaluated: more records needed", 10: "Sent records request to provider", 11: "Provider confirmed receipt; chasing clinicals", 0: "Waiting on a doctor appointment", 14: "Medical necessity established; sent to Insurance", 15: "Closed as a dead lead (Stuck)", 5: "Stage cleared", null: "Stage cleared",
      // Labels from the board's older layout (indexes later reused); shown with monday's own text.
      12: "Moved to {text} (old board layout)", 13: "Moved to {text} (old board layout)", 1: "Moved to {text} (old board layout)", 3: "Moved to {text} (old board layout)", 4: "Moved to {text} (old board layout)" },
    [C.escalationColumn.MN]: esc,
    color_mm1wz0vg: { 2: "Followed up with provider (attempt 1)", 3: "Followed up with provider (attempt 2)", 1: "Followed up with provider (attempt 3)", 0: "Follow-ups used up; escalated", 5: "Follow-up count reset", null: "Follow-up count reset" },
    color_mm1y8rv8: { 1: "Medical records received", 0: "Records in; to evaluate", 3: "Records still to collect", 5: "Records status cleared", null: "Records status cleared" },
    color_mm1xw7y5: { "*": "Clinicals method set to {text}" },
    text_mm2yd068: { "*": "Logged a chase attempt" }, text_mm2y9h4a: { "*": "Logged a chase attempt" }, text_mm2ymtsk: { "*": "Logged a chase attempt" },
    text_mm2yhpjt: { "*": "Logged a chase attempt" }, text_mm2yb3rv: { "*": "Logged a chase attempt" }, text_mm2ybk06: { "*": "Logged a chase attempt" },
    color_mm35v6a0: { "*": "Follow-up set: {text}" }, date_mm35kbkj: { "*": "Set the next chase date" },
  },
  INS: {
    [C.stageColumn.INS]: { 1: "Sent for DVS check", 3: "Benefits check started", 4: "Benefits verified; authorization to submit", 6: "Submitted authorization to insurance", 0: "Authorization denied by insurance", 7: "Insurance approved; sent to Welcome Call", 2: "Closed as a dead lead (Stuck)", 5: "Stage cleared", null: "Stage cleared" },
    [C.escalationColumn.INS]: esc,
    [C.insBenefitsMarkerColumn]: { "*": "Benefits check result: {text}" },
    color_mm34jz1x: { "*": "Follow-up set: {text}" }, date_mm34m2dz: { "*": "Set the next follow-up date" },
  },
  WC: {
    [C.stageColumn.WC]: { 7: "Ready for the welcome call", 0: "Welcome call done; final profile check", 4: "Released to subscription", 2: "Closed as a dead lead (Stuck)", 5: "Stage cleared", null: "Stage cleared" },
    [C.escalationColumn.WC]: esc,
    color_mm1xtqvv: { 0: "Sent scheduling text", 5: "Scheduling text mark cleared", null: "Scheduling text mark cleared", "*": "Welcome text: {text}" },
    text_mm322fg9: { "*": "Logged call attempt {num}" }, color_mm38w2tk: { "*": "Follow-up set: {text}" }, date_mm38a7k7: { "*": "Set a call-back date" },
  },
};
export function actionPhrase(board: string, columnId: string, toIndex: number | null, toText?: string | null, toNum?: number | null): string {
  if (columnId === "__group__") return "Moved to another board group";
  const col = ACTIONS[board]?.[columnId];
  const raw = col?.[String(toIndex)] ?? col?.["*"];
  if (raw) return raw.replace("{text}", toText || "a new value").replace(" {num}", toNum != null ? ` (${toNum})` : "");
  return toText ? `Status changed to "${toText}"` : "Status changed";
}

/** Attempts phrased as counts. */
export const attemptsPhrase = {
  mnFollowUps: (n: number) => `${n} follow-up${n === 1 ? "" : "s"} with provider`,
  insSubmissions: (s: number, d: number) => `${s} auth submission${s === 1 ? "" : "s"}${d ? ` · ${d} denied` : ""}`,
  wcText: "Scheduling text sent",
  wcCalls: "Call attempts logged",
  intAsks: (n: number) => `Asked for more info ${n}×`,
};

/** Who made a change, in plain words. */
export const WHO = { automation: "Automation", unattributed: "Shared Command Center account", unknown: "Unknown" } as const;

/** CR-11 cause tags: the only "why" shown on the Overview (one per bottleneck tile). Rules in metrics/minimal.ts (spec §3.18). */
export const CAUSE = {
  WAITING_PAYER: "Waiting on payer", WAITING_PROVIDER: "Waiting on provider", WAITING_PATIENT: "Waiting on patient",
  DECISION: "Decision not made", NO_OWNER: "No owner", SHORT_STAFFED: "Short-staffed", NOT_WORKED: "Not being worked",
} as const;
export type CauseId = keyof typeof CAUSE;

/** CR-11 short fix per cause (click-in "Fix" column; never a sentence). */
export const FIX_SHORT: Record<CauseId, string> = {
  DECISION: "Decide the 10 oldest", WAITING_PROVIDER: "Chase providers, 10 oldest", WAITING_PAYER: "Call the payer, 10 oldest",
  WAITING_PATIENT: "Call patients, 10 oldest", NO_OWNER: "Assign an owner", SHORT_STAFFED: "Add a person", NOT_WORKED: "Work just-late first",
};

/* ---------- CR-13 short forms (DESIGN-INTENT word test): scannable cells; the full wording stays in tooltips ---------- */
const SUB_SHORT: Record<string, string> = {
  "1.1.1.1": "Collecting info", "1.1.1.2": "Clean-up", "1.1.1": "Intake",
  "1.1.2.1": "Evaluate", "1.1.2.2": "Send request", "1.1.2.3": "Confirm receipt", "1.1.2.4F": "Chase (fax)", "1.1.2.4P": "Chase (portal)", "1.1.2.4": "Chase", "MN-DA": "Dr appointment",
  "1.1.3.1": "Benefits", "1.1.3.2": "Auth check", "1.1.3.1+2": "Benefits", "1.1.3.3": "Submit auth", "1.1.3.4": "Auth outstanding", "1.1.3.5": "Auth denied", "1.1.3.6": "Remediation",
  "1.1.4.1": "Welcome Call", "1.1.5.1": "Final check", UNMAPPED: "Unknown",
};
export function subStageShort(kind: string, code: string | null): string {
  if (kind === "MGR") return "Manager Intervention"; if (kind === "FINAL") return "Final Decisions"; if (kind === "STUCK") return "Stuck"; if (kind === "EXITED") return "Done";
  return SUB_SHORT[code ?? "UNMAPPED"] ?? SUB_SHORT.UNMAPPED;
}
/** Short action label with an icon, derived from the full phrase (both live here; swap together). */
const SHORT_RULES: [RegExp, string][] = [
  [/^Escalated to Janelle/, "⚖ To Janelle"], [/^Sent to Katie/, "⚖ To Katie"], [/^Escalation (marked done|cleared)/, "↩ Back to queue"],
  [/^Referral entered medical review/, "→ In review"], [/^Evaluated: more records needed/, "Records needed"], [/^Sent records request/, "✉ Request sent"],
  [/^Provider confirmed receipt/, "✓ Receipt confirmed"], [/^Followed up with provider \(attempt (\d)\)/, "✉ Follow-up $1"], [/^Follow-ups used up/, "✉ Follow-ups used up"],
  [/^Logged a chase attempt/, "✉ Chase logged"], [/^Medical records received/, "✓ Records in"], [/^Records in; to evaluate/, "✓ Records in"], [/^Records still to collect/, "Records to collect"],
  [/^Medical necessity established/, "✓ Medical Necessity met"], [/^Waiting on a doctor appointment/, "Dr appointment"], [/^Clinicals method set to (.*)/, "Method: $1"],
  [/^Sent for DVS/, "→ DVS"], [/^Benefits check started/, "→ Benefits"], [/^Benefits verified/, "✓ Benefits"], [/^Benefits check result: ([^/]*?)\s*(\/.*)?$/, "Benefits: $1"],
  [/^Submitted authorization/, "✉ Auth submitted"], [/^Authorization denied/, "✕ Auth denied"], [/^Insurance approved/, "✓ Approved"],
  [/^Ready for the welcome call/, "→ Ready to call"], [/^Welcome call done/, "✓ Called"], [/^Released to subscription/, "✓ Released"], [/^Sent scheduling text/, "✉ Texted"],
  [/^Logged call attempt \((\d+)\)/, "☎ Call $1"], [/^Logged call attempt/, "☎ Call"], [/^Logged intake attempt \((\d+)\)/, "☎ Attempt $1"], [/^Sent drop-off reminder/, "✉ Reminder"],
  [/^Follow-up set/, "⏰ Follow-up set"], [/^Set (the next chase|the next follow-up|a call-back|a follow-up) date/, "⏰ Date set"],
  [/^Intake complete; sent to Medical Necessity/, "✓ To MN"], [/^Intake complete; sent to Welcome Call/, "✓ To WC"], [/^Asked for more information/, "? More info"],
  [/^Can't serve/, "✕ Can't serve"], [/^Already serving/, "Already serving"], [/^Profile clean-up started/, "→ Clean-up"], [/^Closed as a dead lead/, "Stuck"],
  [/^Stage cleared|^Intake decision cleared|status cleared|mark cleared|count reset/, "Cleared"], [/^Status changed/, "Updated"], [/^Moved to another board group/, "Moved"], [/^Moved to (.*) \(old board layout\)/, "Old: $1"],
];
export function actionShort(full: string): string {
  for (const [re, out] of SHORT_RULES) { const m = full.match(re); if (m) { const r = out.replace(/\$(\d)/g, (_x, i) => m[Number(i)] ?? ""); return r.length > 24 ? `${r.slice(0, 23)}…` : r; } }
  return full.length > 24 ? `${full.slice(0, 23)}…` : full;
}
export const CAUSE_SHORT: Record<CauseId, string> = { DECISION: "Decision", NOT_WORKED: "Not worked", WAITING_PROVIDER: "Provider", WAITING_PAYER: "Payer", WAITING_PATIENT: "Patient", NO_OWNER: "No owner", SHORT_STAFFED: "Short-staffed" };

/** Level-2 per-row "Why" tag (final Operator Test, task f): one short reason from a fixed list. */
export const WHY_TAG = { decisionMGR: "⚖ Decision", decisionFINAL: "⚖ Decision", tries: "Tries used up", idle: "Idle", noChase: "No chase", noFollowUp: "No follow-up", sentBack: "Sent back", waiting: "Their move", notWorked: "Not worked" } as const;
