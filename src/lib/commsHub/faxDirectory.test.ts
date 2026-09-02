import { describe, it, expect } from "vitest";
import {
  buildFaxDirectory,
  faxDigits,
  isChasing,
  type DoctorDbRow,
  type FaxMatchRow,
} from "./faxDirectory";

const ME = 18406060017, INS = 18410601299, WC = 18410804557;

function row(over: Partial<FaxMatchRow> = {}): FaxMatchRow {
  return {
    itemId: "1",
    name: "Kai Burridge",
    boardId: ME,
    boardName: "Medical Evaluation",
    groupTitle: "Medical Necessity",
    isCompleted: false,
    isStuck: false,
    route: "/evaluate",
    stage: "Evaluate MN",
    clinicalsMethod: "Fax",
    nextActionDate: "2026-09-02",
    doctorName: "Dr. Alice Ng",
    clinicName: "UNC Health",
    npi: "1234567890",
    doctorPhone: "+19195550123",
    doctorFax: "9843215678@rcfax.com",
    ...over,
  };
}

describe("faxDigits", () => {
  it("reads the number out of the rcfax address the app writes", () => {
    expect(faxDigits("9843215678@rcfax.com")).toBe("9843215678");
  });

  it("reads a bare number typed straight into Monday", () => {
    expect(faxDigits("(984) 321-5678")).toBe("9843215678");
    expect(faxDigits("+19843215678")).toBe("9843215678");
  });

  it("never takes digits out of the domain", () => {
    expect(faxDigits("@rcfax24.com")).toBe("");
  });

  it("is empty for a blank column", () => {
    expect(faxDigits("")).toBe("");
  });
});

describe("isChasing", () => {
  it("is true only on Medical Evaluation at the Chase Clinicals stage", () => {
    expect(isChasing({ boardId: ME, stage: "Chase Clinicals", isCompleted: false, isStuck: false })).toBe(true);
    expect(isChasing({ boardId: ME, stage: "Evaluate MN", isCompleted: false, isStuck: false })).toBe(false);
    expect(isChasing({ boardId: INS, stage: "Chase Clinicals", isCompleted: false, isStuck: false })).toBe(false);
  });

  it("is false for a finished or stuck record", () => {
    expect(isChasing({ boardId: ME, stage: "Chase Clinicals", isCompleted: true, isStuck: false })).toBe(false);
    expect(isChasing({ boardId: ME, stage: "Chase Clinicals", isCompleted: false, isStuck: true })).toBe(false);
  });
});

describe("buildFaxDirectory", () => {
  it("matches on digits, whatever shape the column holds", () => {
    const d = buildFaxDirectory("+1 (984) 321-5678", [row(), row({ itemId: "2", name: "Other", doctorFax: "2125550000" })]);
    expect(d.patients.map((p) => p.name)).toEqual(["Kai Burridge"]);
    expect(d.provider?.clinicName).toBe("UNC Health");
  });

  it("reports no provider when nobody carries the number", () => {
    const d = buildFaxDirectory("+12125559999", [row()]);
    expect(d.provider).toBeNull();
    expect(d.patients).toEqual([]);
  });

  it("puts Chase Clinicals patients first — the fax is probably theirs", () => {
    const d = buildFaxDirectory("9843215678", [
      row({ itemId: "1", name: "Anna", stage: "Evaluate MN", nextActionDate: "2026-09-01" }),
      row({ itemId: "2", name: "Ben", stage: "Chase Clinicals", nextActionDate: "2026-09-09" }),
    ]);
    expect(d.patients.map((p) => p.name)).toEqual(["Ben", "Anna"]);
    expect(d.patients[0].inChase).toBe(true);
  });

  it("leads with the patient nothing is going to surface on its own", () => {
    // A blank next-action date means no queue will raise them.
    const d = buildFaxDirectory("9843215678", [
      row({ itemId: "1", name: "Anna", stage: "Evaluate MN", nextActionDate: "2026-09-01" }),
      row({ itemId: "2", name: "Ben", stage: "Evaluate MN", nextActionDate: "" }),
    ]);
    expect(d.patients.map((p) => p.name)).toEqual(["Ben", "Anna"]);
  });

  it("counts finished and stuck patients rather than listing them", () => {
    const d = buildFaxDirectory("9843215678", [
      row({ itemId: "1", name: "Anna" }),
      row({ itemId: "2", name: "Ben", isCompleted: true }),
      row({ itemId: "3", name: "Cara", isStuck: true }),
    ]);
    expect(d.patients.map((p) => p.name)).toEqual(["Anna"]);
    expect(d.inactiveCount).toBe(2);
  });

  it("shows one row per patient, preferring the chase record", () => {
    // A patient can hold live items on two boards at once.
    const d = buildFaxDirectory("9843215678", [
      row({ itemId: "wc", name: "Anna", boardId: WC, boardName: "Welcome Call", stage: "Welcome Call" }),
      row({ itemId: "me", name: "Anna", boardId: ME, stage: "Chase Clinicals" }),
    ]);
    expect(d.patients).toHaveLength(1);
    expect(d.patients[0].itemId).toBe("me");
  });

  it("builds the provider card from the fullest value of each FIELD", () => {
    // One board's record has the name, another has the NPI — neither row is
    // complete on its own.
    const d = buildFaxDirectory("9843215678", [
      row({ itemId: "1", doctorName: "", npi: "", clinicName: "UNC Health" }),
      row({ itemId: "2", name: "Ben", doctorName: "Dr. Alice Ng", npi: "1234567890", clinicName: "" }),
    ]);
    expect(d.provider).toMatchObject({ doctorName: "Dr. Alice Ng", npi: "1234567890", clinicName: "UNC Health" });
  });

  it("matches nothing for an unusable fax number rather than everything", () => {
    expect(buildFaxDirectory("123", [row()]).patients).toEqual([]);
  });
});


function dbRow(over: Partial<DoctorDbRow> = {}): DoctorDbRow {
  return {
    itemId: "d1",
    doctorName: "Dr. Robert Hass",
    clinicName: "Bradford Regional Medical Center",
    npi: "1962819813",
    phone: "7163757500",
    fax: "7167016854@rcfax.com",
    ...over,
  };
}

describe("Doctor Database fallback — an office we know but aren't chasing", () => {
  it("names the office when no patient carries the fax number", () => {
    // The patient boards hold the doctor for the patients ON them; the Doctor
    // Database holds every office we have on file. Searching only the former is
    // what made a fax from a real practice read as an unknown number.
    const entry = buildFaxDirectory("+17167016854", [], [dbRow()]);
    expect(entry.provider).toMatchObject({
      doctorName: "Dr. Robert Hass",
      clinicName: "Bradford Regional Medical Center",
      npi: "1962819813",
      source: "doctorDb",
    });
    expect(entry.patients).toEqual([]);
  });

  it("strips the @rcfax.com suffix on the database side too", () => {
    // Same join as the patient boards: comparing the stored value to a phone
    // number matches nothing, with no error.
    expect(buildFaxDirectory("(716) 701-6854", [], [dbRow()]).provider?.source).toBe("doctorDb");
    expect(buildFaxDirectory("+17167016854", [], [dbRow({ fax: "7167016854" })]).provider?.source).toBe("doctorDb");
  });

  it("lets the PATIENT rows win — they are the doctor as we recorded them", () => {
    const entry = buildFaxDirectory(
      "+19843215678",
      [row()],
      [dbRow({ fax: "9843215678@rcfax.com", doctorName: "Dr. Someone Else" })],
    );
    expect(entry.provider).toMatchObject({ doctorName: "Dr. Alice Ng", source: "patients" });
  });

  it("ignores a database row whose fax is a coincidental tail match", () => {
    const entry = buildFaxDirectory("+17167016854", [], [dbRow({ fax: "9996854@rcfax.com" })]);
    expect(entry.provider).toBeNull();
  });

  it("still reports nothing when neither source knows the number", () => {
    // (858) 366-6900 on 2026-09-02: audited against every doctor fax column,
    // every doctor phone column and the Doctor Database — genuinely absent.
    expect(buildFaxDirectory("+18583666900", [row()], [dbRow()]).provider).toBeNull();
  });
});
