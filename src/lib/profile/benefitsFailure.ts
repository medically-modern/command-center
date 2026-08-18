/**
 * Presentation shape for a failed benefits check (Stedi Error Description).
 *
 * The Railway stedi service writes the column as one line:
 *
 *   "<guidance for the rep> | <technical cause>"
 *
 * where the cause is either a payer AAA line ("AAA 72 — Invalid/Missing
 * Subscriber/Insured ID (Please Correct and Resubmit)") or a raw
 * "Stedi HTTP 400: {json}" blob. Rendered verbatim that reads as a wall of
 * red — the JSON blob especially, which buries the one useful sentence
 * (`message`) inside ids nobody on a call can act on. This splits the line
 * back into its halves and digs the message out of the HTTP blob, so the UI
 * can lead with the cause and keep the guidance as the footnote.
 *
 * Purely presentational — the column value itself is never rewritten.
 */
export type BenefitsFailure = { cause: string; guidance: string };

export function formatBenefitsFailure(raw: string | undefined): BenefitsFailure | null {
  const s = (raw ?? "").trim();
  if (!s) return null;

  const [first, ...rest] = s.split(" | ");
  let guidance = "";
  let cause = first.trim();
  if (rest.length) {
    guidance = first.trim();
    cause = rest.join(" | ").trim();
  }

  // "Stedi HTTP 400: {…}" → the payload's own `message` is the readable part.
  // Anything unparseable stays verbatim — a mangled blob is still more honest
  // than a blank.
  const m = /^Stedi HTTP (\d+):\s*(\{[\s\S]*\})\s*$/.exec(cause);
  if (m) {
    try {
      const msg = (JSON.parse(m[2]) as { message?: unknown }).message;
      if (typeof msg === "string" && msg.trim()) {
        cause = `${msg.trim()} (Stedi HTTP ${m[1]})`;
      }
    } catch {
      /* keep the raw cause */
    }
  }

  return { cause, guidance };
}
