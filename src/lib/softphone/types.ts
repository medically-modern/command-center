/**
 * Shared types for the browser softphone (lib/softphone/softphone.ts).
 *
 * Kept in their own module so the pure rule files (registration.ts,
 * ringMerge.ts, tabProtocol.ts) and their tests never import the runtime —
 * which imports the RingCentral SDK, which wants a browser.
 */

/** Where this browser stands with RingCentral's SIP server. */
export type RegistrationStatus =
  /** Nothing wanted it: this person is not an assigned answerer and no call is up. */
  | "off"
  /** Provisioning or REGISTERing. */
  | "registering"
  /** Registered — an inbound call will ring in this browser. */
  | "registered"
  /**
   * RingCentral refused with `603 Too Many Contacts`: the shared extension
   * already has five devices registered (§5.13b). Retried every minute.
   */
  | "full"
  /** Something else broke; `registrationError` says what. Retried with backoff. */
  | "error";

/** An inbound call that is ringing THIS browser's SIP registration. */
export interface SipRing {
  /** The SIP Call-Id — what answer() is keyed on. */
  id: string;
  /** RingCentral's telephony session id (`s-…`), when the INVITE carried one.
   *  It is the same id the gateway's SSE cards use, so the two can be merged
   *  into one card (ringMerge.ts). */
  sessionId: string;
  /** Caller, as RingCentral put it in the From header. */
  from: string;
  /** Carrier caller-ID name, when one came. */
  callerName: string;
  startedAt: number;
}

export type CallStatus = "idle" | "connecting" | "ringing" | "connected" | "ending";

/** The one live call this browser is on (inbound or outbound). */
export interface ActiveCall {
  callId: string;
  phone: string;
  direction: "inbound" | "outbound";
  status: CallStatus;
  /** When audio connected; null until then. The hooks derive elapsed seconds
   *  from it locally, so the leader tab doesn't have to broadcast a tick. */
  connectedAt: number | null;
  muted: boolean;
}

/**
 * What every tab renders from. The LEADER tab computes it from the SDK; the
 * other tabs of the same browser receive it over a BroadcastChannel and only
 * differ in `leader: false` (tabProtocol.ts).
 */
export interface PhoneSnapshot {
  /** This tab holds the browser's one SIP registration. */
  leader: boolean;
  /**
   * The signed-in person is one of the manager-assigned call answerers
   * (accessStore `callAnswerers`, capped at five). Nothing rings, registers or
   * even shows a card for anyone else — that is the model (Josh, 2026-09-14),
   * not a gap.
   */
  enabled: boolean;
  registration: RegistrationStatus;
  /** The ringtone is muted in this browser (cards still show). Per browser,
   *  read locally by every tab — like `enabled`, it never waits on the leader. */
  ringMuted: boolean;
  /** Why registration is not up, in a sentence a rep can act on. */
  registrationError: string | null;
  /** The last thing that failed on a call action (dial, answer); dismissable. */
  lastError: string | null;
  rings: SipRing[];
  call: ActiveCall | null;
}
