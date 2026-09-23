/**
 * Where the Communications hub's *Open Profile Page* goes (CLAUDE.md §5.49):
 * the live record, or — for a patient whose records are all finished or stuck —
 * the one the patient screen would anchor on. Any of a patient's records opens
 * the same screen (it builds the whole trail from whichever it is given), and it
 * carries the BOARD because a Monday item id alone does not say which board it
 * is on (§5.39).
 *
 * ⚠️ Not in `patientScreen.ts`, where `itemOpenHref` lives: `infoStrip` already
 * imports that module, so reading `anchorItem` from there would be a cycle.
 */
import type { PatientDossier } from "@/lib/commsHub/dossier";
import { anchorItem } from "@/lib/patient/infoStrip";

export function profilePageHref(dossier: PatientDossier | null): string | null {
  const item = anchorItem(dossier);
  return item ? `/patient/${encodeURIComponent(item.itemId)}?board=${item.boardId}` : null;
}
