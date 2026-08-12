import { describe, it, expect } from "vitest";
import {
  pickCompletionActor,
  completionWindow,
  LOOKBACK_MS,
  GRACE_MS,
} from "./stageActor.mjs";

const ADVANCER = "color_mm1wyr92"; // Medical Evaluation Stage Advancer

/** A gql_log row, trimmed to the fields the picker reads. */
function row(over = {}) {
  return {
    created_at: "2026-05-03T23:59:00.000Z",
    actor: "rep@medicallymodern.com",
    actor_verified: null,
    columns: null,
    ok: true,
    ...over,
  };
}

describe("completionWindow", () => {
  it("spans the whole send transaction, plus a little after", () => {
    const w = completionWindow("2026-05-03T23:59:19.000Z");
    const at = Date.parse("2026-05-03T23:59:19.000Z");
    expect(Date.parse(w.from)).toBe(at - LOOKBACK_MS);
    expect(Date.parse(w.to)).toBe(at + GRACE_MS);
  });

  it("rejects a timestamp it can't parse", () => {
    expect(completionWindow("nope")).toBeNull();
    expect(completionWindow("")).toBeNull();
  });
});

describe("pickCompletionActor", () => {
  it("prefers the row that actually wrote the stage advancer", () => {
    const found = pickCompletionActor(
      [
        // A later, unrelated edit by someone else — newest, but not the advance.
        row({ created_at: "2026-05-03T23:59:50.000Z", actor: "other@medicallymodern.com", columns: { long_text_mm27zjt2: "note" } }),
        row({ created_at: "2026-05-03T23:59:10.000Z", actor: "rep@medicallymodern.com", columns: { [ADVANCER]: { index: 14 } } }),
      ],
      ADVANCER,
    );
    expect(found).toMatchObject({ actor: "rep@medicallymodern.com", matchedColumn: true });
  });

  it("falls back to the latest attributed row, flagged as an inference", () => {
    const found = pickCompletionActor(
      [
        row({ created_at: "2026-05-03T23:59:10.000Z", columns: { color_mm1y6qrf: { index: 1 } } }),
        row({ created_at: "2026-05-03T23:50:00.000Z", actor: "earlier@medicallymodern.com" }),
      ],
      ADVANCER,
    );
    expect(found).toMatchObject({ actor: "rep@medicallymodern.com", matchedColumn: false });
  });

  it("only calls the email verified when the token really was checked", () => {
    // NULL is the norm — the durable /send path carries no verified flag — so
    // it must read as unverified, not as a missing value the UI treats as true.
    expect(pickCompletionActor([row({ actor_verified: true, columns: { [ADVANCER]: {} } })], ADVANCER).verified).toBe(true);
    expect(pickCompletionActor([row({ actor_verified: null })], ADVANCER).verified).toBe(false);
    expect(pickCompletionActor([row({ actor_verified: false })], ADVANCER).verified).toBe(false);
  });

  it("ignores rows that failed — a rejected write completed nothing", () => {
    const found = pickCompletionActor(
      [
        row({ created_at: "2026-05-03T23:59:15.000Z", actor: "failed@medicallymodern.com", ok: false, columns: { [ADVANCER]: {} } }),
        row({ created_at: "2026-05-03T23:59:10.000Z", actor: "rep@medicallymodern.com", columns: { [ADVANCER]: {} } }),
      ],
      ADVANCER,
    );
    expect(found.actor).toBe("rep@medicallymodern.com");
  });

  it("ignores unattributed rows rather than reporting a blank name", () => {
    expect(pickCompletionActor([row({ actor: null }), row({ actor: "   " })], ADVANCER)).toBeNull();
  });

  it("returns null when nothing is attributable (board edit, or pre-gateway)", () => {
    expect(pickCompletionActor([], ADVANCER)).toBeNull();
    expect(pickCompletionActor(null, ADVANCER)).toBeNull();
  });

  it("works with no column hint — some boards advance via a different column", () => {
    const found = pickCompletionActor([row({ actor: "rep@medicallymodern.com" })], null);
    expect(found).toMatchObject({ actor: "rep@medicallymodern.com", matchedColumn: false });
  });

  it("takes the LATEST advancer write when a stage was completed twice", () => {
    const found = pickCompletionActor(
      [
        row({ created_at: "2026-05-03T23:00:00.000Z", actor: "first@medicallymodern.com", columns: { [ADVANCER]: {} } }),
        row({ created_at: "2026-05-03T23:59:10.000Z", actor: "second@medicallymodern.com", columns: { [ADVANCER]: {} } }),
      ],
      ADVANCER,
    );
    expect(found.actor).toBe("second@medicallymodern.com");
  });
});
