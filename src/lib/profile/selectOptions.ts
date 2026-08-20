/**
 * Dropdown option assembly for the intake panes.
 *
 * ⚠️ **Nothing is hidden from the rep any more** (Josh, 2026-08-20). This
 * module used to strip a `HIDDEN_LABELS` list — in practice "Not Serving" —
 * out of every product picker, on the reasoning that it is a derived value
 * rather than a rep's answer (HANDOFF §5.2: "Not Serving is never offered to
 * the rep"). The cost was the other half of that: a rep could READ the value
 * on a patient and never set it, and never correct one the cross-sell rule had
 * written. The board's label set is the picker's label set now, whole.
 *
 * What survives is the rule that made hiding survivable at all, because it
 * covers every label a build doesn't know about:
 *
 *   "If an item's current value is not among the options, still display it —
 *    rendered disabled/greyed. Filter it out entirely and the select shows
 *    blank and the next save silently wipes a real value."
 *
 * That is General Insurance "Other" (index 15), a legacy status, or a label
 * somebody added on Monday this morning that the hardcoded fallback doesn't
 * carry yet: a `<select>` whose `value` matches no `<option>` renders blank,
 * and a blank control tells the rep the field is empty when it isn't.
 *
 * So: keep the current value visible, always.
 */

/**
 * Board value → the word the rep reads.
 *
 * The board stores `Hypo`; reps read "Hypoglycemia". Index 1 on this column was
 * renamed `Hypoglycemia` → `Hypo` on 2026-08-20 so the board that ORIGINATES
 * this value speaks the same vocabulary as every board downstream (see
 * `mondayMapping.CGM_COVERAGE_PATH_INDEX` for why that rename is a data fix and
 * not a tidy-up). Josh's call that the long word stays on screen — and the
 * Evaluate stage has always done precisely this, storing `Hypo` and rendering
 * "Hypoglycemia" (`EvaluatePanel` CgmPathSelect), so the two stages now read
 * alike instead of only looking as though they do.
 *
 * ⚠️ **DISPLAY ONLY.** A select's `value` stays the board's own label, because
 * that is what the index maps are keyed on. Alias the value instead of the
 * label and the write silently stops landing — monday drops a status write for
 * a label it doesn't have, without erroring (§5.2).
 */
export const DISPLAY_ALIASES: Record<string, string> = {
  Hypo: "Hypoglycemia",
};

/** The label to show for a board value. Identity for anything unaliased. */
export function displayFor(label: string): string {
  return DISPLAY_ALIASES[label.trim()] ?? label;
}

export interface SelectOption {
  value: string;
  label: string;
  /** Shown so the rep can read it, but not re-pickable once changed away. */
  disabled?: boolean;
}

/**
 * The options a select should render: the pickable list, plus the item's
 * current value pinned on when that value isn't in the list.
 *
 * Blank board labels are dropped — Monday leaves an empty slot behind when a
 * status is removed, and it would otherwise render as a nameless option.
 */
export function optionsWithCurrent(options: string[], current: string | undefined): SelectOption[] {
  const pickable = options
    .filter((o) => o.trim() !== "")
    .map((o) => ({ value: o, label: displayFor(o) }));

  const value = (current ?? "").trim();
  if (!value) return pickable;
  if (pickable.some((o) => o.value.trim() === value)) return pickable;

  // On the board, not in this build's option list — a status added or renamed
  // on Monday since it shipped. Show it first so it reads as the current state
  // rather than an option the rep skipped past.
  return [{ value, label: `${displayFor(value)} — not selectable`, disabled: true }, ...pickable];
}
