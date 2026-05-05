import { writeStatusIndex, writeNumber, writeLocation, writeText, writeLongText, COL } from "./mondayApi";
import type { Patient } from "./workflow";

export async function sendPatientToMonday(p: Patient): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  // Phone edit
  if (p.phoneEdited !== null && p.phoneEdited !== "") {
    const phoneQuery = `
      mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
      }
    `;
    tasks.push(
      fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: (import.meta.env.VITE_MONDAY_API_TOKEN as string) ?? "",
          "API-Version": "2024-10",
        },
        body: JSON.stringify({
          query: phoneQuery,
          variables: {
            boardId: 18410804557,
            itemId: p.id,
            columnId: COL.phone,
            value: JSON.stringify({ phone: p.phoneEdited, countryShortName: "US" }),
          },
        }),
      }),
    );
  }

  // CGM Type override
  if (p.cgmTypeIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.cgmType, p.cgmTypeIndex));

  // Pump Type override
  if (p.pumpTypeIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.pumpType, p.pumpTypeIndex));

  // Secondary Insurance (only if edited)
  if (p.secondaryInsuranceEdited !== null && p.secondaryInsuranceIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.secondaryInsurance, p.secondaryInsuranceIndex));

  // Member ID 2 (only if edited)
  if (p.memberId2Edited !== null && p.memberId2Edited !== "")
    tasks.push(writeText(p.id, COL.memberId2, p.memberId2Edited));

  if (p.monitorQty !== "") tasks.push(writeNumber(p.id, COL.monitorQty, Number(p.monitorQty)));
  if (p.pumpQty !== "") tasks.push(writeNumber(p.id, COL.pumpQty, Number(p.pumpQty)));
  if (p.qtyInf1 !== "") tasks.push(writeNumber(p.id, COL.qtyInf1, Number(p.qtyInf1)));
  if (p.qtyInf2 !== "") tasks.push(writeNumber(p.id, COL.qtyInf2, Number(p.qtyInf2)));

  if (p.infusionSet1Index !== null)
    tasks.push(writeStatusIndex(p.id, COL.infusionSet1, p.infusionSet1Index));
  if (p.infusionSet2Index !== null)
    tasks.push(writeStatusIndex(p.id, COL.infusionSet2, p.infusionSet2Index));
  if (p.subscriptionTypeIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.subscriptionType, p.subscriptionTypeIndex));
  if (p.welcomeCallTextIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.welcomeCallText, p.welcomeCallTextIndex));
  if (p.orderHandlingIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.orderHandling, p.orderHandlingIndex));
  if (p.advanceDecisionIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.advanceDecision, p.advanceDecisionIndex));

  if (p.addressEdited !== null) {
    const lat = p.addressLat ?? 0;
    const lng = p.addressLng ?? 0;
    tasks.push(writeLocation(p.id, COL.address, p.addressEdited, lat, lng));
  }

  // Notes
  if (typeof p.notes === "string" && p.notes.trim() !== "") {
    tasks.push(writeLongText(p.id, COL.notes, p.notes));
  }

  // Escalation toggle — if flagged, write Escalation Required
  if (p.escalated) {
    tasks.push(writeStatusIndex(p.id, COL.escalation, 0)); // Escalation Required
  }

  // Stage advancer — Review Profile
  tasks.push(writeStatusIndex(p.id, COL.stageAdvancer, 0));

  await Promise.all(tasks);
}

/**
 * Welcome Call Text flow:
 *  1. Push every form field that the auto-text might consume (CGM type, monitor qty,
 *     pump type, infusion sets + qtys, subscription type, order handling, address,
 *     and any insurance / member-ID edits) FIRST.
 *  2. THEN flip Welcome Call Text status to Send (index 0).
 *
 * The two phases are sequenced — Monday's automation reads column values when the
 * status flips, so the data writes must be fully committed before the trigger fires.
 */
export async function sendWelcomeCallTextToMonday(p: Patient): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  // CGM Type
  if (p.cgmTypeIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.cgmType, p.cgmTypeIndex));

  // Pump Type — re-write so Monday has the latest source value before the automation fires
  if (p.pumpTypeIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.pumpType, p.pumpTypeIndex));

  // Numbers
  if (p.monitorQty !== "") tasks.push(writeNumber(p.id, COL.monitorQty, Number(p.monitorQty)));
  if (p.pumpQty !== "") tasks.push(writeNumber(p.id, COL.pumpQty, Number(p.pumpQty)));
  if (p.qtyInf1 !== "") tasks.push(writeNumber(p.id, COL.qtyInf1, Number(p.qtyInf1)));
  if (p.qtyInf2 !== "") tasks.push(writeNumber(p.id, COL.qtyInf2, Number(p.qtyInf2)));

  // Infusion Sets + Subscription Type + Order Handling
  if (p.infusionSet1Index !== null)
    tasks.push(writeStatusIndex(p.id, COL.infusionSet1, p.infusionSet1Index));
  if (p.infusionSet2Index !== null)
    tasks.push(writeStatusIndex(p.id, COL.infusionSet2, p.infusionSet2Index));
  if (p.subscriptionTypeIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.subscriptionType, p.subscriptionTypeIndex));
  if (p.orderHandlingIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.orderHandling, p.orderHandlingIndex));

  // Secondary insurance & Member ID 2 (only if locally edited)
  if (p.secondaryInsuranceEdited !== null && p.secondaryInsuranceIndex !== null)
    tasks.push(writeStatusIndex(p.id, COL.secondaryInsurance, p.secondaryInsuranceIndex));
  if (p.memberId2Edited !== null && p.memberId2Edited !== "")
    tasks.push(writeText(p.id, COL.memberId2, p.memberId2Edited));

  // Address
  if (p.addressEdited !== null) {
    const lat = p.addressLat ?? 0;
    const lng = p.addressLng ?? 0;
    tasks.push(writeLocation(p.id, COL.address, p.addressEdited, lat, lng));
  }

  // Phase 1: wait for every data field to commit
  await Promise.all(tasks);

  // Phase 2: now flip Welcome Call Text to Send so the Monday automation fires
  // with up-to-date column values.
  await writeStatusIndex(p.id, COL.welcomeCallText, 0);
}

/**
 * Immediately push notes to Monday (called on Add press).
 */
export async function sendNotesToMonday(itemId: string, notes: string): Promise<void> {
  await writeLongText(itemId, COL.notes, notes);
}

/**
 * Immediately push call attempts count to Monday (called on +1 press).
 */
export async function sendCallAttemptsToMonday(itemId: string, count: number): Promise<void> {
  await writeText(itemId, COL.callAttempts, String(count));
}
