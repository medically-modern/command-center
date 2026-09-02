import { describe, it, expect } from "vitest";
import { filterInbound, filterOutbound, toOutboundRows, viewIsOutbound } from "./faxFilter";
import type { InboundFax } from "@/lib/fax/ringcentralApi";
import type { RcFaxRecord } from "@/lib/fax/faxOutcome";

const inbound = (over: Partial<InboundFax> = {}): InboundFax =>
  ({ id: 1, fromNumber: "+18583666900", fromName: "", fromLocation: "", creationTime: "2026-09-02T12:00:00Z", pages: 2, read: false, attachmentUri: "" , ...over }) as InboundFax;

describe("which list a view reads", () => {
  it("routes Sent and Failed to the OUTBOUND list", () => {
    // The default views are inbound, so the outbound read is only spent when a
    // rep actually asks for it.
    expect(viewIsOutbound("sent")).toBe(true);
    expect(viewIsOutbound("failed")).toBe(true);
    for (const v of ["all", "unread", "received"] as const) expect(viewIsOutbound(v)).toBe(false);
  });

  it("renders no inbound rows on an outbound view, and vice versa", () => {
    const list = [inbound()];
    expect(filterInbound(list, "sent")).toEqual([]);
    expect(filterOutbound([], "unread")).toEqual([]);
  });
});

describe("filterInbound", () => {
  const list = [inbound({ id: 1, read: false }), inbound({ id: 2, read: true })];
  it("Unread keeps only what RingCentral still holds unread", () => {
    expect(filterInbound(list, "unread").map((f) => f.id)).toEqual([1]);
  });
  it("All and Received both show the whole inbound list", () => {
    expect(filterInbound(list, "all")).toHaveLength(2);
    expect(filterInbound(list, "received")).toHaveLength(2);
  });
});

describe("toOutboundRows", () => {
  it("makes ONE row per recipient, not per record", () => {
    // ⚠️ RingCentral reports the verdict per number. Collapsing a fan-out to
    // its parent would report one office's failure as the whole send's — the
    // same "read the legs" rule the call log needs.
    const rows = toOutboundRows([
      {
        id: 7,
        creationTime: "2026-09-02T12:00:00Z",
        faxPageCount: 3,
        to: [
          { phoneNumber: "+19195550111", messageStatus: "Sent" },
          { phoneNumber: "+19195550222", messageStatus: "SendingFailed", faxErrorCode: "NoAnswer" },
        ],
      } as RcFaxRecord,
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.state).sort()).toEqual(["failed", "sent"]);
    // Keys must differ or React collapses the two rows.
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
  });

  it("carries the failure code through for the row's reason", () => {
    const rows = toOutboundRows([
      { id: 1, creationTime: "2026-09-02T12:00:00Z", to: [{ phoneNumber: "+19195550111", messageStatus: "SendingFailed", faxErrorCode: "NoAnswer" }] } as RcFaxRecord,
    ]);
    expect(rows[0]).toMatchObject({ state: "failed", code: "NoAnswer" });
  });

  it("drops a recipient with no usable number rather than rendering a blank row", () => {
    expect(toOutboundRows([{ id: 1, creationTime: "2026-09-02T12:00:00Z", to: [{ phoneNumber: "" }] } as RcFaxRecord])).toEqual([]);
  });

  it("sorts newest first, like every other list in the hub", () => {
    const rows = toOutboundRows([
      { id: 1, creationTime: "2026-09-01T12:00:00Z", to: [{ phoneNumber: "+19195550111" }] } as RcFaxRecord,
      { id: 2, creationTime: "2026-09-02T12:00:00Z", to: [{ phoneNumber: "+19195550222" }] } as RcFaxRecord,
    ]);
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
  });
});

describe("filterOutbound", () => {
  const rows = toOutboundRows([
    { id: 1, creationTime: "2026-09-02T12:00:00Z", to: [{ phoneNumber: "+19195550111", messageStatus: "Sent" }] } as RcFaxRecord,
    { id: 2, creationTime: "2026-09-02T11:00:00Z", to: [{ phoneNumber: "+19195550222", messageStatus: "SendingFailed", faxErrorCode: "NoAnswer" }] } as RcFaxRecord,
  ]);
  it("Failed keeps only the ones RingCentral gave up on", () => {
    expect(filterOutbound(rows, "failed").map((r) => r.id)).toEqual([2]);
  });
  it("Sent shows everything we sent, failures included — they were still sends", () => {
    expect(filterOutbound(rows, "sent")).toHaveLength(2);
  });
});
