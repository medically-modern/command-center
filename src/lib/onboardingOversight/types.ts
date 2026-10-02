/**
 * Data model for the Onboarding Oversight dashboard (BUILD-SPEC §4.1).
 * Everything the metrics read is one of these plain objects, so every number can be
 * traced back to monday item/column/label IDs.
 */
export type BoardKey = "INT" | "MN" | "INS" | "WC" | "SUB" | "FAX";
export type PipelineBoard = "INT" | "MN" | "INS" | "WC";

/** One status change (or group move) from monday's activity log, normalized. */
export interface RawEvent {
  eventId: string;
  boardKey: BoardKey;
  itemId: string;
  /** Column ID for column changes; "__group__" for group moves. */
  columnId: string;
  event: "update_column_value" | "move_pulse_from_group";
  toIndex: number | null;
  fromIndex: number | null;
  /** monday's status label text at the time (not PII; used only as a fallback in labels.ts). */
  toText?: string | null;
  /** numeric value at the time (numeric columns, or a digits-only count text) */
  toNum?: number | null;
  /** date columns (e.g. Next Action Date): the date set and the date replaced (YYYY-MM-DD; not PII) */
  toDate?: string | null; fromDate?: string | null;
  fromGroupId?: string;
  toGroupId?: string;
  atMs: number;
  userId: number;
  /** Marked by §3.1 bulk rules (signature, is_batch_action, or operator window). */
  bulk: boolean;
}

/** Current state of one monday item. Text of count-only columns is never stored. */
export interface ItemRow {
  boardKey: BoardKey;
  itemId: string;
  groupId: string;
  createdAtMs: number;
  uid: string | null;
  values: Record<string, { index?: number | null; date?: string | null; num?: number; nonEmpty: boolean }>;
  /** Patient name: live monday mode only (never in exports, fixtures or commits). */
  name?: string;
  /** Escalation kind, classified live from the notes stamp (v2/escClass.ts); one word, never the text. */
  escClass?: "proposedStuck" | "edgeCase" | "unclassified";
}

export type HolderKind = "EXITED" | "STUCK" | "FINAL" | "MGR" | "QUEUE";
/** "QUEUE:<code>" or one of the parked/exited states. */
export type HolderState = "EXITED" | "STUCK" | "FINAL" | "MGR" | `QUEUE:${string}`;

export interface HolderSpan {
  boardKey: PipelineBoard;
  itemId: string;
  state: HolderState;
  kind: HolderKind;
  /** Taxonomy (or non-taxonomy) code for QUEUE spans, else null. */
  code: string | null;
  startMs: number;
  endMs: number | null;
  /** True when the start is unknown (log missed the change): the age is an UPPER bound. */
  synthetic: boolean;
  byGroup: boolean;
  reentry: boolean;
  startEventUserId: number | null;
  startBulk: boolean;
  endEventBulk: boolean;
  /** For QUEUE spans entered via INT "Need More Info". */
  waitingOverride?: string;
  /** EXITED spans: exit label (counts as a stage exit), INT terminal label, or group only. */
  exitReason?: "label" | "terminal" | "group";
  /** Stage label index in effect when the span opened. */
  stageLabel?: number | null;
}

export type ArrivalSource = "int_link" | "int_uid" | "mn_created" | "wc_date_of_intake" | "first_item" | null;

export interface Journey {
  patientKey: string;
  primary: Partial<Record<BoardKey, ItemRow>>;
  duplicates: ItemRow[];
  arrivalMs: number | null;
  arrivalSource: ArrivalSource;
  releaseMs: number | null;
  referralSource: string | null;
  expedited: boolean;
  importCohort: boolean;
}

/** Parsed view of CC's access.json: who holds which role. Emails are only used for matching. */
export interface AccessView {
  managers: string[];
  /** person key (access.json processors key) -> roles */
  roles: Record<string, string[]>;
  callAnswererKeys: string[];
}

export interface CommsSla {
  open: number; over: number; resolved: number; within: number; withinPct: number | null;
  medianMs: number | null; byHow: Record<string, number>;
  reps: { who: string; resolved: number; within?: number; withinPct?: number | null }[];
}

export interface FaxWeek { weekStart: string; byGroup: Record<string, number>; }
export interface FaxData { weeks: FaxWeek[]; neverClosed: Record<string, number>; }

export interface FetchError { board: BoardKey | "COMMS" | "FAX"; message: string; atMs: number; }

export interface Snapshot {
  schemaVersion: number;
  snapshotAt: number;
  items: ItemRow[];
  events: RawEvent[];
  spans: HolderSpan[];
  journeys: Journey[];
  access: AccessView | null;
  commsSla: CommsSla | null;
  fax: FaxData | null;
  excludedIntCounts: { total: number; escalated: number } | null;
  cursors: Partial<Record<BoardKey, number>>;
  fetchErrors: FetchError[];
  /** "gateway" | "direct" | "fixture": shown in the freshness bar. */
  mode: string;
}

export interface MetricQuery {
  periodDays: 7 | 28 | 90;
  filters: { referralSource?: string[]; expeditedOnly?: boolean };
}

export type Status = "healthy" | "risk" | "breaking" | "nodata" | "nottracked" | "notconnected" | "finding";

export interface ItemRef { boardKey: BoardKey; itemId: string }

export interface LineageRef { board: string; columns: string[]; labels?: string }

export type DrillTarget =
  | { kind: "view"; view: "pipeline" | "byproducts" | "people" | "managers" | "patient"; focus?: string }
  | { kind: "items"; title: string }
  | { kind: "source"; text: string };

export interface MetricResult {
  id: string;
  value: number | null;
  n: number;
  status: Status;
  proposed: boolean;
  breakdown?: Record<string, number>;
  itemRefs: ItemRef[];
  drill: DrillTarget;
  caveats: string[];
  /** Human sentence for tiles. */
  text?: string;
}

/**
 * Runtime lookup into the per-board config literal (e.g. thresholds[code], groups[board]).
 * WHY one alias: OO_CONFIG is a deeply `as const` literal whose per-board shapes differ, and lookups
 * use runtime keys. Funnelling those casts through one named alias keeps them auditable.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Dict = Record<string, any>;
