/**
 * Did the fax actually land? — the rule behind the "Fax Bad" badge.
 *
 * ⚠️ **An accepted fax is NOT a delivered fax**, exactly as §5.5 documents for
 * texts. Send Request hands the message to Gmail, Gmail hands it to
 * `<digits>@rcfax.com`, and RingCentral reports the real outcome into its
 * message store a **median of 11 minutes later** (p90 31 min, measured over the
 * 255 outbound faxes of Aug 2026). The rep has long since moved on, the patient
 * has already been advanced to Confirm Receipt, and nothing on any page ever
 * said the fax died. Over that month **60 of 255 faxes failed — 23.5%** — and
 * 45 of those 60 were the destination number, not us.
 *
 * So the message store, not the send call, is where a fax failure becomes
 * visible. This module turns a page of RC fax records into "is the number on
 * this doctor's record currently bad?", which is all the badge needs.
 *
 * **STATUS decides, CODE only explains** — the same rule as `smsDelivery.ts`,
 * for the same reason. `messageStatus` is the verdict; `faxErrorCode` is a
 * reason string we may or may not recognise. An unknown status is PENDING,
 * never failed: a fax still in flight must not be marked bad, or the rep goes
 * off to "fix" a number that was fine.
 */

/** The slice of a RingCentral message-store fax record this rule reads. */
export interface RcFaxRecord {
  messageStatus?: string;
  creationTime?: string;
  lastModifiedTime?: string;
  to?: Array<{ phoneNumber?: string; messageStatus?: string; faxErrorCode?: string }>;
}

export type FaxState = "sent" | "failed";

export interface FaxOutcome {
  state: FaxState;
  /** RingCentral's `faxErrorCode` for a failure, when it gave one. */
  code?: string;
  /** When RC reached this verdict (falls back to the send time). */
  at: string;
  /** The number as RC reported it, for display. */
  number: string;
}

/**
 * RingCentral's terminal fax failure statuses. Everything else — `Queued`,
 * `Sent`, `Delivered`, or a status we have never seen — is not a failure. A
 * blank status is an absence of evidence, not evidence of absence.
 */
const FAILED_STATUSES = new Set(["SendingFailed", "DeliveryFailed"]);

/** Statuses that positively confirm the fax went through. */
const SENT_STATUSES = new Set(["Sent", "Delivered"]);

/**
 * What the rep should DO about it, in their words rather than the carrier's.
 * Codes are RingCentral's, observed live on this account in Aug 2026.
 *
 * The split that matters is "the number is wrong, fix the record" versus "the
 * line was busy, just re-send" — a rep who can't tell those apart either edits
 * a number that was fine or re-sends into a dead line all week.
 */
const REASONS: Record<string, string> = {
  WrongNumber:
    "The line answered but it isn't a fax machine — the number on the doctor record is wrong.",
  CallFailed:
    "The call never connected — the line is disconnected, or it never answered as a fax. Usually a wrong or dead number.",
  LineBusy: "The line was busy. Worth re-sending.",
  NoAnswer: "The line rang out with no answer. Worth re-sending.",
  RenderingFailed:
    "Our own document failed to render — this one is ours, not the doctor's number.",
};

/** Plain-language reason for a failure code, or a usable fallback. */
export function faxFailureReason(code?: string): string {
  const c = (code ?? "").trim();
  if (!c) return "RingCentral didn't say why.";
  return REASONS[c] ?? `RingCentral reported "${c}".`;
}

/**
 * Is this failure worth changing the number over, or just re-sending?
 *
 * `LineBusy` / `NoAnswer` are the phone being the phone. Everything else points
 * at the record. Only used for the badge's wording — the badge itself shows for
 * any failure, because "the last fax didn't arrive" is the fact the rep needs.
 */
export function isRetryableFaxFailure(code?: string): boolean {
  const c = (code ?? "").trim();
  return c === "LineBusy" || c === "NoAnswer";
}

/**
 * The key both sides of the join agree on: the last 10 digits.
 *
 * Monday stores a doctor fax as `<digits>@rcfax.com` (an EMAIL column — see
 * `faxAddress.ts`), while RingCentral returns `+1XXXXXXXXXX`. The last ten
 * digits are the only rendering present in both, the same reasoning
 * `fetchOutboundFaxStatus` and `callHistory` already use.
 *
 * Returns "" for anything that isn't a usable US fax number — a real email
 * address in the fax column, a blank, or a partial number. "" never matches, so
 * a doctor with no fax on file simply gets no badge.
 */
export function faxKey(raw?: string): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

/** Newest of two RC timestamps, preferring the verdict time over the send time. */
function verdictTime(r: RcFaxRecord): string {
  return r.lastModifiedTime || r.creationTime || "";
}

/**
 * Fold a page of outbound fax records into "the latest outcome per number".
 *
 * ⚠️ **LATEST WINS, and that is what makes the badge self-clearing.** A number
 * that failed on Tuesday and went through on Wednesday is fine, and must show
 * nothing — otherwise the badge is permanent, every rep learns to ignore it,
 * and correcting a fax number produces no visible reward. Ordering of the input
 * is irrelevant; the timestamps decide.
 */
export function buildFaxOutcomes(records: RcFaxRecord[]): Map<string, FaxOutcome> {
  const out = new Map<string, FaxOutcome>();
  for (const rec of records ?? []) {
    const at = verdictTime(rec);
    if (!at) continue;
    for (const to of rec.to ?? []) {
      const key = faxKey(to.phoneNumber);
      if (!key) continue;
      // The per-recipient status is the specific one (a fax can go to several
      // numbers); the top-level status is the fallback for older records.
      const status = (to.messageStatus || rec.messageStatus || "").trim();
      const state: FaxState | null = FAILED_STATUSES.has(status)
        ? "failed"
        : SENT_STATUSES.has(status)
          ? "sent"
          : null;
      // Unknown/in-flight: no verdict to record. Deliberately does not overwrite
      // an earlier one either — a Queued re-send must not erase yesterday's
      // failure until it actually resolves.
      if (!state) continue;
      const prev = out.get(key);
      if (prev && prev.at >= at) continue;
      out.set(key, {
        state,
        at,
        number: to.phoneNumber || "",
        ...(state === "failed" && to.faxErrorCode ? { code: to.faxErrorCode } : {}),
      });
    }
  }
  return out;
}

/**
 * The outcome for one doctor's fax value, or null when we have nothing to say —
 * no fax on file, or no fax sent to it inside the lookback window.
 */
export function faxOutcomeFor(
  outcomes: Map<string, FaxOutcome> | null | undefined,
  doctorFax?: string,
): FaxOutcome | null {
  const key = faxKey(doctorFax);
  if (!key || !outcomes) return null;
  return outcomes.get(key) ?? null;
}
