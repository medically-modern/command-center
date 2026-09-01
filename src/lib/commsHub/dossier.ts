/**
 * The patient dossier — "what is going on with the person who just texted us",
 * assembled from every board they sit on.
 *
 * Pure. The Monday reads live in `dossierApi.ts`; everything that decides what
 * the records MEAN is here so it can be tested without a board.
 *
 * A patient is one item PER BOARD (CLAUDE.md §6): finishing Medical Evaluation
 * leaves a completed item in that board's Completed group while the live item
 * moves on. So "their profile" is really a trail, and the widget's job is to
 * show the trail and open the live end of it.
 */
import { NON_PIPELINE_BOARDS, PIPELINE_ORDER, pipelineIndex, type PipelineBoard } from "./pipelineOrder";

/** One board's record of this patient. */
export interface DossierItem {
  itemId: string;
  name: string;
  phone: string;
  boardId: number;
  boardName: string;
  groupId: string;
  groupTitle: string;
  /** In a group flagged `isCompleted` in the BOARDS registry. */
  isCompleted: boolean;
  /** In a Stuck group — out of the pipeline until a manager moves them back. */
  isStuck: boolean;
  /** Date of birth as the board holds it — the corroborating identity signal
   *  when a record carries no phone. See `nameMatchAccepted`. */
  dob: string;
  /** Where a click on this record goes. Empty when the board has no page. */
  route: string;
  /** Raw Stage Advancer text, e.g. "Chase Clinicals". */
  stageAdvancerText: string;
  /** The board's notes column, newest last. */
  notes: string;
  nextActionDate: string;
  daysSinceStage: string;
}

export type StepState =
  /** Finished — the item sits in that board's Completed group. */
  | "completed"
  /** The live record; this is where the work is. */
  | "active"
  /** On the board but neither finished nor the live end of the trail —
   *  a Stuck record, or an older parallel item. */
  | "parked"
  /** No item on that board. Ahead of them, or they skipped it. */
  | "notReached";

export interface PathStep {
  board: PipelineBoard;
  state: StepState;
  item: DossierItem | null;
}

export interface PatientDossier {
  name: string;
  phone: string;
  /**
   * The record a rep should open. Null when every item is completed or stuck —
   * a patient can genuinely have no live stage, and inventing one would send
   * somebody to a finished record as though it were work.
   */
  active: DossierItem | null;
  /** One entry per pipeline board, in tracker order. */
  path: PathStep[];
  /** Records on boards that aren't pipeline stages (Secondary Claims). */
  alsoOn: DossierItem[];
  /** Everything, for callers that want the raw trail. */
  items: DossierItem[];
}

/** Group titles that mean "parked, not finished". Matched on the TITLE because
 *  the BOARDS registry only flags Completed groups, and Monday reuses group ids
 *  across boards (§5.18) so an id list would be the wrong key here. */
function isStuckGroup(groupTitle: string): boolean {
  return /\bstuck\b/i.test(groupTitle);
}

export function markStuck<T extends { groupTitle: string }>(item: T): boolean {
  return isStuckGroup(item.groupTitle);
}

/** Digits of a date of birth, so `01/15/1957` and `01-15-1957` compare equal.
 *  Deliberately NOT a date parse: an ISO value and a US value would normalise
 *  to different digit strings, which REJECTS the match — the safe direction. */
export function dobKey(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/** What we know about the patient from the phone pass — the anchor every name
 *  match is checked against. */
export interface PatientIdentity {
  /** E.164 number the lookup started from. */
  phone: string;
  /** DOB from the phone-matched records, where one carried it. */
  dob: string;
}

/**
 * May a NAME match be admitted to this patient's trail?
 *
 * ⚠️ **A NAME IS NOT AN IDENTITY.** Two patients called Maria Garcia is an
 * ordinary thing in a population this size, and admitting a name-only match
 * merges their trails — one person's notes and stage rendered on the other's
 * conversation, and the wrong Monday item handed to `sendMessage` to attribute
 * an outbound text to.
 *
 * So a name match always needs a second signal, and there are exactly two:
 *   - the record's **phone** agrees → accept;
 *   - the phone is **blank** (the ordinary shape of the completed record this
 *     pass exists to find) → accept only if the **date of birth** agrees.
 *
 * Everything else is rejected, INCLUDING a blank-phone record with no DOB on
 * either side. That is deliberate and it is the safe direction: the cost of a
 * false reject is one missing chip in a patient's history, and the cost of a
 * false accept is another patient's notes on this conversation. DOB rides on
 * the same create-item automations as the phone, so a real completed record
 * almost always carries one.
 */
export function nameMatchAccepted(
  item: Pick<DossierItem, "phone" | "dob">,
  anchor: PatientIdentity,
): boolean {
  if (item.phone) return item.phone === anchor.phone;
  const a = dobKey(anchor.dob);
  const b = dobKey(item.dob);
  return a.length > 0 && a === b;
}

/**
 * Which record is the live one?
 *
 * The item on the **furthest-along** pipeline board that is neither completed
 * nor stuck. Furthest-along rather than most-recently-touched because no board
 * carries a reliable "last activity" column and a patient can legitimately hold
 * an open item on two boards at once (an Update Clinicals loop puts them back
 * on Medical Evaluation while Subscription runs) — in that case the later
 * board is the one they have actually reached.
 *
 * ⚠️ A record on a NON-pipeline board can never be the active one. Secondary
 * Claims is a parallel reconciliation board, so treating it as the live stage
 * would send a rep to a page that says nothing about the patient's progress.
 */
export function pickActive(items: DossierItem[]): DossierItem | null {
  let best: DossierItem | null = null;
  let bestIdx = -1;
  for (const it of items) {
    if (it.isCompleted || it.isStuck) continue;
    const idx = pipelineIndex(it.boardId);
    if (idx < 0) continue;
    if (idx > bestIdx) {
      best = it;
      bestIdx = idx;
    }
  }
  return best;
}

/**
 * Fold a patient's board items into the dossier the widget renders.
 *
 * `name`/`phone` fall back through the items, because a completed record can
 * carry a blank phone column while a live one has it (or the other way round)
 * — and the header naming the patient must not go empty for that.
 */
export function buildDossier(items: DossierItem[]): PatientDossier {
  const active = pickActive(items);

  const byBoard = new Map<number, DossierItem[]>();
  for (const it of items) {
    const list = byBoard.get(it.boardId);
    if (list) list.push(it);
    else byBoard.set(it.boardId, [it]);
  }

  const path: PathStep[] = PIPELINE_ORDER.map((board) => {
    const onBoard = byBoard.get(board.boardId) ?? [];
    if (!onBoard.length) return { board, state: "notReached" as const, item: null };
    const live = onBoard.find((i) => i.itemId === active?.itemId);
    if (live) return { board, state: "active" as const, item: live };
    // A board a patient ran twice leaves a completed item and possibly a live
    // one. The completed record is the interesting half of the history, so it
    // wins the chip; the widget links to it.
    const done = onBoard.find((i) => i.isCompleted);
    if (done) return { board, state: "completed" as const, item: done };
    return { board, state: "parked" as const, item: onBoard[0] };
  });

  const alsoOn = items.filter((i) => NON_PIPELINE_BOARDS.includes(i.boardId));

  return {
    name: (active?.name || items.find((i) => i.name)?.name || "").trim(),
    phone: active?.phone || items.find((i) => i.phone)?.phone || "",
    active,
    path,
    alsoOn,
    items,
  };
}

/** How far along the chain the patient has actually got, for a caption like
 *  "3 of 6 stages complete". Counts completed steps only. */
export function stagesCompleted(path: PathStep[]): number {
  return path.filter((s) => s.state === "completed").length;
}
