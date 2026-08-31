import { describe, it, expect } from "vitest";
import {
  buildFaxOutcomes,
  faxFailureReason,
  faxKey,
  faxOutcomeFor,
  isRetryableFaxFailure,
  type RcFaxRecord,
} from "./faxOutcome";

/** Shapes copied from real records on this account (Aug 2026). */
const failed: RcFaxRecord = {
  messageStatus: "SendingFailed",
  creationTime: "2026-08-28T20:54:30.000Z",
  lastModifiedTime: "2026-08-28T21:05:48.252Z",
  to: [{ phoneNumber: "+19198435515", messageStatus: "SendingFailed", faxErrorCode: "CallFailed" }],
};
const sent: RcFaxRecord = {
  messageStatus: "Sent",
  creationTime: "2026-08-28T14:00:00.000Z",
  lastModifiedTime: "2026-08-28T14:04:00.000Z",
  to: [{ phoneNumber: "+17186136948", messageStatus: "Sent" }],
};

describe("faxKey", () => {
  it("joins Monday's @rcfax.com address to RingCentral's E.164", () => {
    // The two sides of the join, for the same office.
    expect(faxKey("9198435515@rcfax.com")).toBe("9198435515");
    expect(faxKey("+19198435515")).toBe("9198435515");
    expect(faxKey("(919) 843-5515")).toBe("9198435515");
  });

  it("is empty for anything that isn't a usable number, so it never matches", () => {
    // A real email address in the fax column, a blank, a partial number.
    expect(faxKey("records@clinic.org")).toBe("");
    expect(faxKey("")).toBe("");
    expect(faxKey(undefined)).toBe("");
    expect(faxKey("555-1234")).toBe("");
  });
});

describe("buildFaxOutcomes", () => {
  it("records a failure with RingCentral's reason code", () => {
    const m = buildFaxOutcomes([failed]);
    expect(m.get("9198435515")).toMatchObject({ state: "failed", code: "CallFailed" });
  });

  it("records a success", () => {
    expect(buildFaxOutcomes([sent]).get("7186136948")?.state).toBe("sent");
  });

  it("LATEST WINS — a number that failed then went through is no longer bad", () => {
    // This is what makes the badge self-clearing once a rep fixes the number.
    const later: RcFaxRecord = {
      messageStatus: "Sent",
      creationTime: "2026-08-29T09:00:00.000Z",
      lastModifiedTime: "2026-08-29T09:03:00.000Z",
      to: [{ phoneNumber: "+19198435515", messageStatus: "Sent" }],
    };
    for (const order of [[failed, later], [later, failed]]) {
      expect(buildFaxOutcomes(order).get("9198435515")?.state).toBe("sent");
    }
  });

  it("a newer failure replaces an older success", () => {
    const older: RcFaxRecord = {
      messageStatus: "Sent",
      creationTime: "2026-08-01T09:00:00.000Z",
      lastModifiedTime: "2026-08-01T09:03:00.000Z",
      to: [{ phoneNumber: "+19198435515", messageStatus: "Sent" }],
    };
    expect(buildFaxOutcomes([older, failed]).get("9198435515")?.state).toBe("failed");
  });

  it("an unknown or in-flight status is NOT a failure", () => {
    // Marking a queued fax bad sends the rep off to fix a number that is fine.
    const queued: RcFaxRecord = {
      messageStatus: "Queued",
      creationTime: "2026-08-28T20:00:00.000Z",
      to: [{ phoneNumber: "+12125550100", messageStatus: "Queued" }],
    };
    const unheardOf: RcFaxRecord = {
      messageStatus: "SomethingNew",
      creationTime: "2026-08-28T20:00:00.000Z",
      to: [{ phoneNumber: "+12125550101" }],
    };
    const m = buildFaxOutcomes([queued, unheardOf]);
    expect(m.has("2125550100")).toBe(false);
    expect(m.has("2125550101")).toBe(false);
  });

  it("a queued re-send does not erase an existing failure", () => {
    // The verdict on the retry lands minutes later; until it does, the last
    // thing we actually know is that the previous fax failed.
    const requeued: RcFaxRecord = {
      messageStatus: "Queued",
      creationTime: "2026-08-29T10:00:00.000Z",
      to: [{ phoneNumber: "+19198435515", messageStatus: "Queued" }],
    };
    expect(buildFaxOutcomes([failed, requeued]).get("9198435515")?.state).toBe("failed");
  });

  it("falls back to the top-level status when the recipient carries none", () => {
    const rec: RcFaxRecord = {
      messageStatus: "SendingFailed",
      creationTime: "2026-08-28T20:00:00.000Z",
      to: [{ phoneNumber: "+12125550102" }],
    };
    expect(buildFaxOutcomes([rec]).get("2125550102")?.state).toBe("failed");
  });

  it("handles a fax sent to several numbers independently", () => {
    const multi: RcFaxRecord = {
      messageStatus: "SendingFailed",
      creationTime: "2026-08-28T20:00:00.000Z",
      to: [
        { phoneNumber: "+12125550103", messageStatus: "Sent" },
        { phoneNumber: "+12125550104", messageStatus: "SendingFailed", faxErrorCode: "WrongNumber" },
      ],
    };
    const m = buildFaxOutcomes([multi]);
    expect(m.get("2125550103")?.state).toBe("sent");
    expect(m.get("2125550104")).toMatchObject({ state: "failed", code: "WrongNumber" });
  });

  it("ignores records with no usable number or timestamp", () => {
    expect(buildFaxOutcomes([{ messageStatus: "SendingFailed", to: [{ phoneNumber: "+19198435515" }] }]).size).toBe(0);
    expect(buildFaxOutcomes([{ messageStatus: "SendingFailed", creationTime: "2026-08-28T20:00:00.000Z" }]).size).toBe(0);
    expect(buildFaxOutcomes([]).size).toBe(0);
  });
});

describe("faxOutcomeFor", () => {
  const outcomes = buildFaxOutcomes([failed, sent]);

  it("looks a doctor's stored @rcfax.com value up against RC's E.164", () => {
    expect(faxOutcomeFor(outcomes, "9198435515@rcfax.com")?.state).toBe("failed");
    expect(faxOutcomeFor(outcomes, "7186136948@rcfax.com")?.state).toBe("sent");
  });

  it("says nothing when there is nothing to say", () => {
    expect(faxOutcomeFor(outcomes, "2125559999@rcfax.com")).toBeNull(); // no fax in the window
    expect(faxOutcomeFor(outcomes, "")).toBeNull(); // no fax on file
    expect(faxOutcomeFor(null, "9198435515@rcfax.com")).toBeNull(); // not loaded yet
  });
});

describe("failure wording", () => {
  it("tells the rep whether to fix the number or just re-send", () => {
    expect(isRetryableFaxFailure("LineBusy")).toBe(true);
    expect(isRetryableFaxFailure("NoAnswer")).toBe(true);
    expect(isRetryableFaxFailure("WrongNumber")).toBe(false);
    expect(isRetryableFaxFailure("CallFailed")).toBe(false);
  });

  it("stays useful for a code we have never seen", () => {
    expect(faxFailureReason("WrongNumber")).toMatch(/isn't a fax machine/);
    expect(faxFailureReason("BrandNewCode")).toContain("BrandNewCode");
    expect(faxFailureReason(undefined)).toMatch(/didn't say/);
  });
});
