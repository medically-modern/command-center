/**
 * ringMerge.ts — one card per inbound call, whichever way we heard about it.
 *
 * Two independent signals say "somebody is calling" (§5.13 / §5.13b):
 *   · the GATEWAY's webhook → SSE (`useInboundCalls`), which every tab gets
 *     and which knows the patient — it drives "Take it" (forward to my phone);
 *   · this browser's own SIP registration (`softphone.ts`), which only the
 *     five registered browsers get — it is what "Answer" answers.
 * They arrive within a second of each other and describe the same call. Two
 * cards for one ring would be the worst possible UI on a 20-second window, so
 * this joins them, and says per card whether it can be answered right here.
 *
 * Join key: RingCentral's telephony session id, which the gateway keys its
 * calls on (`inboundCalls.mjs` → `call.id`) and which the SIP INVITE carries in
 * `p-rc-api-ids` (the SDK's `session.sessionId`). When the INVITE lacks it,
 * fall back to the caller's digits — the two signals cannot disagree about who
 * is calling, only about how they name the call.
 */
import type { RingingCall } from "@/hooks/inboundCalls/useInboundCalls";
import type { PatientRef } from "@/lib/assignedPatients/patientLookup";
import type { SipRing } from "./types";

export interface UnifiedRing {
  /** Stable across the SSE and SIP halves arriving in either order. */
  key: string;
  from: string;
  callerName: string;
  startedAt: number;
  patient: PatientRef | null;
  state: "ringing" | "answered" | "missed";
  claimedBy: string | null;
  /** The gateway's view, when it has one — what `claim()` needs. */
  sse: RingingCall | null;
  /** This browser's SIP leg, when it has one — what `answer()` needs. */
  sip: SipRing | null;
  /** True iff a SIP leg is ringing here: the call can be taken in the page. */
  canAnswer: boolean;
}

/** The last ten digits — the one rendering every source of a US number shares. */
export function digitsKey(phone: string): string {
  const d = String(phone || "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

function keyFor(sessionId: string, from: string): string {
  return sessionId ? `s:${sessionId}` : `n:${digitsKey(from)}`;
}

/**
 * Merge the gateway's ringing cards with this browser's SIP rings.
 *
 * ⚠️ A SIP leg that is still ringing WINS the state: the gateway's card can
 * lag a second behind (or say "missed" for a call this very browser is about
 * to answer), and the leg in the page is the ground truth of whether Answer
 * would work. Conversely a card the gateway says is answered or missed with
 * no SIP leg is exactly that — somebody else took it, or it went to voicemail.
 */
export function mergeRings(sse: RingingCall[], sip: SipRing[]): UnifiedRing[] {
  const out = new Map<string, UnifiedRing>();
  const bySession = new Map<string, UnifiedRing>();
  const byDigits = new Map<string, UnifiedRing>();

  for (const c of sse) {
    const u: UnifiedRing = {
      key: keyFor(c.id, c.from),
      from: c.from,
      callerName: c.callerName || "",
      startedAt: c.startedAt,
      patient: c.patient,
      state: c.state,
      claimedBy: c.claimedBy,
      sse: c,
      sip: null,
      canAnswer: false,
    };
    out.set(u.key, u);
    if (c.id) bySession.set(c.id, u);
    const dk = digitsKey(c.from);
    // Two calls from one number at once is not a case worth a second card.
    if (dk && !byDigits.has(dk)) byDigits.set(dk, u);
  }

  for (const r of sip) {
    const twin =
      (r.sessionId && bySession.get(r.sessionId)) ||
      byDigits.get(digitsKey(r.from)) ||
      null;
    if (twin && !twin.sip) {
      twin.sip = r;
      twin.canAnswer = true;
      twin.state = "ringing";
      if (!twin.callerName && r.callerName) twin.callerName = r.callerName;
      continue;
    }
    const u: UnifiedRing = {
      key: keyFor(r.sessionId, r.from),
      from: r.from,
      callerName: r.callerName || "",
      startedAt: r.startedAt,
      patient: null,
      state: "ringing",
      claimedBy: null,
      sse: null,
      sip: r,
      canAnswer: true,
    };
    out.set(u.key, u);
  }

  return [...out.values()].sort((a, b) => a.startedAt - b.startedAt);
}
