import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { unsavableDoctorFields, isDoctorEditField, DOCTOR_EDIT_FIELDS, followDoctorContact } from "./doctorEdits";
import { buildDoctorWriteTasks, saveDoctorEdits, COL } from "./mondayApi";

/**
 * Provider edits on Medical Evaluation (2026-09-29). A rep corrected a
 * patient's doctor fax — the board's was the office's PHONE line — and the fix
 * never reached Monday: the fax column is an EMAIL column, a typed number is
 * not an address, and `writeEmail` skips what it can't parse without a word.
 */

type Call = { query: string };

function mockMonday(opts: { failOn?: string } = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const { query } = JSON.parse(init.body) as { query: string };
    calls.push({ query });
    if (opts.failOn && query.includes(opts.failOn)) {
      return { ok: true, json: async () => ({ errors: [{ message: "label not found" }] }) };
    }
    return { ok: true, json: async () => ({ data: { change_column_value: { id: "1" } } }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

describe("unsavableDoctorFields", () => {
  it("passes a clean draft, including a fax typed as a phone number", () => {
    expect(
      unsavableDoctorFields({
        doctorName: "Test Doctor",
        doctorPhone: "(215) 555-0199",
        doctorFax: "(215) 555-0100",
        doctorEmail: "records@clinic.com",
      }),
    ).toEqual([]);
  });

  it("catches a phone Monday would silently drop", () => {
    expect(unsavableDoctorFields({ doctorPhone: "215555019" })).toEqual(["Doctor Phone (needs 10 digits)"]);
  });

  it("catches a truncated fax — it would save, and go nowhere", () => {
    expect(unsavableDoctorFields({ doctorFax: "215555010" })).toEqual([
      "Doctor Fax (needs a 10-digit fax number)",
    ]);
    expect(unsavableDoctorFields({ doctorFax: "n/a" })).toEqual([
      "Doctor Fax (needs a 10-digit fax number)",
    ]);
  });

  it("catches an unparseable email", () => {
    expect(unsavableDoctorFields({ doctorEmail: "drsmith@" })).toEqual(["Doctor Email (not a valid address)"]);
  });

  it("lets a blank through — clearing is a real edit", () => {
    expect(unsavableDoctorFields({ doctorPhone: "", doctorFax: "", doctorEmail: "" })).toEqual([]);
  });

  it("says nothing about fields the rep didn't touch", () => {
    expect(unsavableDoctorFields({ doctorName: "Dr. Who" })).toEqual([]);
  });
});

describe("followDoctorContact — Send Request's To box follows a corrected fax", () => {
  const OLD = "2155550199@rcfax.com";

  it("replaces the prefilled fax in place", () => {
    expect(followDoctorContact([OLD, "nurse@clinic.com"], OLD, "2155550100")).toEqual([
      "2155550100",
      "nurse@clinic.com",
    ]);
  });

  it("follows keystroke by keystroke — cleared, then retyped", () => {
    let box = [OLD];
    let prev = OLD;
    for (const next of ["", "2", "21", "2155550100"]) {
      box = followDoctorContact(box, prev, next) ?? box;
      prev = next;
    }
    expect(box).toEqual(["2155550100"]);
  });

  it("never adds a second fax to the same office in another format", () => {
    expect(followDoctorContact([OLD, "(215) 555-0100"], OLD, "2155550100@rcfax.com")).toEqual([
      "(215) 555-0100",
    ]);
  });

  it("stops following once the rep removed the prefilled entry by hand", () => {
    expect(followDoctorContact(["2155550111"], OLD, "2155550100")).toBeNull();
  });

  it("leaves the box alone when nothing changed", () => {
    const box = [OLD];
    expect(followDoctorContact(box, OLD, OLD)).toBe(box);
  });
});

describe("isDoctorEditField", () => {
  it("knows the six grid fields and nothing else", () => {
    for (const f of DOCTOR_EDIT_FIELDS) expect(isDoctorEditField(f)).toBe(true);
    expect(isDoctorEditField("mnEvalNotes")).toBe(false);
    expect(isDoctorEditField("name")).toBe(false);
  });
});

describe("the provider writers", () => {
  beforeEach(() => vi.stubEnv("VITE_MONDAY_API_TOKEN", "test-token"));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("buildDoctorWriteTasks writes a typed fax as <digits>@rcfax.com instead of skipping it", async () => {
    const calls = mockMonday();
    const tasks = buildDoctorWriteTasks({ id: "123", doctorFax: "(215) 555-0100" });
    expect(tasks.map((t) => t.label)).toEqual(["Doctor Fax"]);
    await tasks[0].run();
    expect(calls).toHaveLength(1);
    expect(calls[0].query).toContain(COL.doctorFax);
    expect(calls[0].query).toContain("2155550100@rcfax.com");
  });

  it("saveDoctorEdits writes only the touched fields, one at a time, clinic last", async () => {
    const calls = mockMonday();
    await saveDoctorEdits("123", { clinicName: "Test Clinic", doctorFax: "2155550100" });
    expect(calls.map((c) => (c.query.includes(COL.doctorFax) ? "fax" : c.query.includes(COL.clinicName) ? "clinic" : "?"))).toEqual([
      "fax",
      "clinic",
    ]);
  });

  it("names the field that Monday refused", async () => {
    mockMonday({ failOn: COL.clinicName });
    await expect(saveDoctorEdits("123", { doctorFax: "2155550100", clinicName: "Nope" })).rejects.toThrow(
      /^Clinic Name: label not found/,
    );
  });
});
