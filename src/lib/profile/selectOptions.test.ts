import { describe, it, expect } from "vitest";
import { optionsWithCurrent } from "./selectOptions";

const PATHS = ["Insulin", "Hypoglycemia", "Not Serving", "Neither Applies"];

describe("optionsWithCurrent", () => {
  it("offers every label the board has, hiding nothing", () => {
    // Josh, 2026-08-20: "Not Serving" used to be stripped out here, so a rep
    // could read it on a patient but never set or correct one.
    expect(optionsWithCurrent(PATHS, "Insulin").map((o) => o.value)).toEqual(PATHS);
  });

  it("makes Not Serving a normal, pickable option", () => {
    const opt = optionsWithCurrent(PATHS, "Not Serving").find((o) => o.value === "Not Serving");
    expect(opt).toBeDefined();
    expect(opt?.disabled).toBeUndefined();
    expect(opt?.label).toBe("Not Serving");
  });

  it("does not pin a value that is already in the list", () => {
    // Pinning is for labels the build does not know — a value in the options
    // must not be duplicated at the front.
    expect(optionsWithCurrent(PATHS, "Not Serving").filter((o) => o.value === "Not Serving"))
      .toHaveLength(1);
  });

  it("keeps ANY board value the code's list doesn't know", () => {
    // A label the hardcoded map is missing, e.g. General Insurance "Other"
    // (index 15), or one added on Monday today. Pinned disabled rather than
    // dropped: a select whose value matches no option renders blank, and the
    // next save wipes what the board held.
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
    expect(optionsWithCurrent(PATHS, "")).toHaveLength(PATHS.length);
    expect(optionsWithCurrent(PATHS, undefined)).toHaveLength(PATHS.length);
  });
});
