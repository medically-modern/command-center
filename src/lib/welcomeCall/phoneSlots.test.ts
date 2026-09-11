import { describe, it, expect } from "vitest";
import {
  welcomeCallTextBlock,
  slotsFromPatient,
  addSlot,
  starSlot,
  removeSlot,
  setSlotNumber,
  setSlotOwner,
  setSlotCanText,
  oppositeOwner,
  ownerFromLabel,
  canTextFromLabel,
  formatCaregiver,
  parseCaregiver,
  caregiverPanelVisible,
  phoneSlotGaps,
  phoneSlotWrites,
  CONTACT_LABEL_ID,
  CAN_TEXT_LABEL_ID,
  type PhoneSlot,
} from "./phoneSlots";

const source = (over: Partial<Parameters<typeof slotsFromPatient>[0]> = {}) => ({
  phone: "(555) 555-0100",
  alternatePhone: "",
  primaryContact: "Patient",
  alternateContact: "",
  canText: "Yes",
  // The age default only fills a BLANK Primary Contact, so every fixture that
  // states one is unaffected by it — this keeps the type happy and the
  // existing expectations meaningful.
  dob: "",
  ...over,
});

const slot = (over: Partial<PhoneSlot> = {}): PhoneSlot => ({
  number: "5555550100",
  owner: "patient",
  starred: true,
  canText: "yes",
  ...over,
});

describe("label vocabulary", () => {
  it("reads the board's two contact labels", () => {
    expect(ownerFromLabel("Patient")).toBe("patient");
    expect(ownerFromLabel("Caregiver")).toBe("caregiver");
  });

  it("reads an UNRECOGNISED contact label as unset, never as the other one", () => {
    expect(ownerFromLabel("")).toBe("");
    expect(ownerFromLabel("Spouse")).toBe("");
  });

  it("reads a blank Can Text as UNKNOWN, never as No", () => {
    // The whole point: a blank means nobody asked. A fabricated No sends this
    // patient's reorders to a call queue.
    expect(canTextFromLabel("")).toBe("");
    expect(canTextFromLabel("No")).toBe("no");
    expect(canTextFromLabel("Yes")).toBe("yes");
  });

  it("reads an unrecognised Can Text label as unknown", () => {
    expect(canTextFromLabel("Landline")).toBe("");
  });

  it("pins the write ids read back off the live board", () => {
    // ⚠️ Monday derived these from the label COLOUR, not the display order the
    // create call asked for. A write to an id that does not exist is dropped
    // with no error, so this test is the only thing that would catch a drift.
    expect(CONTACT_LABEL_ID.patient).toBe(7);
    expect(CONTACT_LABEL_ID.caregiver).toBe(4);
    expect(CAN_TEXT_LABEL_ID.yes).toBe(1);
    expect(CAN_TEXT_LABEL_ID.no).toBe(2);
  });
});

describe("slotsFromPatient", () => {
  it("builds one starred slot from Primary Phone", () => {
    const s = slotsFromPatient(source());
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ number: "(555) 555-0100", owner: "patient", starred: true, canText: "yes" });
  });

  it("builds a second slot when the board holds an Alternate Phone", () => {
    const s = slotsFromPatient(source({ alternatePhone: "5555550199", alternateContact: "Caregiver" }));
    expect(s).toHaveLength(2);
    expect(s[1]).toMatchObject({ number: "5555550199", owner: "caregiver", starred: false });
  });

  it("leaves slot 2's Can Text blank — the column only describes the primary", () => {
    const s = slotsFromPatient(source({ alternatePhone: "5555550199", alternateContact: "Patient" }));
    expect(s[1].canText).toBe("");
  });

  it("does NOT infer slot 2's owner from Primary Contact", () => {
    // The reason Alternate Contact exists as a column. A blank stays blank and
    // the rep is asked, rather than the app guessing "the other one".
    const s = slotsFromPatient(source({ alternatePhone: "5555550199", primaryContact: "Caregiver", alternateContact: "" }));
    expect(s[1].owner).toBe("");
  });

  it("survives a two-caregiver household — the case inference got wrong", () => {
    const s = slotsFromPatient(
      source({ primaryContact: "Caregiver", alternatePhone: "5555550199", alternateContact: "Caregiver" }),
    );
    expect(s.map((x) => x.owner)).toEqual(["caregiver", "caregiver"]);
  });
});

describe("adding, starring and removing", () => {
  it("opens slot 2 on the opposite owner", () => {
    expect(oppositeOwner("patient")).toBe("caregiver");
    expect(oppositeOwner("caregiver")).toBe("patient");
    expect(oppositeOwner("")).toBe("");
    const s = addSlot([slot({ owner: "patient" })]);
    expect(s[1].owner).toBe("caregiver");
  });

  it("caps at two slots", () => {
    const two = addSlot([slot()]);
    expect(addSlot(two)).toHaveLength(2);
  });

  it("moves the star, leaving exactly one", () => {
    const s = starSlot(addSlot([slot()]), 1);
    expect(s.map((x) => x.starred)).toEqual([false, true]);
  });

  it("starring the other slot shows an unanswered Can Text", () => {
    // Brandon: "if the star moves to the other slot, clear it so the rep
    // re-answers for the new primary". Per-slot storage satisfies that by
    // construction — slot 2 has never been answered for.
    const s = starSlot(addSlot([slot({ canText: "yes" })]), 1);
    expect(s[1].canText).toBe("");
  });

  it("keeps each slot's own answer when the star moves back", () => {
    // The one place this deviates from a literal reading, deliberately:
    // re-asking about a number nothing changed about is a wasted question.
    let s = addSlot([slot({ canText: "yes" })]);
    s = setSlotCanText(starSlot(s, 1), 1, "no");
    s = starSlot(s, 0);
    expect(s[0].canText).toBe("yes");
    expect(s[1].canText).toBe("no");
  });

  it("deleting the starred slot makes the survivor primary", () => {
    // Otherwise the list carries no star and the send has no Primary Phone.
    const s = removeSlot(addSlot([slot()]), 0);
    expect(s).toHaveLength(1);
    expect(s[0].starred).toBe(true);
  });

  it("deleting the unstarred slot leaves the star alone", () => {
    const s = removeSlot(addSlot([slot()]), 1);
    expect(s).toHaveLength(1);
    expect(s[0].starred).toBe(true);
  });
});

describe("editing a number", () => {
  it("clears that slot's Can Text — the answer was about the old number", () => {
    const s = setSlotNumber([slot({ canText: "yes" })], 0, "5555550199");
    expect(s[0].canText).toBe("");
  });

  it("does NOT clear on a reformat of the same digits", () => {
    const s = setSlotNumber([slot({ number: "5555550100", canText: "yes" })], 0, "(555) 555-0100");
    expect(s[0].canText).toBe("yes");
  });

  it("leaves the other slot untouched", () => {
    const two = setSlotCanText(addSlot([slot({ canText: "yes" })]), 1, "no");
    const s = setSlotNumber(two, 0, "5555550123");
    expect(s[1].canText).toBe("no");
  });
});

describe("caregiver name round-trip", () => {
  it("joins the two boxes into one column value", () => {
    expect(formatCaregiver("Jane Doe", "daughter")).toBe("Jane Doe (daughter)");
  });

  it("writes a bare name when there is no relationship", () => {
    expect(formatCaregiver("Jane Doe", "")).toBe("Jane Doe");
  });

  it("writes nothing at all with no name", () => {
    expect(formatCaregiver("", "daughter")).toBe("");
  });

  it("parses back", () => {
    expect(parseCaregiver("Jane Doe (daughter)")).toEqual({ name: "Jane Doe", relationship: "daughter" });
  });

  it("treats a value with no bracket as all name", () => {
    expect(parseCaregiver("Jane Doe")).toEqual({ name: "Jane Doe", relationship: "" });
  });

  it("splits on the LAST group, so a bracketed name survives", () => {
    expect(parseCaregiver("Bob Smith (Sr) (son)")).toEqual({ name: "Bob Smith (Sr)", relationship: "son" });
  });

  it("round-trips every shape", () => {
    for (const [n, r] of [["Jane Doe", "daughter"], ["Jane Doe", ""], ["Bob Smith (Sr)", "son"]] as const) {
      expect(parseCaregiver(formatCaregiver(n, r))).toEqual({ name: n, relationship: r });
    }
  });
});

describe("caregiverPanelVisible", () => {
  it("shows for a caregiver on EITHER slot", () => {
    expect(caregiverPanelVisible([slot({ owner: "patient" })])).toBe(false);
    expect(caregiverPanelVisible([slot({ owner: "caregiver" })])).toBe(true);
    expect(
      caregiverPanelVisible([slot({ owner: "patient" }), slot({ owner: "caregiver", starred: false })]),
    ).toBe(true);
  });
});

describe("phoneSlotGaps", () => {
  it("is empty when the starred slot is fully answered", () => {
    expect(phoneSlotGaps([slot()])).toEqual([]);
  });

  it("asks for a number when there is none", () => {
    expect(phoneSlotGaps([slot({ number: "" })])).toHaveLength(1);
  });

  it("asks who the number belongs to", () => {
    expect(phoneSlotGaps([slot({ owner: "" })]).join(" ")).toMatch(/patient's or a caregiver's/);
  });

  it("requires the Can Text answer on the starred slot", () => {
    expect(phoneSlotGaps([slot({ canText: "" })]).join(" ")).toMatch(/can receive texts/);
  });

  it("does NOT require Can Text on the unstarred slot", () => {
    const two = addSlot([slot()]);
    const filled = setSlotNumber(two, 1, "5555550199");
    const owned = setSlotOwner(filled, 1, "caregiver");
    expect(phoneSlotGaps(owned)).toEqual([]);
  });

  it("ignores an empty second slot the rep thought better of", () => {
    expect(phoneSlotGaps(addSlot([slot()]))).toEqual([]);
  });

  it("refuses a number Monday could not store", () => {
    // ⚠️ `writePhone` SKIPS an unparseable number rather than throwing, so
    // without this the send reports success having written nothing.
    expect(phoneSlotGaps([slot({ number: "555-121" })]).join(" ")).toMatch(/can't be saved/);
  });

  it("accepts a number a rep typed the way the provider says it", () => {
    // Reps type "(347) 555-0102" and "347-555-0102"; both are storable and
    // must not be reported — a gate that fires on ordinary input gets ignored.
    for (const n of ["(347) 555-0102", "347-555-0102", "3475550102"]) {
      expect(phoneSlotGaps([slot({ number: n })])).toEqual([]);
    }
  });
});

describe("welcomeCallTextBlock", () => {
  it("allows the send when the starred number takes texts", () => {
    expect(welcomeCallTextBlock([slot({ canText: "yes" })])).toBeNull();
  });

  it("BLOCKS when the starred number is marked No", () => {
    // Not a warning. The automation texts Primary Phone, RingCentral ACCEPTS a
    // text to a landline and only fails it seconds later (§5.5), so a
    // click-through warning buys a green toast and a patient who heard nothing.
    expect(welcomeCallTextBlock([slot({ canText: "no" })])).toMatch(/not able to receive texts/);
  });

  it("does NOT block on an unanswered Can Text", () => {
    // Blank is unknown, not No — and this button is pressed mid-call, often
    // before the rep has reached that question.
    expect(welcomeCallTextBlock([slot({ canText: "" })])).toBeNull();
  });

  it("blocks when there is no number at all", () => {
    expect(welcomeCallTextBlock([slot({ number: "" })])).toMatch(/Add the patient's phone number/);
  });

  it("blocks a number Monday could not store", () => {
    expect(welcomeCallTextBlock([slot({ number: "555-121" })])).toMatch(/can't be saved/);
  });

  it("reads the STARRED slot, not the first one", () => {
    // The whole point of the star: a rep who stars the caregiver's cell must
    // have that number judged, not the one the board still holds.
    let s = addSlot([slot({ number: "5555550100", canText: "yes" })]);
    s = setSlotNumber(s, 1, "5555550199");
    s = starSlot(s, 1);
    s = setSlotCanText(s, 1, "no");
    expect(welcomeCallTextBlock(s)).toMatch(/5555550199/);
  });
});

describe("phoneSlotWrites", () => {
  const noCaregiver = { name: "", relationship: "", authorized: false };

  it("writes the starred slot to Primary and clears Alternate when there is one number", () => {
    const w = phoneSlotWrites([slot()], noCaregiver);
    expect(w.primaryPhone).toBe("5555550100");
    expect(w.alternatePhone).toBe("");
    expect(w.primaryContactId).toBe(CONTACT_LABEL_ID.patient);
    expect(w.alternateContactId).toBeNull();
    expect(w.canTextId).toBe(CAN_TEXT_LABEL_ID.yes);
  });

  it("sends the OLD number to Alternate when the rep stars a new one", () => {
    // The handoff's headline behaviour: "if a rep adds a second number and
    // stars it, the old number is written to Alternate Phone automatically".
    let s = addSlot([slot({ number: "5555550100", owner: "patient" })]);
    s = setSlotNumber(s, 1, "5555550199");
    s = setSlotOwner(s, 1, "caregiver");
    s = starSlot(s, 1);
    s = setSlotCanText(s, 1, "yes");
    const w = phoneSlotWrites(s, { name: "Jane Doe", relationship: "daughter", authorized: true });
    expect(w.primaryPhone).toBe("5555550199");
    expect(w.alternatePhone).toBe("5555550100");
    expect(w.primaryContactId).toBe(CONTACT_LABEL_ID.caregiver);
    expect(w.alternateContactId).toBe(CONTACT_LABEL_ID.patient);
  });

  it("leaves the primary untouched when a second number is added and NOT starred", () => {
    let s = addSlot([slot({ number: "5555550100" })]);
    s = setSlotOwner(setSlotNumber(s, 1, "5555550199"), 1, "caregiver");
    const w = phoneSlotWrites(s, noCaregiver);
    expect(w.primaryPhone).toBe("5555550100");
    expect(w.alternatePhone).toBe("5555550199");
  });

  it("writes only the FINAL state, however many times the star moved", () => {
    let s = addSlot([slot({ number: "5555550100" })]);
    s = setSlotOwner(setSlotNumber(s, 1, "5555550199"), 1, "caregiver");
    s = starSlot(starSlot(starSlot(s, 1), 0), 1);
    expect(phoneSlotWrites(s, noCaregiver).primaryPhone).toBe("5555550199");
  });

  it("drops an empty slot rather than writing a blank number with a live owner", () => {
    const s = addSlot([slot()]);
    const w = phoneSlotWrites(s, noCaregiver);
    expect(w.alternatePhone).toBe("");
    expect(w.alternateContactId).toBeNull();
  });

  it("nulls a status rather than writing an id when the answer is unset", () => {
    const w = phoneSlotWrites([slot({ owner: "", canText: "" })], noCaregiver);
    expect(w.primaryContactId).toBeNull();
    expect(w.canTextId).toBeNull();
  });

  it("writes the caregiver when a slot is theirs", () => {
    const w = phoneSlotWrites([slot({ owner: "caregiver" })], {
      name: "Jane Doe",
      relationship: "daughter",
      authorized: true,
    });
    expect(w.caregiverName).toBe("Jane Doe (daughter)");
    expect(w.caregiverAuthorized).toBe(true);
  });

  it("CLEARS the caregiver record when no slot is a caregiver any more", () => {
    // A stale name plus a standing HIPAA tick against a patient who no longer
    // shares their account is a record that says the wrong thing.
    const w = phoneSlotWrites([slot({ owner: "patient" })], {
      name: "Jane Doe",
      relationship: "daughter",
      authorized: true,
    });
    expect(w.caregiverName).toBe("");
    expect(w.caregiverAuthorized).toBe(false);
  });
});
