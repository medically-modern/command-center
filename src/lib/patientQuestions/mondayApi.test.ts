import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchPatientQuestions, longTextParts } from "./mondayApi";

/**
 * Regression coverage for the Monday *boundary*.
 *
 * handled.test.ts already pins the reopen arithmetic, and it passed the whole
 * time this was broken — because it feeds clean ISO strings. The defect lived
 * one layer out: the real column payload spells its timestamp `changed_at`,
 * the reader looked for `updated_at`, and the resulting "" made every
 * already-handled row defer to its handled mark forever. So the payloads below
 * are copied verbatim from the live Subscription Board rather than invented.
 */

const SUB_BOARD_ID = 18407459988;
const CLAIMS_BOARD_ID = 18413019028;

// Item 11807414997, captured 2026-08-09. Message written 18:56:42Z; the row was
// marked handled on 07-13, so it is only visible if the reopen path can read
// the message time.
const HOFFMAN_MESSAGE_VALUE =
  '{"text":"[6/7/26, 2:02 PM ET]\\nThis is lovely!\\n\\n[8/9/26, 2:56 PM ET]\\nWhen will the autosoft 30 be avail? :D","changed_at":"2026-08-09T18:56:42.028Z"}';
const HOFFMAN_HANDLED_VALUE =
  '{"date":"2026-07-13","time":"15:13:22","changed_at":"2026-07-13T15:13:23.374Z"}';
// The reorder form writes this column via toLocaleString — Date.parse says NaN.
const HOFFMAN_RESPONSE_TS = "Aug 9, 2026, 2:57 PM ET";

function item(id: string, name: string, cols: Record<string, { text?: string; value?: string }>) {
  return {
    id,
    name,
    column_values: Object.entries(cols).map(([k, v]) => ({
      id: k,
      text: v.text ?? null,
      value: v.value ?? null,
    })),
  };
}

function mockBoards(itemsByBoard: Record<number, ReturnType<typeof item>[]>) {
  return vi.fn(async (_url: string, init: { body: string }) => {
    const { variables } = JSON.parse(init.body);
    const items = itemsByBoard[Number(variables.boardId)] ?? [];
    return {
      ok: true,
      json: async () => ({ data: { boards: [{ items_page: { cursor: null, items } }] } }),
    };
  });
}

describe("longTextParts", () => {
  const withValue = (value: string) =>
    longTextParts(item("1", "x", { c: { text: "body", value } }), "c");

  it("reads Monday's `changed_at` off a real long-text value", () => {
    expect(withValue(HOFFMAN_MESSAGE_VALUE).updatedAt).toBe("2026-08-09T18:56:42.028Z");
  });

  it("still accepts an `updated_at` spelling", () => {
    expect(withValue('{"text":"hi","updated_at":"2026-08-09T18:56:42.028Z"}').updatedAt)
      .toBe("2026-08-09T18:56:42.028Z");
  });

  it("degrades to empty on a missing or malformed value", () => {
    expect(longTextParts(item("1", "x", { c: {} }), "c").updatedAt).toBe("");
    expect(withValue("not json").updatedAt).toBe("");
    expect(withValue('{"text":"hi"}').updatedAt).toBe("");
  });
});

describe("fetchPatientQuestions — handled/reopen at the Monday boundary", () => {
  beforeEach(() => vi.stubEnv("VITE_MONDAY_API_TOKEN", "test-token"));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reopens a handled row once the patient writes again", async () => {
    vi.stubGlobal("fetch", mockBoards({
      [SUB_BOARD_ID]: [item("11807414997", "Joshua Hoffman", {
        long_text_mm3xnb6k: { text: "…", value: HOFFMAN_MESSAGE_VALUE },
        text_mm3kt9bs: { text: HOFFMAN_RESPONSE_TS, value: `"${HOFFMAN_RESPONSE_TS}"` },
        date_mm57yzmb: { text: "2026-07-13 11:13", value: HOFFMAN_HANDLED_VALUE },
      })],
      [CLAIMS_BOARD_ID]: [],
    }));

    const questions = await fetchPatientQuestions();

    expect(questions.map((q) => q.name)).toEqual(["Joshua Hoffman"]);
    expect(questions[0].message).toContain("When will the autosoft 30 be avail?");
  });

  it("keeps a row hidden while its handled mark is newer than the message", async () => {
    vi.stubGlobal("fetch", mockBoards({
      [SUB_BOARD_ID]: [item("1", "Already Handled", {
        long_text_mm3xnb6k: { text: "…", value: HOFFMAN_MESSAGE_VALUE },
        date_mm57yzmb: { value: '{"date":"2026-08-10","time":"00:00:00"}' },
      })],
      [CLAIMS_BOARD_ID]: [],
    }));

    expect(await fetchPatientQuestions()).toEqual([]);
  });

  it("gives every question a sortable timestamp, newest first", async () => {
    vi.stubGlobal("fetch", mockBoards({
      [SUB_BOARD_ID]: [
        item("older", "Older", {
          long_text_mm3xnb6k: { text: "…", value: '{"text":"a","changed_at":"2026-07-28T18:45:56.347Z"}' },
          // Unparseable, and previously won the || chain — pinning newest-first
          // here is what guards the epoch-0 sort collapse.
          text_mm3kt9bs: { text: HOFFMAN_RESPONSE_TS, value: `"${HOFFMAN_RESPONSE_TS}"` },
        }),
        item("newer", "Newer", {
          long_text_mm3xnb6k: { text: "…", value: HOFFMAN_MESSAGE_VALUE },
        }),
      ],
      [CLAIMS_BOARD_ID]: [],
    }));

    const questions = await fetchPatientQuestions();

    expect(questions.map((q) => q.name)).toEqual(["Newer", "Older"]);
    for (const q of questions) {
      expect(Number.isNaN(Date.parse(q.messageUpdatedAt))).toBe(false);
    }
  });
});
