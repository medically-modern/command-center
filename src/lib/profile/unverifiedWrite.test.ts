import { describe, it, expect } from "vitest";
import { INTAKE_STATUS_INDEX, statusIndexFor } from "./unverifiedWrite";

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
