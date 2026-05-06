import { writeStatusIndex, writeLongText, writeText, writeNumber, writeLocation, COL } from "./mondayApi";
import type { Patient } from "./workflow";

// Stage Advancer: index 1 = Completed (green)
const STAGE_ADVANCER_COMPLETED = 1;

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;

interface WriteTask {
  label: string;
  columnId: string;
  fn: () => Promise<unknown>;
}

async function executeWithRetry(task: WriteTask): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await task.fn();
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `[mondayWrite:finalConfirm] ${task.label} (${task.columnId}) failed attempt ${attempt + 1}/${MAX_RETRIES + 1}: ${msg}`,
      );
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      } else {
        return `${task.label} (${task.columnId}): ${msg}`;
      }
    }
  }
  return null;
}

/**
 * Push all edits for a final-profile-confirmed patient to Monday.
 * Then flip Stage Advancer → Completed so Monday automations can
 * move the item to Subscription & Order boards.
 */
export async function sendPatientToMonday(p: Patient): Promise<void> {
  const tasks: WriteTask[] = [];

  // ─── Demographics edits ───────────────────────────────────
  if (p.phoneEdited !== null && p.phoneEdited !== "") {
    tasks.push({
      label: "Phone",
      columnId: COL.phone,
      fn: () => fetch("https://api.monday.com/v2", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: (import.meta.env.VITE_MONDAY_API_TOKEN as string) ?? "",
          "API-Version": "2024-10",
        },
        body: JSON.stringify({
          query: `mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
            change_column_value(board_id: $boardId, item_id: $itemId, column_id: $columnId, value: $value) { id }
          }`,
          variables: {
            boardId: 18410804557,
            itemId: p.id,
            columnId: COL.phone,
            value: JSON.stringify({ phone: p.phoneEdited, countryShortName: "US" }),
          },
        }),
      }),
    });
  }

  if (p.emailEdited !== null && p.emailEdited !== "")
    tasks.push({ label: "Email", columnId: COL.email, fn: () => writeText(p.id, COL.email, p.emailEdited!) });

  if (p.addressEdited !== null && p.addressEdited !== "") {
    const lat = p.addressLat ?? 0;
    const lng = p.addressLng ?? 0;
    tasks.push({ label: "Address", columnId: COL.address, fn: () => writeLocation(p.id, COL.address, p.addressEdited!, lat, lng) });
  }

  if (p.genderIndex !== null)
    tasks.push({ label: "Gender", columnId: COL.gender, fn: () => writeStatusIndex(p.id, COL.gender, p.genderIndex!) });

  // ─── Insurance edits ──────────────────────────────────────
  if (p.secondaryInsuranceEdited !== null && p.secondaryInsuranceIndex !== null)
    tasks.push({ label: "Secondary Insurance", columnId: COL.secondaryInsurance, fn: () => writeStatusIndex(p.id, COL.secondaryInsurance, p.secondaryInsuranceIndex!) });

  if (p.memberId2Edited !== null && p.memberId2Edited !== "")
    tasks.push({ label: "Member ID 2", columnId: COL.memberId2, fn: () => writeText(p.id, COL.memberId2, p.memberId2Edited!) });

  // ─── Product / Order edits ────────────────────────────────
  if (p.subscriptionTypeIndex !== null)
    tasks.push({ label: "Subscription Type", columnId: COL.subscriptionType, fn: () => writeStatusIndex(p.id, COL.subscriptionType, p.subscriptionTypeIndex!) });

  if (p.infusionSet1Index !== null)
    tasks.push({ label: "Infusion Set 1", columnId: COL.infusionSet1, fn: () => writeStatusIndex(p.id, COL.infusionSet1, p.infusionSet1Index!) });

  if (p.qtyInf1 !== "")
    tasks.push({ label: "Infusion Set 1 Qty", columnId: COL.qtyInf1, fn: () => writeNumber(p.id, COL.qtyInf1, Number(p.qtyInf1)) });

  if (p.infusionSet2Index !== null)
    tasks.push({ label: "Infusion Set 2", columnId: COL.infusionSet2, fn: () => writeStatusIndex(p.id, COL.infusionSet2, p.infusionSet2Index!) });

  if (p.qtyInf2 !== "")
    tasks.push({ label: "Infusion Set 2 Qty", columnId: COL.qtyInf2, fn: () => writeNumber(p.id, COL.qtyInf2, Number(p.qtyInf2)) });

  if (p.monitorQty !== "")
    tasks.push({ label: "Monitor Qty", columnId: COL.monitorQty, fn: () => writeNumber(p.id, COL.monitorQty, Number(p.monitorQty)) });

  if (p.pumpQty !== "")
    tasks.push({ label: "Pump Qty", columnId: COL.pumpQty, fn: () => writeNumber(p.id, COL.pumpQty, Number(p.pumpQty)) });

  if (p.orderHandlingIndex !== null)
    tasks.push({ label: "Order Handling", columnId: COL.orderHandling, fn: () => writeStatusIndex(p.id, COL.orderHandling, p.orderHandlingIndex!) });

  // ─── Notes ────────────────────────────────────────────────
  if (typeof p.notes === "string" && p.notes.trim() !== "")
    tasks.push({ label: "Notes", columnId: COL.notes, fn: () => writeLongText(p.id, COL.notes, p.notes) });

  // ─── Escalation ───────────────────────────────────────────
  if (p.escalated)
    tasks.push({ label: "Escalation", columnId: COL.escalation, fn: () => writeStatusIndex(p.id, COL.escalation, 0) });

  // ─── Stage Advancer → Completed ──────────────────────────
  tasks.push({ label: "Stage Advancer", columnId: COL.stageAdvancer, fn: () => writeStatusIndex(p.id, COL.stageAdvancer, STAGE_ADVANCER_COMPLETED) });

  // ---- Execute all writes in parallel with retries ----
  const results = await Promise.all(tasks.map(executeWithRetry));
  const failures = results.filter((r): r is string => r !== null);

  if (failures.length > 0) {
    const timestamp = new Date().toISOString().slice(0, 19).replace("T", " ");
    const debugMsg = `[${timestamp}] FC: ${failures.length} write(s) failed:\n${failures.join("\n")}`;
    try {
      await writeText(p.id, COL.joshDebug, debugMsg);
    } catch {
      console.error("[mondayWrite:finalConfirm] Could not write to Josh Debug column:", debugMsg);
    }
    throw new Error(
      `${failures.length} column(s) failed after retries. Check "Josh Debug" column. Failed: ${failures.map((f) => f.split(":")[0]).join(", ")}`,
    );
  }
}