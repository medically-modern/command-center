/**
 * The three "no new records" replies.
 *
 * Two things here are safety rules rather than formatting, and both are pinned
 * below: an appointment date can only ever come from "Same old records"
 * (writing it arms an automated fax at the Doctor Fax on the item, which a
 * "New provider" reply has just told us is the wrong office), and a field
 * belonging to an answer the rep did not choose never reaches the board.
 */
import { describe, it, expect } from "vitest";
import {
  RECORDS_REPLY_OPTIONS,
  EMPTY_RECORDS_REPLY,
  recordsReplyNote,
  recordsReplyApptDate,
  recordsReplyProblems,
  canSaveRecordsReply,
  prunedRecordsReply,
  appointmentAlreadyPassed,
  recordsReplyOption,
  type RecordsReplyDraft,
} from "./recordsReply";

const draft = (patch: Partial<RecordsReplyDraft> = {}): RecordsReplyDraft => ({
  ...EMPTY_RECORDS_REPLY,
  ...patch,
});

describe("the three answers", () => {
  it("offers exactly what Brandon asked for, and an appointment on one of them", () => {
    expect(RECORDS_REPLY_OPTIONS.map((o) => o.id)).toEqual(["same-records", "new-provider", "other"]);
    expect(RECORDS_REPLY_OPTIONS.filter((o) => o.takesAppointment).map((o) => o.id)).toEqual(["same-records"]);
    // Only "Other" is meaningless without words — the other two say something
    // on their own, so their detail is offered, not demanded.
    expect(RECORDS_REPLY_OPTIONS.filter((o) => o.detail?.required).map((o) => o.id)).toEqual(["other"]);
  });

  it("reads back the option a choice names", () => {
    expect(recordsReplyOption("new-provider")?.label).toBe("New provider");
    expect(recordsReplyOption(null)).toBeNull();
  });
});

describe("what gets written", () => {
  it("writes Brandon's line: the choice, then the appointment", () => {
    const d = draft({ choice: "same-records", apptDate: "2026-10-13" });
    expect(recordsReplyNote(d)).toBe("Same old records — next appt 10/13/2026");
    expect(recordsReplyApptDate(d)).toBe("2026-10-13");
  });

  it("takes the choice alone when there is nothing to add", () => {
    expect(recordsReplyNote(draft({ choice: "same-records" }))).toBe("Same old records");
    expect(recordsReplyApptDate(draft({ choice: "same-records" }))).toBe("");
  });

  it("carries the new provider's details, and never an appointment date", () => {
    // The date field is not even rendered for this answer; this pins that a
    // value carried over in state cannot leak through the rule either.
    const d = draft({ choice: "new-provider", detail: "Dr Ruiz, Bay Shore Endocrine", apptDate: "2026-10-13" });
    expect(recordsReplyNote(d)).toBe("New provider — Dr Ruiz, Bay Shore Endocrine");
    expect(recordsReplyApptDate(d)).toBe("");
  });

  it("puts Other in her own words", () => {
    const d = draft({ choice: "other", detail: "not seen since 2025, will not return calls" });
    expect(recordsReplyNote(d)).toBe("Other — not seen since 2025, will not return calls");
  });

  it("drops the fields the chosen answer does not offer", () => {
    // She types a provider, changes her mind, picks Same old records. That text
    // must not be written under the wrong heading.
    const d = draft({ choice: "same-records", detail: "Dr Ruiz", apptDate: "2026-10-13" });
    expect(prunedRecordsReply(d)).toEqual({ choice: "same-records", apptDate: "2026-10-13", detail: "" });
    expect(recordsReplyNote(d)).toBe("Same old records — next appt 10/13/2026");
  });

  it("trims, so a stray space is not a detail", () => {
    expect(recordsReplyNote(draft({ choice: "other", detail: "   " }))).toBe("");
    expect(recordsReplyNote(draft({ choice: "new-provider", detail: "  Dr Ruiz  " }))).toBe("New provider — Dr Ruiz");
  });
});

describe("what cannot be saved", () => {
  it("needs an answer first", () => {
    expect(canSaveRecordsReply(draft())).toBe(false);
    expect(recordsReplyProblems(draft())).toEqual(["Pick what the office came back with."]);
  });

  it("refuses an empty Other, because it records nothing", () => {
    const d = draft({ choice: "other" });
    expect(canSaveRecordsReply(d)).toBe(false);
    expect(recordsReplyProblems(d)[0]).toContain("records nothing");
  });

  it("accepts New provider with no details — the move itself is the news", () => {
    expect(canSaveRecordsReply(draft({ choice: "new-provider" }))).toBe(true);
    expect(recordsReplyNote(draft({ choice: "new-provider" }))).toBe("New provider");
  });

  it("never returns a half-written note or a date for a draft it refused", () => {
    const bad = draft({ choice: "other", apptDate: "2026-10-13" });
    expect(canSaveRecordsReply(bad)).toBe(false);
    expect(recordsReplyNote(bad)).toBe("");
    expect(recordsReplyApptDate(bad)).toBe("");
  });

  it("rejects a date that is not one", () => {
    const d = draft({ choice: "same-records", apptDate: "next tuesday" });
    expect(recordsReplyProblems(d)).toEqual(["That appointment date is not a date."]);
    expect(recordsReplyApptDate(d)).toBe("");
  });
});

describe("an appointment already in the past", () => {
  it("is allowed, but reported — monday fires date automations on arrival only", () => {
    // "They came in last Tuesday" is a real thing an office says. It saves, and
    // the page says the follow-up chase will not be scheduled off it, because a
    // date that has already passed arms nothing and nothing else would say so.
    const past = draft({ choice: "same-records", apptDate: "2026-09-01" });
    expect(canSaveRecordsReply(past)).toBe(true);
    expect(appointmentAlreadyPassed(past, "2026-09-17")).toBe(true);

    expect(appointmentAlreadyPassed(draft({ choice: "same-records", apptDate: "2026-10-13" }), "2026-09-17")).toBe(false);
    expect(appointmentAlreadyPassed(draft({ choice: "same-records", apptDate: "2026-09-17" }), "2026-09-17")).toBe(false);
  });

  it("says nothing when there is no date to say it about", () => {
    expect(appointmentAlreadyPassed(draft({ choice: "same-records" }), "2026-09-17")).toBe(false);
    expect(appointmentAlreadyPassed(draft({ choice: "new-provider", apptDate: "2020-01-01" }), "2026-09-17")).toBe(false);
  });
});
