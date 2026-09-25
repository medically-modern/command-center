/**
 * The Fax Inbox's pure bits (pixel-match Phase 5, 2026-09-24), kept out of the
 * page so it exports one component (react-refresh) and so a test can hold them
 * without rendering anything.
 */
import type { InboundFax } from "@/lib/fax/ringcentralApi";
import type { FaxPatient } from "@/lib/commsHub/faxDirectory";
import { formatPhoneParen } from "@/lib/shared/phoneDisplay";

const SUBSCRIPTION_BOARD = 18407459988;
const MEDICAL_EVALUATION_BOARD = 18406060017;

/** Who sent it, as the row and the card both say it. */
export function faxFrom(f: InboundFax): string {
  return f.fromName || formatPhoneParen(f.fromNumber) || f.fromNumber || "Unknown";
}

/** "Fax — Northgate Diabetes 2026-09-24.pdf" — the classic page's download name. */
export function faxFileName(f: InboundFax): string {
  const who = (f.fromName || formatPhoneParen(f.fromNumber) || "fax").replace(/[^\w\s().-]/g, "").trim() || "fax";
  const d = f.creationTime ? new Date(f.creationTime).toISOString().slice(0, 10) : "";
  return `Fax — ${who}${d ? " " + d : ""}.pdf`;
}

/**
 * His `ucBoardChip`: which board the likely match sits on, in the words a rep
 * uses. Subscription and Medical Necessity get his two tones; anything else is
 * the plain chip with the board's own name.
 */
export function faxPatientChip(p: Pick<FaxPatient, "boardId" | "boardName" | "stage" | "groupTitle">): {
  cls: "sub" | "mn" | "";
  text: string;
} {
  const where = p.stage || p.groupTitle;
  if (p.boardId === SUBSCRIPTION_BOARD) return { cls: "sub", text: `Subscription · ${where || "Active"}` };
  if (p.boardId === MEDICAL_EVALUATION_BOARD) return { cls: "mn", text: `Med Necessity · ${where || "Evaluate"}` };
  return { cls: "", text: where ? `${p.boardName} · ${where}` : p.boardName };
}

