/**
 * Where a patient row opens in the existing Command Center (read-only from here; the actions live there).
 */
import type { V2Row } from "./model";


/**
 * Every row in every Onboarding Oversight list opens the patient's Command Center PROFILE (Brandon, 2026-10-02),
 * whatever their state. From the profile, "Open <tool>" goes to the stage page, in manager mode when the patient is
 * escalated (lib/patient/patientScreen.ts managerModeParams). The second argument is kept for call-site stability.
 */
export function patientUrl(r: Pick<V2Row, "itemId" | "boardId">, _escOwners?: { mgr: string; final: string }): string {
  return `/patient/${r.itemId}?board=${r.boardId}`;
}
