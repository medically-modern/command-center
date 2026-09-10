import { describe, expect, it } from "vitest";
import { infusionSetWriteAction } from "./infusionSelection";

/**
 * ⚠️ The third answer is the whole point of this rule.
 *
 * `mondayMapping` derives an infusion set's LABEL from the column's `text` and
 * its INDEX from `JSON.parse(value).index`, independently — and that parse
 * returns null on any failure. So a set that is genuinely on the board can
 * arrive with a null index beside a live label. Treating null as "the rep
 * removed it" would clear a real selection on the strength of a read that
 * failed, and the send would report success.
 */
describe("infusionSetWriteAction", () => {
  it("writes a real index", () => {
    expect(infusionSetWriteAction(3, "AutoSoft 90 6mm")).toBe("write");
  });

  /* Index 0 is a real label id on some columns — it must never be read as
     absent the way a falsy check would. */
  it("writes index 0", () => {
    expect(infusionSetWriteAction(0, "Some Set")).toBe("write");
  });

  it("clears an emptied slot — no index and no label", () => {
    expect(infusionSetWriteAction(null, "")).toBe("clear");
    expect(infusionSetWriteAction(null, "   ")).toBe("clear");
  });

  /* The case this exists for. */
  it("SKIPS a null index that still has a label — that is a bad read, not a removal", () => {
    expect(infusionSetWriteAction(null, "AutoSoft 90 6mm")).toBe("skip");
  });

  it("skips rather than clears whatever the unmappable label happens to be", () => {
    for (const label of ["Renamed Set", "Not Serving", "?", "0"]) {
      expect(
        infusionSetWriteAction(null, label),
        `a null index beside "${label}" must not clear the column`,
      ).toBe("skip");
    }
  });
});
