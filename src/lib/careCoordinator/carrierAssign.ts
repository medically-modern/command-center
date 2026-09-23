/**
 * Assigning the General Insurance carrier from the card photo.
 *
 * Brandon, 2026-09-22: *"When i click photo upload, i should be able to see the
 * photo, but also then assign a general insurance from a drop-down. Once i've
 * assigned it, that general insurance should be the pill, instead of 'Photo
 * Upload', with a little photo icon in top right of the pill to designate that
 * it was assigned based on a photo upload"*. Josh, 2026-09-23: *"click it, it
 * opens the photo, we select an insurance from the drop down of general
 * insurance, it writes to monday only the general insurance, doesnt run a stedi
 * check, this is just an ease of access thing"*.
 *
 * ⚠️⚠️ **IT WRITES ONE COLUMN AND DELIBERATELY DOES NOT RUN THE CHECK.** General
 * Insurance `color_mm24ap4j` is one of the FOUR inputs Stedi reads off the item
 * — name, DOB, this, and the working Member ID `text_mm4t8gbq` (§5.11) — and the
 * member ID is not on the card photo and is not on this dashboard. So this
 * records the carrier and stops: no `writePatientProfile`, no
 * `verifyProfileWritten`, no `triggerStediRun`. A rep still runs the check on
 * the profile page, where the member ID is, which is the one place that can.
 *   Recording the carrier early is worth doing on its own — it is what the
 * pill, the intake filter's Insurance facet and `primaryInsurance`'s suggestion
 * engine all read — and it is strictly more than the blank those patients carry
 * today (§5.30c: 18 of the 20 live "Photo of card" rows have no carrier at all,
 * because the carrier is on the photo).
 *
 * ⚠️ **NO NEW MUTATION.** The write is `profile/mondayWrite.writeBenefitsInputs`
 * — the profile page's own writer — with the member ID passed blank. Two
 * writers for one column is how they disagree (§5.31c, §5.31d); calling the
 * existing one from a second screen is what keeps there being one. Same rule
 * `callAttempt.ts` follows, and this is the dashboard's second write (§5.30).
 */
import { COL } from "@/lib/profile/mondayApi";
import { fetchInsuranceLabelIndex, payerOptions } from "@/lib/profile/boardLabels";
import { GENERAL_INSURANCE_INDEX } from "@/lib/profile/mondayMapping";
import { writeBenefitsInputs } from "@/lib/profile/mondayWrite";
import { PHOTO_OF_CARD } from "./pills";

/**
 * Why this carrier cannot be written, or `""` when it can.
 *
 * ⚠️⚠️ **THE CHECK RUNS BEFORE THE WRITE, and that is not belt and braces.**
 * `writeBenefitsInputs` resolves the label to an index and **SKIPS the column
 * silently** when it cannot (`if (generalInsurance && gi !== undefined)`) — so
 * an unresolvable carrier comes back a clean, resolved promise having written
 * nothing, and the dialog would close green over a board that never changed.
 * Same trap `unwritableDoctorFields` exists for on the DVS doctor editor and
 * `phoneRejectionReason` on the Auth Outstanding phone (§5.32d).
 *
 * ⚠️ The index it is checked against is the **live board's** (§5.33). A write to
 * a label id a column does not have is taken by monday at HTTP 200 and written
 * nowhere, so a hardcoded map silently drops any payer added on monday since —
 * which is exactly the failure this refusal has to catch rather than reproduce.
 */
export function carrierWriteRefusal(
  carrier: string,
  index: Record<string, Record<string, number>>,
): string {
  const label = carrier.trim();
  if (!label) return "Pick a carrier first.";
  const live = index[COL.generalInsurance]?.[label];
  const idx = live ?? GENERAL_INSURANCE_INDEX[label];
  if (idx === undefined) {
    return `"${label}" isn't a General Insurance label on the board, so monday would accept the write and record nothing. Add it on the Profile Send Off board first.`;
  }
  return "";
}

/**
 * Write the carrier, and nothing else.
 *
 * Throws with the refusal above rather than reporting a save that did not
 * happen. `writeBenefitsInputs` re-reads the same cached index, so resolving it
 * here costs no extra request.
 */
export async function assignGeneralInsurance(itemId: string, carrier: string): Promise<void> {
  const index = await fetchInsuranceLabelIndex();
  const refusal = carrierWriteRefusal(carrier, index);
  if (refusal) throw new Error(refusal);
  // ⚠️ The empty second argument is the whole point: `writeBenefitsInputs`
  // writes the working Member ID only when it is given one, so a blank leaves
  // that column untouched. Never pass a member id from here — this screen has
  // none, and inventing one is how the next eligibility check fails on
  // identifiers nobody verified.
  await writeBenefitsInputs(itemId, carrier.trim(), "");
}

/**
 * Did this patient's carrier come off the card photo?
 *
 * ⚠️ Derived, not stored — no column records provenance and none was added. The
 * two facts together say it: the patient answered the intake form's insurance
 * step with a photo, and a carrier is now on the row. Whether a coordinator set
 * it from this dialog or a rep read the same photo on the profile page, the
 * carrier came from the photo, which is exactly what the marker claims.
 *
 * ⚠️ It is the ONLY thing the pill's photo glyph keys on, so it must stay a
 * statement about the patient rather than about this dialog: a session-scoped
 * "I just set it" flag would go quiet the moment the coordinator clicked
 * another card (the §5.19 provenance rule, one board over).
 */
export function carrierFromPhoto(lead: {
  generalInsurance: string;
  insuranceProvidedVia: string;
}): boolean {
  return !!(lead.generalInsurance || "").trim()
    && (lead.insuranceProvidedVia || "").trim() === PHOTO_OF_CARD;
}

/**
 * The picker's options: the board's own General Insurance labels, minus the
 * non-payer hide-list.
 *
 * ⚠️ `payerOptions` is what keeps **"Stedi"** out of it — our eligibility
 * VENDOR, removed from this picker on 2026-08-13 and silently put back the day
 * the options started coming from the board (§5.33). Never filter here; that
 * list has a decision behind each entry and belongs in one place.
 */
export function carrierOptions(
  optionsFor: (columnId: string, fallback: string[]) => string[],
): string[] {
  return payerOptions(
    COL.generalInsurance,
    optionsFor(COL.generalInsurance, Object.keys(GENERAL_INSURANCE_INDEX)),
  );
}
