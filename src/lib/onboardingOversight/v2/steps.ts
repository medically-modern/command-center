/**
 * DESIGN INTENT v2 (Brandon CR-14/15): the step table. One row per step with its normal time (whole business days)
 * and owner, editable in the settings panel. Defaults are Brandon's values; two steps he did not list carry the
 * Quarterback's announced default (Doctor appointment = 10). Auth Denied = 30, unassigned, a sub-stage of Insurance; Final Profile Cleanup is a sub-stage of Welcome Call (Brandon, Fri). Four stages.
 */
export type StageId = "INT" | "MN" | "INS" | "WC";
export const STAGES: { id: StageId; name: string }[] = [
  { id: "INT", name: "Intake" }, { id: "MN", name: "Medical Necessity" }, { id: "INS", name: "Insurance" },
  { id: "WC", name: "Welcome Call" },
];
export const stageName = (s: StageId) => STAGES.find((x) => x.id === s)?.name ?? s;

export type Priority = "High" | "Normal" | "Low";
export interface StepDef { id: string; stage: StageId | "ESC"; step: string; normal: number | null; owner: string; note?: string; /** Brandon (Overview v3): ranks and greys rows; default Normal */ priority?: Priority }
export const DEFAULT_STEPS: StepDef[] = [
  { id: "int.first", stage: "INT", step: "Initial Intake to First Call", normal: 2, owner: "Masani" },
  { id: "int.calling", stage: "INT", step: "Calling the Patient", normal: 7, owner: "Masani" },
  { id: "int.sendoff", stage: "INT", step: "Profile Send-off", normal: 1, owner: "Masani", note: "done every day" },
  { id: "mn.eval", stage: "MN", step: "Evaluation", normal: 1, owner: "Masheke", note: "done every day" },
  { id: "mn.send", stage: "MN", step: "Send Request", normal: 1, owner: "Masheke", note: "done every day" },
  { id: "mn.confirm", stage: "MN", step: "Confirm Receipt", normal: 10, owner: "Masheke", note: "may take a while", priority: "Low" },
  { id: "mn.chase", stage: "MN", step: "Chase Clinicals", normal: 10, owner: "Masheke", priority: "Low" },
  { id: "mn.dr", stage: "MN", step: "Doctor Appointment", normal: 10, owner: "Masheke", note: "default 10; Brandon to set" },
  { id: "ins.benefits", stage: "INS", step: "Benefits", normal: 1, owner: "Sam", note: "done every day" },
  { id: "ins.submit", stage: "INS", step: "Submit Auth", normal: 1, owner: "Sam", note: "done every day" },
  { id: "ins.outstanding", stage: "INS", step: "Auth Outstanding", normal: 5, owner: "Sam", note: "payer's court; after 5 days we chase the payer" },
  { id: "ins.denied", stage: "INS", step: "Auth Denied", normal: 30, owner: "Unassigned", note: "Brandon: 30 days, no owner yet" },
  { id: "ins.dvs", stage: "INS", step: "DVS", normal: null, owner: "Automated" },
  { id: "wc.call", stage: "WC", step: "Welcome Call", normal: 3, owner: "Masani" },
  { id: "fpc.cleanup", stage: "WC", step: "Final Profile Cleanup", normal: 1, owner: "Brandon" },
  { id: "esc.mgr", stage: "ESC", step: "Manager Intervention", normal: 2, owner: "Janelle" },
  { id: "esc.final", stage: "ESC", step: "Final Decisions", normal: 2, owner: "Katie" },
  // Two kinds of escalation (Brandon, CORE RULE): Proposed Stuck must clear every day; an Edge Case (attempts ran out,
  // the manager works it) may take longer. Edge Case 10 is a default for Brandon to confirm (ASSUMPTIONS.md).
  { id: "esc.stuck", stage: "ESC", step: "Proposed Stuck", normal: 1, owner: "Janelle / Katie", note: "clear every day" },
  { id: "esc.edge", stage: "ESC", step: "Edge Case", normal: 10, owner: "Janelle", note: "default 10; Brandon to confirm" },
];
/**
 * Pipeline order (Brandon, CR-16): stages chronologically, sub-stages in workflow order; the one order used for every
 * sort and every list of stages or sub-stages.
 */
export const pipelineOrder = (stage: string, stepId: string): number =>
  STAGES.findIndex((x) => x.id === stage) * 100 + Math.max(0, DEFAULT_STEPS.findIndex((x) => x.id === stepId));
/**
 * Due Soon (Brandon, CR-16): an early warning only in manager views, only for steps whose normal time is over
 * `overDays` business days, covering the last `pct`% of the window (at least 1 day). Configurable per viewer.
 */
export interface DueSoonCfg { pct: number; overDays: number }
export const DEFAULT_DUE_SOON: DueSoonCfg = { pct: 20, overDays: 3 };
export const dueSoonWindow = (normal: number | null, cfg: DueSoonCfg): number => (normal != null && normal > cfg.overDays ? Math.max(1, Math.round((normal * cfg.pct) / 100)) : 0);
const DS_KEY = "oo.v2.dueSoon";
export function loadDueSoon(): DueSoonCfg {
  try { const raw = typeof localStorage !== "undefined" ? localStorage.getItem(DS_KEY) : null; const v = raw ? (JSON.parse(raw) as Partial<DueSoonCfg>) : {};
    return { pct: Number.isFinite(v.pct) ? Number(v.pct) : DEFAULT_DUE_SOON.pct, overDays: Number.isFinite(v.overDays) ? Number(v.overDays) : DEFAULT_DUE_SOON.overDays }; } catch { return DEFAULT_DUE_SOON; }
}
export function saveDueSoon(c: DueSoonCfg): void { try { localStorage.setItem(DS_KEY, JSON.stringify(c)); } catch { /* per-viewer convenience only */ } }
/**
 * Health (Brandon, VISUAL MINIMALISM RULES): % past due of what a row holds, shown only as a thin left border.
 * Under `yellow`% green, then yellow, orange from `orange`%, red over `red`%. Editable in Normal times.
 */
export interface HealthCfg { yellow: number; orange: number; red: number }
export const DEFAULT_HEALTH: HealthCfg = { yellow: 10, orange: 25, red: 50 };
export type Health = "green" | "yellow" | "orange" | "red" | null;
export const healthOf = (pastDue: number, base: number, h: HealthCfg): Health => {
  if (!base) return null; const p = (pastDue / base) * 100;
  return p > h.red ? "red" : p >= h.orange ? "orange" : p >= h.yellow ? "yellow" : "green";
};
const H_KEY = "oo.v2.health";
export function loadHealth(): HealthCfg {
  try { const raw = typeof localStorage !== "undefined" ? localStorage.getItem(H_KEY) : null; const v = raw ? (JSON.parse(raw) as Partial<HealthCfg>) : {};
    return { yellow: Number.isFinite(v.yellow) ? Number(v.yellow) : DEFAULT_HEALTH.yellow, orange: Number.isFinite(v.orange) ? Number(v.orange) : DEFAULT_HEALTH.orange, red: Number.isFinite(v.red) ? Number(v.red) : DEFAULT_HEALTH.red }; } catch { return DEFAULT_HEALTH; }
}
export function saveHealth(c: HealthCfg): void { try { localStorage.setItem(H_KEY, JSON.stringify(c)); } catch { /* per-viewer convenience only */ } }
/** People shown on By Employee even without steps (Victor answers inbound calls, texts and emails). */
export const EXTRA_PEOPLE = ["Victor"];

const KEY = "oo.v2.steps";
export function loadSteps(): StepDef[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return DEFAULT_STEPS;
    const saved = JSON.parse(raw) as Partial<StepDef>[];
    return DEFAULT_STEPS.map((d) => { const s = saved.find((x) => x.id === d.id) as (Partial<StepDef> | undefined); return s ? { ...d, normal: s.normal === undefined ? d.normal : s.normal, owner: s.owner || d.owner, priority: s.priority ?? d.priority } : d; });
  } catch { return DEFAULT_STEPS; }
}
export function saveSteps(steps: StepDef[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(steps.map((s) => ({ id: s.id, normal: s.normal, owner: s.owner, priority: s.priority })))); } catch { /* per-viewer convenience only */ }
}

/**
 * Which step an item is in, from its column values at a moment (stage label, Intake sub-stage, attempt counter).
 * Board columns: INT sub-stage color_mm6ct431 (1 = Profile Clean-Up, 7 = Info Collection) + attempt counter numeric_mm5ze82q;
 * MN Stage Advancer color_mm1wyr92; INS/WC Stage Advancer color_mm1ws96t.
 */
export function stepIdAt(board: string, v: { stage: number | null | undefined; intSub?: number | null; intAttempts?: number | null }): string | null {
  if (board === "INT") return v.intSub === 1 ? "int.sendoff" : (v.intAttempts ?? 0) > 0 ? "int.calling" : "int.first";
  if (board === "MN") return ({ 8: "mn.eval", 9: "mn.send", 10: "mn.confirm", 11: "mn.chase", 0: "mn.dr" } as Record<number, string>)[v.stage ?? -1] ?? null;
  if (board === "INS") return ({ 3: "ins.benefits", 4: "ins.submit", 6: "ins.outstanding", 1: "ins.dvs", 0: "ins.denied" } as Record<number, string>)[v.stage ?? -1] ?? null;
  if (board === "WC") return ({ 7: "wc.call", 0: "fpc.cleanup" } as Record<number, string>)[v.stage ?? -1] ?? null;
  return null;
}
