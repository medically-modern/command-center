import { describe, it, expect } from "vitest";
import {
  INTAKE_STATUS_INDEX, statusIndexFor,
  verifiedInsuranceBlocker, buildAdvanceTasks, buildIntakeTasks,
  buildVerifiedInsuranceTasks, advanceToMedicalNecessity, proposeStuckNoteLine,
  type AdvanceInput,
} from "./unverifiedWrite";
import { COL } from "./mondayApi";
import { proposeStuckLevel } from "../shared/stageActions";
import type { Patient } from "./workflow";

/**
 * These indices are the contract between this app and board 18406352652.
 * Monday drops a status write for an unknown label without erroring, and a
 * WRONG index files the patient under a different answer just as silently —
 * so the index is the thing worth guarding, not the label text.
 *
 * Every value below was read back from the live board's `settings_str` on
 * 2026-08-06, not assumed from the create call. That distinction caught a real
 * bug: Monday ignored the index we asked for on Secondary Insurance.
 */
describe("intake status index map", () => {
  it("matches the indices the board actually assigned", () => {
    expect(INTAKE_STATUS_INDEX.selfAdvocacy).toEqual({ High: 0, Low: 1 });
    expect(INTAKE_STATUS_INDEX.intakeCallComplete).toEqual({ Yes: 0 });
    expect(INTAKE_STATUS_INDEX.formProceedPreference).toEqual({
      "Send request now": 0,
      "Wants a call first": 1,
    });
    expect(INTAKE_STATUS_INDEX.formBookingStatus).toEqual({ Scheduled: 0, Unscheduled: 1 });
    expect(INTAKE_STATUS_INDEX.formPumpNeed).toEqual({
      "Need a new pump": 0,
      "Only need supplies": 1,
    });
    expect(INTAKE_STATUS_INDEX.cgmDataAwareness["Both apply"]).toBe(3);
    expect(INTAKE_STATUS_INDEX.formReasonForInquiry["I want off the finger prick / try a pump"]).toBe(3);
    expect(INTAKE_STATUS_INDEX.formCgmPreference["Any will work"]).toBe(3);
    expect(INTAKE_STATUS_INDEX.formPumpPreference["Not sure"]).toBe(3);
  });

  /**
   * The regression this file exists for. We created Secondary Insurance asking
   * for NYS Medicaid at index 5; Monday left 5 blank and placed it at 11.
   * Writing 5 would have silently set an EMPTY label — a patient on Medicaid
   * filed as nothing at all.
   */
  it("uses the index Monday really gave NYS Medicaid, not the one we asked for", () => {
    expect(INTAKE_STATUS_INDEX.formSecondaryProvided["NYS Medicaid"]).toBe(11);
    expect(INTAKE_STATUS_INDEX.formSecondaryProvided["NYS Medicaid"]).not.toBe(5);
  });

  it("keeps the rest of the secondary payer list on its verified indices", () => {
    expect(INTAKE_STATUS_INDEX.formSecondaryProvided).toMatchObject({
      "Anthem or Blue Cross Blue Shield": 0,
      UnitedHealthcare: 1,
      Aetna: 2,
      Cigna: 3,
      Humana: 4,
      Medicare: 6,
      Fidelis: 7,
      "NYSHIP Empire": 8,
      Other: 9,
      None: 10,
    });
  });

  it("never maps a label to the blank slot the board left at 5", () => {
    const used = Object.values(INTAKE_STATUS_INDEX.formSecondaryProvided);
    expect(used).not.toContain(5);
  });
});

describe("statusIndexFor", () => {
  it("resolves a known label", () => {
    expect(statusIndexFor("selfAdvocacy", "High")).toBe(0);
    expect(statusIndexFor("selfAdvocacy", "Low")).toBe(1);
  });

  it("tolerates surrounding whitespace", () => {
    expect(statusIndexFor("formBookingStatus", "  Scheduled  ")).toBe(0);
  });

  it("returns undefined rather than guessing an index", () => {
    // A skipped write leaves the column alone; a guessed index writes the
    // wrong answer. Undefined is the safe failure.
    expect(statusIndexFor("selfAdvocacy", "Medium")).toBeUndefined();
    expect(statusIndexFor("selfAdvocacy", "")).toBeUndefined();
    expect(statusIndexFor("selfAdvocacy", undefined)).toBeUndefined();
  });

  it("does not resolve index 0 as falsy-skip", () => {
    // Index 0 is a real, writable value — a truthiness check here would
    // silently drop every "High" / "Yes" / "Send request now".
    expect(statusIndexFor("intakeCallComplete", "Yes")).toBe(0);
    expect(statusIndexFor("intakeCallComplete", "Yes")).not.toBeUndefined();
  });
});

/**
 * The advance path.
 *
 * Every test below runs WITHOUT a Monday token: each exercises either a pure
 * function or a path that short-circuits before the first network call. That's
 * deliberate — the defects these cover all shipped green, because the only
 * thing that would have caught them was a live board.
 */

const patient = (over: Partial<Patient> = {}) =>
  ({ id: "123", name: "Test Patient", ...over }) as unknown as Patient;

const columnsOf = (tasks: { columnId: string }[]) => tasks.map((t) => t.columnId);

describe("verifiedInsuranceBlocker", () => {
  it("refuses NY Medicaid with no Member ID 2", () => {
    expect(verifiedInsuranceBlocker({ secondaryInsurance: "NY Medicaid" })?.columnId).toBe(COL.memberId2);
  });

  it("allows NY Medicaid once Member ID 2 is filled", () => {
    expect(verifiedInsuranceBlocker({ secondaryInsurance: "NY Medicaid", memberId2: "M123" })).toBeNull();
  });

  it("treats a whitespace-only Member ID 2 as missing", () => {
    expect(verifiedInsuranceBlocker({ secondaryInsurance: "NY Medicaid", memberId2: "   " })).not.toBeNull();
  });

  it("does not block any other secondary", () => {
    expect(verifiedInsuranceBlocker({ secondaryInsurance: "Aetna" })).toBeNull();
  });
});

describe("buildAdvanceTasks", () => {
  const input: AdvanceInput = {
    edits: { dob: "01/02/1990" },
    verified: { primaryInsurance: "Aetna Commercial", memberId1: "M1" },
  };

  it("carries the left pane, the verified insurance AND the doctor in ONE list", () => {
    // The regression: these were three separate passes, and only the doctor
    // block was verified before the advancer flipped. Automation 7917676280
    // reads all of them.
    const cols = columnsOf(buildAdvanceTasks(patient({ doctorName: "Dr Who", doctorNpi: "1234567890" }), input));
    expect(cols).toContain(COL.dob);              // left pane
    expect(cols).toContain(COL.primaryInsurance); // verified insurance
    expect(cols).toContain(COL.memberId1);
    expect(cols).toContain(COL.doctorName);       // doctor
    expect(cols).toContain(COL.doctorNpi);
  });

  it("emits ONE task per column, with the picked provider winning Clinic Address", () => {
    // Two builders write location_mm1xjnfv: the left pane's Provided Doctor
    // Info, and buildDoctorTasks from the step-3 pick. Both firing inside one
    // transaction is a race whose winner decides the patient's clinic address.
    const tasks = buildAdvanceTasks(
      patient({ doctorName: "Dr Who", clinicAddress: "9 Verified Way" }),
      { edits: { clinicAddress: "1 Patient Said St" }, verified: {} },
    );
    const addressTasks = tasks.filter((t) => t.columnId === COL.clinicAddress);
    expect(addressTasks).toHaveLength(1);
    // Last wins, and the doctor block is appended last.
    expect(addressTasks[0].label).toBe("Clinic Address");

    const ids = columnsOf(tasks);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("never includes the stage advancer — verifiedWrite has to hold that back itself", () => {
    const cols = columnsOf(buildAdvanceTasks(patient({ doctorName: "Dr Who" }), input));
    expect(cols).not.toContain(COL.moveToOnboarding);
  });

  it("is empty when there is nothing to write", () => {
    expect(buildAdvanceTasks(patient(), { edits: {}, verified: {} })).toEqual([]);
  });
});

describe("advanceToMedicalNecessity refusals", () => {
  // Both return before any network call, so they are safe to assert on with no
  // token and no mocking.
  it("refuses before writing anything when Member ID 2 is missing for NY Medicaid", async () => {
    const res = await advanceToMedicalNecessity(patient({ doctorName: "Dr Who" }), {
      edits: { dob: "01/02/1990" },
      verified: { secondaryInsurance: "NY Medicaid" },
    });
    expect(res.ok).toBe(false);
    expect(res.errors[0].columnId).toBe(COL.memberId2);
  });

  it("refuses to advance when there is no data column to verify first", async () => {
    // verifiedWrite skips its snapshot and read-back phases when there are no
    // data columns, so this shape would fire the advancer completely unverified.
    const res = await advanceToMedicalNecessity(patient(), { edits: {}, verified: {} });
    expect(res.ok).toBe(false);
    expect(res.errors[0].columnId).toBe(COL.moveToOnboarding);
    expect(res.errors[0].error).toMatch(/refusing to advance/i);
  });
});

describe("intake task builders keep provided and verified apart", () => {
  it("never lets a left-pane save touch the verified doctor columns (HANDOFF §6.0)", () => {
    const cols = columnsOf(buildIntakeTasks("123", {
      formProvidedDoctorName: "Dr Patient-Said",
      formProvidedClinicPhone: "3475550101",
    }));
    expect(cols).toContain(COL.formProvidedDoctorName);
    expect(cols).not.toContain(COL.doctorName);
    expect(cols).not.toContain(COL.doctorPhone);
  });

  it("skips a field the rep never touched rather than blanking the board", () => {
    expect(buildIntakeTasks("123", {})).toEqual([]);
    expect(buildVerifiedInsuranceTasks("123", {})).toEqual([]);
  });

  it("treats an empty string as a deliberate clear, unlike undefined", () => {
    expect(columnsOf(buildIntakeTasks("123", { dob: "" }))).toContain(COL.dob);
    expect(columnsOf(buildIntakeTasks("123", { dob: undefined }))).not.toContain(COL.dob);
  });

  it("SKIPS a status label it doesn't know rather than guessing an index", () => {
    // Writing the wrong index would file the patient under the wrong answer, so
    // an unrecognised label is dropped. Worth pinning: it means a label renamed
    // on the board stops being written with no error anywhere (§5.2).
    expect(buildVerifiedInsuranceTasks("123", { primaryInsurance: "Aetna" })).toEqual([]);
    expect(columnsOf(buildVerifiedInsuranceTasks("123", { primaryInsurance: "Aetna Commercial" })))
      .toContain(COL.primaryInsurance);
  });
});

describe("write paths added for the mockup port", () => {
  it("writes Gender and Address, which had no write path before", () => {
    const cols = columnsOf(buildIntakeTasks("123", {
      gender: "Female",
      patientAddress: "122 Elderberry Ln, Central Square, NY 13036",
    }));
    expect(cols).toContain(COL.gender);
    expect(cols).toContain(COL.patientAddress);
  });

  it("skips an unknown Gender label rather than guessing", () => {
    expect(columnsOf(buildIntakeTasks("123", { gender: "M" }))).not.toContain(COL.gender);
    expect(columnsOf(buildIntakeTasks("123", { gender: "Male" }))).toContain(COL.gender);
  });

  it("writes CGM Type and Pump Type — the device, not the stated preference", () => {
    const cols = columnsOf(buildIntakeTasks("123", { cgmType: "Dexcom G7", pumpType: "Mobi" }));
    expect(cols).toContain(COL.cgmType);
    expect(cols).toContain(COL.pumpType);
    // Distinct columns from what the patient said they wanted.
    expect(COL.cgmType).not.toBe(COL.formCgmPreference);
    expect(COL.pumpType).not.toBe(COL.formPumpPreference);
  });

  it("writes the Follow Up flag and its date", () => {
    const cols = columnsOf(buildIntakeTasks("123", { followUp: "Follow Up", followUpDate: "2026-08-10" }));
    expect(cols).toContain(COL.followUp);
    expect(cols).toContain(COL.followUpDate);
  });

  it("does not raise the Follow Up flag for a blank value", () => {
    // The column has a single label, so "" means "leave it alone" — writing
    // index 1 anyway would flag every patient whose save touched the field.
    expect(columnsOf(buildIntakeTasks("123", { followUp: "" }))).not.toContain(COL.followUp);
  });

  it("never lets a bulk save clear the snooze", () => {
    // followUp/followUpDate belong to logAttempt. writeDate with a blank string
    // CLEARS the column, so round-tripping them through Save is a way to
    // un-snooze a patient back onto the burndown by accident.
    const cols = columnsOf(buildIntakeTasks("123", { dob: "01/02/1990", followUpDate: "" }));
    expect(cols).toContain(COL.followUpDate); // explicit callers still can
    const save = columnsOf(buildIntakeTasks("123", { dob: "01/02/1990" }));
    expect(save).not.toContain(COL.followUpDate);
    expect(save).not.toContain(COL.followUp);
  });

  it("NEVER writes the notes column from a bulk save", () => {
    // The Call Log is append-only (appendIntakeNote). If `notes` could ride
    // along in IntakeEdits, the first save from a bound textarea would replace
    // the entire history with one line.
    const everything = buildIntakeTasks("123", {
      name: "Richard Clark", dob: "01/02/1990", gender: "Male",
      patientAddress: "1 Main St", followUp: "Follow Up", followUpDate: "2026-08-10",
      selfAdvocacy: "High", currentOopCost: "$75/month",
    });
    expect(columnsOf(everything)).not.toContain(COL.notes);
  });
});

describe("Propose Stuck stamps where it came from", () => {
  // The label is what a manager reads in the Call Log to tell a rep's proposal
  // apart from a second opinion on someone else's.
  const line = (origin: Parameters<typeof proposeStuckNoteLine>[1]) =>
    proposeStuckNoteLine("no insurance on file", origin);

  it("leaves a processor's proposal unlabelled", () => {
    expect(line("processor")).toBe("Proposed stuck: no insurance on file");
  });

  it("names Manager Escalation and Final Escalation", () => {
    expect(line("manager-intervention"))
      .toBe("Proposed stuck — Manager Escalation: no insurance on file");
    expect(line("final-decisions"))
      .toBe("Proposed stuck — Final Escalation: no insurance on file");
  });

  it("always carries the reason, whatever the rung", () => {
    for (const o of ["processor", "manager-intervention", "final-decisions"] as const) {
      expect(line(o)).toContain("no insurance on file");
    }
  });
});

describe("intake climbs the shared Propose Stuck ladder", () => {
  it("starts a rep's proposal at Manager Intervention", () => {
    expect(proposeStuckLevel("unverified-intake", null, "")).toBe("manager");
  });

  it("promotes to Final when a manager proposes from Manager Intervention", () => {
    expect(proposeStuckLevel("unverified-intake", "manager-intervention", "")).toBe("final");
  });

  it("promotes to Final when the patient is already escalated", () => {
    expect(proposeStuckLevel("unverified-intake", null, "Manager Escalation Required")).toBe("final");
  });
});

/**
 * §5.2 — the four product dropdowns now take their options from the board, so
 * the WRITE path has to resolve against the same live map. Without this the
 * picker offers a label the hardcoded map has never heard of, `mapped()` skips
 * it, and the rep's choice is silently discarded: right dropdown, no write, no
 * error. These pin that the live map wins and that the hardcoded one is still
 * the fallback when the settings fetch failed.
 */
describe("live board labels drive the status write (§5.2)", () => {
  /** Run one task against a stubbed fetch and return the index it POSTed.
   *  The index is the whole point — asserting only that a task EXISTS would
   *  pass just as happily with the stale hardcoded value. */
  const indexWritten = async (
    tasks: { columnId: string; fn: () => Promise<unknown> }[],
    columnId: string,
  ): Promise<number> => {
    const task = tasks.find((t) => t.columnId === columnId);
    if (!task) throw new Error(`no task for ${columnId}`);
    let body = "";
    const real = globalThis.fetch;
    // gql() refuses to run without a token, and in direct mode it reads one
    // straight off import.meta.env.
    const env = import.meta.env as Record<string, unknown>;
    const realToken = env.VITE_MONDAY_API_TOKEN;
    env.VITE_MONDAY_API_TOKEN = "test-token";
    globalThis.fetch = ((_url: string, init: { body: string }) => {
      body = init.body;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ data: {} }) });
    }) as unknown as typeof fetch;
    try {
      await task.fn();
    } finally {
      globalThis.fetch = real;
      env.VITE_MONDAY_API_TOKEN = realToken;
    }
    return JSON.parse(JSON.parse(body).variables.value).index;
  };

  it("writes a label the hardcoded map has never heard of", () => {
    // Nothing here without the live map — this is the regression.
    expect(columnsOf(buildIntakeTasks("123", { cgmType: "Dexcom G8" }))).not.toContain(COL.cgmType);
    const live = { [COL.cgmType]: { "Dexcom G8": 9 } };
    expect(columnsOf(buildIntakeTasks("123", { cgmType: "Dexcom G8" }, live)))
      .toContain(COL.cgmType);
  });

  it("prefers the live index over the hardcoded one for the SAME label", async () => {
    // A board can renumber a label; the live read is the newer truth. Dexcom
    // G7 is 6 in the hardcoded map, so 3 can only have come from the live one.
    const live = { [COL.cgmType]: { "Dexcom G7": 3 } };
    expect(await indexWritten(buildIntakeTasks("123", { cgmType: "Dexcom G7" }, live), COL.cgmType))
      .toBe(3);
    expect(await indexWritten(buildIntakeTasks("123", { cgmType: "Dexcom G7" }), COL.cgmType))
      .toBe(6);
  });

  it("falls back to the hardcoded map for a column the fetch didn't return", () => {
    // A partial fetch must not take out the columns it did not cover.
    const live = { [COL.cgmType]: { "Dexcom G7": 3 } };
    expect(columnsOf(buildIntakeTasks("123", { pumpType: "Mobi" }, live))).toContain(COL.pumpType);
  });

  it("degrades to today's behaviour when the fetch failed entirely", () => {
    expect(columnsOf(buildIntakeTasks("123", { cgmType: "Dexcom G7" }, {})))
      .toContain(COL.cgmType);
  });

  it("still skips a label neither map knows", () => {
    const live = { [COL.cgmType]: { "Dexcom G8": 9 } };
    expect(columnsOf(buildIntakeTasks("123", { cgmType: "Not A Real Device" }, live)))
      .not.toContain(COL.cgmType);
  });

  it("carries the live map through the advance transaction too", () => {
    // buildAdvanceTasks wraps buildIntakeTasks — an advance that dropped the
    // live map would write a stale index on the way out of the stage, which is
    // the worst possible moment for it.
    const p = { id: "123" } as Patient;
    const opts: AdvanceInput = {
      edits: { cgmType: "Dexcom G8" },
      verified: {},
      liveIndex: { [COL.cgmType]: { "Dexcom G8": 9 } },
    };
    expect(columnsOf(buildAdvanceTasks(p, opts))).toContain(COL.cgmType);
    expect(columnsOf(buildAdvanceTasks(p, { ...opts, liveIndex: undefined })))
      .not.toContain(COL.cgmType);
  });
});
