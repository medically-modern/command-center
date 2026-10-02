/**
 * Item state model (BUILD-SPEC §3.2): turns one item's events + current values into holder spans.
 *
 * Holder priority (§3.2.2): EXITED > STUCK > FINAL > MGR > QUEUE:<code>.
 * WHY a single merged timeline: stage, escalation, intake sub-stage, clinicals method, the INS
 * benefits marker and group moves all change state, and the order of same-instant changes
 * matters (stage first, then escalation: R1), so they are replayed together.
 */
import type { Dict } from "../types";
import type { HolderKind, HolderSpan, ItemRow, PipelineBoard, RawEvent } from "../types";
import { OO_CONFIG } from "../config";

type Cfg = typeof OO_CONFIG;
const COL_ORDER = (cfg: Cfg, board: PipelineBoard, col: string) =>
  col === cfg.stageColumn[board] ? 0 : col === cfg.escalationColumn[board] ? 1 : col === "__group__" ? 2 : 3;

interface Values { stage: number | null; esc: number | null; intSub: number | null; clin: number | null; group: string | null }
interface Flags { seenDenied: boolean; markerSinceLabel3: boolean; chaseCode: string | null; createdBeforeIntSplit: boolean }

export interface ResolvedState { kind: HolderKind; code: string | null; byGroup: boolean; waitingOverride?: string; exitReason?: "label" | "terminal" | "group" }

const FIRST_CODE: Record<PipelineBoard, string> = { INT: "1.1.1.1", MN: "1.1.2.1", INS: "1.1.3.1", WC: "1.1.4.1" };

/** Pure state function: values + history flags -> holder state (§3.2.2, §3.2.3). */
export function resolveState(board: PipelineBoard, v: Values, f: Flags, cfg: Cfg = OO_CONFIG, useGroup = true): ResolvedState {
  const g = (cfg.groups as Dict)[board];
  const exitLabels: readonly number[] = (cfg.exitLabels as Dict)[board];
  if (v.stage != null && exitLabels.includes(v.stage)) return { kind: "EXITED", code: null, byGroup: false, exitReason: "label" };
  if (board === "INT" && v.stage != null && (cfg.intTerminalLabels as readonly number[]).includes(v.stage)) return { kind: "EXITED", code: null, byGroup: false, exitReason: "terminal" };
  if (useGroup && v.group && g.exit.includes(v.group)) return { kind: "EXITED", code: null, byGroup: true, exitReason: "group" };
  const stuckLabels: readonly number[] = (cfg.stuckLabels as Dict)[board] ?? [];
  if (v.stage != null && stuckLabels.includes(v.stage)) return { kind: "STUCK", code: null, byGroup: false };
  if (useGroup && v.group && g.stuck.includes(v.group)) return { kind: "STUCK", code: null, byGroup: true };
  if (v.esc === cfg.escalation.finalLabel) return { kind: "FINAL", code: null, byGroup: false };
  if (v.esc === cfg.escalation.managerLabel) return { kind: "MGR", code: null, byGroup: false };
  if (useGroup && v.group && g.escalations.includes(v.group)) return { kind: "MGR", code: null, byGroup: true };
  return { kind: "QUEUE", code: resolveCode(board, v, f, cfg), byGroup: false,
    waitingOverride: board === "INT" && v.stage === cfg.intNeedMoreInfoLabel ? cfg.waitingOn.intNeedMoreInfo : undefined };
}

export function resolveCode(board: PipelineBoard, v: Values, f: Flags, cfg: Cfg = OO_CONFIG): string {
  if (board === "INT") {
    if (f.createdBeforeIntSplit) return "1.1.1";
    return v.intSub === cfg.intSubStageCleanupLabel ? "1.1.1.2" : "1.1.1.1";
  }
  if (v.stage == null) return FIRST_CODE[board];
  const map = (cfg.labelToCode as Dict)[board] as Record<number, string>;
  const raw = map[v.stage];
  if (raw == null) return `UNMAPPED:${board}:${v.stage}`;
  if (raw === "CHASE") {
    if (f.chaseCode) return f.chaseCode;
    if (!cfg.splitChaseClinicals) return "1.1.2.4";
    return v.clin != null && (cfg.parachuteRoleMethodLabels as readonly number[]).includes(v.clin) ? "1.1.2.4P" : "1.1.2.4F";
  }
  if (raw === "BENEFITS_SOS") return f.markerSinceLabel3 ? "1.1.3.2" : "1.1.3.1";
  if (board === "INS" && f.seenDenied && (v.stage === 4 || v.stage === 6)) return "1.1.3.6";
  return raw;
}

const stateKey = (s: ResolvedState) => (s.kind === "QUEUE" ? `QUEUE:${s.code}` : s.kind);

export interface ItemSpansResult { spans: HolderSpan[]; historyMismatch: boolean; lastEventMs: number | null }

const isSpecialGroup = (cfg: Cfg, board: PipelineBoard, g: string | undefined) => {
  const grp = (cfg.groups as Dict)[board];
  return !!g && (grp.stuck.includes(g) || grp.escalations.includes(g) || grp.exit.includes(g));
};

/**
 * Builds holder spans for one item (R1-R3, §3.2.2 merge rules). Events must belong to this item.
 * Prototype review fixes: group is unknown until a move is seen (a first move OUT of a special group
 * opens a synthetic span only from the group-move window start); items without stage history are
 * synthetic (age unknown); sub-120 s label/group lag blips are removed; re-entry is computed last.
 */
export function buildItemSpans(board: PipelineBoard, item: ItemRow, events: RawEvent[], snapshotAt: number, cfg: Cfg = OO_CONFIG, groupHistoryStartMs?: number): ItemSpansResult {
  const stageCol = cfg.stageColumn[board];
  const escCol = cfg.escalationColumn[board];
  const clinCol = cfg.clinicalsMethodColumn;
  const markerCol = cfg.insBenefitsMarkerColumn;
  const subCol = cfg.intSubStageColumn;
  const evs = [...events].sort((a, b) => a.atMs - b.atMs || COL_ORDER(cfg, board, a.columnId) - COL_ORDER(cfg, board, b.columnId) || a.eventId.localeCompare(b.eventId));
  const firstOf = (col: string) => evs.find((e) => e.columnId === col);
  const lastOf = (col: string) => { for (let i = evs.length - 1; i >= 0; i--) if (evs[i].columnId === col) return evs[i]; return undefined; };
  const cur = (col: string) => (item.values[col]?.index ?? null) as number | null;
  const hasStageHistory = !!firstOf(stageCol);
  const firstAtCreation = hasStageHistory && Math.abs(firstOf(stageCol)!.atMs - item.createdAtMs) <= cfg.firstEventToleranceSeconds * 1000;
  const v: Values = {
    // MN/INS/WC: automation sets the first stage at creation, so an unknown "before" value means "the first logged value".
    // R2 (D-37): infer "first logged value" only when that first event happened at creation (automation sets it).
    stage: hasStageHistory ? (firstOf(stageCol)!.fromIndex ?? (board !== "INT" && firstAtCreation ? firstOf(stageCol)!.toIndex : null)) : cur(stageCol),
    esc: firstOf(escCol) ? firstOf(escCol)!.fromIndex : null,
    intSub: firstOf(subCol) ? firstOf(subCol)!.fromIndex : null,
    clin: firstOf(clinCol) ? firstOf(clinCol)!.fromIndex : cur(clinCol),
    group: null, // unknown until a group move is seen (group moves are fetched for a short window only)
  };
  const f: Flags = { seenDenied: false, markerSinceLabel3: false, chaseCode: null,
    createdBeforeIntSplit: board === "INT" && item.createdAtMs < Date.parse(cfg.intSubStageHistoryStart) };
  // A first observed move OUT of a Stuck/Escalations/exit group: the move IN was not logged.
  const firstMove = evs.find((e) => e.columnId === "__group__");
  // The group-move window start is fixed at the first cold load and kept on warm loads (prototype review A-1),
  // so the synthetic span applies only when the move-in really predates the window.
  const gStart = groupHistoryStartMs ?? (snapshotAt - cfg.groupMoves.lookbackDays * 86400000);
  const syntheticGroupStart = firstMove && isSpecialGroup(cfg, board, firstMove.fromGroupId) && gStart < firstMove.atMs
    ? Math.max(item.createdAtMs, gStart) : null;

  const spans: HolderSpan[] = [];
  const open = (s: ResolvedState, at: number, ev: RawEvent | null, synthetic = false) => {
    spans.push({ boardKey: board, itemId: item.itemId, state: stateKey(s) as HolderSpan["state"], kind: s.kind, code: s.kind === "QUEUE" ? s.code : null,
      startMs: at, endMs: null, synthetic, byGroup: s.byGroup, reentry: false, startEventUserId: ev?.userId ?? null, startBulk: ev?.bulk ?? false,
      endEventBulk: false, waitingOverride: s.waitingOverride, exitReason: s.exitReason, stageLabel: v.stage });
  };
  const close = (at: number, ev: RawEvent | null) => { const last = spans[spans.length - 1]; if (last && last.endMs == null) { last.endMs = at; last.endEventBulk = ev?.bulk ?? false; } };

  let state = resolveState(board, v, f, cfg);
  // No stage history in the fetched window: the start is unknown, so the age is not trustworthy (red-team P-1).
  const openingSynthetic = board === "INT" ? (!hasStageHistory && cur(stageCol) != null)
    : (!hasStageHistory || (firstOf(stageCol)!.fromIndex == null && !firstAtCreation));
  open(state, item.createdAtMs, null, openingSynthetic);
  const apply = (at: number, ev: RawEvent | null, synthetic: boolean) => {
    const next = resolveState(board, v, f, cfg);
    if (next.kind === "QUEUE" && next.code?.startsWith("1.1.2.4")) f.chaseCode = next.code; // channel fixed at span start (KL-03)
    if (stateKey(next) !== stateKey(state)) { close(at, ev); open(next, at, ev, synthetic); state = next; }
  };
  let syntheticGroupApplied = syntheticGroupStart == null;
  for (const e of evs) {
    if (!syntheticGroupApplied && e.atMs >= syntheticGroupStart!) {
      v.group = firstMove!.fromGroupId!; apply(syntheticGroupStart!, null, true); syntheticGroupApplied = true;
    }
    const prevStage = v.stage;
    if (e.columnId === stageCol) v.stage = e.toIndex;
    else if (e.columnId === escCol) v.esc = e.toIndex;
    else if (e.columnId === subCol) v.intSub = e.toIndex;
    else if (e.columnId === clinCol) v.clin = e.toIndex;
    else if (e.columnId === "__group__") v.group = e.toGroupId ?? null;
    else if (e.columnId === markerCol && board === "INS" && v.stage === 3) f.markerSinceLabel3 = true;
    if (e.columnId === stageCol) {
      if (board === "INS" && prevStage === 0) f.seenDenied = true;
      if (v.stage !== prevStage) { f.markerSinceLabel3 = false; f.chaseCode = null; }
    }
    apply(e.atMs, e, false);
  }
  // R3: the current value wins for the open span.
  const curState = resolveState(board, { ...v, stage: cur(stageCol) ?? v.stage, esc: cur(escCol), intSub: board === "INT" ? (cur(subCol) ?? v.intSub) : v.intSub, group: item.groupId }, { ...f }, cfg, true);
  const lastStage = lastOf(stageCol); const lastEsc = lastOf(escCol);
  const stageMismatch = lastStage != null && lastStage.toIndex !== cur(stageCol);
  const escMismatch = (lastEsc != null && lastEsc.toIndex !== cur(escCol)) || (lastEsc == null && cur(escCol) != null && [0, 2].includes(cur(escCol)!));
  const historyMismatch = stageMismatch || escMismatch;
  const lastEventMs = evs.length ? evs[evs.length - 1].atMs : null;
  if (stateKey(curState) !== stateKey(state)) {
    // Start = latest event on the mismatching column (R3), else creation. Group-driven: the move into the current group.
    const gm = curState.byGroup ? [...evs].reverse().find((e) => e.columnId === "__group__" && e.toGroupId === item.groupId) : undefined;
    const colEv = stageMismatch ? lastStage : escMismatch ? lastEsc : undefined;
    // byGroup without a logged move: latest event on any tracked column (§3.2.2), never before the current span (review A-2).
    const base = gm ? gm.atMs : curState.byGroup ? (lastEventMs ?? item.createdAtMs) : (colEv?.atMs ?? item.createdAtMs);
    const lastOpen = spans[spans.length - 1];
    const start = Math.max(item.createdAtMs, base, lastOpen?.startMs ?? item.createdAtMs);
    close(start, null);
    open(curState, start, gm ?? null, !gm);
  }
  // Merge accidental flips: drop spans shorter than minSpan whose neighbours are the same state.
  const minMs = cfg.loops.minSpanMinutes * 60_000;
  const lagMs = cfg.attributionMatchSeconds * 1000;
  for (let i = spans.length - 2; i >= 1; i--) {
    const s = spans[i], a = spans[i - 1], b = spans[i + 1];
    const dur = (s.endMs ?? snapshotAt) - s.startMs;
    const sameSides = s.endMs != null && dur < minMs && a.state === b.state;
    // Label/group lag (prototype review CR-3): automations move items between groups seconds after a label change,
    // and INS approvals clear the escalation before setting Stuck. Such blips are not real states.
    const lagBlip = s.endMs != null && dur < lagMs && (s.byGroup || (s.kind === "QUEUE" && (a.kind === "FINAL" || a.kind === "MGR") && b.kind === "STUCK"));
    if (sameSides) { a.endMs = b.endMs; a.endEventBulk = b.endEventBulk; spans.splice(i, 2); }
    else if (lagBlip) { a.endMs = s.endMs; a.endEventBulk = s.endEventBulk; spans.splice(i, 1); }
  }
  const kept = spans.filter((s, i) => i === spans.length - 1 || (s.endMs ?? snapshotAt) > s.startMs);
  for (let i = 1; i < kept.length; i++) if (kept[i].state === kept[i - 1].state && kept[i - 1].endMs === kept[i].startMs) { kept[i - 1].endMs = kept[i].endMs; kept[i - 1].endEventBulk = kept[i].endEventBulk; kept.splice(i--, 1); }
  // Re-entry is decided only after all merges (prototype review A7).
  const seen = new Set<string>();
  for (const s of kept) { if (s.code) { s.reentry = seen.has(s.code); seen.add(s.code); } }
  return { spans: kept, historyMismatch, lastEventMs };
}
