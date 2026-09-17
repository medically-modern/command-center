/**
 * Phone identity for the Welcome Call activity box.
 *
 * ⚠️ **The canonical E.164 form is the identity — not the last ten digits.**
 * `last10` is right for NARROWING a board query, because boards store numbers
 * in whatever shape they were typed and ten digits is the only substring
 * present in every rendering (§5.13). It is wrong as an IDENTITY: two numbers
 * that differ only in country code share it, so a module-scope cache keyed on
 * it can hand one patient another patient's texts.
 *
 * That collision needs an international number, and every patient on these
 * boards is NANP — so this is not a live exposure. It is fixed because
 * `toE164` is already the repo's canonical normaliser, the exactness costs
 * nothing, and §5.13's own pattern is narrow-then-verify-on-E164 rather than
 * trusting a suffix (Greptile, PR #56).
 *
 * ⚠️ `toE164` returns "" for anything it cannot normalise rather than
 * fabricating a number from partial digits — so an empty result means "we
 * cannot identify this patient", and callers must treat it as such rather than
 * falling back to a looser match.
 */
import { toE164 } from "@/lib/fax/ringcentralApi";

export function phoneIdentity(raw: string | undefined | null): string {
  return toE164(String(raw ?? ""));
}

/* ─── Which numbers the activity box can show ─── */

export interface ActivityNumber {
  /** "Primary" / "Alternate", as the phone slots have it. */
  label: string;
  /** The number as the rep has it on screen. */
  number: string;
}

/**
 * The numbers the RingCentral activity box should offer, starred first.
 *
 * ⚠️⚠️ **THE BOX USED TO READ `phoneEdited ?? phone`, AND NOTHING SETS
 * `phoneEdited` ON THIS BOARD ANY MORE.** The Welcome Call banner's editable
 * `PhoneField` was deleted on 2026-09-11 with the rest of its phone controls
 * (§5.31c) and the phone SLOTS took over (§5.31d), which write
 * `phoneSlotsEdited`. So the box — and the Call and Text buttons in its header —
 * were pinned to the board's Primary Phone column:
 *   · a rep who corrected a wrong number went on reading, and **texting**, the
 *     old one, with the corrected number visible two sections below; and
 *   · a rep who moved the star was ignored the same way.
 * Both are read as "not synced" from the floor, which is what Katie reported
 * (2026-09-17: *"not sure if ring central activity is fully synced"*).
 *
 * ⚠️ The second half of that report is the ALTERNATE number. A patient with two
 * numbers on file had the history of one of them shown and no indication the
 * other existed — and the alternate is often the one a caregiver rings from. The
 * box offers both now; it still loads exactly one at a time, because every entry
 * here is a per-patient RingCentral read and fanning out over both at once is
 * INCIDENT_2026-08-20's shape.
 *
 * ⚠️ Slots with no digits are dropped, and duplicates collapse: an abandoned
 * "+ Add number" must not put a blank tab on the box, and two slots holding one
 * number would fetch the same thread twice and offer the rep a choice that is
 * not a choice.
 */
export function activityNumbers(
  slots: { number: string; starred: boolean }[],
): ActivityNumber[] {
  const seen = new Set<string>();
  const out: ActivityNumber[] = [];
  const ordered = [...slots].sort(
    (a, b) => Number(b.starred) - Number(a.starred),
  );
  for (const s of ordered) {
    const number = (s.number ?? "").trim();
    if (!number) continue;
    /* Keyed on the DIGITS, so "(555) 555-0100" and "5555550100" are one number.
       An unparseable value still gets an entry — the box says it cannot read it,
       which is more use than hiding a number the rep can see on the form. */
    const key = number.replace(/\D/g, "") || number;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ label: s.starred ? "Primary" : "Alternate", number });
  }
  return out;
}
