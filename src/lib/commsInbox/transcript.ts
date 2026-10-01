import type { TranscriptTurn } from "./api";

/**
 * Display names for Google's speaker labels (§5.47e).
 *
 * Default: "Speaker 1", "Speaker 2", numbered by first appearance.
 *
 * ⚠️ Inbound calls with a known answerer (Josh, 2026-10-01): the FIRST voice is
 * named after the person who picked up and the second is "Caller", because
 * the rep opens the call ("Medically Modern, how can I help you?"). It is a
 * best guess from who spoke first: Google's labels only say which voice spoke
 * first, and a caller talking over the greeting or a mid-call mix-up swaps
 * them. Outbound calls keep the numbers: the patient usually speaks first.
 */
export function speakerNames(turns: readonly TranscriptTurn[], answeredBy = ""): Map<string, string> {
  const first = answeredBy.trim().split(/\s+/)[0] || "";
  const names = new Map<string, string>();
  for (const t of turns) {
    if (!t.speaker || names.has(t.speaker)) continue;
    const n = names.size;
    names.set(t.speaker, first ? (n === 0 ? first : n === 1 ? "Caller" : `Speaker ${n + 1}`) : `Speaker ${n + 1}`);
  }
  return names;
}
