/**
 * Who picked up an inbound call — the extension and its person (§5.47d).
 *
 * The fixtures are the SHAPE of a real call read on 2026-09-30 (numbers and
 * names replaced): the shared line's record has a master leg ("Accepted", to
 * the line's own extension) and one fan-out leg per extension it rang, each
 * "Stopped" or "IP Phone Offline" except the one that answered, "Call
 * connected", carrying `to.extensionNumber` and no name.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { answeredByOf, EMPTY_DIRECTORY, extensionDirectory, toCallRow } from "./callArchiveRules.mjs";
import { callEvent } from "./commsInboxRules.mjs";

const gatewaySrc = (f) => readFileSync(resolve(process.cwd(), "services/monday-gateway", f), "utf8");

const SHARED_ID = "900000002";
const directory = extensionDirectory([
  { id: SHARED_ID, extensionNumber: "2", type: "User", contact: { firstName: "Shared", lastName: "Owner" } },
  { id: "900000013", extensionNumber: "13", type: "User", contact: { firstName: "Test", lastName: "Rep" } },
  { id: "900000008", extensionNumber: "8", type: "User", contact: { firstName: "Other", lastName: "Rep" } },
  { id: "900001001", extensionNumber: "1001", type: "IvrMenu", name: "IVR Menu 1001" },
  { id: "900000004", extensionNumber: "4", type: "Department", name: "General Queue" },
]);

const fanOut = (ext, result, duration = 0) => ({
  legType: "PstnToSip", result, duration,
  from: { name: "Shared Owner", extensionId: SHARED_ID, phoneNumber: "+15555550101" },
  to: { extensionNumber: ext, phoneNumber: "+15555550100" },
});
const master = (result = "Accepted") => ({
  master: true, legType: "Accept", result, duration: 123,
  from: { name: "A Patient", phoneNumber: "+15555550101" },
  to: { name: "Shared Owner", extensionId: SHARED_ID, phoneNumber: "+15555550199" },
});
const inbound = (legs, over = {}) => ({
  id: "c1", startTime: "2026-09-30T19:57:00.000Z", direction: "Inbound", result: "Accepted", duration: 123,
  from: { phoneNumber: "+15555550101" }, to: { phoneNumber: "+15555550199" }, legs, ...over,
});

describe("extensionDirectory", () => {
  it("names a person by contact, anything else by its own name", () => {
    expect(directory.byExt.get("13")).toMatchObject({ ext: "13", name: "Test Rep", type: "User" });
    expect(directory.byId.get(SHARED_ID)).toMatchObject({ ext: "2", name: "Shared Owner" });
    expect(directory.byExt.get("1001").name).toBe("IVR Menu 1001");
  });

  it("tolerates junk", () => {
    expect(extensionDirectory(null).byExt.size).toBe(0);
    expect(extensionDirectory([{}, null]).byExt.size).toBe(0);
  });
});

describe("answeredByOf", () => {
  it("is the extension whose fan-out leg connected — the real 2026-09-30 shape", () => {
    const rec = inbound([
      master(),
      fanOut("2", "Stopped", 16), fanOut("2", "IP Phone Offline"),
      fanOut("13", "Call connected", 115), fanOut("13", "IP Phone Offline"),
      fanOut("8", "Stopped", 16), fanOut("8", "IP Phone Offline"),
    ]);
    expect(answeredByOf(rec, directory)).toEqual({ ext: "13", name: "Test Rep" });
  });

  it("saves the extension number even when the list could not be read", () => {
    const rec = inbound([master(), fanOut("13", "Call connected", 115)]);
    expect(answeredByOf(rec, EMPTY_DIRECTORY)).toEqual({ ext: "13", name: null });
    expect(answeredByOf(rec)).toEqual({ ext: "13", name: null });
  });

  it("takes the longest connected leg when more than one connected", () => {
    const rec = inbound([master(), fanOut("8", "Call connected", 20), fanOut("13", "Call connected", 90)]);
    expect(answeredByOf(rec, directory).ext).toBe("13");
  });

  it("is the line's own extension when it was answered there with no fan-out", () => {
    expect(answeredByOf(inbound([master()]), directory)).toEqual({ ext: "2", name: "Shared Owner" });
  });

  it("is NEVER set on an outbound call — they all leave from one shared extension", () => {
    const rec = inbound([master(), fanOut("13", "Call connected", 115)], { direction: "Outbound" });
    expect(answeredByOf(rec, directory)).toBeNull();
  });

  it("is null for a missed call or one that went to voicemail", () => {
    expect(answeredByOf(inbound([master("Missed"), fanOut("13", "Stopped", 20)], { result: "Missed" }), directory)).toBeNull();
    expect(answeredByOf(inbound([master(), { result: "Voicemail" }], { result: "Voicemail" }), directory)).toBeNull();
    expect(answeredByOf(inbound([master(), { result: "Voicemail" }]), directory)).toBeNull();
  });

  it("is null when the call connected to a number that is not an extension (a forward to a cell)", () => {
    const toCell = { result: "Call connected", duration: 60, to: { phoneNumber: "+15555550142" } };
    expect(answeredByOf(inbound([master(), toCell]), directory)).toBeNull();
  });

  it("never names an IVR menu or a queue as the person who picked up", () => {
    expect(answeredByOf(inbound([master(), fanOut("1001", "Call connected", 30)]), directory)).toBeNull();
    const queueMaster = { ...master(), to: { extensionId: "900000004" } };
    expect(answeredByOf(inbound([queueMaster]), directory)).toBeNull();
  });
});

describe("the row and the timeline carry it", () => {
  it("toCallRow stores answeredExt / answeredName, and null on an outbound call", () => {
    const rec = inbound([master(), fanOut("13", "Call connected", 115)]);
    expect(toCallRow(rec, directory)).toMatchObject({ answeredExt: "13", answeredName: "Test Rep" });
    expect(toCallRow({ ...rec, direction: "Outbound" }, directory)).toMatchObject({ answeredExt: null, answeredName: null });
    // The one-argument call every existing caller makes still works.
    expect(toCallRow(rec)).toMatchObject({ answeredExt: "13", answeredName: null });
  });

  it("callEvent reads the two columns, blank when absent", () => {
    const base = { rc_call_id: "c1", direction: "Inbound", started_at: "2026-09-30T19:57:00Z" };
    expect(callEvent({ ...base, answered_ext: "13", answered_name: "Test Rep" })).toMatchObject({ answeredExt: "13", answeredName: "Test Rep" });
    expect(callEvent(base)).toMatchObject({ answeredExt: "", answeredName: "" });
  });
});

describe("wiring", () => {
  const archive = gatewaySrc("callArchive.mjs");
  const inbox = gatewaySrc("commsInbox.mjs");

  it("adds the columns, writes them, and never blanks a known value", () => {
    expect(archive).toMatch(/ADD COLUMN IF NOT EXISTS answered_ext TEXT/);
    expect(archive).toMatch(/ADD COLUMN IF NOT EXISTS answered_name TEXT/);
    expect(archive).toMatch(/answered_ext\s+= COALESCE\(EXCLUDED\.answered_ext,\s+call_archive\.answered_ext\)/);
    expect(archive).toMatch(/answered_name\s+= COALESCE\(EXCLUDED\.answered_name,\s+call_archive\.answered_name\)/);
    expect(archive).toMatch(/r\.answeredExt \?\? null,\s*r\.answeredName \?\? null,/);
  });

  it("every call written to the archive is resolved against the extension list", () => {
    // The one path into call_archive (the hourly scan and the inbox tick).
    expect(archive).toMatch(/toCallRow\(rec, extensions/);
    expect(archive).toMatch(/await getExtensionDirectory\(\)/);
  });

  it("the timeline reads them — and survives a table that does not have them yet", () => {
    expect(inbox).toMatch(/has\.answered \? "answered_ext, answered_name" : "NULL AS answered_ext, NULL AS answered_name"/);
    expect(inbox).toMatch(/column_name = 'answered_name'/);
  });
});
