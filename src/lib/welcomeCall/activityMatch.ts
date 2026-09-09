/**
 * Last-ten-digit matching for the Welcome Call activity box.
 *
 * ⚠️ Boards and RingCentral both store numbers in whatever shape they were
 * typed — `5555550100`, `(555) 555-0100`, `+15555550100` — and the last ten
 * digits are the only substring present in every rendering (§5.13). Shared so
 * the voicemail narrowing and any future consumer cannot drift into comparing
 * raw strings, which matches nothing and errors nowhere.
 */
export function last10(raw: string | undefined | null): string {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}
