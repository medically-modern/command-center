/**
 * A call that went to voicemail → the voicemail it left.
 *
 * The Phone tab's two lists come from two different RingCentral endpoints: the
 * call log and the message store. Nothing joins them — a call-log record
 * carries no message id — so a rep who saw "Left voicemail" on a call row had
 * to switch to the Voicemail sub-tab and find the same caller again (Josh,
 * 2026-09-15: *"calls — if they left a voicemail — it should auto open the
 * voicemail + the texts below it"*). This is that join.
 *
 * ⚠️ **IT IS A TIME-AND-NUMBER MATCH, NOT AN ID MATCH, AND THAT COULD NOT BE
 * VERIFIED AGAINST THE LIVE ACCOUNT.** Every RingCentral read now goes through
 * the gateway's `/rc/` proxy, which requires a verified employee identity
 * (§5.30b), so the precise relationship between a call's `startTime` and its
 * voicemail's `creationTime` is reasoned from the two endpoints' meanings
 * rather than measured. The window below is therefore deliberately generous in
 * the direction the data must run (a message is created DURING or AFTER the
 * call, never meaningfully before it), and every branch fails CLOSED: no match
 * leaves the pane exactly as it behaved before this existed, which is the
 * §5.31e rule — a partial answer must never be dressed up as a complete one.
 * **Measure it and tighten this** the first time somebody with a token can.
 */
import { contactKey } from "@/lib/contactState/contactState";
import { isVoicemail, type RcCallLogRecord } from "@/lib/callHistory/callHistory";

/** What the list hands the page when a rep clicks a call row. */
export interface PickedCall {
  /** The other party's number, as RingCentral rendered it. */
  phone: string;
  /** The call's `startTime`, ISO. */
  at: string;
  /** The call log says it reached voicemail (`isVoicemail`, which reads the legs). */
  voicemail: boolean;
}

/** A voicemail, as much of one as the match needs. */
export interface VoicemailLike {
  id: number;
  fromNumber: string;
  creationTime: string;
}

/**
 * How far AFTER the call's start a voicemail may be created and still be that
 * call's message: ring time (~20–30s) plus however long the caller talked.
 * Fifteen minutes is longer than any real message and still short enough that
 * it cannot normally reach a *different* call from the same number — and when
 * it does, nearest-wins picks the right one anyway.
 */
export const VOICEMAIL_AFTER_CALL_MS = 15 * 60 * 1000;

/**
 * ⚠️ And a small allowance for the message being stamped a moment BEFORE the
 * call-log start we compare it to — two subsystems, two clocks. Deliberately
 * tiny: widening this is what would let the PREVIOUS call's voicemail attach
 * to this one, which is the one wrong answer that looks right.
 */
export const VOICEMAIL_BEFORE_CALL_MS = 2 * 60 * 1000;

const ms = (iso: string): number | null => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
};

/**
 * The voicemail this call left, or null.
 *
 * ⚠️ **Gated on the CALL saying it reached voicemail.** Matching on number and
 * time alone would hang the caller's last message off an ordinary answered
 * call — a rep listening to a week-old voicemail believing it was just left.
 * `isVoicemail` reads the legs, for the §5.16 reason.
 *
 * ⚠️ NEAREST wins, not first: the voicemail list is newest-first, so "first in
 * the window" is the LATEST message, i.e. the wrong one whenever a number rang
 * twice.
 */
export function voicemailForCall<T extends VoicemailLike>(
  call: PickedCall | null,
  voicemails: readonly T[] | null,
): T | null {
  if (!call?.voicemail || !voicemails?.length) return null;
  const key = contactKey(call.phone);
  if (key.length !== 10) return null;
  const started = ms(call.at);
  if (started === null) return null;

  let best: T | null = null;
  let bestGap = Infinity;
  for (const v of voicemails) {
    if (contactKey(v.fromNumber) !== key) continue;
    const made = ms(v.creationTime);
    if (made === null) continue;
    const delta = made - started;
    if (delta < -VOICEMAIL_BEFORE_CALL_MS || delta > VOICEMAIL_AFTER_CALL_MS) continue;
    const gap = Math.abs(delta);
    if (gap < bestGap) {
      best = v;
      bestGap = gap;
    }
  }
  return best;
}

/** The row shape the call list builds, reduced to what the page needs to carry. */
export function pickedCall(record: RcCallLogRecord): PickedCall {
  const inbound = String(record.direction) !== "Outbound";
  const party = inbound ? record.from : record.to;
  return {
    phone: party?.phoneNumber ?? "",
    at: record.startTime ?? "",
    voicemail: isVoicemail(record),
  };
}
