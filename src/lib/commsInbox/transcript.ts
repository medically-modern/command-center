import type { TranscriptTurn } from "./api";

/** "Speaker 1", "Speaker 2" — numbered by first appearance, not Google's label
 *  (§5.47e). Google cannot know which voice is the rep, so neither do we. */
export function speakerNames(turns: readonly TranscriptTurn[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const t of turns) {
    if (t.speaker && !names.has(t.speaker)) names.set(t.speaker, `Speaker ${names.size + 1}`);
  }
  return names;
}
