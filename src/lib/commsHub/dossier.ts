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
  /** Which column that is, so the hub can append to it. Empty on a board the
   *  registry has no notes column for — the composer hides itself rather than
   *  offering a write with nowhere to go. */
  notesColId: string;
  /** ⚠️ And which KIND it is — `text` and `long_text` take different value
   *  shapes and Monday rejects the wrong one outright (see `BoardDef
   *  .notesColType`). Carried on the record rather than looked up at write
   *  time so the composer cannot write to one board's column with another
   *  board's shape. `null` when there is no notes column. */
  notesColType: "text" | "long_text" | null;
  nextActionDate: string;
  daysSinceStage: string;
  /** Raw text of every stage-detail column for this board, keyed by column id.
   *  Read once with the rest of the record so the detail pane needs no second
   *  round trip — see `stageDetail.buildStageDetail`. */
  cols: Record<string, string>;
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

/** One stage's running notes, for the hub's "notes from every stage" list. */
export interface StageNotes {
  boardId: number;
  boardName: string;
  itemId: string;
  /** Whether the rep is reading history or a live parallel record — the two
   *  badges on the block's header. Deliberately the flags rather than the raw
   *  group title: the title varies per board ("Completed" vs "Complete") and
   *  the flags already carry the only distinction that changes how it reads. */
  isCompleted: boolean;
  isStuck: boolean;
  notes: string;
}

/**
 * Every OTHER stage's notes, in pipeline order.
 *
 * Josh, 2026-09-02: *"notes should be ALL notes from all stages not just
 * welcome call notes, but welcome call notes should be the main attraction,
 * the others viewable on scroll"*. The active stage stays in its own box at the
 * top with the composer; this is what sits under it.
 *
 * ⚠️ **No extra Monday read.** Every board's notes column is already in
 * `dossierCols`, so each `DossierItem` arrives carrying its own stage's notes —
 * the pane was simply throwing all but the active one away. Fetching them
 * separately would be a second cross-board round trip for data already in hand.
 *
 * ⚠️ Ordered by PIPELINE position, not by the order the lookup returned them,
 * so the list reads as the patient's journey. Non-pipeline boards (Secondary
 * Claims) come last: they are a parallel reconciliation board, not a stage, and
 * putting them mid-chain would misrepresent where the patient is.
 *
 * ⚠️ A board can hold TWO records (a completed one and a live one from a
 * re-run). Both are listed — collapsing them would silently drop a cycle's
 * history, which is exactly what a rep is scrolling for.
 */
export function stageNoteTrail(dossier: PatientDossier): StageNotes[] {
  const activeId = dossier.active?.itemId ?? "";
  const rank = (it: DossierItem) => {
    const idx = pipelineIndex(it.boardId);
    return idx < 0 ? PIPELINE_ORDER.length : idx;
  };
  return dossier.items
    .filter((it) => it.itemId !== activeId && it.notes.trim().length > 0)
    .sort((a, b) => rank(a) - rank(b) || a.itemId.localeCompare(b.itemId))
    .map((it) => ({
      boardId: it.boardId,
      boardName: it.boardName,
      itemId: it.itemId,
      isCompleted: it.isCompleted,
      isStuck: it.isStuck,
      notes: it.notes,
    }));
}

/**
 * Two board records are the same PERSON when their names agree once the rep
 * annotations are stripped.
 *
 * ⚠️ Boards share nothing but the name (§7 gives `buildCompletionMap` the same
 * reason), so this is the only key available. What it strips is the vocabulary
 * reps actually add to an item title, verified against the live boards
 * 2026-09-02: a parenthetical (`(ip)`, `(cgm)`, `(copy)`, `(pump - pa
 * appealed)`, `(switches insurance aug 1)`) and a trailing `old`. Those are
 * notes on a record, never a different human.
 *
 * ⚠️ It deliberately does NOT fuzzy-match. `Bradley Comstock` and `Bradley
 * Comstuck` stay two people here, and that is the safe direction: over-
 * splitting shows a rep both records and makes a duplicate obvious, while
 * over-merging is the bug this whole split exists to fix. Same fail-closed
 * posture as `nameMatchAccepted`.
 */
export function personKey(name: string): string {
  return String(name ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bold\b/gi, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Split one number's board records into the people who actually share it.
 *
 * ⚠️ **A phone match is not a person.** 18 of the 3,140 numbers on our boards
 * are shared by genuinely different patients (audited 2026-09-02) — households
 * like John and Sue Hartley on `3046977788`, and a fair few pairs with
 * different surnames. Folding them into one dossier merged two people's stage
 * paths and notes under one header, and — because the pane's composer writes to
 * `dossier.active.itemId` and the page derives `threadPatient` from the same
 * object — a note or an outbound text could be filed against the wrong one.
 *
 * Ordered so the default selection is the patient a rep most likely means: the
 * one with a live record furthest along the pipeline, then by name so the order
 * cannot change between polls.
 */
export function splitByPerson(items: DossierItem[]): PatientDossier[] {
  const byPerson = new Map<string, DossierItem[]>();
  for (const it of items) {
    const k = personKey(it.name) || it.itemId;
    const list = byPerson.get(k);
    if (list) list.push(it);
    else byPerson.set(k, [it]);
  }
  const rank = (d: PatientDossier) => (d.active ? pipelineIndex(d.active.boardId) : -1);
  return [...byPerson.values()]
    .map(buildDossier)
    .sort((a, b) => rank(b) - rank(a) || a.name.localeCompare(b.name));
}

/** How far along the chain the patient has actually got, for a caption like
 *  "3 of 6 stages complete". Counts completed steps only. */
export function stagesCompleted(path: PathStep[]): number {
  return path.filter((s) => s.state === "completed").length;
}
