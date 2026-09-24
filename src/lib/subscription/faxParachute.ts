/**
 * Fax / Parachute `color_mm25t5q` — which index a Subscription send writes.
 *
 * WHY THIS EXISTS (2026-09-24). The send wrote `faxVal === "Parachute" ? 1 : 0`,
 * so every save of a patient whose method read **Email** or **Dashboard**
 * rewrote it to **Fax** — silently, with a green toast — from `/subscription`
 * AND the patient screen's Subscription › Profile tab, which share the one
 * `sendPatientToMonday`. The column has four labels (live `settings_str`,
 * 2026-09-24: `0 Fax · 1 Parachute · 2 Email · 3 Dashboard`) and ten patients
 * held one of the other two that day. Dashboard is a real clinicals method
 * (CLAUDE.md §5.9 — treated exactly like Parachute), so the flip changed how a
 * patient is chased.
 *
 * ⚠️ **The index is resolved from the LABEL, against the LIVE board first.**
 * The label is display-only; the index is the only binding, and a write to an
 * index the column does not have is dropped at HTTP 200 with nothing in the
 * logs (§5.33). `FAX_PARACHUTE_OPTIONS` is the fallback for a board we could
 * not READ — never for a label the board we did read does not have.
 *
 * ⚠️ **A value we cannot name is LEFT ALONE — no task — when it came off the
 * item.** The column already holds it, so writing nothing preserves it; a
 * guessed index is how Email became Fax. Same rule as the Insurance send's
 * payer re-write (`samantha/mondayWrite`, §5.33).
 *
 * ⚠️ **A rep's CHANGE the board cannot hold is REFUSED, never skipped.** The
 * pickers render the hardcoded list, so if the board ever loses one of those
 * labels, skipping would save the rest of the profile green and quietly drop
 * the method the rep picked — the §5.33 "picker and write must move together"
 * failure. Refusing happens while the task list is still being built, i.e.
 * before anything is written.
 */
import { fetchStatusOptions, indexForLabel, type StatusOption } from "../shared/statusOptions";
import { BOARD_ID, COL } from "./mondayApi";
import { FAX_PARACHUTE_OPTIONS, type Patient } from "./workflow";

export type FaxParachuteWrite =
  /** Write this index. */
  | { action: "write"; index: number }
  /** Nothing to write — blank, or a board value we cannot name. The column is left as it is. */
  | { action: "skip" }
  /** The rep picked a method the board cannot hold. Nothing may be written. */
  | { action: "refuse"; reason: string };

type FaxFields = Pick<Patient, "faxParachute" | "faxParachuteEdited">;

/**
 * The pure rule. `live` is the column's options as read from the board, or
 * `[]` when that read failed — the only case the hardcoded list is used.
 */
export function planFaxParachuteWrite(p: FaxFields, live: readonly StatusOption[]): FaxParachuteWrite {
  const onBoard = (p.faxParachute ?? "").trim();
  const edited = p.faxParachuteEdited;
  const value = (edited ?? p.faxParachute ?? "").trim();
  // A blank never CLEARS the column — the pickers offer no "none", and a blank
  // edit has only ever meant "nothing to write".
  if (!value) return { action: "skip" };

  const options = live.length > 0 ? live : FAX_PARACHUTE_OPTIONS;
  const index = indexForLabel([...options], value);
  if (index !== null) return { action: "write", index };

  // Re-picking the value the board already shows is not a change.
  const changed = edited !== null && value !== onBoard;
  if (!changed) return { action: "skip" };
  return {
    action: "refuse",
    reason:
      `Fax / Parachute: the board has no "${value}" option, so it can't be saved — nothing was written. ` +
      `Pick another method, or add "${value}" back to the column on Monday.`,
  };
}

/**
 * The column's live options, or `[]` when the board cannot be read. Never
 * throws — a failed read degrades to the hardcoded list inside
 * `planFaxParachuteWrite` rather than failing the whole send.
 */
async function liveFaxParachuteOptions(): Promise<StatusOption[]> {
  try {
    const byColumn = await fetchStatusOptions(BOARD_ID, [COL.faxParachute]);
    return byColumn[COL.faxParachute] ?? [];
  } catch {
    return [];
  }
}

/** What the send should do with the column. Reads the board only when there is a value to resolve. */
export async function resolveFaxParachuteWrite(p: FaxFields): Promise<FaxParachuteWrite> {
  if (!(p.faxParachuteEdited ?? p.faxParachute ?? "").trim()) return { action: "skip" };
  return planFaxParachuteWrite(p, await liveFaxParachuteOptions());
}
