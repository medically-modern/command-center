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

  /**
   * Monday derives an auto-generated column id from the column's TYPE, so the
   * prefix and the declaration must agree. This is the check that catches the
   * crossing above at build time rather than at a rep's desk — it fails if
   * somebody adds a `text_…` notes column declared `long_text`, which is
   * exactly the mistake that shipped.
   */
  it("declares the type the column id itself says it is", () => {
    for (const b of BOARDS) {
      if (!b.notesColId) continue;
      const fromId = b.notesColId.startsWith("long_text")
        ? "long_text"
        : b.notesColId.startsWith("text")
          ? "text"
          : null;
      if (!fromId) continue; // a legacy id with no type prefix — nothing to check
      expect(b.notesColType, `${b.boardName} (${b.notesColId})`).toBe(fromId);
    }
  });

  it("still has Profile Send Off as the one `text` notes column", () => {
    // Pinned by name because it is the odd one out and the whole reason the
    // type has to be declared. If this board's column is ever migrated to
    // long_text, this test is the reminder to re-check the writer.
    const profile = BOARDS.find((b) => b.boardId === PROFILE_SEND_OFF);
    expect(profile?.notesColId).toBe("text_mm389fs");
    expect(profile?.notesColType).toBe("text");
    expect(BOARDS.filter((b) => b.notesColType === "text")).toHaveLength(1);
  });
});

describe("appendNoteToRecord — value shape follows the column type", () => {
  /** Bodies of every request the writer made, newest last. */
  let sent: Array<{ query: string; variables: Record<string, unknown> }>;

  beforeEach(() => {
    sent = [];
    vi.stubEnv("VITE_MONDAY_API_TOKEN", "test-token");
    globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
      const call = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
      sent.push(call);
      // The writer re-reads the current body before appending (readNotesNow).
      const isRead = call.query.includes("column_values (ids: $cols)");
      return {
        ok: true,
        status: 200,
        json: async () =>
          isRead
            ? {
                data: {
                  items: [
                    {
                      column_values: [
                        { id: (call.variables.cols as string[])[0], text: "old line" },
                      ],
                    },
                  ],
                },
              }
            : { data: { change_column_value: { id: "1" } } },
      };
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The `value` argument of the write, parsed back from what was sent. */
  async function writtenValue(columnType: "text" | "long_text", text = "spoke to the office") {
    await appendNoteToRecord({
      boardId: PROFILE_SEND_OFF,
      itemId: "12345",
      columnId: columnType === "text" ? "text_mm389fs" : "long_text_mm27zjt2",
      columnType,
      text,
      stage: "Profile Send Off",
      phone: "+13475550101",
    });
    const write = sent.at(-1)!;
    return JSON.parse(write.variables.val as string);
  }

  it("sends a BARE STRING to a text column", async () => {
    const value = await writtenValue("text");
    expect(typeof value).toBe("string");
    expect(value).toContain("spoke to the office");
    // The shape that was being sent before, and that Monday refuses here.
    expect(value).not.toHaveProperty("text");
  });

  it("sends { text } to a long_text column", async () => {
    const value = await writtenValue("long_text");
    expect(typeof value).toBe("object");
    expect(value.text).toContain("spoke to the office");
  });

  it("appends onto the re-read body rather than replacing it", async () => {
    const value = await writtenValue("text");
    // `readNotesNow` returned "old line"; losing it is the lost-update bug the
    // re-read exists to narrow, so pin that it survives the append.
    expect(value).toContain("old line");
  });

  it("refuses a long_text body Monday would silently truncate", async () => {
    await expect(writtenValue("long_text", "x".repeat(MONDAY_LONG_TEXT_MAX + 1))).rejects.toThrow();
  });

  it("does NOT apply the long_text limit to a text column", async () => {
    // Profile Send Off carries live values well past 2000 characters (9,383 at
    // the longest, measured 2026-09-02) with nothing parked at a ceiling, so
    // the long_text guard here would refuse writes the board accepts.
    const value = await writtenValue("text", "x".repeat(MONDAY_LONG_TEXT_MAX + 1));
    expect(typeof value).toBe("string");
    expect((value as string).length).toBeGreaterThan(MONDAY_LONG_TEXT_MAX);
  });

  it("writes nothing at all when the board declares no type", async () => {
    await expect(
      appendNoteToRecord({
        boardId: PROFILE_SEND_OFF,
        itemId: "12345",
        columnId: "text_mm389fs",
        columnType: null,
        text: "spoke to the office",
        stage: "Profile Send Off",
        phone: "+13475550101",
      }),
    ).rejects.toThrow(/notesColType/);
    // Not even the re-read fired — guessing a shape is what this prevents.
    expect(sent).toHaveLength(0);
  });
});
