/**
 * Contact state — who owes whom a reply, per patient, for the manager sidebars.
 *
 * Pure: no fetching, no React. The RingCentral REST calls live in
 * `lib/fax/ringcentralApi.ts` with the rest of the RC surface (same split as
 * `lib/callHistory/callHistory.ts`), and everything that decides *what a record
 * means* is here so it can be tested without a network.
 *
 * ## Two lanes, not four states
 *
 * Josh asked for four situations and a ceiling of two icons. They fit because
 * the four are two questions asked twice:
 *
 *   TEXT lane — who sent the last message?
 *     inbound  → `awaitingOurReply`   (they texted, we haven't answered)
 *     outbound → `weRepliedLast`      (ball is in the patient's court)
 *
 *   CALL lane — what was the most recent call, and how did it end?
 *     inbound, nobody picked up → `missedTheirCall`
 *     outbound                  → `weCalledThem`
 *     inbound, we answered      → null, see below
 *
 * A patient can never be in both states of one lane, so the ceiling is a
 * property of the rule rather than a cap anyone has to enforce.
 *
 * ⚠️ **An ANSWERED inbound call reports nothing.** It is not one of the four
 * situations, and the only other lane value — `weCalledThem` — would be a
 * plain lie about who dialled. Reporting "nothing owed" as an empty corner is
 * the honest answer; inventing a fifth glyph would break the ceiling above.
 *
 * ⚠️ **MOST RECENT wins within a lane, it is not a high-water mark.** Patient
 * rings at 9am and we miss it; we ring back at 10am and get no answer — that
 * is `weCalledThem`, not `missedTheirCall`. We did respond. A rule that
 * latched onto the missed call would keep a rose mark on a patient somebody
 * had already chased, which is exactly the noise that teaches people to stop
 * reading the column.
 */

import { callConnected, isVoicemail, type RcCallLogRecord } from "../callHistory/callHistory";

/** Which side sent the last text. */
export type TextLane = "awaitingOurReply" | "weRepliedLast";

/** What the most recent call was. */
export type CallLane = "missedTheirCall" | "weCalledThem";

export interface ContactState {
  /** Null when there has been no text in the window. */
  text: TextLane | null;
  /** Null when there has been no call in the window, or the last one was an
   *  inbound call we answered — see the header. */
  call: CallLane | null;
  /** ISO time of the message that decided `text`, for the hover text. */
  textAt: string;
  /** ISO time of the call that decided `call`, for the hover text. */
  callAt: string;
  /**
   * The missed call left a voicemail. Tooltip only — the glyph is the same
   * either way (Josh's call: split it later, once the Phone tab surfaces
   * voicemails in their own right).
   */
  voicemail: boolean;
}

/**
 * The slice of a RingCentral message-store record this rule reads.
 *
 * ⚠️ `type` matters. The store holds Fax and VoiceMail rows alongside the
 * texts, and the account-wide read cannot filter them out at the API — see
 * `fetchRecentMessageActivity` for why the `messageType` filter is unusable
 * here — so they are dropped in this module instead.
 */
export interface RcMessageRecord {
  type?: string;
  direction?: string;
  creationTime?: string;
  from?: { phoneNumber?: string };
  to?: Array<{ phoneNumber?: string }>;
}

/**
 * Last 10 digits — the only substring present in every rendering of a US
 * number, so it is what matching keys off. Same rule as `ringcentralApi` and
 * `callHistory`; boards store numbers in whatever shape they were typed.
 */
export function contactKey(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "").slice(-10);
}

/** Only SMS and MMS are texts. A patient who answers with a photo sends an
 *  MMS, and dropping it would report them as never having replied. */
const TEXT_TYPES = new Set(["sms", "mms"]);

const isOutbound = (d: unknown) => String(d ?? "") === "Outbound";

/** The PATIENT's number on a record — the party that isn't us. */
function counterpartOfMessage(r: RcMessageRecord): string {
  return isOutbound(r.direction)
    ? contactKey((r.to ?? [])[0]?.phoneNumber)
    : contactKey(r.from?.phoneNumber);
}

function counterpartOfCall(r: RcCallLogRecord): string {
  return isOutbound(r.direction) ? contactKey(r.to?.phoneNumber) : contactKey(r.from?.phoneNumber);
}

/** Milliseconds, or NaN for a value we can't read. Records without a usable
 *  time are dropped rather than sorted to the epoch, where they would beat
 *  nothing and lose to everything — a silent "no contact". */
function ms(iso: unknown): number {
  const t = new Date(String(iso ?? "")).getTime();
  return Number.isFinite(t) ? t : NaN;
}

export interface BuildContactStatesOptions {
  /**
   * Our own line(s), so a record where both parties are us can't be mistaken
   * for a patient. The counterpart rules above already pick the other side;
   * this is the belt to that pair of braces.
   */
  ownNumbers?: string[];
}

/**
 * Fold a window of RingCentral activity into one entry per patient number.
 *
 * Only numbers with something to say are included: a patient with no text and
 * no call in the window is ABSENT from the map, not present with two nulls.
 * The sidebar renders an empty corner for them, and an empty corner is the
 * whole point — a placeholder meaning "nothing happened" on every row would
 * cost the column its scannability.
 */
export function buildContactStates(
  messages: RcMessageRecord[],
  calls: RcCallLogRecord[],
  opts: BuildContactStatesOptions = {},
): Map<string, ContactState> {
  const own = new Set((opts.ownNumbers ?? []).map(contactKey).filter((n) => n.length === 10));

  /** number → the newest text, and the newest call, seen so far. */
  const latestText = new Map<string, { at: number; iso: string; outbound: boolean }>();
  const latestCall = new Map<string, { at: number; iso: string; lane: CallLane | null; voicemail: boolean }>();

  for (const r of messages) {
    if (!TEXT_TYPES.has(String(r.type ?? "").toLowerCase())) continue;
    const key = counterpartOfMessage(r);
    if (key.length !== 10 || own.has(key)) continue;
    const at = ms(r.creationTime);
    if (!Number.isFinite(at)) continue;
    const prev = latestText.get(key);
    if (prev && prev.at >= at) continue;
    latestText.set(key, { at, iso: String(r.creationTime), outbound: isOutbound(r.direction) });
  }

  for (const r of calls) {
    const key = counterpartOfCall(r);
    if (key.length !== 10 || own.has(key)) continue;
    const at = ms(r.startTime);
    if (!Number.isFinite(at)) continue;
    const prev = latestCall.get(key);
    if (prev && prev.at >= at) continue;

    const outbound = isOutbound(r.direction);
    // ⚠️ `connected` reads the LEGS, not the top-level result: claiming an
    // inbound call forwards it, which tears down the original leg and can
    // stamp the parent with a terminal-looking result. Reading that literally
    // is what once flashed "Missed" at the person who had just answered
    // (CLAUDE.md §5.13/§5.16) — here it would put a rose mark on a patient a
    // rep had actually spoken to.
    const answered = callConnected(r);
    const lane: CallLane | null = outbound ? "weCalledThem" : answered ? null : "missedTheirCall";
    latestCall.set(key, {
      at,
      iso: String(r.startTime),
      lane,
      voicemail: !outbound && !answered && isVoicemail(r),
    });
  }

  const out = new Map<string, ContactState>();
  for (const key of new Set([...latestText.keys(), ...latestCall.keys()])) {
    const t = latestText.get(key);
    const c = latestCall.get(key);
    const text: TextLane | null = t ? (t.outbound ? "weRepliedLast" : "awaitingOurReply") : null;
    const call = c?.lane ?? null;
    // Both empty means the only thing in the window was an inbound call we
    // answered. Nothing is owed and nothing is claimed — leave them out.
    if (!text && !call) continue;
    out.set(key, {
      text,
      call,
      textAt: text ? (t?.iso ?? "") : "",
      callAt: call ? (c?.iso ?? "") : "",
      voicemail: call === "missedTheirCall" && !!c?.voicemail,
    });
  }
  return out;
}

/** Human wording for a lane value — the icon's `title`, and the only place a
 *  rep ever reads what a glyph means. */
export const TEXT_LANE_LABEL: Record<TextLane, string> = {
  awaitingOurReply: "They texted us and nobody has replied",
  weRepliedLast: "We sent the last text — waiting on them",
};

export const CALL_LANE_LABEL: Record<CallLane, string> = {
  missedTheirCall: "They called and nobody picked up",
  weCalledThem: "We called them",
};
