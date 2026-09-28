/**
 * softphone.ts — the browser's ONE RingCentral phone (§5.13b, "Route B").
 *
 * ── What this is ───────────────────────────────────────────────────────────
 * Until 2026-09-14 the browser softphone was outbound-only and the inbound card
 * could only TRANSFER a ringing call to the rep's own cell ("Take it"). This
 * registers the browser on the shared extension for real — so a call rings in
 * the page and "Answer" answers it, audio and all — while keeping the whole of
 * the old path as the fallback.
 *
 * ── The cap that shapes everything here ────────────────────────────────────
 * Every Command Center browser registers as the SAME RingCentral extension
 * (the one the gateway's JWT belongs to: on the live account that is one
 * shared user, and ALL inbound calls land on it — verified from the call log,
 * 2026-09-14). RingCentral allows FIVE simultaneous registrations per
 * extension and refuses the sixth with `603 Too Many Contacts`. Hence:
 *
 *   1. ONE registration per BROWSER, never per tab — the leader election in
 *      tabProtocol.ts. Followers mirror the leader over a BroadcastChannel
 *      and relay Answer / Hang up / Mute / Dial to it.
 *   2. A stable per-browser `instanceId`, so reloads are not new devices.
 *   3. WHO registers is ASSIGNED by a manager (accessStore `callAnswerers`,
 *      capped at the same five) — never a toggle anyone can flip. Nobody else
 *      registers, rings, or is even shown a card (Josh, 2026-09-14). Each tab
 *      reads the assignment from access.json and tells this store via
 *      `setEnabled`.
 *   4. `full` is a STATE the rep is shown, retried every minute.
 *   5. A follower tab can TAKE OVER the registration (`takeOver`): it steals
 *      the Web Lock, the old leader's request rejects with AbortError and it
 *      demotes itself. That is what "connected on THIS tab" on the home page
 *      offers; it is refused while the leader is on a call.
 *
 * ── Rules that are correctness, not style ──────────────────────────────────
 * ⚠️ NEVER decline or send-to-voicemail a ringing call from here. Dismissing a
 *    card is LOCAL (`ignore`). Every registered device is rung at once, and a
 *    device that declines can shorten the window in which a colleague — or the
 *    gateway's "Take it" forward, which only works while the party is still
 *    ringing (§5.13) — can take the call. `softphoneRules.test.ts` scans for
 *    `.decline(` / `.toVoicemail(` in src/ and fails the build.
 * ⚠️ `autoAnswer: false`. The SDK's default answers any INVITE carrying an
 *    `Alert-Info: Auto Answer` header (RingCentral intercom) without a click.
 * ⚠️ Listeners go on the session via the WebPhone's `outboundCall` /
 *    `inboundCall` events, never after `await wp.call()` resolves — that
 *    promise resolves only once the call is answered or failed, by which time
 *    `ringing` and `answered` have already fired (the SDK README says so, and
 *    the previous hook had exactly this bug: its overlay never left "Setting
 *    up…").
 * ⚠️ `session.answer()` is NOT awaited for status: it resolves on an RC
 *    "AlreadyProcessed" message that may never come. The `answered` event is
 *    the signal; the promise is only watched for a rejection (mic blocked).
 */
import WebPhone from "ringcentral-web-phone";
import type { SipInfo } from "ringcentral-web-phone/types";
import { getIdToken, getUser, isAuthed, onAuthChange } from "@/lib/shared/auth";
import { mmPhoneNumber } from "@/lib/fax/ringcentralApi";
import {
  MUTE_KEY,
  PROVISION_TIMEOUT_MESSAGE,
  START_TIMEOUT_MESSAGE,
  classifyRegistrationError,
  clearCachedSipInfo,
  describeRegistrationFailure,
  instanceIdFor,
  readCachedSipInfo,
  readMuted,
  retryDelayMs,
  shouldRefreshCredentials,
  writeCachedSipInfo,
  writeMuted,
} from "./registration";
import { CHANNEL_NAME, LOCK_NAME, followerView, isTabMessage, type TabCommand, type TabMessage } from "./tabProtocol";
import { audibleRings, nextExpiryMs, sameRings, type RingLike } from "./ringRules";
import { Ringtone } from "./ringtone";
import type { ActiveCall, PhoneSnapshot, RegistrationStatus, SipRing } from "./types";

const GATEWAY =
  (import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined)?.replace(/\/+$/, "") || "";

/** How long an ended call keeps the registration up when browser answering is
 *  off — a rep who redials a minute later shouldn't wait on a fresh REGISTER. */
const RELEASE_AFTER_MS = 30_000;

/**
 * How long ONE attempt to connect and register may take before it is given up
 * and retried.
 *
 * ⚠️⚠️ THE SDK'S `start()` CAN NEVER SETTLE, AND THIS DEADLINE IS THE ONLY THING
 * THAT ENDS IT (Josh, 2026-09-23: "it keeps saying connecting to ring central
 * but never connects"). Read in ringcentral-web-phone 2.5.1's sip-client:
 * `register()` awaits `request()`, whose promise resolves on a matching reply
 * and has NO rejection path at all. The SDK's own guard for an unanswered
 * REGISTER is to CLOSE THE SOCKET after 5s — which stops any reply arriving,
 * so the promise waits for ever and `start()` with it. `connect()` is the same
 * shape: it settles only on the socket's `open` or `error`, and the second
 * (authorised) REGISTER has no guard of any kind.
 * Before this, an unanswered REGISTER — a laptop waking, a Wi-Fi hand-off, a
 * slow moment on RingCentral's side — left the phone on "Reconnecting to
 * RingCentral…" permanently: no failure ever came to schedule a retry, and the
 * close listener that would have noticed is only attached after `start()`
 * resolves. It lasted until the leader TAB was reloaded, and reloading any
 * other tab did nothing, because a follower just mirrors the stuck leader.
 * Generous on purpose: a normal registration is well under two seconds, and a
 * slow one abandoned early costs only a retry.
 */
export const START_DEADLINE_MS = 20_000;
/** The same bound for the gateway's sip-provision request, which is a plain
 *  `fetch` with no timeout of its own. */
export const PROVISION_DEADLINE_MS = 15_000;
/* ⚠️ Both deadline messages now live in registration.ts, beside the classifier
 * that has to tell them apart: they BOTH say "timed out", and filing the
 * gateway's silence as "Can't reach RingCentral" sent everyone to look at the
 * wrong half (2026-09-28). Imported above; re-declaring one here is how they
 * drift back into one bucket. */

/**
 * How long a dialled call may sit with NO SIP progress before it is given up.
 *
 * ⚠️⚠️ THE SDK'S `call()` HAS TWO WAYS TO NEVER TELL US ANYTHING (read in
 * ringcentral-web-phone 2.5.1, call-session/outbound.ts, after Brandon's
 * 2026-09-25 stuck call — the gateway's webhook log shows his 8:43 AM INVITE
 * never became a telephony session at RingCentral at all):
 *   · The first INVITE awaits `sipClient.request()`, which has NO rejection
 *     path (§5.13b's measurement) — a socket that silently died, or an edge
 *     that swallows the INVITE, leaves the promise pending for ever.
 *   · A SIP 403 makes `call()` `return` QUIETLY: no "failed" event, no state
 *     change — a healthy socket, and still nothing to move the overlay.
 * Either way the session never reaches "ringing" and the overlay sat on
 * "Setting up…" indefinitely. Real progress (a 183/180 via the authorised
 * INVITE) arrives within a couple of seconds on a live socket — the PSTN's
 * post-dial delay is on the audio, not the SIP progress — so fifteen seconds
 * with nothing at all means the attempt is dead.
 */
export const DIAL_PROGRESS_DEADLINE_MS = 15_000;
const DIAL_DEAD_MESSAGE =
  "RingCentral didn't respond to the call attempt — the phone connection is being re-checked. Try the call again in a moment.";

/**
 * How long Hang up waits for RingCentral to acknowledge the CANCEL/BYE.
 *
 * ⚠️⚠️ The SDK's `cancel()` and `hangup()` are bare `await sipClient.request()`
 * — no timeout, no rejection path — so a teardown written to an unresponsive
 * socket NEVER settles, and the overlay sat on "Hanging up…" for 20+ minutes
 * (Brandon, 2026-09-25). The rep's intent is already final at the press: the
 * deadline only bounds how long we keep the overlay up waiting for a reply
 * nobody needs. A real BYE round-trip is sub-second.
 */
export const HANGUP_DEADLINE_MS = 8_000;
const HANGUP_TIMEOUT_MESSAGE = "RingCentral didn't acknowledge the hang-up";

/**
 * Settle `p` or reject after `ms`, whichever comes first. The losing promise is
 * still observed by the race, so a late rejection is never unhandled.
 */
function withDeadline<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  let id: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(id));
}

/**
 * The slice of the SDK's CallSession we touch, typed structurally — the
 * session classes are only reachable through `any`-typed emitter events.
 */
interface Session {
  callId: string;
  sessionId?: string;
  remoteNumber: string;
  state: "init" | "ringing" | "answered" | "disposed" | "failed";
  direction: "inbound" | "outbound";
  rcApiCallInfo?: { callerIdName?: string; queueName?: string };
  answer?: () => Promise<void>;
  hangup(): Promise<void>;
  cancel?: () => Promise<void>;
  /** Local teardown only — closes the RTC peer and emits `disposed`. Never
   *  touches the network, so it is what a timed-out CANCEL/BYE falls back to. */
  dispose?: () => void;
  reInvite?: () => Promise<void>;
  mute(): void;
  unmute(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  once(event: string, listener: (...args: unknown[]) => void): void;
}

function mintUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Insecure-context fallback; only a dev server on a LAN address gets here.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

const NO_STORAGE = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/** The SDK types `sipClient` as an interface without its WebSocket; the
 *  default client exposes it as `wsc`, which the README's own reconnect sample
 *  reads. Null when a custom client has no socket. */
function socketOf(wp: WebPhone | null): WebSocket | null {
  const c = wp?.sipClient as unknown as { wsc?: WebSocket } | undefined;
  return c?.wsc ?? null;
}

/**
 * Drop a WebPhone that must not stay registered — a registration attempt that
 * timed out, or one that finished in a tab that has since stopped being the
 * leader — WITHOUT the SDK's `dispose()`.
 *
 * ⚠️ `dispose()` is wrong twice here. It sends an unREGISTER and waits for the
 * reply before it closes the socket — on the dead connection that got us here
 * that wait never ends, so the socket is never closed. And every browser
 * registers under the same `instanceId`, so an unREGISTER from a tab that lost
 * the lead would remove the binding the NEW leader has just made. It also
 * declines ringing sessions, which this file never does (see the header) —
 * no session can exist on a phone that never finished registering, but the
 * rule is simpler to keep than to argue.
 *
 * So: mark it disposed (the close listener ignores a disposed phone), stop its
 * re-register timer, and close the socket.
 */
function abandon(wp: WebPhone | null): void {
  if (!wp) return;
  const c = wp.sipClient as unknown as { timeoutHandle?: ReturnType<typeof setTimeout>; wsc?: WebSocket };
  try {
    (wp as { disposed: boolean }).disposed = true;
  } catch {
    /* read-only in some future SDK — the close listener's other checks still hold */
  }
  try {
    if (c?.timeoutHandle) clearTimeout(c.timeoutHandle);
  } catch {
    /* no timer */
  }
  try {
    c?.wsc?.close();
  } catch {
    /* never opened */
  }
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e ?? "");
}

class Softphone {
  private readonly tabId = mintUuid();
  private readonly listeners = new Set<() => void>();
  private snapshot: PhoneSnapshot;
  private started = false;

  // Leadership
  private isLeader = false;
  private leaderState: PhoneSnapshot | null = null;
  /** Which tab we are mirroring — a change means a new leader that has never
   *  been told this tab's cards (see `handleMessage`). */
  private leaderTabId: string | null = null;
  private channel: BroadcastChannel | null = null;
  /** This person is an assigned call answerer (set by the host from access.json). */
  private enabled = false;
  /** Ringtone muted in this browser (localStorage, shared by every tab of it).
   *  Distinct from `active.call.muted`, which is the microphone on a live call. */
  private ringMuted = readMuted(storage() ?? NO_STORAGE);

  // Leader-side phone state
  private wp: WebPhone | null = null;
  private registration: RegistrationStatus = "off";
  private registrationError: string | null = null;
  private lastError: string | null = null;
  private registering: Promise<void> | null = null;
  /** One reconnect at a time. The `online` event and a socket's `close` land
   *  together after a network drop, and two `start()`s on one SIP client race
   *  for its single socket slot — each opens a socket and sends on whichever
   *  one the other left behind. */
  private recovering: { wp: WebPhone; p: Promise<void> } | null = null;
  /** Removes the close listener from the socket we are watching. */
  private detachSocket: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private readonly rings = new Map<string, { ring: SipRing; session: Session }>();
  private readonly ignored = new Set<string>();
  private active: { session: Session | null; call: ActiveCall } | null = null;
  private dialToken: symbol | null = null;
  private readonly ringtone = new Ringtone();
  /** The gateway cards THIS tab sees ringing (IncomingCallHost → setCardRings).
   *  Kept in every tab, leader or not, so a tab handed the phone rings at once
   *  instead of waiting for the next SSE update to tell it there is a call. */
  private cardRings: RingLike[] = [];
  /** Leader only: the same, as forwarded by the browser's OTHER tabs. See
   *  tabProtocol's `cards` command for why it is keyed by tab and why every
   *  entry carries a start time. */
  private readonly tabCardRings = new Map<string, RingLike[]>();
  /** Re-checks the ring when its oldest entry ages out of the audible window. */
  private ringExpiryTimer: ReturnType<typeof setTimeout> | null = null;
  /** ⚠️ Public: the gateway's phone-presence rows are keyed on it, so a
   *  browser's report lines up with the same browser's next one (§5.13b).
   *  Stable per browser and never rotated — a new id is a new device to
   *  RingCentral. */
  readonly instanceId = instanceIdFor(storage() ?? NO_STORAGE, mintUuid);

  constructor() {
    this.snapshot = followerView(null, false, this.ringMuted);
  }

  /* ── store contract (useSyncExternalStore) ────────────────────────────── */

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = (): PhoneSnapshot => this.snapshot;

  /** Idempotent. Called by the hook on first mount; safe to call again. */
  start = (): void => {
    if (this.started || typeof window === "undefined") return;
    this.started = true;

    if (typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (ev: MessageEvent) => this.handleMessage(ev.data);
    }
    // A mute flipped in ANOTHER tab of this browser reaches the leader — the
    // tab that is actually making the sound — through the storage event.
    window.addEventListener("storage", (e) => {
      if (e.key === MUTE_KEY || e.key === null) this.onRingMuteChanged(readMuted(storage() ?? NO_STORAGE));
    });
    window.addEventListener("online", () => this.onOnline());
    window.addEventListener("pagehide", () => this.shutdown());
    // ⚠️ Get the audio path open on the first click or keypress, not when the
    // call arrives. A browser keeps an AudioContext suspended until the page
    // has seen a user gesture and `resume()` is asynchronous, so a ringtone
    // that creates its context at ring time spends the opening of a 20-second
    // window asking permission — and in a tab nobody has clicked in, never
    // gets it. `prime()` is a no-op once the context runs, and creates nothing
    // for somebody who is not an assigned answerer.
    for (const ev of ["pointerdown", "keydown", "touchstart"] as const) {
      window.addEventListener(ev, () => this.primeRingtone(), { passive: true });
    }
    onAuthChange(() => this.reconcile());

    this.elect();
    // Ask whoever leads to re-announce, so a tab opened mid-call renders the
    // call rather than a blank placeholder until the next state change.
    this.post({ type: "hello", from: this.tabId });
  };

  /* ── public actions ───────────────────────────────────────────────────── */

  /** The host calls this with `canAnswerCalls(email, config)` whenever access
   *  changes (it polls every 10s), so an assignment made on the admin page
   *  registers — or unregisters — a browser within seconds, no reload. */
  setEnabled = (on: boolean): void => {
    if (on === this.enabled) return;
    this.enabled = on;
    this.publish();
    if (this.isLeader) this.reconcile();
  };

  /**
   * The gateway cards this tab can see ringing (`ringRules.ringingCards`), fed
   * by IncomingCallHost on every SSE update.
   *
   * ⚠️ **This is what makes the browser ring at all in the ordinary case**
   * (§5.13b, 2026-09-28). The chime used to be keyed on the SIP leg, so a card
   * that arrived while this browser was not registered — the line full, a
   * retry in flight, the RingCentral desktop app holding the newest
   * registration — popped in silence. The card is the signal every assigned
   * answerer gets; the leg only decides whether **Answer** works.
   *
   * A follower forwards its set to the leader, which owns the speaker. Posted
   * only when the set really changed: this runs on every SSE update and every
   * patient-name resolution, and a BroadcastChannel message per render is the
   * shape INCIDENT_2026-08-20 was made of.
   */
  setCardRings = (rings: RingLike[]): void => {
    if (sameRings(this.cardRings, rings)) return;
    this.cardRings = rings;
    if (this.isLeader) this.syncRingtone();
    else this.post({ type: "cmd", cmd: "cards", from: this.tabId, rings });
  };

  /**
   * Make THIS tab the browser's phone. Steals the Web Lock; the current
   * leader's lock request rejects with AbortError and it demotes itself
   * (`elect` handles that), releasing its registration. Refused mid-call: a
   * takeover would drop the audio out from under the person talking.
   */
  takeOver = (): void => {
    if (this.isLeader) return;
    if (this.snapshot.call) return;
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) return this.becomeLeader();
    locks
      .request(LOCK_NAME, { mode: "exclusive", steal: true }, () => new Promise<void>(() => this.becomeLeader()))
      .catch((e: unknown) => this.onLockLost(e));
  };

  /** Silence the ringtone in this browser. Cards still show and Answer still
   *  works — this is the speaker, not the assignment. */
  setRingMuted = (on: boolean): void => {
    writeMuted(storage() ?? NO_STORAGE, on);
    this.onRingMuteChanged(on);
  };

  private onRingMuteChanged(on: boolean): void {
    if (on === this.ringMuted) return;
    this.ringMuted = on;
    if (this.isLeader) this.syncRingtone();
    this.publish();
  }

  dismissError = (): void => {
    if (!this.isLeader) return this.post({ type: "cmd", cmd: "dismissError" });
    this.lastError = null;
    this.publish();
  };

  answer = (callId: string): void => {
    if (!this.isLeader) return this.post({ type: "cmd", cmd: "answer", callId });
    void this.doAnswer(callId);
  };

  /** Hide a ring on this browser's screens. LOCAL ONLY — see the header. */
  ignore = (callId: string): void => {
    if (!this.isLeader) return this.post({ type: "cmd", cmd: "ignore", callId });
    this.ignored.add(callId);
    this.syncRingtone();
    this.publish();
  };

  dial = (phone: string): void => {
    if (!phone) return;
    if (!this.isLeader) return this.post({ type: "cmd", cmd: "dial", phone });
    void this.doDial(phone);
  };

  hangup = (): void => {
    if (!this.isLeader) return this.post({ type: "cmd", cmd: "hangup" });
    void this.doHangup();
  };

  toggleMute = (): void => {
    if (!this.isLeader) {
      const cur = this.snapshot.call?.muted ?? false;
      return this.post({ type: "cmd", cmd: "mute", muted: !cur });
    }
    this.setMuted(!(this.active?.call.muted ?? false));
  };

  /* ── leadership ───────────────────────────────────────────────────────── */

  private elect(): void {
    const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
    if (!locks) {
      // No Web Locks: every tab is a leader, all sharing one instanceId. The
      // SDK then rings only the most recently registered tab. Degraded, but
      // never silent — and every current browser has Web Locks.
      this.becomeLeader();
      return;
    }
    locks
      .request(LOCK_NAME, { mode: "exclusive" }, () => new Promise<void>(() => this.becomeLeader()))
      .catch((e: unknown) => this.onLockLost(e));
  }

  /**
   * The lock request settled without us holding the lock. AbortError means
   * another tab STOLE it (takeOver) — step down. Anything else means Web Locks
   * refused to work at all, in which case leading regardless beats silence.
   */
  private onLockLost(e: unknown): void {
    const name = (e as { name?: string } | null)?.name;
    if (name === "AbortError") this.demote();
    else if (!this.isLeader) this.becomeLeader();
  }

  private becomeLeader(): void {
    this.isLeader = true;
    this.leaderState = null;
    this.leaderTabId = null;
    this.reconcile();
    // This tab may have been watching a card ring the whole time it was a
    // follower; now that it owns the speaker, that card has to be audible.
    this.syncRingtone();
    this.publish();
  }

  private demote(): void {
    if (!this.isLeader) return;
    this.isLeader = false;
    this.leaderTabId = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.releaseTimer) clearTimeout(this.releaseTimer);
    this.releaseTimer = null;
    this.release();
    this.active = null;
    this.dialToken = null;
    this.post({ type: "bye", from: this.tabId });
    this.leaderState = null;
    // Re-queue for leadership so this tab takes over again if the thief closes.
    this.elect();
    this.publish();
  }

  private post(msg: TabMessage | TabCommand): void {
    try {
      this.channel?.postMessage(msg);
    } catch {
      /* channel closed */
    }
  }

  private handleMessage(raw: unknown): void {
    if (!isTabMessage(raw)) return;
    switch (raw.type) {
      case "state":
        if (this.isLeader || raw.from === this.tabId) return;
        // A NEW leader (this tab was demoted, or the old leader's tab closed)
        // has never heard this tab's cards, and a follower only posts them
        // when they change — so a call already ringing would be silent in the
        // browser until the next SSE update happened to alter the set.
        if (raw.from !== this.leaderTabId) {
          this.leaderTabId = raw.from;
          if (this.cardRings.length) this.post({ type: "cmd", cmd: "cards", from: this.tabId, rings: this.cardRings });
        }
        this.leaderState = raw.state;
        this.publish();
        return;
      case "hello":
        if (this.isLeader) this.publish();
        return;
      case "bye":
        if (!this.isLeader) {
          this.leaderState = null;
          this.leaderTabId = null;
          this.publish();
        }
        return;
      case "cmd":
        if (!this.isLeader) return;
        this.runCommand(raw);
        return;
    }
  }

  private runCommand(c: TabCommand): void {
    switch (c.cmd) {
      case "answer":
        return void this.doAnswer(c.callId);
      case "ignore":
        return this.ignore(c.callId);
      case "hangup":
        return void this.doHangup();
      case "mute":
        return this.setMuted(c.muted);
      case "dial":
        return void this.doDial(c.phone);
      case "dismissError":
        return this.dismissError();
      case "cards":
        this.tabCardRings.set(c.from, c.rings);
        return this.syncRingtone();
    }
  }

  /* ── registration lifecycle (leader only) ─────────────────────────────── */

  /** Does anything need the registration up right now? */
  private wanted(): boolean {
    return isAuthed() && (this.enabled || !!this.active);
  }

  private reconcile(): void {
    if (!this.isLeader) return;
    if (this.wanted()) {
      if (this.releaseTimer) {
        clearTimeout(this.releaseTimer);
        this.releaseTimer = null;
      }
      if (!this.wp && !this.registering) void this.ensureRegistered();
      return;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.wp && !this.releaseTimer) {
      this.releaseTimer = setTimeout(() => {
        this.releaseTimer = null;
        if (!this.wanted()) this.release();
      }, RELEASE_AFTER_MS);
    }
    if (!this.wp && this.registration !== "off") this.setRegistration("off", null);
  }

  private setRegistration(status: RegistrationStatus, error: string | null = this.registrationError): void {
    this.registration = status;
    this.registrationError = error;
    this.publish();
  }

  private async provision(): Promise<SipInfo> {
    const email = (getUser()?.email || "").toLowerCase();
    const store = storage() ?? NO_STORAGE;
    const cached = readCachedSipInfo(store, email, Date.now());
    if (cached) return cached;
    if (!GATEWAY) throw new Error("Calling needs the Monday gateway (VITE_MONDAY_GATEWAY_URL).");
    const token = getIdToken();
    // A plain fetch waits as long as the connection stays open; a gateway that
    // accepted the request and never answered would hold "registering" for as
    // long as that takes. The abort ends the request itself, not just our wait.
    const ctrl = new AbortController();
    const provisioned = await withDeadline(
      (async () => {
        const res = await fetch(`${GATEWAY}/messaging/sip-provision`, {
          headers: token ? { "X-MM-Auth": token } : {},
          signal: ctrl.signal,
        });
        if (!res.ok) {
          let msg = `Couldn't set up calling (${res.status})`;
          try {
            const j = (await res.json()) as { error?: string; message?: string };
            msg = j.error || j.message || msg;
          } catch {
            /* keep default */
          }
          throw new Error(msg);
        }
        return (await res.json()) as { sipInfo?: SipInfo[] | SipInfo };
      })(),
      PROVISION_DEADLINE_MS,
      PROVISION_TIMEOUT_MESSAGE,
    ).finally(() => ctrl.abort());
    const sipInfo = Array.isArray(provisioned.sipInfo) ? provisioned.sipInfo[0] : provisioned.sipInfo;
    if (!sipInfo) throw new Error("RingCentral returned no SIP credentials for this extension.");
    writeCachedSipInfo(store, email, sipInfo, Date.now());
    return sipInfo;
  }

  private ensureRegistered(): Promise<void> {
    if (this.wp) return Promise.resolve();
    if (this.registering) return this.registering;
    this.registering = (async () => {
      this.setRegistration("registering");
      let wp: WebPhone | null = null;
      try {
        const sipInfo = await this.provision();
        wp = new WebPhone({ sipInfo, instanceId: this.instanceId, autoAnswer: false });
        wp.on("inboundCall", (s: Session) => this.onInbound(s));
        wp.on("outboundCall", (s: Session) => this.onOutbound(s));
        await withDeadline(wp.start(), START_DEADLINE_MS, START_TIMEOUT_MESSAGE);
        // ⚠️ Taken over while this was registering (takeOver): the new leader
        // is registering the same instanceId, and a second live registration
        // would re-REGISTER every ~57s alongside it — "most recently
        // registered" would then rotate between the two tabs and the ring
        // would land in whichever won last. Drop this one quietly.
        if (!this.isLeader) {
          abandon(wp);
          return;
        }
        this.wp = wp;
        this.watchSocket(wp);
        this.attempt = 0;
        this.setRegistration("registered", null);
        // Nothing may want it any more (un-assigned mid-REGISTER): hand it to
        // the ordinary release timer rather than holding a slot for nobody.
        if (!this.wanted()) this.reconcile();
      } catch (err) {
        abandon(wp);
        if (!this.isLeader) return;
        this.onRegistrationFailure(err);
      } finally {
        this.registering = null;
      }
    })();
    return this.registering;
  }

  private onRegistrationFailure(err: unknown): void {
    const kind = classifyRegistrationError(err);
    // ⚠️ NOT `kind === "auth"` any more. The SDK cannot be relied on to give us
    // an auth failure at all — a REFUSED REGISTER hangs exactly like an
    // unanswered one (§5.13b), so it reaches us as our own deadline, whose
    // message classifies as `network`. Keeping the credentials for every
    // non-auth failure is what let a browser retry dead sipInfo every 60s for
    // the seven days of the cache, saying only "Retrying…" (Katie, prod,
    // 2026-09-28). `shouldRefreshCredentials` drops them after three failures
    // in a row and then sparingly, because a provision mints a RingCentral
    // device record and the gateway floors the route (§5.53).
    if (shouldRefreshCredentials(kind, this.attempt)) {
      clearCachedSipInfo(storage() ?? NO_STORAGE);
      // ⚠️ Clearing the CACHE is not enough on its own: a retry that finds a
      // WebPhone still here calls `recover()`, which re-`start()`s that same
      // phone — and its sipInfo was baked in when it was constructed, so the
      // fresh provision would never be read. That is the second shape of the
      // same forever-loop: a browser that registered once, lost the socket,
      // and can never pick up new credentials. Dropping the phone sends the
      // next attempt back through `ensureRegistered()` → `provision()`.
      // ⚠️ Never mid-call — the phone carries the audio.
      if (this.wp && !this.active) {
        abandon(this.wp);
        this.wp = null;
        this.detachSocket?.();
      }
    }
    this.setRegistration(kind === "full" ? "full" : "error", describeRegistrationFailure(kind, err));
    this.scheduleRetry(retryDelayMs(kind, this.attempt++));
  }

  private scheduleRetry(ms: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.isLeader || !this.wanted()) return;
      if (this.wp) void this.recover();
      else void this.ensureRegistered();
    }, ms);
  }

  /**
   * The network came back. A registered phone reconnects (the SDK README's own
   * advice for an outage); one sitting out a backoff after failed attempts
   * tries NOW rather than waiting up to a minute for a timer that was only
   * ever standing in for this event.
   */
  private onOnline(): void {
    if (!this.isLeader) return;
    if (this.wp) {
      void this.recover();
      return;
    }
    if (!this.wanted() || this.registering) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    void this.ensureRegistered();
  }

  /**
   * The SDK does not reconnect on its own (README, "Recover from network
   * outage"): a dropped WebSocket is reported by its `close` event and it is
   * on us to `start()` again. The SDK also closes the socket itself when a
   * REGISTER goes unanswered for 5s, which lands here too.
   *
   * ⚠️ Only the socket the SIP client is USING counts. `start()` opens a new
   * socket and leaves the old one to die, so the old one's close arrives after
   * the reconnect has already succeeded — and used to start another one, which
   * opened another socket, whose predecessor then closed… `recover()` detaches
   * the old listener before it starts, and this check covers the rest.
   */
  private watchSocket(wp: WebPhone): void {
    this.detachSocket?.();
    this.detachSocket = null;
    const wsc = socketOf(wp);
    if (!wsc) return;
    const onClose = () => {
      detach();
      if (wp.disposed || this.wp !== wp) return;
      if (socketOf(wp) !== wsc) return;
      this.setRegistration("registering", "Reconnecting to RingCentral…");
      this.scheduleRetry(retryDelayMs("network", this.attempt++));
    };
    const detach = () => {
      wsc.removeEventListener("close", onClose);
      if (this.detachSocket === detach) this.detachSocket = null;
    };
    wsc.addEventListener("close", onClose);
    this.detachSocket = detach;
  }

  /** Reconnect the existing WebPhone, keeping its call sessions (an answered
   *  call is re-INVITEd afterwards). Bounded and one-at-a-time — see
   *  START_DEADLINE_MS and `recovering`. */
  private recover(): Promise<void> {
    const wp = this.wp;
    if (!wp || !this.isLeader) return Promise.resolve();
    // Joined only when it is reconnecting THIS phone. One left over from a
    // phone this tab has since dropped (demoted, then handed the line back)
    // must not stand in for this one's reconnect: it settles without touching
    // the new phone, and nothing would ever ask again.
    if (this.recovering?.wp === wp) return this.recovering.p;
    const token: { wp: WebPhone; p: Promise<void> } = { wp, p: Promise.resolve() };
    this.recovering = token;
    token.p = (async () => {
      this.detachSocket?.();
      const before = socketOf(wp);
      try {
        await withDeadline(wp.start(), START_DEADLINE_MS, START_TIMEOUT_MESSAGE);
        // ⚠️ Released (un-assigned, signed out) or demoted while this ran. The
        // release's `dispose()` could not stop a `start()` already in flight,
        // so the SIP client has just re-registered and armed its ~57s
        // re-register timer: a rogue registration nothing would ever end.
        if (this.wp !== wp || !this.isLeader) {
          abandon(wp);
          return;
        }
        this.watchSocket(wp);
        this.attempt = 0;
        this.setRegistration("registered", null);
        // A network CHANGE (Wi-Fi to hotspot) leaves an answered call silent
        // until its media is renegotiated.
        if (this.active?.session?.state === "answered") void this.active.session.reInvite?.().catch(() => {});
      } catch (err) {
        // The socket this attempt opened never registered; close it so a late
        // open can't leave a half-built connection behind the retry.
        const opened = socketOf(wp);
        if (opened && opened !== before) {
          try {
            opened.close();
          } catch {
            /* never opened */
          }
        }
        if (this.wp !== wp || !this.isLeader) {
          abandon(wp);
          return;
        }
        this.onRegistrationFailure(err);
      } finally {
        if (this.recovering === token) this.recovering = null;
      }
    })();
    return token.p;
  }

  private release(): void {
    const wp = this.wp;
    this.wp = null;
    this.detachSocket?.();
    this.rings.clear();
    this.ignored.clear();
    // Another tab's forwarded cards are that tab's view of the gateway, not
    // this one's to keep once this tab is out of the speaker's chair.
    this.tabCardRings.clear();
    if (this.ringExpiryTimer) clearTimeout(this.ringExpiryTimer);
    this.ringExpiryTimer = null;
    this.ringtone.stop();
    if (wp) void wp.dispose().catch(() => {});
    this.setRegistration("off", null);
  }

  private shutdown(): void {
    if (!this.isLeader) return;
    this.post({ type: "bye", from: this.tabId });
    const wp = this.wp;
    this.wp = null;
    this.detachSocket?.();
    // Best effort: the unREGISTER may not complete during unload, in which case
    // the SIP server frees the slot when the registration expires (~1 min).
    if (wp) void wp.dispose().catch(() => {});
  }

  /* ── calls (leader only) ──────────────────────────────────────────────── */

  private onInbound(session: Session): void {
    const ring: SipRing = {
      id: session.callId,
      sessionId: session.sessionId || "",
      from: session.remoteNumber || "",
      callerName: session.rcApiCallInfo?.callerIdName || "",
      startedAt: Date.now(),
    };
    this.rings.set(ring.id, { ring, session });
    // Answered elsewhere, or the caller hung up: RingCentral CANCELs this leg
    // and the SDK disposes the session.
    session.once("disposed", () => {
      this.rings.delete(ring.id);
      this.ignored.delete(ring.id);
      if (this.active?.session === session) this.endActive();
      this.syncRingtone();
      this.publish();
    });
    this.syncRingtone();
    this.publish();
  }

  private onOutbound(session: Session): void {
    if (!this.active || this.active.session) return;
    this.active.session = session;
    this.active.call = { ...this.active.call, callId: session.callId };
    session.on("ringing", () => this.patchCall({ status: "ringing" }));
    session.on("answered", () => this.patchCall({ status: "connected", connectedAt: Date.now() }));
    session.once("failed", () => {
      this.lastError = "The call couldn't be connected.";
      this.endActive();
    });
    session.once("disposed", () => {
      if (this.active?.session === session) this.endActive();
    });
    this.publish();
  }

  private async doAnswer(callId: string): Promise<void> {
    const entry = this.rings.get(callId);
    if (!entry) {
      this.lastError = "That call already ended — the caller hung up or somebody else picked it up.";
      this.publish();
      return;
    }
    if (this.active) {
      this.lastError = "Finish your current call before answering another.";
      this.publish();
      return;
    }
    const { ring, session } = entry;
    this.ringtone.stop();
    this.active = {
      session,
      call: { callId, phone: ring.from, direction: "inbound", status: "connecting", connectedAt: null, muted: false },
    };
    this.rings.delete(callId);
    this.ignored.delete(callId);
    // ⚠️ The GATEWAY's card for this call can still read "ringing" for a beat
    // after we answer it, and the ringtone now follows the card — so without
    // this, hanging up a short call could be followed by a chime at the call
    // that just ended. The id is the telephony session, the gateway's own key.
    if (ring.sessionId) this.ignored.add(ring.sessionId);
    this.publish();
    session.once("answered", () => this.patchCall({ status: "connected", connectedAt: Date.now() }));
    try {
      if (!session.answer) throw new Error("This call can't be answered here.");
      // See the header: resolved by an RC message that may never arrive, so it
      // is watched for rejection only. A rejection this early is the mic.
      void session.answer().catch((e: unknown) => this.answerFailed(session, e));
    } catch (e) {
      this.answerFailed(session, e);
    }
  }

  private answerFailed(session: Session, e: unknown): void {
    if (this.active?.session !== session || this.active.call.status === "connected") return;
    const text = errorText(e);
    this.lastError = /permission|notallowed|denied|getusermedia|device/i.test(text)
      ? "Your browser blocked the microphone. Allow it for this site and answer again."
      : `Couldn't answer: ${text || "unknown error"}`;
    this.endActive();
  }

  private async doDial(phone: string): Promise<void> {
    if (this.active) {
      this.lastError = "Finish your current call first.";
      this.publish();
      return;
    }
    const token = Symbol("dial");
    this.dialToken = token;
    this.lastError = null;
    this.active = {
      session: null,
      call: { callId: "", phone, direction: "outbound", status: "connecting", connectedAt: null, muted: false },
    };
    this.publish();
    try {
      await this.ensureRegistered();
      // A reconnect in flight owns the socket this call would go out on.
      if (this.recovering && this.recovering.wp === this.wp) await this.recovering.p;
      // Hung up while we were still registering.
      if (this.dialToken !== token || !this.active) return;
      // ⚠️ A phone that is reconnecting — or failed to, and is waiting to try
      // again — has no socket that will answer an INVITE, and the SDK waits for
      // that answer with no timeout: the overlay would sit on "Setting up…"
      // for ever. Say why instead.
      if (!this.wp || this.registration !== "registered") {
        throw new Error(this.registrationError || "Browser calling isn't available right now.");
      }
      // ⚠️ The INVITE can go unanswered with nothing to reject: a silently
      // dead socket, or an edge that swallows it (Brandon's 2026-09-25 dial —
      // no telephony session ever existed at RingCentral). The watchdog is the
      // only thing that ends that state; see DIAL_PROGRESS_DEADLINE_MS.
      this.armDialWatchdog(token, this.wp);
      // callerId is passed EXPLICITLY: every call must reach the patient as
      // the MM main line, never the extension's own default.
      await this.wp.call(phone, mmPhoneNumber());
      // ⚠️ A SIP 403 makes the SDK's call() RESOLVE with the session still in
      // "init" — no "failed" event, no state change (outbound.ts:
      // `if (subject.startsWith("SIP/2.0 403 ")) return;`). Without this the
      // overlay sits on "Setting up…" for ever on a perfectly healthy socket.
      if (this.dialToken === token && this.active?.call.status === "connecting") {
        this.failDial(token, "RingCentral refused the call. Try again in a moment.", false);
      }
    } catch (e) {
      if (this.dialToken !== token) return;
      this.lastError = errorText(e) || "The call couldn't be connected.";
      this.endActive();
    }
  }

  /**
   * Give up on a dial that is showing no signs of life. `suspectSocket` says
   * whether the silence indicts the CONNECTION (an INVITE nothing answered ⇒
   * re-check the socket via the bounded `recover()`) or only the call (a 403 —
   * the socket demonstrably answered).
   */
  private failDial(token: symbol, message: string, suspectSocket: boolean): void {
    if (this.dialToken !== token || !this.active) return;
    const s = this.active.session;
    const wp = this.wp;
    this.lastError = message;
    this.endActive();
    // Local teardown only — a network goodbye to a dialog that never formed
    // would just be another unanswerable request.
    if (s) {
      try {
        s.dispose?.();
      } catch {
        /* already down */
      }
    }
    if (suspectSocket && wp && this.wp === wp) void this.recover();
  }

  /**
   * The only thing that ends a dial neither answered nor failed — see
   * DIAL_PROGRESS_DEADLINE_MS. Fire-and-check rather than managed: the token
   * and status re-checks make a stale timer a no-op, so nothing has to clear it.
   */
  private armDialWatchdog(token: symbol, wp: WebPhone): void {
    setTimeout(() => {
      if (this.dialToken !== token || !this.active) return;
      if (this.active.call.status !== "connecting") return;
      if (this.wp !== wp) return;
      this.failDial(token, DIAL_DEAD_MESSAGE, true);
    }, DIAL_PROGRESS_DEADLINE_MS);
  }

  private async doHangup(): Promise<void> {
    const cur = this.active;
    if (!cur) return;
    this.dialToken = null;
    const s = cur.session;
    if (!s) {
      this.endActive();
      return;
    }
    this.patchCall({ status: "ending" });
    const wp = this.wp;
    let acked = true;
    try {
      // ⚠️ BOUNDED — see HANGUP_DEADLINE_MS. The SDK's cancel()/hangup() await
      // a SIP reply with no timeout and no rejection path, so on a socket that
      // has silently died this await never settles and the overlay sat on
      // "Hanging up…" for 20+ minutes (Brandon, 2026-09-25).
      //
      // An outbound call that never reached "answered" is torn down with
      // CANCEL, not BYE: there is no established dialog to BYE, and on a
      // session still in "init" cancel() throws synchronously (no remote peer
      // yet) — an immediate local cleanup, where hangup() would build a BYE
      // from undefined headers and wait the whole deadline on it.
      await withDeadline(
        (async () => {
          if (s.direction === "outbound" && s.state !== "answered" && s.cancel) await s.cancel();
          else await s.hangup();
        })(),
        HANGUP_DEADLINE_MS,
        HANGUP_TIMEOUT_MESSAGE,
      );
    } catch (e) {
      acked = !(e instanceof Error && e.message === HANGUP_TIMEOUT_MESSAGE);
      /* the call is going away either way */
    }
    if (this.active === cur) this.endActive();
    if (!acked) {
      // Nothing answered the teardown, so nothing will answer anything else on
      // this dialog: end it locally, and re-check the connection it happened
      // on — recover() is bounded (START_DEADLINE_MS) and one-at-a-time.
      try {
        s.dispose?.();
      } catch {
        /* already down */
      }
      if (wp && this.wp === wp) void this.recover();
    }
  }

  private setMuted(muted: boolean): void {
    const s = this.active?.session;
    if (!s || !this.active) return;
    try {
      if (muted) s.mute();
      else s.unmute();
      this.patchCall({ muted });
    } catch {
      /* leave the flag alone if the SDK refused */
    }
  }

  private patchCall(patch: Partial<ActiveCall>): void {
    if (!this.active) return;
    this.active.call = { ...this.active.call, ...patch };
    this.publish();
  }

  private endActive(): void {
    this.active = null;
    this.dialToken = null;
    this.syncRingtone();
    this.publish();
    this.reconcile();
  }

  /** Called from the first user gesture in the page — see `start()`. */
  private primeRingtone(): void {
    if (!this.enabled) return;
    this.ringtone.prime();
  }

  /**
   * Is anything ringing that should be audible, and is this the tab that makes
   * the sound?
   *
   * ⚠️ **The ring follows the CARD, not only the SIP leg** (ringRules.ts).
   * Three sources are joined and de-duplicated by id: this browser's SIP legs,
   * this tab's gateway cards, and the cards every other tab forwarded. Whoever
   * heard about the call makes the browser ring; the leader is the only tab
   * that plays it, because one browser makes one sound.
   */
  private syncRingtone(): void {
    if (this.ringExpiryTimer) clearTimeout(this.ringExpiryTimer);
    this.ringExpiryTimer = null;
    // A tab that has just been demoted still has a chime in the air.
    if (!this.isLeader) return this.ringtone.stop();
    const now = Date.now();
    const all: RingLike[] = [
      ...[...this.rings.values()].map((r) => r.ring),
      ...this.cardRings,
      ...[...this.tabCardRings.values()].flat(),
    ];
    // A dismissed SIP leg clears its own entry when the session is disposed; a
    // dismissed CARD has nothing to clean it, so `ignored` would grow for the
    // life of the tab. Anything nobody is still reporting has nothing left to
    // silence — and a card re-pushed later (the gateway re-sends a stranded
    // ring to every new stream, §5.13) is already past the audible window.
    for (const id of this.ignored) if (!all.some((r) => r.id === id)) this.ignored.delete(id);
    const audible = audibleRings(all, this.ignored, now);
    if (audible.length && !this.active && !this.ringMuted) {
      this.ringtone.start();
      // One timer for the whole list, re-armed on every change, so a ring that
      // ages out of the window goes quiet without anything polling for it.
      const left = nextExpiryMs(audible, now);
      if (left !== null) this.ringExpiryTimer = setTimeout(() => this.syncRingtone(), left + 250);
    } else {
      this.ringtone.stop();
    }
  }

  /* ── snapshot ─────────────────────────────────────────────────────────── */

  private publish(): void {
    if (this.isLeader) {
      this.snapshot = {
        leader: true,
        enabled: this.enabled,
        ringMuted: this.ringMuted,
        registration: this.registration,
        registrationError: this.registrationError,
        lastError: this.lastError,
        rings: [...this.rings.values()].filter((r) => !this.ignored.has(r.ring.id)).map((r) => r.ring),
        call: this.active ? this.active.call : null,
      };
      this.post({ type: "state", from: this.tabId, state: this.snapshot });
    } else {
      this.snapshot = followerView(this.leaderState, this.enabled, this.ringMuted);
    }
    for (const fn of this.listeners) fn();
  }
}

/** The one phone per tab. Module scope so every hook and host shares it. */
export const softphone = new Softphone();
