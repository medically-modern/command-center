/**
 * The in-oversight search and the pinned patient (pixel-match Phase 7,
 * CLAUDE.md §5.52) — Brandon's `.ov-search` + `.ov-focus`, on Josh's terms
 * (2026-09-24): *"a search inside oversight would be helpful but it would need
 * to be keyed on only patients that are IN oversight"*.
 *
 * ⚠️⚠️ **THE POPULATION IS THE ONE THE CHARTS ALREADY HOLD — NEVER A BOARD
 * READ.** `pipelinePeople` is the union of every chart's patients out of the
 * `Map` `fetchOversightData()` returns, deduplicated by item id. That is what
 * "IN oversight" means: a patient is here if and only if some chart on this
 * screen counts them, so the search can never find somebody the columns do
 * not show, and it costs no request at all — the header's seven-board search
 * (§5.39, §5.52) is the one that asks Monday.
 *
 * ⚠️ **NAME ONLY, and the placeholder says so.** The oversight fetch carries
 * the columns the charts and drill-downs read — Days in Stage, the escalation
 * and stage columns, Primary Insurance, Referral Source — and no DOB or phone
 * (`columnsForBoard` in `oversightApi`). Brandon's placeholder promises "name,
 * DOB, phone, member ID…"; ours promises what the box does, because a
 * placeholder is a contract (§5.39f). Widening the fetch for a finder would be
 * more Monday on a 90-second poll over five boards, which is not a visual change.
 *
 * ⚠️ **One patient, one section.** A chart is bound to a board and every
 * section is one board's stages, so a patient (one item id) can only ever sit
 * in charts of ONE section — which is what makes "picking one switches the
 * stage below" well-defined.
 *
 * ⚠️ The decision rules here are the drill-down's, moved rather than copied:
 * `isBotOwnedRow` and the per-kind copy (`decisionCopy`) used to live inside
 * `OversightTab.tsx`, and the pinned card needed them too. Two copies of "which
 * rows get a button" is how one column offers a decision the other refuses.
 */
import {
  CHART_DEFS,
  OVERSIGHT_SECTIONS,
  reasonBucketsFor,
  type ChartDef,
  type OversightPatient,
} from "./oversightApi";
import { fuzzyNameMatch } from "./fuzzyName";

/** Which of the three manager columns a chart sits in (1 = Processor Overview). */
export type OvColumn = 1 | 2 | 3;

export interface PipelinePerson {
  patient: OversightPatient;
  /** Every chart on the screen that counts this patient, in section order. */
  charts: ChartDef[];
  sectionId: string;
  sectionTitle: string;
}

const CHART_SECTION = new Map<string, { id: string; title: string; column: OvColumn }>();
for (const s of OVERSIGHT_SECTIONS) {
  for (const id of s.chartIds) CHART_SECTION.set(id, { id: s.id, title: s.title, column: 1 });
  for (const id of s.secondaryChartIds ?? []) CHART_SECTION.set(id, { id: s.id, title: s.title, column: 2 });
  for (const id of s.tertiaryChartIds ?? []) CHART_SECTION.set(id, { id: s.id, title: s.title, column: 3 });
}
const CHART_ORDER = new Map(CHART_DEFS.map((c, i) => [c.id, i]));

/** The column a chart renders in; 1 for a chart no section lists. */
export function columnOf(chartId: string): OvColumn {
  return CHART_SECTION.get(chartId)?.column ?? 1;
}

/** The section (stage dropdown entry) a chart belongs to, or null. */
export function sectionOf(chartId: string): { id: string; title: string } | null {
  const s = CHART_SECTION.get(chartId);
  return s ? { id: s.id, title: s.title } : null;
}

/**
 * Every patient on the screen, once each, with the charts that count them.
 *
 * ⚠️ Deduplicated by ITEM id: the same patient sits in several charts (a
 * Manager Intervention chart's population is a subset of the stage's), and a
 * finder that listed them once per chart would read as three people.
 */
export function pipelinePeople(data: Map<string, OversightPatient[]> | null | undefined): PipelinePerson[] {
  if (!data) return [];
  const byId = new Map<string, PipelinePerson>();
  for (const [chartId, patients] of data) {
    const chart = CHART_DEFS.find((c) => c.id === chartId);
    const section = CHART_SECTION.get(chartId);
    if (!chart || !section) continue;
    for (const p of patients) {
      const cur = byId.get(p.id);
      if (cur) {
        if (!cur.charts.some((c) => c.id === chart.id)) cur.charts.push(chart);
      } else {
        byId.set(p.id, { patient: p, charts: [chart], sectionId: section.id, sectionTitle: section.title });
      }
    }
  }
  for (const person of byId.values()) {
    person.charts.sort((a, b) => (CHART_ORDER.get(a.id) ?? 0) - (CHART_ORDER.get(b.id) ?? 0));
  }
  return [...byId.values()];
}

export const MAX_SEARCH_ROWS = 8;
export const MIN_SEARCH_CHARS = 2;

/**
 * The finder. Every word of the query has to be found in the name (a
 * substring, or — `fuzzyNameMatch`'s rule — an in-order subsequence for a word
 * of four or more letters, so a typo still finds the patient). Exact substring
 * matches rank first; ties keep the pipeline order.
 */
export function searchPipeline(people: PipelinePerson[], query: string, max = MAX_SEARCH_ROWS): PipelinePerson[] {
  const q = query.trim().toLowerCase();
  if (q.length < MIN_SEARCH_CHARS) return [];
  const words = q.split(/\s+/).filter(Boolean);
  const exact = (name: string) => {
    const n = name.toLowerCase();
    return words.every((w) => n.includes(w));
  };
  const hits = people.filter((p) => fuzzyNameMatch(p.patient.name, q));
  hits.sort((a, b) => Number(exact(b.patient.name)) - Number(exact(a.patient.name)));
  return hits.slice(0, max);
}

/**
 * The chart a pinned patient is WORKED from: Final Decisions over Manager
 * Intervention over Processor Overview, because the later column is where a
 * manager's decision lives, and within a column the first chart listed.
 */
export function seniorChart(charts: ChartDef[]): ChartDef | null {
  if (!charts.length) return null;
  return [...charts].sort((a, b) => columnOf(b.id) - columnOf(a.id) || (CHART_ORDER.get(a.id) ?? 0) - (CHART_ORDER.get(b.id) ?? 0))[0];
}

/** Reason bars whose state belongs to the DVS bot, not to a person. */
export const BOT_OWNED_REASONS = new Set(["DVS Retry", "DVS Manual Review"]);

/**
 * Is this row purely a bot state, i.e. nothing for a manager to decide? Only
 * true when EVERY reason the row matched is bot-owned — a row with no reasons
 * at all (a day-bucketed chart, or a patient the bars missed) is emphatically
 * not, since that is the row most likely to be stranded.
 */
export const isBotOwnedRow = (reasons: string[]): boolean =>
  reasons.length > 0 && reasons.every((r) => BOT_OWNED_REASONS.has(r));

export type DecisionAction = "approve" | "return" | "escalate";

/**
 * What a decision means on THIS chart — the copy the confirm dialog prints and
 * the rules the buttons obey. One reading, shared by the drill-down and the
 * pinned card.
 */
export function decisionCopy(chart: ChartDef) {
  const isDecisionChart = !!chart.decision;
  const returnRedates = chart.decision === "proposed-stuck";
  // Welcome Call board returns clear the Follow Up SNOOZE rather than writing a
  // date — that board has no Next Action Date; a cleared Follow Up is "due now".
  const returnClearsSnooze =
    chart.decision === "welcome-call-manager" || chart.decision === "welcome-call-final";
  const reasonNotesLabel =
    chart.decision === "proposed-stuck" ? "MN Notes" : returnClearsSnooze ? "Welcome Call Notes" : "Reference Notes";
  // Manager Intervention charts: the two outcomes are Escalate to Final
  // Decisions (required note) or Return to Queue.
  const isEscalateChart =
    chart.decision === "submit-auth-manager" ||
    chart.decision === "intake-manager" ||
    chart.decision === "welcome-call-manager";
  /** ⚠️ The bot-owned exemption is INSURANCE-only. A DVS retry/manual row has
   *  nothing for a manager to decide; every Patient Intake escalation is a
   *  human's, so every row there gets buttons — and must, since the escalation
   *  is what took the patient out of the rep's queue. */
  const skipBotRows = chart.decision === "submit-auth-manager";
  // The proposal is stamped into the reason source, which is NOT always the
  // chart's notesColId (Chase charts stamp the MN notes) — show the column the
  // manager is actually deciding from.
  const returnNotesColId = chart.reasonColId ?? chart.notesColId;
  return { isDecisionChart, returnRedates, returnClearsSnooze, reasonNotesLabel, isEscalateChart, skipBotRows, returnNotesColId };
}

/**
 * The decision buttons a patient gets on a chart — exactly the drill-down's
 * rule: a Manager Intervention chart offers Escalate to Final + Return to
 * Queue (nothing for a bot-owned DVS row), a Final Decisions chart offers
 * Approve Stuck + Return to Queue, and a chart with no `decision` offers none.
 */
export function decisionActions(chart: ChartDef, patient: OversightPatient): Array<{ action: DecisionAction; label: string }> {
  if (!chart.decision) return [];
  const { isEscalateChart, skipBotRows } = decisionCopy(chart);
  if (isEscalateChart) {
    if (skipBotRows && isBotOwnedRow(reasonBucketsFor(chart, patient))) return [];
    return [
      { action: "escalate", label: "Escalate to Final" },
      { action: "return", label: "Return to Queue" },
    ];
  }
  return [
    { action: "approve", label: "Approve Stuck" },
    { action: "return", label: "Return to Queue" },
  ];
}

/** Brandon's `.gs-foot` line under the finder's rows. */
export function searchFootLine(count: number): string {
  return `${count} match${count === 1 ? "" : "es"} across every stage · Enter opens the first · picking one switches the stage below and pins the patient on top`;
}

/** What the empty drop-down says — too short, or nobody. */
export function searchEmptyLine(query: string): string {
  const q = query.trim();
  if (q.length < MIN_SEARCH_CHARS) return "Keep typing — a patient's name.";
  return `No patient named “${q}” is in the pipeline right now. This box searches the oversight stages only; the header search covers every board.`;
}
