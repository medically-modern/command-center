import { describe, expect, it } from "vitest";
import {
  isRinging,
  last4,
  normalizePrefs,
  pickInboundParty,
  sessionOutcome,
  shouldNotify,
} from "./callRules.mjs";

/** A telephony-session notification shaped like RingCentral's, trimmed to the
 *  fields this module reads. */
const evt = (parties) => ({ telephonySessionId: "abc", parties });

const inboundRinging = {
  id: "cs-1",
  direction: "Inbound",
  from: { phoneNumber: "+13475550101", name: "MARIA G" },
  to: { phoneNumber: "+13475037148" },
  status: { code: "Proceeding" },
};

describe("pickInboundParty", () => {
  it("returns the caller for an inbound ringing party", () => {
    const p = pickInboundParty(evt([inboundRinging]));
    expect(p).toMatchObject({ partyId: "cs-1", from: "+13475550101", to: "+13475037148" });
  });

  it("accepts Setup as well as Proceeding", () => {
    const p = pickInboundParty(evt([{ ...inboundRinging, status: { code: "Setup" } }]));
    expect(p?.from).toBe("+13475550101");
  });

  // A rep clicking Call generates telephony events too. Treating those as
  // inbound would pop every screen in the office on every outbound call.
  it("ignores outbound calls", () => {
    expect(pickInboundParty(evt([{ ...inboundRinging, direction: "Outbound" }]))).toBeNull();
  });

  // An answered call is somebody's conversation, not an offer to take one.
  it("ignores a call that has already been answered", () => {
    expect(pickInboundParty(evt([{ ...inboundRinging, status: { code: "Answered" } }]))).toBeNull();
  });

  it("finds the ringing party among several legs of one session", () => {
    const p = pickInboundParty(
      evt([
        { ...inboundRinging, id: "cs-0", status: { code: "Disconnected" } },
        { ...inboundRinging, id: "cs-2" },
      ]),
    );
    expect(p?.partyId).toBe("cs-2");
  });

  // Keying on `to` would match our own main line for every call, collapsing
  // every caller onto one "patient".
  it("reads the caller from `from`, not `to`", () => {
    const p = pickInboundParty(evt([inboundRinging]));
    expect(p.from).toBe("+13475550101");
    expect(p.from).not.toBe(p.to);
  });

  it("skips a party with no caller number", () => {
    expect(pickInboundParty(evt([{ ...inboundRinging, from: {} }]))).toBeNull();
  });

  it("survives a malformed payload", () => {
    expect(pickInboundParty(undefined)).toBeNull();
    expect(pickInboundParty({})).toBeNull();
    expect(pickInboundParty({ parties: null })).toBeNull();
  });
});

describe("sessionOutcome", () => {
  it("reports answered when any inbound leg is answered", () => {
    expect(sessionOutcome(evt([{ ...inboundRinging, status: { code: "Answered" } }]))).toBe("answered");
  });

  it("reports ended once every inbound leg is terminal", () => {
    expect(sessionOutcome(evt([{ ...inboundRinging, status: { code: "Disconnected" } }]))).toBe("ended");
  });

  // Voicemail is a call no human took — the card must clear, and it counts as
  // missed rather than answered.
  it("treats voicemail as ended, not answered", () => {
    expect(sessionOutcome(evt([{ ...inboundRinging, status: { code: "VoiceMail" } }]))).toBe("ended");
  });

  it("reports nothing while the call is still ringing", () => {
    expect(sessionOutcome(evt([inboundRinging]))).toBeNull();
  });

  it("does not end the call while one leg is still ringing", () => {
    expect(
      sessionOutcome(
        evt([{ ...inboundRinging, id: "cs-0", status: { code: "Disconnected" } }, inboundRinging]),
      ),
    ).toBeNull();
  });
});

describe("normalizePrefs", () => {
  // A new hire who has never opened the settings dialog must still see the
  // shared line ring.
  it("defaults to all", () => {
    expect(normalizePrefs(undefined).mode).toBe("all");
    expect(normalizePrefs({}).mode).toBe("all");
  });

  it("rejects an unknown mode rather than silencing someone", () => {
    expect(normalizePrefs({ mode: "nonsense" }).mode).toBe("all");
  });
});

describe("shouldNotify", () => {
  it("all mode rings for anything", () => {
    expect(shouldNotify({ mode: "all" }, {})).toBe(true);
  });

  it("off mode rings for nothing, pinned included", () => {
    expect(shouldNotify({ mode: "off" }, { pinned: true, texted: true })).toBe(false);
  });

  it("list mode rings for a pinned number", () => {
    expect(shouldNotify({ mode: "list" }, { pinned: true })).toBe(true);
  });

  it("list mode stays quiet for a stranger", () => {
    expect(shouldNotify({ mode: "list" }, {})).toBe(false);
  });

  // The rule Josh removed: having texted someone must NOT enrol them. A rep who
  // texts all day would otherwise have rebuilt `all` under a name that promises
  // the opposite — and they are the likeliest person to pick `list`.
  it("list mode does NOT ring merely because you have texted them", () => {
    expect(shouldNotify({ mode: "list" }, { texted: true })).toBe(false);
  });

  it("texting someone you also pinned still rings — the pin is what counts", () => {
    expect(shouldNotify({ mode: "list" }, { pinned: true, texted: true })).toBe(true);
  });
});

describe("last4", () => {
  it("takes the last four digits of a formatted number", () => {
    expect(last4("+1 (347) 555-0101")).toBe("0101");
  });

  it("returns empty for something too short to be a hint", () => {
    expect(last4("123")).toBe("");
    expect(last4("")).toBe("");
    expect(last4(null)).toBe("");
  });
});
