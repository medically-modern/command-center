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

  /* ── Have we actually got through to this person? ──────────────
   *
   * ⚠️ **THESE ARE HIGH-WATER MARKS, and the four fields above are
   * deliberately NOT** — read the header again before treating them as the
   * same kind of fact. `text` and `call` answer "who owes whom a reply right
   * now", so the most recent event wins and an older one is forgotten. These
   * answer a different question, the one the Care Coordinator's cards ask
   * (Brandon, 2026-09-17: "have the text and phone icon turn a shade of green
   * if they've responded to a text or picked up"): has this patient EVER
   * engaged inside the window. A patient who replied on Monday and was texted
   * again on Friday is `weRepliedLast` — and has still replied to us, which is
   * what a coordinator deciding whether this number is worth ringing needs to
   * know.
   *
   * Both are scoped to the same window as everything else here, so they mean
   * "this week", not "ever". */

  /** They sent us at least one text in the window. */
  reachedByText: boolean;
  /**
   * They answered one of OUR calls in the window.
   *
   * ⚠️ **OUTBOUND ONLY, and that is the literal ask** (Josh, 2026-09-17, asked
   * whether an inbound call we took should count: *"they answered our call"*).
   * So an inbound call somebody here picked up does NOT set this, even though
   * we plainly spoke to the patient. The question the Care Coordinator's green
   * phone icon answers is "does ringing this number work", and a patient who
   * only ever rings us has not answered that.
   *
   * ⚠️ `callConnected` reads the LEGS, for the reason the loop below records:
   * claiming an inbound call forwards it and can stamp the parent with a
   * terminal-looking result. It matters here for the mirror case — an outbound
   * call whose audio rode a leg — not just for the inbound one.
   */
  reachedByCall: boolean;
  /**
   * How many calls with this number the window held, both directions.
   *
   * ⚠️ **AN UNDERCOUNT IS POSSIBLE AND IS NOT DETECTABLE FROM HERE.** The
   * account-wide read behind this is page-capped (`ACTIVITY_MAX_PAGES`), so on
   * a busy week the oldest calls fall off the end — and this number would then
   * be quietly too low. The CALLER must decide whether it has enough of the
   * window to show a count at all; `useContactStates` exposes `truncated` for
   * exactly that, and the Care Coordinator card hides the number when it is
   * set. Never render this without checking.
   */
  calls: number;

  /* ── How many, each way ────────────────────────────────────────
   *
   * ⚠️ **THESE REPLACE A BOARD COUNTER AND DO NOT MEAN THE SAME THING**
   * (Brandon, 2026-09-22: *"i don't think the call/text counters are working
   * ... what i think it might be doing is incoming calls/texts"*). What the
   * Care Coordinator card used to count was the **Attempt Counter** column —
   * calls a rep had pressed *Log call attempt* for — and the **Drop-off
   * Attempt** column, which moves only for the intake form's two automated
   * nudges (§5.24). Neither has ever been a count of calls or texts: Katelyn
   * Matias read `1` beside a call log holding three real calls, and a patient
   * a rep had texted by hand read `0`.
   *
   * These are the real thing, from the same account-wide window every other
   * field here is folded out of. ⚠️ Which means they are bounded by that
   * window — a call made eight days ago is not in them — and the caller must
   * decide what to say about that. The card deliberately says nothing (Josh,
   * 2026-09-22: *"no need to explicitly say it's this week, i'll tell him
   * that's all that's possible"*).
   *
   * ⚠️ `calls` above is **`callsOut + callsIn`** and stays, because the
   * `Call Log (N)` chip beside these means "calls with this number", both
   * directions. Deriving one from the other in the view is what lets them
   * drift; both are computed here from the same loop. */

  /** Calls WE placed to this number in the window. */
  callsOut: number;
  /** Calls this number placed to US in the window, answered or not. */
  callsIn: number;
  /** Texts WE sent to this number in the window — rep-sent and automated alike. */
  textsOut: number;
  /** Texts this number sent US in the window. */
  textsIn: number;
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
  /** number → the high-water facts, which every record can only ever add to. */
  const reachedText = new Set<string>();
  const reachedCall = new Set<string>();
  const callCount = new Map<string, number>();
  /** number → [outbound, inbound], for calls and for texts. */
  const callsByDir = new Map<string, [number, number]>();
  const textsByDir = new Map<string, [number, number]>();

  /** Bump one side of a two-slot tally, creating it if this is the first. */
  const bump = (m: Map<string, [number, number]>, key: string, outbound: boolean) => {
    const cur = m.get(key) ?? [0, 0];
    cur[outbound ? 0 : 1] += 1;
    m.set(key, cur);
  };

  for (const r of messages) {
    if (!TEXT_TYPES.has(String(r.type ?? "").toLowerCase())) continue;
    const key = counterpartOfMessage(r);
    if (key.length !== 10 || own.has(key)) continue;
    const at = ms(r.creationTime);
    if (!Number.isFinite(at)) continue;
    // ⚠️ Set BEFORE the most-recent guard below, not after: a patient's reply
    // is a fact about the window whether or not it happens to be their newest
    // message. Ordering these two the other way round would make "they have
    // replied" mean "their reply was the last thing that happened", which is
    // the lane rule this is deliberately not.
    const outboundText = isOutbound(r.direction);
    // Counted for EVERY text, before the newest-wins guard below — the same
    // reasoning as `reachedText`: a count is a fact about the window, not
    // about which message happened to be last.
    bump(textsByDir, key, outboundText);
    if (!outboundText) reachedText.add(key);
    const prev = latestText.get(key);
    if (prev && prev.at >= at) continue;
    latestText.set(key, { at, iso: String(r.creationTime), outbound: outboundText });
  }

  for (const r of calls) {
    const key = counterpartOfCall(r);
    if (key.length !== 10 || own.has(key)) continue;
    const at = ms(r.startTime);
    if (!Number.isFinite(at)) continue;

    const outbound = isOutbound(r.direction);
    // Counted and marked for EVERY call, before the newest-wins guard — same
    // reasoning as the texts above. ⚠️ `reachedByCall` is OUTBOUND-only; see
    // the field's own note.
    callCount.set(key, (callCount.get(key) ?? 0) + 1);
    bump(callsByDir, key, outbound);
    if (outbound && callConnected(r)) reachedCall.add(key);

    const prev = latestCall.get(key);
    if (prev && prev.at >= at) continue;

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
    const reachedByText = reachedText.has(key);
    const reachedByCall = reachedCall.has(key);
    const calls = callCount.get(key) ?? 0;
    const [callsOut, callsIn] = callsByDir.get(key) ?? [0, 0];
    const [textsOut, textsIn] = textsByDir.get(key) ?? [0, 0];
    // ⚠️ This used to drop an entry whose `text` and `call` lanes were both
    // null — the case where the only thing in the window was an inbound call
    // somebody answered. That was right while the lanes were all this map
    // held: nothing was owed, so there was nothing to draw. It is wrong now,
    // because that patient is precisely one we HAVE spoken to, which is what
    // `reachedByCall` exists to say. The entry is kept when anything at all is
    // known, and the sidebar marks are unaffected: `ContactStateMarks` renders
    // per lane and already returns null when neither produces a glyph.
    if (!text && !call && !reachedByText && !reachedByCall && calls === 0) continue;
    out.set(key, {
      text,
      call,
      textAt: text ? (t?.iso ?? "") : "",
      callAt: call ? (c?.iso ?? "") : "",
      voicemail: call === "missedTheirCall" && !!c?.voicemail,
      reachedByText,
      reachedByCall,
      calls,
      callsOut,
      callsIn,
      textsOut,
      textsIn,
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
