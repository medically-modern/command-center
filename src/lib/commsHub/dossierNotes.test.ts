/**
 * The Communications Hub note writer, and the one thing about it that is
 * silently wrong until a rep tries it on the wrong board.
 *
 * ── WHAT BROKE ──
 * `appendNoteToRecord` shipped (2026-09-01) writing `{"text": …}` — the
 * `long_text` value shape — for every board. Six of the seven notes columns in
 * the `BOARDS` registry really are `long_text`, so it worked wherever anyone
 * tried it. The seventh, Profile Send Off's `text_mm389fs` ("Profile Send Off
 * Notes"), is a plain `text` column, which takes a bare JSON string instead.
 *
 * Monday's answer to the wrong shape is HTTP 200 with a GraphQL `errors[]`
 * carrying *"invalid value, please check our API documentation for the correct
 * data structure for this column"* — so the note is not written, the rep gets a
 * toast full of protocol text, and it fails for Profile Send Off patients only:
 * the top of the funnel, i.e. the people a rep is most often on the phone with
 * in this hub. It would have read as "notes are broken for these patients", not
 * as a type error.
 *
 * ⚠️ Found by audit, not by a failure: the gateway log shows this composer was
 * never used on a Profile Send Off record before it was fixed, so no rep hit
 * it. It is NOT the cause of the "invalid value" alert of the same day — that
 * was a bulk Clinic Address backfill sending a `location` value with no
 * lat/lng. Two different columns, two different writers, one error message.
 *
 * `profile/unverifiedWrite.appendIntakeNote` already carried a comment warning
 * about this exact crossing. A comment in one file cannot help a second
 * consumer in another, so the type is now DECLARED (`BoardDef.notesColType`)
 * and carried on the record — and these tests are what keep the declaration
 * honest, in both directions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BOARDS } from "../systemMgmt/mondayApi";
import { appendNoteToRecord } from "./dossierApi";
import { MONDAY_LONG_TEXT_MAX } from "../shared/longText";
import { invalidateColumnTypes } from "../shared/columnType";

const PROFILE_SEND_OFF = 18406352652;

describe("BOARDS notes column types", () => {
  it("declares a type for every notes column, and none without one", () => {
    for (const b of BOARDS) {
      if (b.notesColId) {
        expect(
          b.notesColType,
          `${b.boardName}: notesColId ${b.notesColId} has no notesColType — the writer cannot pick a value shape`,
        ).toMatch(/^(text|long_text)$/);
      } else {
        expect(b.notesColType, `${b.boardName}: no notes column, so no type`).toBeNull();
      }
    }
  });

  // There is deliberately NO "declaration matches the id prefix" test any more:
  // the notes columns are being converted long_text → text in the Monday UI
  // (CLAUDE.md §10) and that conversion may KEEP the id, so a `long_text_…` id
  // can legitimately be a text column. Nothing infers type from the prefix now;
  // the writer asks the live board (lib/shared/columnType).

  it("still has Profile Send Off as the one `text` notes column", () => {
    // Pinned by name because it is the odd one out and the whole reason the
    // type has to be declared. If this board's column is ever migrated to
    // long_text, this test is the reminder to re-check the writer.
    const profile = BOARDS.find((b) => b.boardId === PROFILE_SEND_OFF);
    expect(profile?.notesColId).toBe("text_mm389fs");
    expect(profile?.notesColType).toBe("text");
    // No longer "the only one": the other boards' notes columns are being
    // converted to text too (§10). The declaration is documentation now.
  });
});

describe("appendNoteToRecord — bare string for every column type; the cap is asked of the board", () => {
  /** Bodies of every request the writer made, newest last. */
  let sent: Array<{ query: string; variables: Record<string, unknown> }>;
  /** What the LIVE board reports each column to be — deliberately independent
   *  of what the caller declares, because the two can disagree for weeks while
   *  a column is being converted long_text → text with its id kept. */
  let liveType: Record<string, string>;

  beforeEach(() => {
    sent = [];
    invalidateColumnTypes();
    liveType = { text_mm389fs: "text", long_text_mm27zjt2: "long_text" };
    vi.stubEnv("VITE_MONDAY_API_TOKEN", "test-token");
    globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
      const call = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
      sent.push(call);
      const isRead = call.query.includes("column_values (ids: $cols)");
      const isTypeLookup = call.query.includes("columns(ids: $cols) { id type }");
      return {
        ok: true,
        status: 200,
        json: async () =>
          isTypeLookup
            ? { data: { boards: [{ columns: (call.variables.cols as string[]).map((id) => ({ id, type: liveType[id] })) }] } }
            : isRead
              ? { data: { items: [{ column_values: [{ id: (call.variables.cols as string[])[0], text: "old line" }] }] } }
              : { data: { change_multiple_column_values: { id: "1" } } },
      };
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The value the write carried for its column, parsed back from what was sent. */
  async function writtenValue(
    columnId: "text_mm389fs" | "long_text_mm27zjt2",
    text = "spoke to the office",
    declared: "text" | "long_text" | null = columnId === "text_mm389fs" ? "text" : "long_text",
  ) {
    await appendNoteToRecord({
      boardId: PROFILE_SEND_OFF,
      itemId: "12345",
      columnId,
      columnType: declared,
      text,
      stage: "Profile Send Off",
      phone: "+13475550101",
    });
    const write = sent.at(-1)!;
    expect(write.query, "the flip-safe mutation").toContain("change_multiple_column_values");
    const vals = JSON.parse(write.variables.vals as string) as Record<string, unknown>;
    expect(Object.keys(vals)).toEqual([columnId]);
    return vals[columnId];
  }

  it("sends a BARE STRING to a text column", async () => {
    const value = await writtenValue("text_mm389fs");
    expect(typeof value).toBe("string");
    expect(value).toContain("spoke to the office");
  });

  it("sends a BARE STRING to a long_text column too — the one shape both types accept", async () => {
    const value = await writtenValue("long_text_mm27zjt2");
    expect(typeof value).toBe("string");
    expect(value).toContain("spoke to the office");
  });

  it("appends onto the re-read body rather than replacing it", async () => {
    const value = await writtenValue("text_mm389fs");
    expect(value).toContain("old line");
  });

  it("refuses a body Monday would silently truncate on a column the BOARD says is long_text", async () => {
    await expect(writtenValue("long_text_mm27zjt2", "x".repeat(MONDAY_LONG_TEXT_MAX + 1))).rejects.toThrow(/2000-character limit/);
  });

  it("does NOT apply the long_text limit to a text column", async () => {
    const value = await writtenValue("text_mm389fs", "x".repeat(MONDAY_LONG_TEXT_MAX + 1));
    expect((value as string).length).toBeGreaterThan(MONDAY_LONG_TEXT_MAX);
  });

  it("asks the BOARD, not the declaration: a column declared long_text that is live text is uncapped", async () => {
    // The UI conversion can keep the id, so the registry (and the id prefix)
    // can say long_text for weeks after the column stopped being one.
    liveType.long_text_mm27zjt2 = "text";
    const value = await writtenValue("long_text_mm27zjt2", "x".repeat(MONDAY_LONG_TEXT_MAX + 1), "long_text");
    expect((value as string).length).toBeGreaterThan(MONDAY_LONG_TEXT_MAX);
  });

  it("treats a column the board cannot type as capped (the safe default)", async () => {
    delete liveType.text_mm389fs;
    await expect(writtenValue("text_mm389fs", "x".repeat(MONDAY_LONG_TEXT_MAX + 1))).rejects.toThrow(/2000-character limit/);
  });

  it("still writes when the registry declares no type — the shape no longer depends on it", async () => {
    const value = await writtenValue("text_mm389fs", "spoke to the office", null);
    expect(typeof value).toBe("string");
  });
});
