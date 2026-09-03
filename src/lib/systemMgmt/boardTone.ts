/**
 * How a board is NAMED and COLOURED wherever a manager scans a list of patients
 * across boards — System Management → Search rows and the Communications Hub's
 * "find this patient" list. One table so the two cannot drift (§5.9's rule).
 */
export interface BoardTone {
  /** Left border colour for the stage column. */
  bar: string;
  /** The small-caps board label. */
  label: string;
  /** The stage text itself. */
  stage: string;
}

export const BOARD_TONE: Record<number, BoardTone> = {
  18406352652: { bar: "border-l-sky-500",     label: "text-sky-700 dark:text-sky-300",         stage: "text-sky-950 dark:text-sky-100" },         // Profile Send Off
  18406060017: { bar: "border-l-amber-500",   label: "text-amber-700 dark:text-amber-300",     stage: "text-amber-950 dark:text-amber-100" },     // Medical Evaluation
  18410601299: { bar: "border-l-violet-500",  label: "text-violet-700 dark:text-violet-300",   stage: "text-violet-950 dark:text-violet-100" },   // Insurance
  18410804557: { bar: "border-l-emerald-500", label: "text-emerald-700 dark:text-emerald-300", stage: "text-emerald-950 dark:text-emerald-100" }, // Welcome Call
  18407459988: { bar: "border-l-teal-500",    label: "text-teal-700 dark:text-teal-300",       stage: "text-teal-950 dark:text-teal-100" },       // Subscription
};

export const DEFAULT_BOARD_TONE: BoardTone = {
  bar: "border-l-slate-400",
  label: "text-muted-foreground",
  stage: "text-foreground",
};

/** The board as a manager says it: "Medical Necessity", not "Medical Evaluation". */
export const BOARD_STAGE_LABEL: Record<number, string> = {
  18406352652: "Intake",
  18406060017: "Medical Necessity",
  18410601299: "Insurance",
  18410804557: "Welcome Call",
  18407459988: "Subscription",
  18392794310: "DTC Intake",
  18413019028: "Secondary Claims",
};

export function boardTone(boardId: number): BoardTone {
  return BOARD_TONE[boardId] ?? DEFAULT_BOARD_TONE;
}
export function boardStageLabel(boardId: number, fallback: string): string {
  return BOARD_STAGE_LABEL[boardId] ?? fallback;
}
