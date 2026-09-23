/**
 * The SLA card's wording rules. The NUMBERS are the gateway's (`slaReport`) and
 * are tested there; this only pins how they are said — above all, that *Left
 * voicemail* is never counted among the resolutions (Josh's D6).
 */
import { describe, expect, it } from "vitest";
import type { AccessConfig } from "@/lib/accessStore";
import { RESOLVING_HOWS, howBreakdown, howLabels, medianLabel, pct, repName, repNames } from "./sla";

describe("howBreakdown", () => {
  it("lists what happened, in the resolve bar's order", () => {
    expect(howBreakdown({ no_action: 3, called: 12, texted: 4 })).toEqual([
      { how: "called", label: "Called", n: 12 },
      { how: "texted", label: "Texted", n: 4 },
      { how: "no_action", label: "No action needed", n: 3 },
    ]);
  });

  it("drops a way nobody used rather than printing a zero", () => {
    expect(howBreakdown({ called: 2, texted: 0 }).map((b) => b.how)).toEqual(["called"]);
    expect(howBreakdown({})).toEqual([]);
  });

  it("⚠️⚠️ Left voicemail is never a resolution, even if it reaches byHow", () => {
    expect(RESOLVING_HOWS).not.toContain("left_vm");
    expect(howBreakdown({ called: 1, left_vm: 9 } as never).map((b) => b.how)).toEqual(["called"]);
  });

  it("a way the gateway grows later is listed under its own name, not dropped", () => {
    expect(howBreakdown({ called: 1, emailed: 2 } as never)).toEqual([
      { how: "called", label: "Called", n: 1 },
      { how: "emailed", label: "emailed", n: 2 },
    ]);
  });
});

describe("howLabels", () => {
  it("names a rep's ways in the bar's order, once each, never Left voicemail", () => {
    expect(howLabels(["no_action", "called", "left_vm", "called"])).toBe("Called, No action needed");
    expect(howLabels([])).toBe("");
  });
});

describe("repName", () => {
  const config = {
    managers: ["josh@medicallymodern.com"],
    processors: {
      "katie.tyler@medicallymodern.com": { name: "Katie T.", roles: [] },
      "masani@medicallymodern.com": { name: "", roles: [] },
    },
  } as unknown as AccessConfig;
  const names = repNames(config);

  it("uses the name typed on the access list", () => {
    expect(repName("Katie.Tyler@medicallymodern.com", names)).toBe("Katie T.");
  });

  it("falls back to the email's own name — including somebody no longer on the list", () => {
    expect(repName("masani@medicallymodern.com", names)).toBe("Masani");
    expect(repName("josh@medicallymodern.com", names)).toBe("Josh");
    expect(repName("former.rep@medicallymodern.com", names)).toBe("Former Rep");
  });

  it("never renders a blank cell", () => {
    expect(repName("", names)).toBe("Unknown");
    expect(repNames(null).size).toBe(0);
  });
});

describe("empty is not zero", () => {
  it("a share of nothing is a dash, never 0%", () => {
    expect(pct(null)).toBe("—");
    expect(pct(0)).toBe("0%");
    expect(pct(88)).toBe("88%");
  });

  it("a median of nothing is a dash; a real zero stays a zero", () => {
    expect(medianLabel(null)).toBe("—");
    expect(medianLabel(0)).toBe("0m");
    expect(medianLabel(3 * 3600_000 + 12 * 60_000)).toBe("3h 12m");
  });
});
