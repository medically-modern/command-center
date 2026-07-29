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
import { COL, type MondayItem } from "./mondayApi";

/** A status cell as Monday returns it: `text` is the label, `value` the JSON index. */
function statusCell(id: string, index: number, text: string) {
  return { id, text, value: JSON.stringify({ index }) };
}

function itemWith(cols: { id: string; text: string; value: string }[]): MondayItem {
  return { id: "1", name: "Test Patient", column_values: cols };
}

const universalOf = (item: MondayItem) => mondayItemToPatient(item).insurance?.universal;

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
