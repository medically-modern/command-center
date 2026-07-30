/**
 * Round-trip guard for the three universal checks (In-Network? · Active? ·
 * DME Benefits?) on the Insurance board.
 *
 * Regression these tests exist for (2026-07-29): the board's single
 * "Active/Network" column was split into In-Network? (color_mm2vhwan, renamed
 * + relabelled) and Active? (color_mm5q9y3, new). The reader matched on label
 * TEXT ("active/in-network" / "stuck"), so the rename silently made every
 * patient hydrate with both checks blank — reps had to re-answer them on every
 * load — while the writer still collapsed both answers into one column, marking
 * in-network-but-inactive patients "Out-of-Network".
 *
 * Both halves are covered here: reads match by INDEX (rename-proof), and the
 * two checks are independent in each direction.
 */
import { describe, it, expect } from "vitest";
import { mondayItemToPatient, UNIVERSAL_INDEX } from "./mondayMapping";
import { COL, READ_COLUMN_IDS, AUTH_READ_COLUMN_IDS, type MondayItem } from "./mondayApi";

/** A status cell as Monday returns it: `text` is the label, `value` the JSON index. */
function statusCell(id: string, index: number, text: string) {
  return { id, text, value: JSON.stringify({ index }) };
}

function itemWith(cols: { id: string; text: string; value: string }[]): MondayItem {
  return { id: "1", name: "Test Patient", column_values: cols };
}

const universalOf = (item: MondayItem) => mondayItemToPatient(item).insurance?.universal;

/**
 * The fetch-list half of the round-trip.
 *
 * Every test below this block hands the parser a hand-built item that ALREADY
 * contains the columns — so they answer "if the data arrives, do we read it
 * correctly?" and can never catch a column that is written but never fetched.
 * That is exactly how the Benefits page shipped writing all three universal
 * answers to Monday and reading none of them back (2026-07-30): the columns
 * sat in AUTH_READ_COLUMN_IDS, and the Benefits group is not in
 * AUTH_GROUP_IDS, so its query never asked for them.
 *
 * This block asserts the LIST, not the parsing — the one thing a synthetic
 * item can't check. Same trap as the Stedi column contract (CLAUDE.md §5.11).
 */
describe("universal checks — fetched, not just parseable", () => {
  const UNIVERSAL_COLS = [COL.inNetwork, COL.active, COL.dmeBenefits];

  it("the BASE read list fetches all three — Benefits writes them, so Benefits must read them", () => {
    // Benefits is NOT in AUTH_GROUP_IDS, so it queries with READ_COLUMN_IDS.
    // If this fails, the answers hydrate blank and reps re-enter them on every
    // load, with no error anywhere.
    for (const id of UNIVERSAL_COLS) expect(READ_COLUMN_IDS).toContain(id);
  });

  it("the auth read list covers them too (it spreads the base list)", () => {
    for (const id of UNIVERSAL_COLS) expect(AUTH_READ_COLUMN_IDS).toContain(id);
  });

  it("neither list fetches a column twice", () => {
    expect(READ_COLUMN_IDS).toHaveLength(new Set(READ_COLUMN_IDS).size);
    expect(AUTH_READ_COLUMN_IDS).toHaveLength(new Set(AUTH_READ_COLUMN_IDS).size);
  });
});

describe("universal checks — Monday round-trip", () => {
  it("reads In-Network? and Active? from their own columns", () => {
    const u = universalOf(
      itemWith([
        statusCell(COL.inNetwork, UNIVERSAL_INDEX.inNetwork.pass, "In-Network"),
        statusCell(COL.active, UNIVERSAL_INDEX.active.fail, "Inactive"),
        statusCell(COL.dmeBenefits, UNIVERSAL_INDEX.dmeBenefits.pass, "Yes"),
      ]),
    );
    // The pre-split reader fed ONE column into both fields, so this exact
    // combination was unrepresentable.
    expect(u?.["in-network"]).toBe("confirmed");
    expect(u?.["active"]).toBe("not-confirmed");
    expect(u?.["dme-benefits"]).toBe("confirmed");
  });

  it("matches by index, not label text — a board rename must not break reads", () => {
    const u = universalOf(
      itemWith([
        statusCell(COL.inNetwork, UNIVERSAL_INDEX.inNetwork.fail, "Renamed On The Board"),
        statusCell(COL.active, UNIVERSAL_INDEX.active.pass, "Also Renamed"),
      ]),
    );
    expect(u?.["in-network"]).toBe("not-confirmed");
    expect(u?.["active"]).toBe("confirmed");
  });

  it("Medicare not Primary round-trips instead of collapsing to Out-of-Network", () => {
    const u = universalOf(
      itemWith([
        statusCell(
          COL.inNetwork,
          UNIVERSAL_INDEX.inNetwork.medicareNotPrimary,
          "Medicare not Primary",
        ),
      ]),
    );
    // Before the label existed (2026-07-29) this answer wrote the plain fail
    // index and came back as "not-confirmed", losing the reason on reload.
    expect(u?.["in-network"]).toBe("medicare-not-primary");
  });

  it("Medicare not Primary and Out-of-Network are distinct indices", () => {
    expect(UNIVERSAL_INDEX.inNetwork.medicareNotPrimary).not.toBe(UNIVERSAL_INDEX.inNetwork.fail);
    expect(UNIVERSAL_INDEX.inNetwork.medicareNotPrimary).not.toBe(UNIVERSAL_INDEX.inNetwork.pass);
  });

  it("an unset or unparseable column reads as unanswered, not as a failed check", () => {
    const u = universalOf(
      itemWith([
        { id: COL.inNetwork, text: "", value: null },
        { id: COL.active, text: "Active", value: "not json" },
      ]),
    );
    // "" gates the send (rep must answer); "not-confirmed" would silently
    // escalate the patient instead.
    expect(u?.["in-network"]).toBe("");
    expect(u?.["active"]).toBe("");
  });

  it("a column missing from the response entirely reads as unanswered", () => {
    const u = universalOf(itemWith([]));
    expect(u?.["in-network"]).toBe("");
    expect(u?.["active"]).toBe("");
    expect(u?.["dme-benefits"]).toBe("");
  });
});
