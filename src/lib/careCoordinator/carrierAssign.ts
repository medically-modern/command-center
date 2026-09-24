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
 * ⚠️⚠️ **IT WRITES THE CARRIER — AND, FROM 2026-09-24, THE MEMBER ID — AND
 * DELIBERATELY DOES NOT RUN THE CHECK.** General Insurance `color_mm24ap4j` is
 * one of the FOUR inputs Stedi reads off the item — name, DOB, this, and the
 * working Member ID `text_mm4t8gbq` (§5.11). The member ID joined on Brandon's
 * 2026-09-24 ask (*"let's also have them enter the member ID too (as optional)
 * … [a member ID] - put it in, not run the check"*): it IS printed on the card the
 * coordinator is looking at, so reading it off is the same act as reading the
 * carrier. Neither write runs anything: no `writePatientProfile`, no
 * `verifyProfileWritten`, no `triggerStediRun`. A rep still runs the check on
 * the profile page, where name and DOB are confirmed too — the one place that
 * can put all four inputs in front of somebody before Stedi reads them.
 *   Recording the carrier early is worth doing on its own — it is what the
 * pill, the intake filter's Insurance facet and `primaryInsurance`'s suggestion
 * engine all read — and it is strictly more than the blank those patients carry
 * today (§5.30c: 18 of the 20 live "Photo of card" rows have no carrier at all,
 * because the carrier is on the photo).
 *
 * ⚠️ **NO NEW MUTATION.** The write is `profile/mondayWrite.writeBenefitsInputs`
 * — the profile page's own writer — passed only the fields that changed. Two
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
 * What a save from the card dialog would write.
 *
 * Only what CHANGED is written — a carrier or member ID already on the row is
 * left alone, so pressing Save on an untouched field cannot overwrite a value a
 * rep corrected on the profile page a minute ago.
 *
 * ⚠️ **A blank field means "leave it", never "clear it".** `writeBenefitsInputs`
 * skips a blank, so a cleared Member ID box would save green and leave the old
 * ID on the row — `keptMemberId` is how the dialog SAYS so rather than letting
 * a coordinator believe they removed it. Removing a member ID is a profile-page
 * job, where the benefits check that depends on it lives.
 */
export interface CardWritePlan {
  /** The carrier to write, or "" to leave General Insurance alone. */
  carrier: string;
  /** The member ID to write, or "" to leave it alone. */
  memberId: string;
  /** Why the carrier cannot be written (see `carrierWriteRefusal`), or "". */
  refusal: string;
  /** Nothing changed — Save has nothing to do. */
  nothing: boolean;
  /** The row holds a member ID and the box was emptied: it will be KEPT. */
  keptMemberId: boolean;
}

export function cardWritePlan(
  input: { carrier: string; memberId: string; boardCarrier: string; boardMemberId: string },
  index: Record<string, Record<string, number>>,
): CardWritePlan {
  const carrier = input.carrier.trim();
  const memberId = input.memberId.trim();
  const boardCarrier = input.boardCarrier.trim();
  const boardMemberId = input.boardMemberId.trim();
  const writeCarrier = carrier && carrier !== boardCarrier ? carrier : "";
  const writeMember = memberId && memberId !== boardMemberId ? memberId : "";
  return {
    carrier: writeCarrier,
    memberId: writeMember,
    refusal: writeCarrier ? carrierWriteRefusal(writeCarrier, index) : "",
    nothing: !writeCarrier && !writeMember,
    keptMemberId: !memberId && !!boardMemberId,
  };
}

/**
 * Write what the plan says, and nothing else.
 *
 * Throws with the refusal rather than reporting a save that did not happen.
 * The plan is RE-DERIVED here against a fresh read of the label index, so a
 * caller holding a stale plan cannot slip an unresolvable carrier past it.
 * `writeBenefitsInputs` re-reads the same cached index, so that costs no extra
 * request.
 */
export async function assignFromCard(
  itemId: string,
  input: { carrier: string; memberId: string; boardCarrier: string; boardMemberId: string },
): Promise<CardWritePlan> {
  const index = await fetchInsuranceLabelIndex();
  const plan = cardWritePlan(input, index);
  if (plan.refusal) throw new Error(plan.refusal);
  if (plan.nothing) throw new Error("Nothing changed — the carrier and member ID are already on file.");
  // ⚠️ A blank in either argument leaves that column untouched — that is
  // `writeBenefitsInputs`' own contract, and it is what makes "only what
  // changed" true. It writes those two columns and nothing else, and it runs
  // no benefits check.
  await writeBenefitsInputs(itemId, plan.carrier, plan.memberId);
  return plan;
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
