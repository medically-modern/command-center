/**
 * The header search's ROW rules (§5.52) — what a hit's chip and DOB say, and
 * the two strings that are a contract with the rep: the placeholder and the
 * count line's scope. Kept out of the component so they can be imported by
 * tests without dragging React in, and so the component file exports only a
 * component (react-refresh).
 */
import type { PersonHit } from "./searchPeople";
import { SUBSCRIPTION_BOARD } from "@/lib/patient/patientScreen";

/** People, not board items — a patient with six records is ONE row (§5.42). */
export const MAX_ROWS = 8;

/** The placeholder is a CONTRACT (§5.39f): every noun in it is searched. */
export const SEARCH_PLACEHOLDER = "Search patient name, DOB, phone, member ID, order #, doctor…";

/** Brandon's footer, with insurance added because this box searches it. */
export const SEARCH_SCOPE =
  "searches name, DOB, phone, member ID, order & tracking numbers, doctor, doctor phone and insurance";

/**
 * The stage chip's tone — Brandon's `.st onb` for a patient in onboarding,
 * `.st sub` for one on Subscription, and `.st stuck` (his oversight rows) for
 * a stuck one. A finished patient or an order takes the plain grey chip.
 */
export function chipTone(hit: PersonHit): "onb" | "sub" | "stuck" | "" {
  if (hit.bucket === "stuck") return "stuck";
  if (hit.lead.boardId === SUBSCRIPTION_BOARD) return "sub";
  if (hit.bucket === "active") return "onb";
  return "";
}

/** The DOB the row shows — the lead's, else any record's. */
export function hitDob(hit: PersonHit): string {
  return hit.lead.dob || hit.rows.find((r) => r.dob)?.dob || "";
}

/** Brandon's count line: "3 matches" — or, when the rows on screen are not all
 *  of them, "Showing 8 of 11 matches". Counts PEOPLE, never board items. */
export function countLine(people: number, shown: number): string {
  if (people > shown) return `Showing ${shown} of ${people} matches`;
  return `${people} match${people === 1 ? "" : "es"}`;
}
