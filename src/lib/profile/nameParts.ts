/**
 * First/Last name split for the intake Demographics card.
 *
 * The Profile Send Off board has NO name columns — the patient's name IS the
 * Monday item name (HANDOFF's demographics inventory: "First/Last = the item
 * `name`, no column needed"). The mockup still shows two boxes, so the split
 * has to happen in the UI and recombine on write.
 *
 * That makes this a data-safety problem rather than a formatting one: whatever
 * comes out of `joinName` REPLACES the item name on the board. So the rule is
 * chosen to round-trip — `joinName(splitName(x)) === x` for every ordinary
 * name — and the edge cases fail towards keeping the string intact rather than
 * towards a tidy split.
 */

export interface NameParts {
  first: string;
  last: string;
}

/**
 * Split on the LAST space: everything before it is the first name, the final
 * token is the last name. "Mary Jane Watson" is Mary Jane / Watson, which is
 * how a medical record reads it — not Mary / Jane Watson.
 *
 * A single-token name is all FIRST, with last blank. Putting it in `last`
 * instead would make "Cher" render in the second box with an empty first box,
 * which reads as data loss to a rep even though nothing was lost.
 */
export function splitName(full: string | undefined): NameParts {
  const s = (full ?? "").trim().replace(/\s+/g, " ");
  if (!s) return { first: "", last: "" };
  const i = s.lastIndexOf(" ");
  if (i === -1) return { first: s, last: "" };
  return { first: s.slice(0, i), last: s.slice(i + 1) };
}

/**
 * Recombine for the item-name write. Collapses the whitespace a blank half
 * would otherwise leave behind, so clearing the last name yields "Richard" and
 * never "Richard ".
 */
export function joinName(parts: NameParts): string {
  return `${parts.first.trim()} ${parts.last.trim()}`.trim().replace(/\s+/g, " ");
}
