import { describe, it, expect } from "vitest";
import {
  FULL_RETRY_MS,
  INSTANCE_ID_KEY,
  PROVISION_TIMEOUT_MESSAGE,
  SIP_INFO_TTL_MS,
  START_TIMEOUT_MESSAGE,
  classifyRegistrationError,
  clearCachedSipInfo,
  describeRegistrationFailure,
  instanceIdFor,
  readCachedSipInfo,
  readMuted,
  retryDelayMs,
  shouldRefreshCredentials,
  type StorageLike,
  writeCachedSipInfo,
  writeMuted,
} from "./registration";

function memStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const SIP = {
  authorizationId: "802000",
  domain: "sip.ringcentral.com",
  outboundProxy: "sip-wss.ringcentral.com:8083",
  outboundProxyBackup: "sip-wss-backup.ringcentral.com:8083",
  username: "17325550100",
  password: "secret",
  stunServers: ["stun.ringcentral.com:19302"],
};

describe("classifyRegistrationError — the 5-device cap is a STATE, not a fault", () => {
  it("reads the SDK's refused REGISTER as full", () => {
    // sip-client.mjs throws `Registration failed: <SIP status line>`.
    expect(classifyRegistrationError(new Error("Registration failed: SIP/2.0 603 Too Many Contacts"))).toBe("full");
    expect(classifyRegistrationError(new Error("SIP/2.0 603 Decline"))).toBe("full");
  });
  it("sends a rejected credential back to provisioning", () => {
    expect(classifyRegistrationError(new Error("Registration failed: SIP/2.0 403 Forbidden"))).toBe("auth");
    expect(classifyRegistrationError(new Error("Registration failed: SIP/2.0 401 Unauthorized (missing nonce)"))).toBe("auth");
  });
  it("treats a WebSocket that never opened, and a fetch that failed, as network", () => {
    expect(classifyRegistrationError(new Event("error"))).toBe("network");
    expect(classifyRegistrationError(new TypeError("Failed to fetch"))).toBe("network");
  });
  it("leaves everything else unknown rather than guessing", () => {
    expect(classifyRegistrationError(new Error("Couldn't set up calling (500)"))).toBe("unknown");
    expect(classifyRegistrationError(undefined)).toBe("unknown");
  });
});

describe("retryDelayMs", () => {
  it("waits a fixed minute on full — never a hot loop against the SIP server", () => {
    expect(retryDelayMs("full", 0)).toBe(FULL_RETRY_MS);
    expect(retryDelayMs("full", 9)).toBe(FULL_RETRY_MS);
  });
  it("backs off 2s → 60s on network trouble", () => {
    expect(retryDelayMs("network", 0)).toBe(2_000);
    expect(retryDelayMs("network", 1)).toBe(4_000);
    expect(retryDelayMs("network", 4)).toBe(32_000);
    expect(retryDelayMs("network", 10)).toBe(60_000);
  });
  it("⚠️ auth is a LADDER, never a flat beat — the 2026-09-25 metronome", () => {
    // Every auth retry re-fetches provision (the failure just cleared the
    // sipInfo cache), so a REGISTER that keeps being refused re-provisions on
    // every cycle. A flat 5s ran one browser at ~10 gateway + RingCentral
    // sip-provision calls a minute for twelve straight minutes and helped
    // draw a real RC 429 on the shared account. First rung 10s — quick enough
    // for the ordinary stale-credential recovery, and ABOVE the gateway's
    // 8s provision floor (messaging.mjs SIP_PROVISION_FLOOR_MS), so a genuine
    // recovery is never refused by our own guard.
    expect(retryDelayMs("auth", 0)).toBe(10_000);
    expect(retryDelayMs("auth", 1)).toBe(20_000);
    expect(retryDelayMs("auth", 2)).toBe(40_000);
    expect(retryDelayMs("auth", 3)).toBe(60_000);
    expect(retryDelayMs("auth", 10)).toBe(60_000);
  });
});

describe("describeRegistrationFailure", () => {
  it("tells a rep the line is full AND what frees a slot — never to forward the call", () => {
    // "or use Take it to ring your phone" went with the button (2026-09-28):
    // pointing at the banned path exactly when the allowed one is broken is
    // how a patient call ends up on a personal phone.
    const s = describeRegistrationFailure("full", null);
    expect(s).toMatch(/five devices/i);
    expect(s).toMatch(/frees a slot/i);
    expect(s).not.toMatch(/Take it/);
  });
  it("carries the raw reason for an unknown failure", () => {
    expect(describeRegistrationFailure("unknown", new Error("VoipCalling scope missing"))).toContain("VoipCalling scope missing");
  });
});

describe("instanceIdFor — one stable id per browser", () => {
  it("mints once and then reuses", () => {
    const s = memStorage();
    let n = 0;
    const mint = () => `0000000${++n}-0000-4000-8000-000000000000`;
    const a = instanceIdFor(s, mint);
    const b = instanceIdFor(s, mint);
    expect(a).toBe(b);
    expect(n).toBe(1);
    expect(s.map.get(INSTANCE_ID_KEY)).toBe(a);
  });
  it("replaces a corrupt stored value", () => {
    const s = memStorage();
    s.setItem(INSTANCE_ID_KEY, "not-a-uuid");
    const id = instanceIdFor(s, () => "11111111-2222-4333-8444-555555555555");
    expect(id).toBe("11111111-2222-4333-8444-555555555555");
  });
  it("survives disabled storage with a session-only id", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(instanceIdFor(broken, () => "11111111-2222-4333-8444-555555555555")).toBe(
      "11111111-2222-4333-8444-555555555555",
    );
  });
});

describe("sipInfo cache", () => {
  it("round-trips within the TTL for the same person", () => {
    const s = memStorage();
    writeCachedSipInfo(s, "Katie@MedicallyModern.com", SIP, 1_000);
    expect(readCachedSipInfo(s, "katie@medicallymodern.com", 1_000 + SIP_INFO_TTL_MS - 1)).toEqual(SIP);
  });
  it("expires after the TTL, and never serves a future-dated entry", () => {
    const s = memStorage();
    writeCachedSipInfo(s, "k@medicallymodern.com", SIP, 1_000);
    expect(readCachedSipInfo(s, "k@medicallymodern.com", 1_000 + SIP_INFO_TTL_MS + 1)).toBeNull();
    expect(readCachedSipInfo(s, "k@medicallymodern.com", 999)).toBeNull();
  });
  it("is scoped to the signed-in email — a shared machine re-provisions for the next person", () => {
    const s = memStorage();
    writeCachedSipInfo(s, "a@medicallymodern.com", SIP, 1_000);
    expect(readCachedSipInfo(s, "b@medicallymodern.com", 2_000)).toBeNull();
  });
  it("rejects a malformed entry and clears on request", () => {
    const s = memStorage();
    s.setItem("mm-softphone-sip", "{not json");
    expect(readCachedSipInfo(s, "a@medicallymodern.com", 1)).toBeNull();
    writeCachedSipInfo(s, "a@medicallymodern.com", SIP, 1_000);
    clearCachedSipInfo(s);
    expect(readCachedSipInfo(s, "a@medicallymodern.com", 1_001)).toBeNull();
  });
});

describe("ringtone mute", () => {
  it("is OFF by default — a silent ring is a missed call", () => {
    const s = memStorage();
    expect(readMuted(s)).toBe(false);
    writeMuted(s, true);
    expect(readMuted(s)).toBe(true);
    writeMuted(s, false);
    expect(readMuted(s)).toBe(false);
  });
  it("reads unmuted when storage is unavailable", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(readMuted(broken)).toBe(false);
    expect(() => writeMuted(broken, true)).not.toThrow();
  });
});

/**
 * ⚠️ The forever-loop (Katie, prod, 2026-09-28: "cant connct ring centerals
 * phone server retrying and it never resolves").
 *
 * `auth` was the only kind that dropped the cached sipInfo — and the SDK
 * cannot be relied on to produce an `auth` at all: a REGISTER RingCentral
 * REFUSES hangs exactly like one it never answered (§5.13b, `register()` has
 * no rejection path), so it reaches us as our own 20s deadline, whose message
 * says "timed out" and therefore classified as `network`. Dead credentials
 * were then retried every 60s for the seven days of the cache TTL.
 */
describe("shouldRefreshCredentials — a registration that can never recover", () => {
  it("drops the credentials on auth immediately: that IS the credential failure", () => {
    expect(shouldRefreshCredentials("auth", 0)).toBe(true);
  });

  it("⚠️ eventually drops them for a network failure too — the SDK hides refusals behind our timeout", () => {
    // The first rungs (2s · 4s · 8s) are where a real blip recovers.
    expect(shouldRefreshCredentials("network", 0)).toBe(false);
    expect(shouldRefreshCredentials("network", 2)).toBe(false);
    expect(shouldRefreshCredentials("network", 3)).toBe(true);
  });

  it("then only sparingly — a provision mints an RC device record and the gateway floors the route", () => {
    // §5.53's metronome: a refresh on EVERY retry is that incident again.
    const refreshed = [];
    for (let n = 3; n <= 20; n++) if (shouldRefreshCredentials("network", n)) refreshed.push(n);
    expect(refreshed).toEqual([3, 8, 13, 18]);
  });

  it("NEVER while the line is full — five devices says nothing about these credentials", () => {
    // And a fresh provision would mint a device record competing for the slots.
    for (let n = 0; n < 30; n++) expect(shouldRefreshCredentials("full", n)).toBe(false);
  });

  it("covers the unknown bucket as well, on the same ladder", () => {
    expect(shouldRefreshCredentials("unknown", 2)).toBe(false);
    expect(shouldRefreshCredentials("unknown", 3)).toBe(true);
  });
});

/**
 * ⚠️ Both deadline messages say "timed out", and only one of them is about
 * RingCentral. A rep reporting "Can't reach RingCentral's phone server" was
 * reporting any of three faults, one of which is our own gateway.
 */
describe("the gateway's silence is not RingCentral's", () => {
  it("files a provision timeout as `gateway`, and says so on screen", () => {
    const kind = classifyRegistrationError(new Error(PROVISION_TIMEOUT_MESSAGE));
    expect(kind).toBe("gateway");
    expect(describeRegistrationFailure(kind, null)).toMatch(/Command Center's calling service/);
  });

  it("still files the REGISTER deadline as `network` — that one really is RingCentral", () => {
    const kind = classifyRegistrationError(new Error(START_TIMEOUT_MESSAGE));
    expect(kind).toBe("network");
    expect(describeRegistrationFailure(kind, null)).toMatch(/RingCentral's phone server/);
  });

  it("puts `gateway` on the auth ladder, so its retry stays above the gateway's own 8s floor", () => {
    // §5.53: a gateway retry re-fetches provision, and SIP_PROVISION_FLOOR_MS
    // (8s) refuses anything faster. 2s would eat a 429 on the first retry.
    expect(retryDelayMs("gateway", 0)).toBe(10_000);
    expect(retryDelayMs("network", 0)).toBe(2_000);
  });
});
