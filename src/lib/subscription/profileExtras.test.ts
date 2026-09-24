/**
 * The Subscription columns the patient screen's Profile tab adds to the ONE
 * Send (Brandon's pixel-match, 2026-09-24 — Josh: "1. YES"): Order Frequency,
 * the CGM and cartridge quantities, and the Contacts block.
 *
 * The two rules that matter, because a regression in either is silent on
 * screen:
 *  - ONLY WHAT THE REP CHANGED is written (`diffExtras`). A value read when the
 *    tab opened is never written back, so a Contacts block the Welcome Call
 *    send filled in since cannot be put back to what it was.
 *  - Every task carries its real `value`, in the shape the client path sends —
 *    one `undefined` disables the gateway's durable fast path for the WHOLE
 *    send (§5.2), and a mismatched shape means the two paths write different
 *    things.
 */
import { describe, expect, it } from "vitest";
import type { MondayItem } from "./mondayApi";
import {
  EMPTY_EXTRAS,
  EXTRA_COL,
  PROFILE_EXTRA_COLUMN_IDS,
  diffExtras,
  extrasRefusals,
  hasExtras,
  readProfileExtras,
  type ProfileExtras,
} from "./profileExtras";
import { buildExtrasTasks } from "./mondayWrite";

const cv = (id: string, text: string | null, value: unknown = null) => ({
  id,
  text,
  value: value === null ? null : JSON.stringify(value),
});

function row(values: ReturnType<typeof cv>[]): MondayItem {
  return { id: "8000", name: "Jane Sample", column_values: values } as unknown as MondayItem;
}

const base = (over: Partial<ProfileExtras> = {}): ProfileExtras => ({
  ...EMPTY_EXTRAS,
  orderFrequency: "90-Days",
  orderFrequencyIndex: 4,
  cgmQty: "3",
  cartridgeQty: "10",
  primaryContact: "Patient",
  primaryContactIndex: 7,
  caregiverName: "Sam Helper",
  alternatePhone: "5555550100",
  ...over,
});

describe("the column ids", () => {
  it("are the Subscription board's own, read back live on 2026-09-24", () => {
    expect(EXTRA_COL).toEqual({
      orderFrequency: "color_mm48kv1c",
      cgmQty: "numeric_mm3sr332",
      cartridgeQty: "numeric_mm3sfe56",
      primaryContact: "color_mm72vm7p",
      alternateContact: "color_mm723hfk",
      caregiverName: "text_mm72mdzk",
      caregiverAuthorized: "boolean_mm72nt75",
      alternatePhone: "phone_mm72r19q",
      canText: "color_mm72jg9e",
      lastPatientContact: "text_mm5frhe9",
      lastEligibilityCheck: "date_mm43n083",
      oopRemaining: "text_mm3gs345",
    });
    // ⚠️ Every one is READ — a column missing from the read comes back ""
    // on every patient with nothing erroring (§5.11).
    expect(PROFILE_EXTRA_COLUMN_IDS).toEqual(Object.values(EXTRA_COL));
  });
});

describe("readProfileExtras", () => {
  it("reads text, the status label ids, and the phone from its value", () => {
    const x = readProfileExtras(
      row([
        cv(EXTRA_COL.orderFrequency, "60-Days", { index: 2 }),
        cv(EXTRA_COL.cgmQty, "3"),
        cv(EXTRA_COL.primaryContact, "Caregiver", { index: 4 }),
        cv(EXTRA_COL.caregiverName, " Sam Helper "),
        cv(EXTRA_COL.alternatePhone, "+1 555-555-0100", { phone: "5555550100", countryShortName: "US" }),
        cv(EXTRA_COL.canText, "Yes", { index: 1 }),
        cv(EXTRA_COL.lastEligibilityCheck, "2026-09-10", { date: "2026-09-10" }),
      ]),
    );
    expect(x.orderFrequency).toBe("60-Days");
    expect(x.orderFrequencyIndex).toBe(2);
    expect(x.cgmQty).toBe("3");
    expect(x.primaryContact).toBe("Caregiver");
    expect(x.primaryContactIndex).toBe(4);
    expect(x.caregiverName).toBe("Sam Helper");
    expect(x.alternatePhone).toBe("5555550100");
    expect(x.canText).toBe("Yes");
    expect(x.lastEligibilityCheck).toBe("2026-09-10");
  });

  it("⚠️ an unreadable label id is NULL, never 0 — 0 is a real label id (§5.43)", () => {
    const x = readProfileExtras(row([cv(EXTRA_COL.primaryContact, "Patient", "not json")]));
    expect(x.primaryContactIndex).toBeNull();
    const y = readProfileExtras(row([cv(EXTRA_COL.primaryContact, "Patient", { index: 0 })]));
    expect(y.primaryContactIndex).toBe(0);
  });

  it("⚠️ a ticked checkbox reads 'v' as text (§5.46e) — either signal is ticked; an unticked box is false, never a No", () => {
    expect(readProfileExtras(row([cv(EXTRA_COL.caregiverAuthorized, "v")])).caregiverAuthorized).toBe(true);
    expect(
      readProfileExtras(row([cv(EXTRA_COL.caregiverAuthorized, null, { checked: "true" })])).caregiverAuthorized,
    ).toBe(true);
    expect(readProfileExtras(row([cv(EXTRA_COL.caregiverAuthorized, "")])).caregiverAuthorized).toBe(false);
    expect(readProfileExtras(row([])).caregiverAuthorized).toBe(false);
  });

  it("⚠️ a blank Can Text stays BLANK — unknown, never a No (§5.31d)", () => {
    expect(readProfileExtras(row([])).canText).toBe("");
  });

  it("no record reads as empty rather than throwing", () => {
    expect(readProfileExtras(null)).toEqual(EMPTY_EXTRAS);
    expect(readProfileExtras(undefined)).toEqual(EMPTY_EXTRAS);
  });
});

describe("⚠️⚠️ diffExtras — only what the rep changed", () => {
  it("drops every field equal to the board", () => {
    const b = base();
    expect(
      diffExtras(b, {
        orderFrequencyIndex: 4,
        cgmQty: " 3 ",
        cartridgeQty: "10",
        primaryContactIndex: 7,
        caregiverName: "Sam Helper ",
        caregiverAuthorized: false,
      }),
    ).toEqual({});
  });

  it("keeps a real change, trimmed", () => {
    expect(diffExtras(base(), { cgmQty: " 4 ", caregiverName: " Pat Helper " })).toEqual({
      cgmQty: "4",
      caregiverName: "Pat Helper",
    });
  });

  it("⚠️ a phone is compared on DIGITS — a reformat, or the leading 1, is not a change", () => {
    expect(diffExtras(base(), { alternatePhone: "(555) 555-0100" })).toEqual({});
    expect(diffExtras(base(), { alternatePhone: "1-555-555-0100" })).toEqual({});
    expect(diffExtras(base(), { alternatePhone: "(555) 555-0199" })).toEqual({ alternatePhone: "(555) 555-0199" });
  });

  it("a cleared field IS a change — null clears a status, blank clears the rest", () => {
    expect(diffExtras(base(), { primaryContactIndex: null, caregiverName: "", cgmQty: "" })).toEqual({
      primaryContactIndex: null,
      caregiverName: "",
      cgmQty: "",
    });
  });

  it("hasExtras is false for an empty delta", () => {
    expect(hasExtras({})).toBe(false);
    expect(hasExtras({ cgmQty: "4" })).toBe(true);
  });
});

describe("extrasRefusals — checked BEFORE the write", () => {
  it("refuses a quantity that is not a whole number, and allows a blank", () => {
    expect(extrasRefusals({ cgmQty: "3 boxes" })).toEqual(["CGM qty must be a whole number (or blank)"]);
    expect(extrasRefusals({ cartridgeQty: "2.5" })).toEqual(["Cartridges qty must be a whole number (or blank)"]);
    expect(extrasRefusals({ cgmQty: "", cartridgeQty: "12" })).toEqual([]);
  });

  it("⚠️ refuses a phone writePhone would silently SKIP — or it saves green having written nothing (§5.32d)", () => {
    expect(extrasRefusals({ alternatePhone: "555-0100" })).toHaveLength(1);
    expect(extrasRefusals({ alternatePhone: "(555) 555-0100" })).toEqual([]);
    // A blank is a deliberate clear.
    expect(extrasRefusals({ alternatePhone: "" })).toEqual([]);
  });
});

describe("⚠️⚠️ buildExtrasTasks — the shapes the gateway's fast path sends", () => {
  it("every task carries a real value", () => {
    const tasks = buildExtrasTasks("8000", {
      orderFrequencyIndex: 2,
      cgmQty: "4",
      cartridgeQty: "",
      primaryContactIndex: null,
      alternateContactIndex: 7,
      caregiverName: "Pat Helper",
      caregiverAuthorized: true,
      alternatePhone: "(555) 555-0199",
    });
    expect(tasks).toHaveLength(8);
    for (const t of tasks) expect(t.value, t.label).not.toBeUndefined();
    const by = Object.fromEntries(tasks.map((t) => [t.columnId, t.value]));
    expect(by[EXTRA_COL.orderFrequency]).toEqual({ index: 2 });
    expect(by[EXTRA_COL.cgmQty]).toBe("4");
    expect(by[EXTRA_COL.cartridgeQty]).toBe("");
    // ⚠️ A status clear is {}, never {index: null} (§5.31c).
    expect(by[EXTRA_COL.primaryContact]).toEqual({});
    expect(by[EXTRA_COL.alternateContact]).toEqual({ index: 7 });
    expect(by[EXTRA_COL.caregiverName]).toBe("Pat Helper");
    // The same checkbox shape Welcome Call and Insurance already send.
    expect(by[EXTRA_COL.caregiverAuthorized]).toEqual({ checked: "true" });
    // ⚠️ A phone is {phone, countryShortName}, never the bare string, which a
    // phone column refuses at HTTP 200 (§5.31d).
    expect(by[EXTRA_COL.alternatePhone]).toEqual({ phone: "5555550199", countryShortName: "US" });
  });

  it("unticking the checkbox and blanking the phone are clears", () => {
    const tasks = buildExtrasTasks("8000", { caregiverAuthorized: false, alternatePhone: "" });
    const by = Object.fromEntries(tasks.map((t) => [t.columnId, t.value]));
    expect(by[EXTRA_COL.caregiverAuthorized]).toEqual({});
    expect(by[EXTRA_COL.alternatePhone]).toEqual({});
  });

  it("an empty delta writes nothing at all", () => {
    expect(buildExtrasTasks("8000", {})).toEqual([]);
  });

  it("⚠️ a refused change set throws before a single task exists", () => {
    expect(() => buildExtrasTasks("8000", { alternatePhone: "555-0100" })).toThrow(/Alternate phone/);
    expect(() => buildExtrasTasks("8000", { cgmQty: "three" })).toThrow(/CGM qty/);
  });

  it("⚠️ never writes Can Text, Last Patient Contact, the eligibility date or OOP remaining — they are shown, not edited", () => {
    const ids = buildExtrasTasks("8000", {
      orderFrequencyIndex: 2,
      cgmQty: "4",
      cartridgeQty: "4",
      primaryContactIndex: 7,
      alternateContactIndex: 7,
      caregiverName: "x",
      caregiverAuthorized: true,
      alternatePhone: "5555550199",
    }).map((t) => t.columnId);
    for (const readOnly of [
      EXTRA_COL.canText,
      EXTRA_COL.lastPatientContact,
      EXTRA_COL.lastEligibilityCheck,
      EXTRA_COL.oopRemaining,
    ]) {
      expect(ids).not.toContain(readOnly);
    }
  });
});
