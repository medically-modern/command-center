import { describe, it, expect } from "vitest";
import { optionsWithCurrent, HIDDEN_LABELS } from "./selectOptions";

const PATHS = ["Insulin", "Hypoglycemia", "Not Serving"];

describe("optionsWithCurrent", () => {
  it("hides Not Serving from the picker", () => {
    expect(optionsWithCurrent(PATHS, "Insulin").map((o) => o.value))
      .toEqual(["Insulin", "Hypoglycemia"]);
  });

  it("STILL SHOWS Not Serving when it is the item's current value (§5.2)", () => {
    // The whole point: filtering it out entirely would render a blank select,
    // which tells the rep the field is empty when the board holds a real value.
    const opts = optionsWithCurrent(PATHS, "Not Serving");
    const current = opts.find((o) => o.value === "Not Serving");
    expect(current).toBeDefined();
    expect(current?.disabled).toBe(true);
    expect(current?.label).toContain("not selectable");
  });

  it("pins the current value first, so it reads as current state", () => {
    expect(optionsWithCurrent(PATHS, "Not Serving")[0].value).toBe("Not Serving");
  });

  it("keeps ANY board value the code's list doesn't know", () => {
    // Not a hidden label — just a label the hardcoded map is missing, e.g.
    // General Insurance "Other" (index 15), or one added on Monday today.
    const opts = optionsWithCurrent(["Aetna", "Cigna"], "Other");
    expect(opts[0]).toMatchObject({ value: "Other", disabled: true });
    expect(opts.map((o) => o.value)).toContain("Aetna");
  });

  it("does not pin anything when the value is already pickable", () => {
    expect(optionsWithCurrent(["Aetna", "Cigna"], "Aetna").every((o) => !o.disabled)).toBe(true);
  });

  it("drops blank board labels", () => {
    expect(optionsWithCurrent(["Aetna", "", "  ", "Cigna"], "").map((o) => o.value))
      .toEqual(["Aetna", "Cigna"]);
  });

  it("handles a blank/undefined current value", () => {
    expect(optionsWithCurrent(PATHS, "")).toHaveLength(2);
    expect(optionsWithCurrent(PATHS, undefined)).toHaveLength(2);
  });

  it("treats Not Serving as the one hidden label", () => {
    expect(HIDDEN_LABELS).toEqual(["Not Serving"]);
  });
});
