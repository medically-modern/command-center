/**
 * "It keeps saying connecting to RingCentral but never connects" (Josh,
 * 2026-09-23). The RingCentral SDK's `start()` can never settle: its REGISTER
 * wait has no rejection path, and its own 5s guard CLOSES THE SOCKET instead of
 * failing the promise (sip-client.mjs `register()` → `request()`). Before the
 * deadline, one unanswered REGISTER left this store on "registering" for good —
 * no failure ever came to schedule a retry.
 *
 * The SDK is replaced with a fake whose `start()` behaves however each test
 * says, so the hang is reproduced exactly: a promise that never settles.
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

type StartBehavior = (phone: FakeWebPhone) => Promise<void>;

const fakes = vi.hoisted(() => ({
  phones: [] as unknown[],
  startBehavior: null as null | ((phone: unknown) => Promise<void>),
}));

class FakeWebPhone {
  disposed = false;
  sipClient: { wsc?: FakeSocket; timeoutHandle?: ReturnType<typeof setTimeout> } = {};
  starts = 0;
  sockets: FakeSocket[] = [];
  calls = 0;
  constructor(public readonly opts: unknown) {
    fakes.phones.push(this);
  }
  on() {}
  removeAllListeners() {}
  /** Like the SDK: every start() opens a NEW socket and leaves the old one. */
  start() {
    this.starts++;
    const s = new FakeSocket();
    this.sockets.push(s);
    this.sipClient.wsc = s;
    return (fakes.startBehavior as StartBehavior)(this);
  }
  dispose() {
    this.disposed = true;
    return Promise.resolve();
  }
  call() {
    this.calls++;
    return new Promise(() => {});
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

const HANG: StartBehavior = () => new Promise<void>(() => {});
const OK: StartBehavior = () => Promise.resolve();

async function freshPhone() {
  vi.resetModules();
  const mod = await import("./softphone");
  const { softphone } = mod;
  softphone.start();
  return { softphone, mod };
}

const phoneAt = (i: number) => fakes.phones[i] as FakeWebPhone;

// Every test imports a fresh store, and each one hangs its `online` / `pagehide`
// listeners on the ONE jsdom window. Left attached, an earlier test's phone
// would answer this test's `online` event and spend its start() calls.
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
  fakes.startBehavior = HANG as (phone: unknown) => Promise<void>;
  // Another "tab" of an earlier test must not reach this one.
  vi.stubGlobal("BroadcastChannel", undefined);
  // A cached provision, so these tests never touch the gateway.
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

describe("a registration that RingCentral never answers", () => {
  it("is abandoned at the deadline and retried — never left on registering", async () => {
    const { softphone, mod } = await freshPhone();
    softphone.setEnabled(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(softphone.getSnapshot().registration).toBe("registering");
    expect(fakes.phones).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(mod.START_DEADLINE_MS);
    const snap = softphone.getSnapshot();
    expect(snap.registration).toBe("error");
    expect(snap.registrationError).toMatch(/Can't reach RingCentral's phone server/);
    // Closed without the SDK's dispose(): no unREGISTER on a dead socket.
    expect(phoneAt(0).sockets[0].closed).toBe(true);
    expect(phoneAt(0).disposed).toBe(true);

    // The network ladder's first rung is 2s; a fresh WebPhone tries again.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fakes.phones).toHaveLength(2);
    expect(softphone.getSnapshot().registration).toBe("registering");
  });

  it("a reconnect that hangs is given up too — the phone does not sit on 'Reconnecting…'", async () => {
    let n = 0;
    fakes.startBehavior = (() => (n++ === 0 ? OK : HANG)(undefined as never)) as (phone: unknown) => Promise<void>;
    const { softphone, mod } = await freshPhone();
    softphone.setEnabled(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(softphone.getSnapshot().registration).toBe("registered");

    // The SDK closes the socket after an unanswered re-REGISTER.
    phoneAt(0).sockets[0].close();
    expect(softphone.getSnapshot().registration).toBe("registering");
    expect(softphone.getSnapshot().registrationError).toBe("Reconnecting to RingCentral…");

    await vi.advanceTimersByTimeAsync(2_000); // the retry → recover() → start() hangs
    expect(phoneAt(0).starts).toBe(2);
    expect(softphone.getSnapshot().registration).toBe("registering");

    await vi.advanceTimersByTimeAsync(mod.START_DEADLINE_MS);
    expect(softphone.getSnapshot().registration).toBe("error");
    // The socket the failed attempt opened is closed rather than left half-built.
    expect(phoneAt(0).sockets[1].closed).toBe(true);

    // …and the ladder keeps going (attempt 2 → 4s).
    await vi.advanceTimersByTimeAsync(4_000);
    expect(phoneAt(0).starts).toBe(3);
  });
});

describe("reconnects that used to start more reconnects", () => {
  it("the old socket's close, after start() replaced it, is ignored", async () => {
    fakes.startBehavior = OK as (phone: unknown) => Promise<void>;
    const { softphone } = await freshPhone();
    softphone.setEnabled(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(softphone.getSnapshot().registration).toBe("registered");

    // The network came back: the SDK README's recovery opens a NEW socket and
    // leaves the old one to die.
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(phoneAt(0).starts).toBe(2);
    expect(softphone.getSnapshot().registration).toBe("registered");

    // The superseded socket finally closes. That is not the connection any more.
    phoneAt(0).sockets[0].close();
    expect(softphone.getSnapshot().registration).toBe("registered");
    await vi.advanceTimersByTimeAsync(120_000);
    expect(phoneAt(0).starts).toBe(2);
  });

  it("an online event and a socket close in the same moment share ONE reconnect", async () => {
    let n = 0;
    let finish: () => void = () => {};
    fakes.startBehavior = (() => {
      if (n++ === 0) return Promise.resolve();
      return new Promise<void>((r) => {
        finish = r;
      });
    }) as (phone: unknown) => Promise<void>;
    const { softphone } = await freshPhone();
    softphone.setEnabled(true);
    await vi.advanceTimersByTimeAsync(0);

    window.dispatchEvent(new Event("online")); // reconnect #1, in flight
    await vi.advanceTimersByTimeAsync(0);
    expect(phoneAt(0).starts).toBe(2);
    // A second trigger while it is in flight joins it instead of opening
    // another socket on the same SIP client.
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(phoneAt(0).starts).toBe(2);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(softphone.getSnapshot().registration).toBe("registered");
  });
});

describe("a dial while the line is down", () => {
  it("ends with the reason instead of waiting on an INVITE nobody will answer", async () => {
    fakes.startBehavior = OK as (phone: unknown) => Promise<void>;
    const { softphone } = await freshPhone();
    softphone.setEnabled(true);
    await vi.advanceTimersByTimeAsync(0);
    phoneAt(0).sockets[0].close(); // "Reconnecting to RingCentral…", retry pending

    softphone.dial("5555550123");
    await vi.advanceTimersByTimeAsync(0);
    const snap = softphone.getSnapshot();
    expect(snap.call).toBeNull();
    expect(snap.lastError).toBe("Reconnecting to RingCentral…");
    expect(phoneAt(0).calls).toBe(0);
  });

  it("a dial on a healthy line still goes out", async () => {
    fakes.startBehavior = OK as (phone: unknown) => Promise<void>;
    const { softphone } = await freshPhone();
    softphone.setEnabled(true);
    await vi.advanceTimersByTimeAsync(0);
    softphone.dial("5555550123");
    await vi.advanceTimersByTimeAsync(0);
    expect(phoneAt(0).calls).toBe(1);
  });
});

describe("a reconnect is tied to the phone it reconnects", () => {
  it("a tab handed the line back does not wait on the reconnect of the phone it dropped", async () => {
    // Web Locks, faked: every request is granted at once, and a test can make
    // an earlier grant reject with AbortError — what the browser does when
    // another tab steals the lock (takeOver).
    const grants: Array<(e: unknown) => void> = [];
    const locks = {
      request(_name: string, _opts: unknown, cb: () => Promise<void>) {
        return new Promise<void>((_resolve, reject) => {
          grants.push(reject);
          void cb();
        });
      },
    };
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    try {
      fakes.startBehavior = ((phone: FakeWebPhone) =>
        phone === phoneAt(0) && phone.starts > 1 ? HANG(phone) : OK(phone)) as (phone: unknown) => Promise<void>;
      const { softphone } = await freshPhone();
      softphone.setEnabled(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(softphone.getSnapshot().registration).toBe("registered");

      // Phone 0 loses its socket and starts a reconnect that will never answer.
      phoneAt(0).sockets[0].close();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(phoneAt(0).starts).toBe(2);

      // Another tab steals the line and hands it straight back: this tab
      // demotes, re-queues, is granted again and registers a NEW phone.
      const err = Object.assign(new Error("stolen"), { name: "AbortError" });
      grants[0](err);
      await vi.advanceTimersByTimeAsync(0);
      expect(fakes.phones).toHaveLength(2);
      expect(softphone.getSnapshot().registration).toBe("registered");

      // The new phone's socket drops while phone 0's reconnect is still hanging.
      phoneAt(1).sockets[0].close();
      await vi.advanceTimersByTimeAsync(2_000);
      // ⚠️ It reconnects ITSELF — it does not join phone 0's dead reconnect,
      // which would settle without touching it and leave nobody to ask again.
      expect(phoneAt(1).starts).toBe(2);
      expect(softphone.getSnapshot().registration).toBe("registered");
    } finally {
      delete (navigator as unknown as { locks?: unknown }).locks;
    }
  });
});
