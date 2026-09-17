/**
 * lib/profile/doctorPrefill.ts — "Select Correct Provider" opens on the doctor
 * the patient's own record already names, instead of an empty search box.
 *
 * Josh, 2026-09-17, on Mark MECHeal (`13063500233`, Profile Clean-Up): *"his
 * doctor info isnt showing up in the ui cause it auto showed up from the form,
 * it should select the doctor in the ui"*.
 *
 * His item carries **MEIR DERSHOWITZ · NPI 1316121049 · 201-460-0063 ·
 * 2014601684@rcfax.com · 612 Rutherford Avenue, Lyndhurst NJ** — written by the
 * CareCentrix intake path (§5.20), with the matching Doctor DB item
 * (`13063514110`) auto-created the same minute. Everything needed was on file
 * and on the board. `DoctorSection` nonetheless opened with `term = ""` and
 * `selectedKey = null` — "starts blank; the rep searches & picks explicitly" —
 * so the card, the locations, the Parachute count and the doctor's notes and
 * order followers all rendered nowhere, and the rep had to retype a name the
 * record already held.
 *
 * ⚠️ **This is the DEFAULT state of that step, not a Mark-specific glitch.** Of
 * the 41 patients in the three worked groups on 2026-09-17 (1. Intake, Already
 * In System, Profile Clean-Up), **37 already carry a Doctor NPI** — so nine out
 * of ten reps opening this pane were looking at a blank box in front of a
 * filled-in record.
 *
 * ── THE TWO RULES THAT MAKE IT SAFE ──
 * ⚠️ **NPI ONLY — a name is not an identity.** Two doctors share a surname far
 * more often than they share an NPI, and this component's own `profileKey`
 * comment records that one NPI can carry several name SPELLINGS ("JASON SLOANE"
 * vs "JASON LOUIS SLOANE"). So an auto-selection is made from the NPI, and only
 * when the NPI resolves to exactly ONE profile; several spellings is a genuine
 * choice and stays the rep's. A name is used only to prefill the SEARCH BOX, so
 * the results are on screen for the rep to pick from — never to select anyone.
 * Same line `commsHub/dossier.nameMatchAccepted` draws for patients (§5.28).
 *
 * ⚠️⚠️ **PRE-SELECTING MUST NOT WRITE.** `DoctorSection.pickProfile` calls
 * `onUpdate(...)`, which patches the patient overlay from the Doctor DB's
 * values — name, phone, fax, clinic address, method — and the next Save writes
 * them to the board. Doing that automatically would silently overwrite the
 * doctor the referral actually named with whatever the DB happens to hold, and
 * §5.20 records exactly this hazard ("Select Correct Provider can change the
 * verified doctor later, which would then overwrite the as-provided record and
 * lose the discrepancy the two column sets exist to show"). The prefill
 * therefore only ever SHOWS: the rep's own click is still the only thing that
 * copies DB values onto the patient.
 *
 * Pure + unit-tested (`doctorPrefill.test.ts`). No fetches, no writes.
 */

/** The shape this module needs of a Doctor DB record — structural, so it takes
 *  `DoctorRecord` without importing the whole module's fetch surface. */
export interface PrefillRecord {
  itemId: string;
  name: string;
  npi: string;
}

type DoctorSource = {
  doctorNpi?: string | null;
  doctorName?: string | null;
};

/** A profile = a distinct name spelling + NPI. ⚠️ Must stay in step with
 *  `DoctorSection`'s own `profileKey`/`norm` — the prefill selects by the key
 *  the component filters by, so a different normalization here would set a
 *  `selectedKey` that matches no record and render an empty card. */
const norm = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export const prefillProfileKey = (r: { name: string; npi: string }) => `${norm(r.name)}|${r.npi}`;

/** NPIs are 10 digits. A partial or malformed one is not a key, so it is not
 *  looked up — `contains_text` on three digits would match hundreds. */
export function prefillNpi(p: DoctorSource): string {
  const npi = (p.doctorNpi ?? "").replace(/\D/g, "");
  return npi.length === 10 ? npi : "";
}

/** The term to drop into the search box when there is no usable NPI: the
 *  doctor's name, so the results are already on screen. Selecting from them
 *  stays the rep's job (see the header). */
export function prefillTerm(p: DoctorSource): string {
  return (p.doctorName ?? "").trim();
}

/**
 * Which profile, if any, an NPI lookup should auto-select.
 *
 * Returns the `selectedKey` for the one profile that matches, or `null` when
 * the answer is not unambiguous: no record, or several name spellings under the
 * one NPI (the rep picks the spelling), or records whose NPI is not the one
 * asked for — `searchDoctors` is a `contains_text` search, so a query for
 * `1316121049` can legitimately return a record whose NPI merely contains it.
 */
export function prefillSelection(records: PrefillRecord[], npi: string): string | null {
  if (!npi) return null;
  const exact = records.filter((r) => (r.npi ?? "").replace(/\D/g, "") === npi);
  if (exact.length === 0) return null;
  const keys = new Set(exact.map(prefillProfileKey));
  return keys.size === 1 ? [...keys][0] : null;
}

/**
 * The one location to focus, when the selected profile has exactly one.
 *
 * ⚠️ Focusing a location is what makes the doctor's **notes and order
 * followers** readable — they are per-profile Doctor DB columns, and the pane
 * greys them out until a location is picked. With a single location there is
 * nothing to choose, so leaving it unpicked greys out real information for no
 * reason. With several, the choice is meaningful and stays the rep's.
 * ⚠️ Focusing is display-only by construction: it sets the component's
 * `selectedItemId`/notes/followers and never calls `onUpdate` (header).
 */
export function prefillLocation(records: PrefillRecord[], selectedKey: string | null): string | null {
  if (!selectedKey) return null;
  const inProfile = records.filter((r) => prefillProfileKey(r) === selectedKey);
  return inProfile.length === 1 ? inProfile[0].itemId : null;
}
