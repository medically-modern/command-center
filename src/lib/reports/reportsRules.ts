/**
 * Reports & Metrics — the numbers, as pure functions (pixel-match Phase 6b,
 * 2026-09-25; CLAUDE.md §5.52). Brandon's `viewReports` computes every tile
 * from his sample data; this file computes the same tiles from data the app
 * already reads, and nothing else in the page decides anything.
 *
 * ⚠️⚠️ **EVERY NUMBER HERE IS A READING OF A RULE THAT ALREADY EXISTS.**
 * A second derivation of "active", "stuck", "open order" or "web-form lead" is
 * the §5.7/§5.17/§5.29 hand-synced hazard, and here the failure mode is a
 * report that disagrees with the screen it summarises — silently, all day.
 *   · active / stuck   → `searchBuckets.searchBucket` (System Management's own)
 *   · escalated         → `SystemPatient.escalated` (the snapshot's own flag)
 *   · days in stage     → `infoStrip.daysSince` on the board's stage-start
 *                         date, falling back to the item's creation date —
 *                         Brandon's own rule for Profile Send Off (§5.46f)
 *   · web-form lead     → `careCoordinator/workflow.isFormLead`
 *   · open / on hold / backordered → the orders slice's `orderStage` +
 *                         `orderFlags` (§5.35, §5.51c)
 *   · the queue bars    → `useRoleCounts`, grouped by `operationsGroups`,
 *                         so they cannot disagree with the burndown (§5.8)
 *
 * ⚠️ **DTC Intake is deliberately OUT of the pipeline tiles.** `MACRO_STAGES`
 * folds it into Intake for the patient screen's stepper (a patient's history
 * has to show where they came from), but the app reads that board for search
 * only (§3) and no dashboard counts it — its ~1,250 rows are cold leads and raw
 * intake data, and they would swamp the Intake tile with work nobody manages.
 *
 * ⚠️ **Web-form leads are subtracted from Intake by ID, never re-derived.** The
 * snapshot does not carry the Drop-off Step, so the caller hands in the ids of
 * the rows the slim form read says are leads (`formLeadFacts`), and the Intake
 * tile is the active Profile Send Off rows that are not among them. Two reads
 * agreeing by construction beats two rules agreeing by luck.
 */
import { MACRO_STAGES } from "@/lib/patient/patientScreen";
import { daysSince, etDateOf } from "@/lib/patient/infoStrip";
import { etToday } from "@/lib/masheke/etDate";
import { searchBucket } from "@/lib/systemMgmt/searchBuckets";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";
import { isFormLead } from "@/lib/careCoordinator/workflow";
import { isOpenStage, orderFlags, orderStage, type Order } from "@/lib/orders/workflow";
import { ROLES, type RoleConfig } from "@/lib/config";
import { groupRoleRows } from "@/lib/systemMgmt/operationsGroups";

/** Read for search only (§3); counted by no dashboard. See the header. */
export const DTC_INTAKE_BOARD = 18392794310;

export interface StageDef {
  key: string;
  label: string;
  boards: readonly number[];
}

/** The four onboarding stages and their boards — `MACRO_STAGES` minus DTC Intake. */
export const STAGE_BOARDS: readonly StageDef[] = MACRO_STAGES.map((m) => ({
  key: m.key,
  label: m.label,
  boards: m.boards.filter((b) => b !== DTC_INTAKE_BOARD),
}));

/** Every board the pipeline tiles count. */
export const PIPELINE_BOARD_IDS: readonly number[] = STAGE_BOARDS.flatMap((s) => [...s.boards]);

export type PipelineRow = Pick<
  SystemPatient,
  "id" | "boardId" | "groupId" | "isCompleted" | "stageAdvancerText" | "escalationLevel"
  | "escalated" | "stageStart" | "createdAt"
>;

/** Which stage a board belongs to, or null for a board outside the pipeline. */
export function stageOf(boardId: number): StageDef | null {
  return STAGE_BOARDS.find((s) => s.boards.includes(boardId)) ?? null;
}

/**
 * Whole ET days this row has been in its stage, or null when nothing on it
 * says. The stage-start DATE column first; the item's creation date where the
 * board has none (Profile Send Off — Brandon's own rule, §5.46f). A negative
 * answer (a stage start in the future) is treated as unknown, as his `x>=0`.
 */
export function daysInStageOf(
  p: Pick<PipelineRow, "stageStart" | "createdAt">,
  today: string = etToday(),
): number | null {
  const start = (p.stageStart ?? "").trim() || etDateOf(p.createdAt ?? "");
  const d = daysSince(start, today);
  return d === null || d < 0 ? null : d;
}

export interface StageTile {
  key: string;
  label: string;
  /** Active rows on the stage's boards (web-form leads excluded on Intake). */
  count: number;
  /** Mean days in stage over the rows that carry a date, rounded; null if none. */
  avgDays: number | null;
}

function isPipelineActive(p: PipelineRow): boolean {
  return PIPELINE_BOARD_IDS.includes(p.boardId) && searchBucket(p) === "active";
}

/**
 * One tile per stage. `leadIds` are the web-form leads to leave out of Intake
 * — they have their own tile, and Brandon's `lead` mode is not `onboarding`.
 */
export function stageTiles(
  rows: readonly PipelineRow[],
  leadIds: ReadonlySet<string> = new Set(),
  today: string = etToday(),
): StageTile[] {
  return STAGE_BOARDS.map((s) => {
    // The lead ids come from Profile Send Off's form groups, so only Intake can
    // ever hold one — scoped by construction rather than by trust.
    const drop = s.key === "intake" ? leadIds : null;
    const mine = rows.filter(
      (p) => s.boards.includes(p.boardId) && isPipelineActive(p) && !drop?.has(p.id),
    );
    const days = mine.map((p) => daysInStageOf(p, today)).filter((d): d is number => d !== null);
    const avgDays = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null;
    return { key: s.key, label: s.label, count: mine.length, avgDays };
  });
}

export interface PipelineFacts {
  /** `searchBucket` says stuck — a Stuck group, a stuck advancer label, or a Final proposal. */
  stuck: number;
  /** The board's escalation flag, on a live (not completed) row. */
  escalated: number;
  /** Every row on any board — Brandon's "patients known". */
  known: number;
}

export function pipelineFacts(rows: readonly PipelineRow[]): PipelineFacts {
  const onb = rows.filter((p) => PIPELINE_BOARD_IDS.includes(p.boardId));
  return {
    stuck: onb.filter((p) => searchBucket(p) === "stuck").length,
    escalated: onb.filter((p) => p.escalated && !p.isCompleted).length,
    known: rows.length,
  };
}

/* ── Web-form leads ──────────────────────────────────────────────────────── */

export interface FormLeadRow {
  id: string;
  groupId: string;
  /** Drop-off Step `color_mm5zv7q8` — blank means the row never touched the form. */
  dropOffStep: string;
}

export interface FormLeadFacts {
  /** Rows in the two form groups that touched the DTC form. */
  leads: number;
  /** Their ids — what `stageTiles` leaves out of Intake. */
  leadIds: Set<string>;
  /** Form-group rows that never touched the form: the 8/25 import (§5.30). */
  imported: number;
  /** Drop-off steps by count, most common first. */
  steps: { step: string; n: number }[];
}

export function formLeadFacts(rows: readonly FormLeadRow[]): FormLeadFacts {
  const leadIds = new Set<string>();
  const by = new Map<string, number>();
  let imported = 0;
  for (const r of rows) {
    if (!isFormLead(r)) { imported++; continue; }
    leadIds.add(r.id);
    const step = r.dropOffStep.trim();
    by.set(step, (by.get(step) ?? 0) + 1);
  }
  const steps = [...by.entries()].map(([step, n]) => ({ step, n })).sort((a, b) => b.n - a.n || a.step.localeCompare(b.step));
  return { leads: leadIds.size, leadIds, imported, steps };
}

/** Brandon's sub-line: the top two steps, "N at Step 5 - Insurance · M at …". */
export function topStepsText(facts: Pick<FormLeadFacts, "steps">, take = 2): string {
  return facts.steps.slice(0, take).map((s) => `${s.n} at ${s.step}`).join(" · ");
}

/* ── Subscriptions ───────────────────────────────────────────────────────── */

export interface SubscriptionRow {
  /** Subscription Status `color_mm2t7tdy` — Paused · Active · Dead. */
  status: string;
  /** Days to Order `color_mkxmtv9c`. */
  daysToOrder: string;
  /** MR `color_mktyr8xg`. */
  mr: string;
}

/**
 * The board's OWN labels (`subscription/workflow.ts` option lists), matched
 * exactly — §9: labels are the contract. Brandon's `/late|passed/i` names the
 * same two; a pattern would also catch a label added later that merely
 * contains the word, so the list is the rule.
 */
export const LATE_LABELS: readonly string[] = ["Order Day Passed", "Very Late"];
export const MR_EXPIRED_LABEL = "MR Expired";

export interface SubscriptionFacts {
  active: number;
  paused: number;
  late: number;
  mrExpired: number;
}

export function subscriptionFacts(rows: readonly SubscriptionRow[]): SubscriptionFacts {
  const t = (s: string) => (s ?? "").trim();
  return {
    active: rows.filter((r) => t(r.status) === "Active").length,
    paused: rows.filter((r) => t(r.status) === "Paused").length,
    late: rows.filter((r) => LATE_LABELS.includes(t(r.daysToOrder))).length,
    mrExpired: rows.filter((r) => t(r.mr) === MR_EXPIRED_LABEL).length,
  };
}

/* ── Orders ──────────────────────────────────────────────────────────────── */

export interface OrderFacts {
  open: number;
  hold: number;
  backordered: number;
}

type OrderInput = Parameters<typeof orderFlags>[0] & Parameters<typeof orderStage>[0];

/** Open = the orders slice's own `OPEN_STAGES`; the two sub-counts are its flags. */
export function orderFacts(orders: readonly OrderInput[]): OrderFacts {
  let open = 0, hold = 0, backordered = 0;
  for (const o of orders) {
    if (!isOpenStage(orderStage(o))) continue;
    open++;
    const ids = new Set(orderFlags(o).map((f) => f.id));
    if (ids.has("hold")) hold++;
    if (ids.has("backordered") || ids.has("substitution")) backordered++;
  }
  return { open, hold, backordered };
}

/* ── Queues today ────────────────────────────────────────────────────────── */

export interface QueueBar {
  role: RoleConfig;
  /** null = no count for this role yet (Brandon's `snapshotNA` em dash). */
  count: number | null;
  esc: number;
  /** Fill width, 0–100 — sqrt-scaled against the largest bar, floor 3 when > 0. */
  pct: number;
  /** Where the bar goes; null for a bar that opens nothing. */
  href: string | null;
}

export interface QueueCard {
  title: string;
  bars: QueueBar[];
}

/**
 * The bar's door — the SAME rule the two burndowns use (`DailyBurndown.openBar`,
 * `OperationsTab`): FAX opens the in-app inbox, Auth Denied is deliberately
 * unclickable (its stage is unbuilt, §7), a role with no route opens nothing.
 */
export function queueHref(role: Pick<RoleConfig, "id" | "route">): string | null {
  if (role.id === "fax") return "/fax-inbox";
  if (role.id === "authDenied") return null;
  return role.route || null;
}

/** Brandon's fill: `max(sqrt(n)/sqrt(max)*100, 3)`, 0 for an empty bar. */
export function barPct(count: number | null, max: number): number {
  if (!count || count <= 0) return 0;
  return Math.max((Math.sqrt(count) / Math.sqrt(Math.max(max, 1))) * 100, 3);
}

/**
 * The stage cards, from the role registry grouped as the Operations tab groups
 * it. Every role is placed (`groupRoleRows` never drops one) except
 * Communications, which has no board, no queue and no count anywhere (§5.8),
 * so its bar could only ever read "—".
 */
export function queueCards(
  counts: Record<string, number | undefined>,
  escalated: Record<string, number | undefined>,
  roles: readonly RoleConfig[] = ROLES,
): QueueCard[] {
  const rows = roles.filter((r) => r.id !== "assignedPatients").map((role) => ({ role }));
  const max = Math.max(1, ...rows.map((r) => counts[r.role.id] ?? 0));
  return groupRoleRows(rows).map((g) => ({
    title: g.title,
    bars: g.bars.map(({ role }) => {
      const count = typeof counts[role.id] === "number" ? (counts[role.id] as number) : null;
      return { role, count, esc: escalated[role.id] ?? 0, pct: barPct(count, max), href: queueHref(role) };
    }),
  }));
}

/** Brandon's `fmt`: thousands separators, en-US. */
export function fmt(n: number): string {
  return n.toLocaleString("en-US");
}
