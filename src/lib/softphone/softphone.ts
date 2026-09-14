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
  classifyRegistrationError,
  clearCachedSipInfo,
  describeRegistrationFailure,
  instanceIdFor,
  readCachedSipInfo,
  readMuted,
  retryDelayMs,
  writeCachedSipInfo,
  writeMuted,
} from "./registration";
import { CHANNEL_NAME, LOCK_NAME, followerView, isTabMessage, type TabCommand, type TabMessage } from "./tabProtocol";
import { Ringtone } from "./ringtone";
import type { ActiveCall, PhoneSnapshot, RegistrationStatus, SipRing } from "./types";

const GATEWAY =
  (import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined)?.replace(/\/+$/, "") || "";

/** How long an ended call keeps the registration up when browser answering is
 *  off — a rep who redials a minute later shouldn't wait on a fresh REGISTER. */
const RELEASE_AFTER_MS = 30_000;

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
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private readonly rings = new Map<string, { ring: SipRing; session: Session }>();
  private readonly ignored = new Set<string>();
  private active: { session: Session | null; call: ActiveCall } | null = null;
  private dialToken: symbol | null = null;
  private readonly ringtone = new Ringtone();
  private readonly instanceId = instanceIdFor(storage() ?? NO_STORAGE, mintUuid);

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
    window.addEventListener("online", () => void this.recover());
    window.addEventListener("pagehide", () => this.shutdown());
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
    this.reconcile();
    this.publish();
  }

  private demote(): void {
    if (!this.isLeader) return;
    this.isLeader = false;
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
        this.leaderState = raw.state;
        this.publish();
        return;
      case "hello":
        if (this.isLeader) this.publish();
        return;
      case "bye":
        if (!this.isLeader) {
          this.leaderState = null;
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
    const res = await fetch(`${GATEWAY}/messaging/sip-provision`, {
      headers: token ? { "X-MM-Auth": token } : {},
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
    const provisioned = (await res.json()) as { sipInfo?: SipInfo[] | SipInfo };
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
        await wp.start();
        this.wp = wp;
        this.watchSocket(wp);
        this.attempt = 0;
        this.setRegistration("registered", null);
      } catch (err) {
        try {
          socketOf(wp)?.close();
        } catch {
          /* never opened */
        }
        this.onRegistrationFailure(err);
      } finally {
        this.registering = null;
      }
    })();
    return this.registering;
  }

  private onRegistrationFailure(err: unknown): void {
    const kind = classifyRegistrationError(err);
    if (kind === "auth") clearCachedSipInfo(storage() ?? NO_STORAGE);
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
   * The SDK does not reconnect on its own (README, "Recover from network
   * outage"): a dropped WebSocket is reported by its `close` event and it is
   * on us to `start()` again. The SDK also closes the socket itself when a
   * REGISTER goes unanswered for 5s, which lands here too.
   */
  private watchSocket(wp: WebPhone): void {
    const wsc = socketOf(wp);
    if (!wsc) return;
    const onClose = () => {
      wsc.removeEventListener("close", onClose);
      if (wp.disposed || this.wp !== wp) return;
      this.setRegistration("registering", "Reconnecting to RingCentral…");
      this.scheduleRetry(retryDelayMs("network", this.attempt++));
    };
    wsc.addEventListener("close", onClose);
  }

  private async recover(): Promise<void> {
    const wp = this.wp;
    if (!wp || !this.isLeader) return;
    try {
      await wp.start();
      this.watchSocket(wp);
      this.attempt = 0;
      this.setRegistration("registered", null);
      // A network CHANGE (Wi-Fi to hotspot) leaves an answered call silent
      // until its media is renegotiated.
      if (this.active?.session?.state === "answered") void this.active.session.reInvite?.().catch(() => {});
    } catch (err) {
      this.onRegistrationFailure(err);
    }
  }

  private release(): void {
    const wp = this.wp;
    this.wp = null;
    this.rings.clear();
    this.ignored.clear();
    this.ringtone.stop();
    if (wp) void wp.dispose().catch(() => {});
    this.setRegistration("off", null);
  }

  private shutdown(): void {
    if (!this.isLeader) return;
    this.post({ type: "bye", from: this.tabId });
    const wp = this.wp;
    this.wp = null;
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
      // Hung up while we were still registering.
      if (this.dialToken !== token || !this.active) return;
      if (!this.wp) throw new Error(this.registrationError || "Browser calling isn't available right now.");
      // callerId is passed EXPLICITLY: every call must reach the patient as
      // the MM main line, never the extension's own default.
      await this.wp.call(phone, mmPhoneNumber());
    } catch (e) {
      if (this.dialToken !== token) return;
      this.lastError = errorText(e) || "The call couldn't be connected.";
      this.endActive();
    }
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
    try {
      if (s.direction === "outbound" && s.state === "ringing" && s.cancel) await s.cancel();
      else await s.hangup();
    } catch {
      /* the call is going away either way */
    }
    if (this.active === cur) this.endActive();
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

  private syncRingtone(): void {
    const ringing = [...this.rings.keys()].some((id) => !this.ignored.has(id));
    if (ringing && !this.active && !this.ringMuted) this.ringtone.start();
    else this.ringtone.stop();
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
