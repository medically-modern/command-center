/**
 * Primary Insurance options + indexes, read from the board the write targets.
 *
 * WHY THIS EXISTS (2026-09-16). Every payer picker outside Profile Send Off
 * carried a hardcoded `{ index, label }[]`, and the index is the ONLY binding —
 * the label is display-only. Four boards number their own labels independently,
 * so a table is only ever meaningful against the one board it was copied from,
 * and nothing checked it. Adding **Health Plans Inc (PHCS)** on 2026-09-11 turned
 * that from latent into live:
 *
 *   - Insurance and Welcome Call had no index **7**. `finalConfirm/workflow.ts`
 *     and `welcomeCall/workflow.ts` both carried `{ index: 7, label: "United
 *     Healthcare Commercial" }` — a label on NO board, an app-only phantom.
 *     Monday drops a write to a non-existent index, so it had always been a
 *     silent no-op.
 *   - PHCS was created into slot 7 on both boards. From that moment, a rep
 *     picking "United Healthcare Commercial" at Final Profile Confirmation wrote
 *     `{index: 7}` and the board stored **Health Plans Inc (PHCS)** — a real,
 *     wrong payer, with a green toast, which then rode to Subscription and Order
 *     by label text.
 *
 * `pos.test.ts` could not catch it: it asserts Welcome Call and Final Confirm
 * agree with EACH OTHER, and both carried the same wrong row.
 *
 * ⚠️ **The lesson is not "delete the phantom", it is "never write an index you
 * did not read from the board you are writing to"** — the rule
 * `shared/statusOptions.ts` already states and that Profile Send Off already
 * follows (§5.33). This module is that rule for the other three boards.
 *
 * ⚠️ **A hardcoded fallback is still REQUIRED, and it is deliberately not the
 * stricter disable-the-control posture of `shared/statusOptions.ts`.** That rule
 * exists for columns whose indexes were RENUMBERED by a dedup, where a stale
 * entry writes a blank. These payer columns have never been renumbered — a label
 * keeps its index for life — so the risk of a stale fallback is a MISSING option,
 * while the risk of disabling is a rep who cannot record a payer at all. Same
 * call, and the same reasoning, as `profile/boardLabels.ts`.
 *
 * ⚠️ **The index travels WITH the option, and that is what keeps the picker and
 * the write together.** A caller renders `options` and hands back the `index` off
 * the very entry the rep chose, so a live list yields a live index and a fallback
 * list yields a fallback index — they can never be sourced from different places.
 * That property is the whole design; do not "simplify" it into rendering labels
 * and looking the index up separately afterwards.
 */
import {
  fetchStatusOptions,
  indexForLabel,
  type StatusOption,
} from "./statusOptions";

/** The boards that carry a Primary Insurance column the SPA writes. */
export const PAYER_BOARD = {
  /** Welcome Call — serves BOTH the welcomeCall and finalConfirm slices. */
  welcomeCall: { boardId: 18410804557, columnId: "color_mm1x157j" },
  /** Insurance ("Samantha"). Same column ID as Welcome Call, different labels. */
  insurance: { boardId: 18410601299, columnId: "color_mm1x157j" },
  subscription: { boardId: 18407459988, columnId: "color_mm254qxj" },
} as const;

export type PayerBoardKey = keyof typeof PAYER_BOARD;

/**
 * ⚠️ **Medical Evaluation shares `color_mm1x157j` with Insurance and Welcome
 * Call and does NOT share their label numbering.** It is deliberately absent
 * from `PAYER_BOARD` because nothing in the SPA writes it — masheke reads that
 * column only, and the board hops populate it by label TEXT. Read live before
 * adding any writer:
 *
 * | index | Medical Evaluation | Insurance + Welcome Call |
 * |---|---|---|
 * | 7   | Fidelis Medicare          | Health Plans Inc (PHCS) |
 * | 108 | Health Plans Inc (PHCS)   | Fidelis Medicare        |
 *
 * Exactly swapped, verified live 2026-09-16. ME's `Fidelis Medicare` was created
 * at 7 long before the others', so when PHCS was added it took 108 there and 7
 * here. Monday assigns an index at label CREATION from the lowest free slot, so
 * this cannot be repaired on the board without deleting and recreating labels
 * (which blanks every item holding them). It is pinned by
 * `payerIndexDivergence.test.ts` so a future session cannot fold the three
 * boards into one shared table on the strength of their sharing a column id.
 */
export const MEDICAL_EVALUATION_PAYER_COLUMN = {
  boardId: 18406060017,
  columnId: "color_mm1x157j",
} as const;

/**
 * Live payer options for one board, or `[]` when the board cannot be reached.
 *
 * Never throws: `fetchStatusOptions` already coalesces concurrent callers and
 * caches for `STATUS_OPTIONS_TTL_MS`, and a failure here must degrade a picker
 * to its fallback rather than take a stage page down.
 */
export async function fetchPayerOptions(board: PayerBoardKey): Promise<StatusOption[]> {
  const { boardId, columnId } = PAYER_BOARD[board];
  try {
    const byColumn = await fetchStatusOptions(boardId, [columnId]);
    return byColumn[columnId] ?? [];
  } catch {
    return [];
  }
}

/**
 * Resolve a payer LABEL to the index that label holds **on this board**.
 *
 * For write paths that have no picker to take an index from — today that is the
 * Insurance send, which re-writes the payer it just read off the item.
 *
 * Returns `null` when the board cannot be reached OR the label is not on it.
 * ⚠️ Callers must treat `null` as "do not write this column", never as a reason
 * to fall back to a hardcoded index: on this board a label we cannot find is
 * either new (and the column already holds it, so skipping is correct) or
 * renamed (and a guessed index is how the wrong payer gets written).
 */
export async function resolvePayerIndex(
  board: PayerBoardKey,
  label: string | null | undefined,
): Promise<number | null> {
  const want = (label ?? "").trim();
  if (!want) return null;
  const options = await fetchPayerOptions(board);
  if (options.length === 0) return null;
  return indexForLabel(options, want);
}

/**
 * The options a picker should render: the board's own list when we have it, the
 * caller's hardcoded list when we don't.
 *
 * Kept as a named function rather than an inline `??` so the intent is greppable
 * and `payerOptionsSource.test.ts` can pin that every picker goes through it.
 */
export function payerOptionsOrFallback(
  live: StatusOption[],
  fallback: readonly StatusOption[],
): StatusOption[] {
  return live.length > 0 ? live : [...fallback];
}

/**
 * Is `label` offered by `options`? Used to decide whether a value already on the
 * board needs re-admitting to a filtered list.
 */
export function optionsContain(options: readonly StatusOption[], label: string): boolean {
  return options.some((o) => o.label === label);
}

/**
 * Re-admit the value the BOARD holds when the option list does not offer it.
 *
 * ⚠️ Without this a patient whose payer is real but missing from the fallback
 * renders as the empty placeholder — the §5.11 blank-with-no-error — and the
 * rep's next save silently writes whatever they pick instead. Two live routes
 * today: a payer added on Monday while the board read is failing, and any of the
 * labels the hardcoded fallbacks have never carried.
 *
 * The re-admitted entry carries the index the ITEM actually holds, so selecting
 * it again is a no-op rather than a re-write at a guessed index.
 */
export function withCurrentPayer(
  options: StatusOption[],
  currentLabel: string | null | undefined,
  currentIndex: number | null | undefined,
): StatusOption[] {
  const label = (currentLabel ?? "").trim();
  if (!label || optionsContain(options, label)) return options;
  if (currentIndex === null || currentIndex === undefined || Number.isNaN(currentIndex)) {
    return options;
  }
  return [...options, { index: currentIndex, label }];
}
