/**
 * Dropdown option assembly for the intake panes.
 *
 * HANDOFF §5.2 spells out a failure this prevents:
 *
 *   "If an item's current value IS a hidden label, still display it — rendered
 *    disabled/greyed. If you filter it out of the options entirely, the select
 *    shows blank and the next save silently wipes a real value."
 *
 * "Not Serving" is the worked example: it is a REAL, writable value (the
 * cross-sell derivation writes it — `cgmType: "Not Serving"`), and it is only
 * meant to be hidden from the rep's PICKER. It must never be filtered on the
 * write path.
 *
 * The rule generalises past that one label. Any value the board holds but the
 * code's option list doesn't know — General Insurance "Other" (index 15), a
 * label added on Monday this morning, a legacy status — hits exactly the same
 * failure: a `<select>` whose `value` matches no `<option>` renders blank, and
 * a blank control tells the rep the field is empty when it isn't.
 *
 * So: keep the current value visible and non-selectable, always.
 */

export interface SelectOption {
  value: string;
  label: string;
  /** Shown so the rep can read it, but not re-pickable once changed away. */
  disabled?: boolean;
}

/** Labels never offered to the rep, per §5.2's HIDDEN_LABELS. */
export const HIDDEN_LABELS = ["Not Serving"];

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
    .filter((o) => !HIDDEN_LABELS.includes(o.trim()))
    .map((o) => ({ value: o, label: o }));

  const value = (current ?? "").trim();
  if (!value) return pickable;
  if (pickable.some((o) => o.value.trim() === value)) return pickable;

  // On the board, not in the picker. Show it first so it reads as the current
  // state rather than an option the rep skipped past.
  return [{ value, label: `${value} — not selectable`, disabled: true }, ...pickable];
}
