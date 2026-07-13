/**
 * "Question handled" logic for the Patient Questions inbox.
 *
 * A question is dismissed by writing the current time to the board's
 * "Question Handled At" date column (Subscription `date_mm57yzmb`,
 * Secondary Claims `date_mm57skrd` — see mondayApi.ts). The inbox shows an
 * item only while its message is NEWER than that mark, so a patient writing
 * again after completion automatically reopens the question — no automation
 * or status reset involved.
 */

/**
 * Whether a question should appear in the inbox.
 *
 * @param messageUpdatedAt newest known message activity (ISO), "" if unknown
 * @param handledAt        the handled mark (ISO), "" when never handled
 */
export function isQuestionOpen(messageUpdatedAt: string, handledAt: string): boolean {
  if (!handledAt) return true;
  const handled = Date.parse(handledAt);
  if (isNaN(handled)) return true; // unreadable mark — never hide a question over a bad value
  const message = Date.parse(messageUpdatedAt);
  if (isNaN(message)) return false; // no reliable message time — trust the handled mark
  return message > handled;
}

/** Monday date-column value JSON ({"date","time"}, time is UTC) → ISO string. */
export function mondayDateValueToIso(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const p = JSON.parse(value) as { date?: string; time?: string };
    if (!p?.date) return "";
    return `${p.date}T${p.time || "00:00:00"}Z`;
  } catch {
    return "";
  }
}

/** Now, as a Monday date-column value (date + UTC time). */
export function nowAsMondayDateValue(now: Date = new Date()): { date: string; time: string } {
  const iso = now.toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 19) };
}

/** The newest parseable timestamp among the given candidates ("" if none). */
export function newestTimestamp(...candidates: string[]): string {
  let best = "";
  let bestMs = -Infinity;
  for (const c of candidates) {
    const ms = Date.parse(c);
    if (!isNaN(ms) && ms > bestMs) {
      bestMs = ms;
      best = c;
    }
  }
  return best;
}
