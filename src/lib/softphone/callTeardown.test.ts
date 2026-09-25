/**
 * "i tried calling and it said setting up... then i tried hanging up and now
 * it's stuck" — 20+ minutes on "Hanging up…" (Brandon, 2026-09-25, one dial,
 * 8:43 AM ET; the gateway saw his provision land and RingCentral never opened
 * a telephony session for the INVITE).
 *
 * The SDK gives a dial THREE ways to never settle, and this store must bound
 * every one:
 *  · `call()` awaits the INVITE's answer with no timeout — a dead socket or a
 *    swallowed INVITE leaves it pending for ever (the dial watchdog's case);
 *  · a SIP 403 makes `call()` RESOLVE with the session still in "init" and no
 *    "failed" event (outbound.ts returns early on the 403 status line);
 *  · `cancel()` / `hangup()` await a SIP reply with no timeout either — the
 *    stuck "Hanging up…" itself.
 *
 * Same harness as registrationDeadline.test.ts — the SDK replaced with a fake
 * whose start()/call()/cancel()/hangup() behave however each test says.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeSocket extends EventTarget {
  readyState = 1;
  closed = false;
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

class FakeSession {
  callId = "call-1";
  remoteNumber = "+15555550123";
  state = "init";
  direction = "outbound";
  disposedCount = 0;
  cancelCalls = 0;
  hangupCalls = 0;
  cancelBehavior: () => Promise<void> = () => new Promise(() => {});
  hangupBehavior: () => Promise<void> = () => new Promise(() => {});
  private handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  on(ev: string, fn: (...a: unknown[]) => void) {
    const list = this.handlers.get(ev) ?? [];
    list.push(fn);
    this.handlers.set(ev, list);
  }
  once(ev: string, fn: (...a: unknown[]) => void) {
    const wrapped = (...a: unknown[]) => {
      const list = this.handlers.get(ev) ?? [];
      this.handlers.set(
        ev,
        list.filter((f) => f !== wrapped),
      );
      fn(...a);
    };
    this.on(ev, wrapped);
  }
  emit(ev: string, ...a: unknown[]) {
    for (const fn of [...(this.handlers.get(ev) ?? [])]) fn(...a);
  }
  cancel() {
    this.cancelCalls++;
    return this.cancelBehavior();
  }
  hangup() {
    this.hangupCalls++;
    return this.hangupBehavior();
  }
  /** Local teardown only, like the SDK's: closes the RTC peer, emits disposed. */
  dispose() {
    this.disposedCount++;
    this.state = "disposed";
    this.emit("disposed");
  }
  mute() {}
  unmute() {}
}

type CallBehavior = (phone: FakeWebPhone) => Promise<void>;

const fakes = vi.hoisted(() => ({
  phones: [] as unknown[],
  sessions: [] as unknown[],
  callBehavior: null as null | ((phone: unknown) => Promise<void>),
}));

class FakeWebPhone {
  disposed = false;
  sipClient: { wsc?: FakeSocket } = {};
  starts = 0;
  sockets: FakeSocket[] = [];
  calls = 0;
  private handlers = new Map<string, Array<(...a: unknown[]) => void>>();
  constructor(public readonly opts: unknown) {
    fakes.phones.push(this);
  }
  on(ev: string, fn: (...a: unknown[]) => void) {
    const list = this.handlers.get(ev) ?? [];
    list.push(fn);
    this.handlers.set(ev, list);
  }
  removeAllListeners() {
    this.handlers.clear();
  }
  emit(ev: string, ...a: unknown[]) {
    for (const fn of [...(this.handlers.get(ev) ?? [])]) fn(...a);
  }
  start() {
    this.starts++;
    const s = new FakeSocket();
    this.sockets.push(s);
    this.sipClient.wsc = s;
    return Promise.resolve();
  }
  dispose() {
    this.disposed = true;
    return Promise.resolve();
  }
  /** Like the SDK: emits `outboundCall` with the session, THEN awaits the
   *  INVITE's fate — which is whatever the test says it is. */
  call() {
    this.calls++;
    return (fakes.callBehavior as CallBehavior)(this);
  }
  emitOutbound(): FakeSession {
    const s = new FakeSession();
    fakes.sessions.push(s);
    this.emit("outboundCall", s);
    return s;
  }
}

vi.mock("ringcentral-web-phone", () => ({ default: FakeWebPhone }));
vi.mock("@/lib/shared/auth", () => ({
  getIdToken: () => "test-token",
  getUser: () => ({ email: "rep@example.com" }),
  isAuthed: () => true,
  onAuthChange: () => () => {},
}));
vi.mock("@/lib/fax/ringcentralApi", () => ({ mmPhoneNumber: () => "+15555550100" }));

/** The INVITE goes out and nothing ever answers it — Brandon's dial. */
const NEVER: CallBehavior = (p) => {
  p.emitOutbound();
  return new Promise(() => {});
};
/** A SIP 403: call() RESOLVES, the session stays in "init", no event fires. */
const REFUSED: CallBehavior = (p) => {
  p.emitOutbound();
  return Promise.resolve();
};

async function readyPhone() {
  vi.resetModules();
  const mod = await import("./softphone");
  const { softphone } = mod;
  softphone.start();
  softphone.setEnabled(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(softphone.getSnapshot().registration).toBe("registered");
  return { softphone, mod };
}

const phoneAt = (i: number) => fakes.phones[i] as FakeWebPhone;
const sessionAt = (i: number) => fakes.sessions[i] as FakeSession;

let added: Array<[string, EventListenerOrEventListenerObject]> = [];
const realAdd = window.addEventListener.bind(window);

beforeEach(() => {
  added = [];
  vi.spyOn(window, "addEventListener").mockImplementation(((
    type: string,
    fn: EventListenerOrEventListenerObject,
    opts?: boolean | AddEventListenerOptions,
  ) => {
    added.push([type, fn]);
    realAdd(type, fn, opts);
  }) as typeof window.addEventListener);
  vi.useFakeTimers();
  fakes.phones.length = 0;
  fakes.sessions.length = 0;
  fakes.callBehavior = NEVER as (phone: unknown) => Promise<void>;
  vi.stubGlobal("BroadcastChannel", undefined);
  localStorage.setItem(
    "mm-softphone-sip",
    JSON.stringify({
      email: "rep@example.com",
      at: Date.now(),
      sipInfo: { username: "u", domain: "sip.example.test", outboundProxy: "proxy.example.test:8083" },
    }),
  );
});

afterEach(() => {
  for (const [type, fn] of added) window.removeEventListener(type, fn);
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("a dial RingCentral never answers", () => {
  it("the watchdog ends it — never 'Setting up…' for ever", async () => {
    const { softphone, mod } = await readyPhone();
    softphone.dial("5555550123");
    await vi.advanceTimersByTimeAsync(0);
    expect(softphone.getSnapshot().call?.status).toBe("connecting");

    await vi.advanceTimersByTimeAsync(mod.DIAL_PROGRESS_DEADLINE_MS);
    const snap = softphone.getSnapshot();
    expect(snap.call).toBeNull();
    expect(snap.lastError).toMatch(/didn't respond to the call attempt/);
    // Local teardown only — no network goodbye to a dialog that never formed.
    expect(sessionAt(0).disposedCount).toBe(1);
    expect(sessionAt(0).cancelCalls).toBe(0);
    // …and the silence indicts the SOCKET: recover() re-checked the line.
    expect(phoneAt(0).starts).toBe(2);
    expect(snap.registration).toBe("registered");
  });

  it("a silent SIP 403 fails the dial at once — call() resolved, the session sat in 'init'", async () => {
    fakes.callBehavior = REFUSED as (phone: unknown) => Promise<void>;
    const { softphone } = await readyPhone();
    softphone.dial("5555550123");
    await vi.advanceTimersByTimeAsync(0);
    const snap = softphone.getSnapshot();
    expect(snap.call).toBeNull();
    expect(snap.lastError).toMatch(/refused the call/);
    expect(sessionAt(0).disposedCount).toBe(1);
    // The socket demonstrably answered (it carried the 403): no recover().
    expect(phoneAt(0).starts).toBe(1);
  });
});

describe("a hang-up RingCentral never acknowledges", () => {
  it("an unanswered outbound call is CANCELled, bounded, disposed, and the line re-checked", async () => {
    const { softphone, mod } = await readyPhone();
    softphone.dial("5555550123");
    await vi.advanceTimersByTimeAsync(0);

    softphone.hangup();
    await vi.advanceTimersByTimeAsync(0);
    // cancel(), never hangup(): there is no established dialog to BYE.
    expect(sessionAt(0).cancelCalls).toBe(1);
    expect(sessionAt(0).hangupCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(mod.HANGUP_DEADLINE_MS);
    const snap = softphone.getSnapshot();
    expect(snap.call).toBeNull(); // never "Hanging up…" for 20 minutes again
    expect(sessionAt(0).disposedCount).toBe(1);
    expect(phoneAt(0).starts).toBe(2); // nothing answered the teardown ⇒ recover()
    // …and the dial watchdog, later, is a spent token — not a third recover.
    await vi.advanceTimersByTimeAsync(mod.DIAL_PROGRESS_DEADLINE_MS);
    expect(phoneAt(0).starts).toBe(2);
  });

  it("an ANSWERED call is torn down with hangup(), bounded the same way", async () => {
    const { softphone, mod } = await readyPhone();
    softphone.dial("5555550123");
    await vi.advanceTimersByTimeAsync(0);
    const s = sessionAt(0);
    s.state = "answered";
    s.emit("answered");
    expect(softphone.getSnapshot().call?.status).toBe("connected");

    softphone.hangup();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.hangupCalls).toBe(1);
    expect(s.cancelCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(mod.HANGUP_DEADLINE_MS);
    expect(softphone.getSnapshot().call).toBeNull();
    expect(s.disposedCount).toBe(1);
    expect(phoneAt(0).starts).toBe(2);
  });

  it("a hang-up that ACKS promptly neither disposes nor recovers — the ordinary case costs nothing", async () => {
    const { softphone } = await readyPhone();
    softphone.dial("5555550123");
    await vi.advanceTimersByTimeAsync(0);
    const s = sessionAt(0);
    s.cancelBehavior = () => Promise.resolve();

    softphone.hangup();
    await vi.advanceTimersByTimeAsync(0);
    expect(softphone.getSnapshot().call).toBeNull();
    expect(s.disposedCount).toBe(0);
    expect(phoneAt(0).starts).toBe(1);
  });
});
