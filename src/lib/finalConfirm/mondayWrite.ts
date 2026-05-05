import { writeStatusIndex, writeLongText, writeText, writeNumber, writeLocation, COL } from "./mondayApi";
import type { Patient } from "./workflow";

// Stage Advancer: index 1 = Completed (green)
const STAGE_ADVANCER_COMPLETED = 1;

/**
 * Push all edits for a final-profile-confirmed patient to Monday.
 * Then flip Stage Advancer → Completed so Monday automations can
 * move the item to Subscription & Order boards.
 */
export async function sendPatientToMonday(p: Patient): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  // ─── Demographics edits ───────────────────────────────────
  if (p.phoneEdited !== null && p.phoneEdited !== "") {
    // Phone is a phone column — value format: {"phone":"...","countryShortName":"US"}
    const query = `
      mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
        change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
      }
    `;
    // We use writeText as a workaround — phone columns accept JSON
    tasks.push(
      fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: (import.meta.env.VITE_MONDAY_API_TOKEN as string) ?? "",
          "API-Version": "2024-10",
        },
        body: JSON.stringify({
          query,
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

  if (p.emailEdited !== null && p.emailEdited !== "") {
    tasks.push(writeText(p.id, COL.email, p.emailEdited));
  }

  if (p.addressEdited !== null && p.addressEdited !== "") {
    const lat = p.addressLat ?? 0;
    const lng = p.addressLng ?? 0;
    tasks.push(writeLocation(p.id, COL.address, p.addressEdited, lat, lng));
  }

  if (p.genderIndex !== null) {
    tasks.push(writeStatusIndex(p.id, COL.gender, p.genderIndex));
  }

  // ─── Insurance edits ──────────────────────────────────────
  if (p.secondaryInsuranceEdited !== null && p.secondaryInsuranceIndex !== null) {
    tasks.push(writeStatusIndex(p.id, COL.secondaryInsurance, p.secondaryInsuranceIndex));
  }
  if (p.memberId2Edited !== null && p.memberId2Edited !== "") {
    tasks.push(writeText(p.id, COL.memberId2, p.memberId2Edited));
  }

  // ─── Product / Order edits ────────────────────────────────
  if (p.subscriptionTypeIndex !== null) {
    tasks.push(writeStatusIndex(p.id, COL.subscriptionType, p.subscriptionTypeIndex));
  }
  if (p.infusionSet1Index !== null) {
    tasks.push(writeStatusIndex(p.id, COL.infusionSet1, p.infusionSet1Index));
  }
  if (p.qtyInf1 !== "") {
    tasks.push(writeNumber(p.id, COL.qtyInf1, Number(p.qtyInf1)));
  }
  if (p.infusionSet2Index !== null) {
    tasks.push(writeStatusIndex(p.id, COL.infusionSet2, p.infusionSet2Index));
  }
  if (p.qtyInf2 !== "") {
    tasks.push(writeNumber(p.id, COL.qtyInf2, Number(p.qtyInf2)));
  }
  if (p.monitorQty !== "") {
    tasks.push(writeNumber(p.id, COL.monitorQty, Number(p.monitorQty)));
  }
  if (p.pumpQty !== "") {
    tasks.push(writeNumber(p.id, COL.pumpQty, Number(p.pumpQty)));
  }
  if (p.orderHandlingIndex !== null) {
    tasks.push(writeStatusIndex(p.id, COL.orderHandling, p.orderHandlingIndex));
  }

  // ─── Notes ────────────────────────────────────────────────
  if (typeof p.notes === "string" && p.notes.trim() !== "") {
    tasks.push(writeLongText(p.id, COL.notes, p.notes));
  }

  // ─── Escalation ───────────────────────────────────────────
  if (p.escalated) {
    tasks.push(writeStatusIndex(p.id, COL.escalation, 0)); // Escalation Required
  }

  // ─── Stage Advancer → Completed ──────────────────────────
  tasks.push(writeStatusIndex(p.id, COL.stageAdvancer, STAGE_ADVANCER_COMPLETED));

  await Promise.all(tasks);
}
