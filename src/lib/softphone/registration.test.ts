import { describe, it, expect } from "vitest";
import {
  FULL_RETRY_MS,
  INSTANCE_ID_KEY,
  SIP_INFO_TTL_MS,
  classifyRegistrationError,
  clearCachedSipInfo,
  describeRegistrationFailure,
  instanceIdFor,
  readCachedSipInfo,
  readMuted,
  retryDelayMs,
  writeCachedSipInfo,
  writeMuted,
  type StorageLike,
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
  it("retries auth quickly, after the cache has been dropped", () => {
    expect(retryDelayMs("auth", 3)).toBe(5_000);
  });
});

describe("describeRegistrationFailure", () => {
  it("tells a rep the line is full AND that Take it still works", () => {
    const s = describeRegistrationFailure("full", null);
    expect(s).toMatch(/five devices/i);
    expect(s).toMatch(/Take it/);
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
