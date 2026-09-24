import { describe, expect, it } from "vitest";
import { activeNumber, numberKey, popupNumbers, withHeaderNumbers } from "./commsPopup";
import type { ItemNumber, TimelineEntry } from "@/lib/commsInbox/rules";

const n = (last4: string, e164: string | null, hmac = `h${last4}`): ItemNumber => ({ hmac, last4, e164 });

const textIn = (last4: string, at = 1): TimelineEntry =>
  ({
    type: "text", id: `t${at}`, dir: "in", at, last4, body: "hi", status: "Received",
    deliveryError: "", attachments: [], sentBy: "",
  }) as TimelineEntry;

describe("numberKey", () => {
  it("is the last ten digits, whatever shape the number was typed in", () => {
    expect(numberKey("(555) 555-0100")).toBe("5555550100");
    expect(numberKey("+15555550100")).toBe("5555550100");
    expect(numberKey("15555550100")).toBe("5555550100");
    expect(numberKey("")).toBe("");
    expect(numberKey(undefined)).toBe("");
  });
});

describe("popupNumbers", () => {
  it("puts the header's own number first, as E.164", () => {
    expect(popupNumbers("(555) 555-0100", "555-555-0199")).toEqual(["+15555550100", "+15555550199"]);
  });

  it("drops a second copy of the same number, however it was typed", () => {
    expect(popupNumbers("(555) 555-0100", "15555550100")).toEqual(["+15555550100"]);
  });

  // ⚠️ A popup cannot text or dial a number it cannot read.
  it("drops anything that is not a whole number", () => {
    expect(popupNumbers("555-0100", "")).toEqual([]);
    expect(popupNumbers("(555) 555-0100", "12345")).toEqual(["+15555550100"]);
  });
});

describe("withHeaderNumbers", () => {
  it("fills a number the gateway could not read back, on a unique last four", () => {
    const out = withHeaderNumbers([n("0100", null)], ["+15555550100"]);
    expect(out).toEqual([n("0100", "+15555550100")]);
  });

  // ⚠️ The directory is at most a day old (§5.29), so a number corrected this
  // morning may not be on the item. The page holds it now, and it is the
  // number the rep expects to text — dropping it would aim the composer
  // somewhere else without saying so.
  it("appends a header number the item does not carry, keyed so it can never collide", () => {
    const out = withHeaderNumbers([n("0100", "+15555550100")], ["+15555550100", "+15555550199"]);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ hmac: "local:5555550199", last4: "0199", e164: "+15555550199" });
  });

  it("returns the item's own list untouched when nothing is missing", () => {
    const numbers = [n("0100", "+15555550100")];
    expect(withHeaderNumbers(numbers, ["(555) 555-0100"])).toBe(numbers);
  });

  it("ignores header values it cannot read", () => {
    const numbers = [n("0100", "+15555550100")];
    expect(withHeaderNumbers(numbers, ["", "0100"])).toBe(numbers);
  });
});

describe("activeNumber — who the composer texts and Call dials", () => {
  const numbers = [n("0100", "+15555550100"), n("0199", "+15555550199"), n("0177", null)];

  it("is the one the rep chose, while it is reachable", () => {
    expect(activeNumber(numbers, "5555550199", "5555550100", [])?.e164).toBe("+15555550199");
  });

  it("otherwise the number the page opened the popup on", () => {
    expect(activeNumber(numbers, "", "5555550100", [textIn("0199")])?.e164).toBe("+15555550100");
    // A choice that no longer resolves falls back the same way.
    expect(activeNumber(numbers, "5555550000", "5555550100", [])?.e164).toBe("+15555550100");
  });

  it("otherwise the Inbox's own default — the number the newest message came in on", () => {
    expect(activeNumber(numbers, "", "", [textIn("0100", 1), textIn("0199", 2)])?.e164).toBe("+15555550199");
  });

  it("never picks a number it cannot dial", () => {
    expect(activeNumber(numbers, "", "", [textIn("0177")])?.e164).toBe("+15555550100");
    expect(activeNumber([n("0177", null)], "", "", [])).toBeNull();
  });
});
