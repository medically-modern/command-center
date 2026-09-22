/**
 * Generating a script (DocExport) — the rule, in one place.
 *
 * Two surfaces trigger it: **Send Request**, where it has always lived, and
 * from 2026-09-22 the **Chase Clinicals — Email, Parachute & Dashboards**
 * drawer (Josh: *"Need to add the option (via a drawer that is default hidden)
 * to send a fax for these patients (and generate a script too)"*).
 *
 * ⚠️ ONE module, never a copy per panel. The §5.7/§5.17/§5.29 hand-synced
 * hazard applies with a specific cost here: the two ends would be the stage
 * that generates a script and the stage that chases the office for the records
 * it asks for, and a drifted required-field list means one screen refusing to
 * generate what the other generates happily — with no error either way.
 *
 * Nothing here renders. The buttons are
 * `components/masheke/GenerateScriptButtons.tsx`.
 */
import { clearStatusColumn, writeStatusIndex, hasToken } from "./mondayApi";
import { GEN_SCRIPT_STATUS } from "./mondayMapping";

/** The fields DocExport needs before it can build a script. */
export interface ScriptInputs {
  name?: string;
  dob?: string;
  cgmType?: string;
  pumpType?: string;
  doctorName?: string;
  doctorNpi?: string;
}

/**
 * What is still missing before `kind`'s script can be generated, in the order
 * a rep reads it. Empty ⇒ ready.
 *
 * ⚠️ These are DocExport's inputs, not a stage gate. A blank here disables the
 * Generate button and says why; it never blocks the chase, the send or the
 * advance — a rep who cannot generate a script can still work the patient.
 */
export function missingForScript(p: ScriptInputs, kind: "cgm" | "ip"): string[] {
  const out: string[] = [];
  if (!p.name) out.push("Name");
  if (!p.dob) out.push("DOB");
  if (kind === "cgm" && !p.cgmType) out.push("CGM Type");
  if (kind === "ip" && !p.pumpType) out.push("Pump Type");
  if (!p.doctorName) out.push("Doctor Name");
  if (!p.doctorNpi) out.push("Doctor NPI");
  return out;
}

/**
 * Which script buttons a patient's Serving earns.
 *
 * ⚠️ `showIpGenerate` is "anything that is not CGM-only", which is deliberately
 * wider than "sells a pump" — infusion sets and cartridges are pump supplies
 * and their script is the IP one (§5.22's `servingIncludesPump` reasoning). A
 * BLANK serving earns both, so a column that failed to read can never hide a
 * script a rep needs.
 */
export function showCgmGenerate(serving: string | undefined): boolean {
  return serving === "CGM" || serving === "Insulin Pump + CGM" || serving === "Supplies + CGM";
}
export function showIpGenerate(serving: string | undefined): boolean {
  return serving !== "CGM";
}

/**
 * Flip the Generate column so Monday's DocExport automation builds the script.
 *
 * ⚠️ CLEAR FIRST, THEN WRITE. The automation fires on the status CHANGING to
 * "Generate", and Monday takes a write of the value a column already holds at
 * HTTP 200 without recording an activity-log entry or firing anything (§9's
 * advancer no-op). So a re-generate on a column still reading "Generate" would
 * be a green button and no script. The 250ms gap is the indexing window the
 * same section documents: a clear and a write in the same instant can land in
 * either order.
 *
 * ⚠️ Passing `undefined` CANCELS — it clears the column and nothing else. That
 * is the rep's escape from a generate that hangs, and it must stay a clear
 * rather than a write of some "cancelled" label the column does not have.
 */
export async function triggerGenerateScript(
  itemId: string,
  columnId: string,
  v: "Generate" | undefined,
): Promise<void> {
  if (!hasToken()) return;
  if (v === "Generate") {
    await clearStatusColumn(itemId, columnId);
    await new Promise((r) => setTimeout(r, 250));
    await writeStatusIndex(itemId, columnId, GEN_SCRIPT_STATUS.generate);
  } else {
    await clearStatusColumn(itemId, columnId);
  }
}
