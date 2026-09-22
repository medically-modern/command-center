/**
 * The contacts rule (§5.46e). Every case below is one that would be SILENT on
 * screen: a blank Can Text read as a No blocks texting for the whole board, a
 * timestamp parsed as an instant lands on the wrong day, and a phantom status
 * index renders as a number nobody can act on.
 */
import { describe, expect, it } from "vitest";
import {
  buildContacts,
  contactsColumns,
  contactsFor,
  formatLastContact,
  readCanText,
  CONTACT_COL,
} from "./contacts";

const SUB = 18407459988;
const WC = 18410804557;
const OTHER = 18406060017;

const C = CONTACT_COL[SUB];
const W = CONTACT_COL[WC];

describe("contactsColumns", () => {
  it("is seven on Subscription and six on Welcome Call", () => {
    expect(contactsColumns(SUB)).toHaveLength(7);
    // ⚠️ Welcome Call has NO Last Patient Contact column — its full column list
    // was read on 2026-09-22 and there is none. Asking for an id that does not
    // exist is not an error on Monday, it is a field that reads blank for ever.
    expect(contactsColumns(WC)).toHaveLength(6);
    expect(contactsColumns(WC)).not.toContain("text_mm5frhe9");
  });

  it("is empty for a board that carries no contacts", () => {
    expect(contactsColumns(OTHER)).toEqual([]);
  });

  it("names the live Subscription ids", () => {
    expect(contactsColumns(SUB)).toEqual([
      "color_mm72vm7p",
      "color_mm723hfk",
      "text_mm72mdzk",
      "boolean_mm72nt75",
      "phone_mm72r19q",
      "color_mm72jg9e",
      "text_mm5frhe9",
    ]);
  });
});

describe("buildContacts", () => {
  it("returns null for a board with no contacts columns", () => {
    expect(buildContacts(OTHER, { anything: "x" })).toBeNull();
  });

  it("reads the whole block off a filled-in row", () => {
    const c = buildContacts(SUB, {
      [C.primaryContact]: "Caregiver",
      [C.alternateContact]: "Patient",
      [C.caregiverName]: "Kathleen Sobiegraj (Mother)",
      // ⚠️ Monday returns a ticked checkbox's text as the literal "v".
      [C.caregiverAuthorized]: "v",
      [C.alternatePhone]: "6803233249",
      [C.canText]: "Yes",
      [C.lastPatientContact!]: "2026-09-17T19:59 in call",
    })!;
    expect(c.primaryContact).toBe("Caregiver");
    expect(c.alternateContact).toBe("Patient");
    expect(c.caregiverName).toBe("Kathleen Sobiegraj (Mother)");
    expect(c.caregiverAuthorized).toBe(true);
    expect(c.alternatePhone).toBe("(680) 323-3249");
    expect(c.alternatePhoneRaw).toBe("6803233249");
    expect(c.canText).toBe("yes");
    expect(c.lastPatientContact).toBe("Sep 17, 2026, 7:59 PM · call");
    expect(c.any).toBe(true);
  });

  it("is all-blank and `any: false` on an untouched row", () => {
    const c = buildContacts(SUB, {})!;
    expect(c.any).toBe(false);
    expect(c.caregiverAuthorized).toBe(false);
    expect(c.alternatePhone).toBe("");
    expect(c.alternatePhoneRaw).toBe("");
    expect(c.canText).toBe("unknown");
    expect(c.lastPatientContact).toBe("");
  });

  it("⚠️ never formats a blank alternate phone into `Unknown`", () => {
    // fmtPhone("") answers "Unknown", which would print on every patient.
    expect(buildContacts(SUB, { [C.alternatePhone]: "" })!.alternatePhone).toBe("");
  });

  it("⚠️ a phantom status index reads as blank, not as a number", () => {
    // Live rows carry `{"index":5}` on Alternate Contact — a label id that
    // column does not have — and Monday answers `text: null` for it, which is
    // also what its own is_not_empty rule says. Reading `text` is what makes
    // that a blank rather than something rendered.
    const c = buildContacts(SUB, { [C.alternateContact]: "" })!;
    expect(c.alternateContact).toBe("");
  });

  it("reads Welcome Call's own ids, and has no last-contact there", () => {
    const c = buildContacts(WC, {
      [W.caregiverName]: "Gill (Daughter)",
      [W.alternatePhone]: "5406595890",
      [W.canText]: "No",
    })!;
    expect(c.caregiverName).toBe("Gill (Daughter)");
    expect(c.alternatePhone).toBe("(540) 659-5890");
    expect(c.canText).toBe("no");
    expect(c.lastPatientContact).toBe("");
    expect(c.any).toBe(true);
  });

  it("counts each field on its own towards `any`", () => {
    const one = (id: string, v = "x") => buildContacts(SUB, { [id]: v })!.any;
    expect(one(C.primaryContact, "Patient")).toBe(true);
    expect(one(C.alternateContact, "Patient")).toBe(true);
    expect(one(C.caregiverName)).toBe(true);
    expect(one(C.caregiverAuthorized, "v")).toBe(true);
    expect(one(C.alternatePhone, "6803233249")).toBe(true);
    expect(one(C.canText, "No")).toBe(true);
    expect(one(C.lastPatientContact!, "2026-09-17T19:59 in call")).toBe(true);
    // An unrecognised Can Text is unknown, so it is NOT an answer.
    expect(one(C.canText, "Maybe")).toBe(false);
  });
});

describe("⚠️ readCanText — a blank is UNKNOWN, never a No", () => {
  it("only an explicit label answers", () => {
    expect(readCanText("Yes")).toBe("yes");
    expect(readCanText("no")).toBe("no");
    expect(readCanText("")).toBe("unknown");
    expect(readCanText("   ")).toBe("unknown");
    // A vocabulary that grows announces itself to nobody, so a label we have no
    // rule for must not be read as the negative (§5.20, §5.31d).
    expect(readCanText("Landline")).toBe("unknown");
    expect(readCanText("Unknown")).toBe("unknown");
  });
});

describe("formatLastContact", () => {
  it("formats the live shape", () => {
    expect(formatLastContact("2026-09-17T19:59 in call")).toBe("Sep 17, 2026, 7:59 PM · call");
    expect(formatLastContact("2026-09-01T18:11 in sms")).toBe("Sep 1, 2026, 6:11 PM · sms");
  });

  it("works without a channel", () => {
    expect(formatLastContact("2026-09-21T16:16")).toBe("Sep 21, 2026, 4:16 PM");
  });

  it("⚠️ is midnight/noon safe and never shifts the day", () => {
    // The value is naive Eastern wall clock (§5.15). Parsed as an instant it
    // moves by the container's offset, which is a different DAY either side of
    // midnight — and this test would fail in UTC if it ever went through Date.
    expect(formatLastContact("2026-09-17T00:05 in sms")).toBe("Sep 17, 2026, 12:05 AM · sms");
    expect(formatLastContact("2026-09-17T23:55 in sms")).toBe("Sep 17, 2026, 11:55 PM · sms");
    expect(formatLastContact("2026-09-17T12:00 in call")).toBe("Sep 17, 2026, 12:00 PM · call");
  });

  it("⚠️ returns an unrecognised value VERBATIM", () => {
    expect(formatLastContact("called her mum")).toBe("called her mum");
    expect(formatLastContact("2026-13-40T99:99")).toBe("2026-13-40T99:99");
    expect(formatLastContact("")).toBe("");
  });
});

describe("contactsFor", () => {
  const sub = { itemId: "sub", boardId: SUB, cols: {} as Record<string, string> };
  const wc = {
    itemId: "wc",
    boardId: WC,
    cols: { [W.caregiverName]: "Gill (Daughter)" } as Record<string, string>,
  };
  const ins = { itemId: "ins", boardId: OTHER, cols: {} as Record<string, string> };

  it("prefers the live record when it has a block", () => {
    const filled = { ...sub, cols: { [C.caregiverName]: "Maria" } };
    expect(contactsFor([filled, wc], "sub")!.caregiverName).toBe("Maria");
  });

  it("⚠️ falls back to another record that HAS one", () => {
    // A patient sitting in Insurance has no contacts columns on their live
    // board at all; their caregiver is on the Welcome Call record, and
    // contacts are a fact about the human, not about the cycle.
    expect(contactsFor([ins, wc], "ins")!.caregiverName).toBe("Gill (Daughter)");
    // Same when the live record maps but is empty.
    expect(contactsFor([sub, wc], "sub")!.caregiverName).toBe("Gill (Daughter)");
  });

  it("returns the live record's empty block when nothing is filled in", () => {
    const c = contactsFor([sub], "sub");
    expect(c).not.toBeNull();
    expect(c!.any).toBe(false);
  });

  it("⚠️ returns null when NO record carries contacts", () => {
    // "This board does not carry contacts" and "nobody has filled them in" are
    // different answers, and the column renders differently for each.
    expect(contactsFor([ins], "ins")).toBeNull();
    expect(contactsFor([])).toBeNull();
  });
});
