/**
 * WHICH field a header-search row matched on — Brandon's precedence, kept
 * exactly (§5.52). Fixtures are 555 numbers and made-up ids.
 */
import { describe, expect, it } from "vitest";
import { HIT_MIN_MEMBER_DIGITS, searchHit } from "./searchHit";
import { FIELD_MIN_MEMBER_DIGITS, type SearchFieldValues, type SystemPatient } from "@/lib/systemMgmt/mondayApi";

const fields = (over: Partial<SearchFieldValues> = {}): SearchFieldValues => ({
  memberIds: [],
  doctors: [],
  clinics: [],
  doctorPhones: [],
  insurances: [],
  orderNumbers: [],
  poNumbers: [],
  trackingNumbers: [],
  ...over,
});

function row(over: Partial<SystemPatient> = {}): SystemPatient {
  return {
    id: "1",
    name: "JAMIE RIVERS",
    phone: "5555550142",
    dob: "03/14/1958",
    boardId: 18410601299,
    boardName: "Insurance",
    groupId: "g",
    groupTitle: "Benefits",
    roleRoute: "/benefits",
    pipelineStage: "Benefits / SoS",
    escalated: false,
    escalationText: "",
    escalationLevel: null,
    escalationNotes: "",
    hasPage: true,
    isCompleted: false,
    daysSinceStage: "",
    notes: "",
    stageAdvancerText: "",
    nextActionDate: "",
    stageStart: "",
    createdAt: "",
    fields: fields({
      memberIds: ["W123456789"],
      doctors: ["SMITH, JOHN"],
      clinics: ["Endo Associates"],
      doctorPhones: ["5555550199"],
      insurances: ["Humana"],
    }),
    ...over,
  };
}

describe("a name query", () => {
  it("⚠️ a NAME match prints nothing — the name is the row", () => {
    expect(searchHit([row()], "jamie rivers")).toBeNull();
    expect(searchHit([row()], "rivers, jamie")).toBeNull();
  });

  it("member id, then doctor, then clinic, then insurance", () => {
    expect(searchHit([row()], "w1234")).toEqual({ label: "Member ID", value: "W123456789" });
    expect(searchHit([row()], "smith")).toEqual({ label: "Doctor", value: "SMITH, JOHN" });
    expect(searchHit([row()], "endo")).toEqual({ label: "Doctor", value: "Endo Associates" });
    expect(searchHit([row()], "humana")).toEqual({ label: "Insurance", value: "Humana" });
  });

  it("matches a multi-word query as the PHRASE, like the board was asked", () => {
    expect(searchHit([row({ fields: fields({ insurances: ["Health Plans Inc (PHCS)"] }) })], "health plans")).toEqual({
      label: "Insurance",
      value: "Health Plans Inc (PHCS)",
    });
  });

  it("⚠️ reads every folded record, not just the lead — the member id is usually on another board", () => {
    const lead = row({ id: "lead", boardId: 18410804557, fields: fields() });
    const insurance = row({ id: "ins" });
    expect(searchHit([lead, insurance], "w1234")).toEqual({ label: "Member ID", value: "W123456789" });
  });

  it("a loose (one-word) name match prints nothing either", () => {
    expect(searchHit([row({ matchedBy: "partial" })], "jamie rivera")).toBeNull();
  });

  it("returns null when nothing fetched explains the row, rather than inventing a reason", () => {
    expect(searchHit([row()], "zzzz")).toBeNull();
    expect(searchHit([row({ fields: undefined })], "humana")).toBeNull();
  });
});

describe("a digits query", () => {
  it("phone first, then DOB, then member id, then doctor phone", () => {
    expect(searchHit([row()], "0142")).toEqual({ label: "Phone", value: "5555550142" });
    expect(searchHit([row()], "1958")).toEqual({ label: "DOB", value: "03/14/1958" });
    expect(searchHit([row()], "3456")).toEqual({ label: "Member ID", value: "W123456789" });
    expect(searchHit([row()], "0199")).toEqual({ label: "Doctor phone", value: "SMITH, JOHN · 5555550199" });
  });

  it("a number typed with its country code still finds the phone", () => {
    expect(searchHit([row()], "+1 555 555 0142")).toEqual({ label: "Phone", value: "5555550142" });
  });

  it(`⚠️ needs ${HIT_MIN_MEMBER_DIGITS} digits before DOB or member id count`, () => {
    // Three digits are the phone floor; inside a nine-digit id they are noise.
    expect(HIT_MIN_MEMBER_DIGITS).toBe(FIELD_MIN_MEMBER_DIGITS);
    expect(searchHit([row({ phone: "", fields: fields({ memberIds: ["W123456789"] }) })], "345")).toBeNull();
  });

  it("an order's identifiers: order number, PO, tracking", () => {
    const order = row({
      boardId: 18405457690,
      fields: fields({ orderNumbers: ["1120085378"], poNumbers: ["MM-13012345-20260901"], trackingNumbers: ["1Z999AA10123456784"] }),
      phone: "",
      dob: "",
    });
    expect(searchHit([order], "1120085378")).toEqual({ label: "Order #", value: "1120085378" });
    expect(searchHit([order], "13012345")).toEqual({ label: "PO #", value: "MM-13012345-20260901" });
    expect(searchHit([order], "10123456784")).toEqual({ label: "Tracking", value: "1Z999AA10123456784" });
  });

  it("a PO number typed with its letters is a name query and still names the PO", () => {
    const order = row({ boardId: 18405457690, fields: fields({ poNumbers: ["MM-13012345-20260901"] }) });
    expect(searchHit([order], "MM-13012345-20260901")).toEqual({ label: "PO #", value: "MM-13012345-20260901" });
  });
});

describe("a date of birth", () => {
  it("names the DOB, whichever padding was typed", () => {
    expect(searchHit([row()], "3/14/1958")).toEqual({ label: "DOB", value: "03/14/1958" });
    expect(searchHit([row()], "03-14-1958")).toEqual({ label: "DOB", value: "03/14/1958" });
  });

  it("is null when no record carries that date", () => {
    expect(searchHit([row()], "01/01/1990")).toBeNull();
  });
});

describe("edges", () => {
  it("no rows, or a query too short to have been asked", () => {
    expect(searchHit([], "humana")).toBeNull();
    expect(searchHit([row()], "h")).toBeNull();
  });
});
