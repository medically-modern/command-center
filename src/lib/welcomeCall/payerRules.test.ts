import { describe, it, expect } from "vitest";
import {
  payerInfusionCap,
  payerCapNote,
  supplyLengthDays,
  isMedicaidPlan,
  supplyLengthNote,
  supplyLengthOptions,
  payerAllows75Days,
  profileFrequencyDays,
  profileFrequencyMaxDays,
  profileFrequencyPayer,
  profileFrequencyRefusal,
  DEFAULT_INFUSION_CAP,
  DEFAULT_INFUSION_QTY,
} from "./payerRules";

/** Every label on the live Primary Insurance column (color_mm1x157j), 2026-09-09. */
const BOARD_PAYERS = [
  "BCBS TN", "BCBS FL", "BCBS WY", "Magnacare", "Oregon Care", "UMR",
  "Medicare A&B", "NYSHIP", "United Commercial", "United Medicare",
  "United Medicaid", "Aetna Commercial", "Aetna Medicare", "Wellcare",
  "Humana", "Cigna", "Medicaid", "Midlands Choice", "Horizon BCBS",
  "Fidelis Low-Cost", "Fidelis Medicaid", "Anthem BCBS Medicaid (JLJ)",
  "Anthem BCBS Commercial", "Anthem BCBS Medicare", "Fidelis Commercial",
  "Fidelis Medicare", "Anthem BCBS Low-Cost (JLJ)", "Fidelis CHP",
];

describe("payerInfusionCap", () => {
  it("gives 9 to exactly two payer families (Josh, 2026-09-17)", () => {
    expect(payerInfusionCap("Anthem BCBS Commercial")).toEqual({ cap: 9, payerLabel: "Anthem Commercial" });
    expect(payerInfusionCap("Horizon BCBS")).toEqual({ cap: 9, payerLabel: "Horizon" });
    // Cigna was the third from 2026-09-09 until Josh narrowed the list.
    expect(payerInfusionCap("Cigna")).toEqual({ cap: 3, payerLabel: null });
  });

  it("caps Aetna COMMERCIAL at 4; Aetna Medicare is 3 (2026-10-01)", () => {
    expect(payerInfusionCap("Aetna Commercial")).toEqual({ cap: 4, payerLabel: "Aetna Commercial" });
    expect(payerInfusionCap("Aetna Medicare")).toEqual({ cap: 3, payerLabel: null });
  });

  it("⚠️ gives only the COMMERCIAL Anthem a 9 — the other three are 3", () => {
    // The old rule was `/anthem/i`, which matched all four. Narrowing it is the
    // whole point of the 2026-09-09 change; a regression here silently lets a
    // rep order 9 sets on a plan that pays for 3.
    for (const p of [
      "Anthem BCBS Medicare",
      "Anthem BCBS Medicaid (JLJ)",
      "Anthem BCBS Low-Cost (JLJ)",
    ]) {
      expect(payerInfusionCap(p)).toEqual({ cap: DEFAULT_INFUSION_CAP, payerLabel: null });
    }
  });

  it("⚠️ has NO generic BCBS rule — the three plain BCBS plans are 3", () => {
    for (const p of ["BCBS TN", "BCBS FL", "BCBS WY"]) {
      expect(payerInfusionCap(p)).toEqual({ cap: DEFAULT_INFUSION_CAP, payerLabel: null });
    }
  });

  it("still matches Horizon BCBS on the horizon pattern, not a BCBS one", () => {
    expect(payerInfusionCap("Horizon BCBS").payerLabel).toBe("Horizon");
  });

  it("falls back to the conservative default for unrecognised payers", () => {
    for (const p of ["Medicare A&B", "NYSHIP", "Humana", "Fidelis Medicaid", "UMR", ""]) {
      expect(payerInfusionCap(p)).toEqual({ cap: DEFAULT_INFUSION_CAP, payerLabel: null });
    }
  });

  it("never returns a cap below the default for any label on the live board", () => {
    // The cap is a ceiling on manual override; the DEFAULT quantity is 3, so a
    // cap under 3 would make the default unreachable.
    for (const p of BOARD_PAYERS) {
      expect(payerInfusionCap(p).cap).toBeGreaterThanOrEqual(DEFAULT_INFUSION_QTY);
    }
  });

  it("names infusion sets AND cartridges in the note — the cap covers both", () => {
    expect(payerCapNote(payerInfusionCap("Aetna Commercial")))
      .toBe("Aetna Commercial caps infusion sets and cartridges at 4 per order.");
    expect(payerCapNote(payerInfusionCap("Humana"))).toContain("can be lowered, not raised");
  });
});

describe("supply length", () => {
  it("shortens to 60 days for a Medicaid primary", () => {
    expect(supplyLengthDays("Medicaid", "")).toBe(60);
    expect(supplyLengthDays("United Medicaid", "")).toBe(60);
    expect(supplyLengthDays("Fidelis Medicaid", "")).toBe(60);
  });

  it("shortens to 60 days when Medicaid is only the SECONDARY", () => {
    expect(supplyLengthDays("Aetna Commercial", "NY Medicaid")).toBe(60);
    expect(isMedicaidPlan("Aetna Commercial", "NY Medicaid")).toBe(true);
  });

  it("is 90 days for everyone else", () => {
    expect(supplyLengthDays("Medicare A&B", "")).toBe(90);
    expect(supplyLengthDays("Aetna Commercial", "Medicare Supplement")).toBe(90);
    expect(supplyLengthDays("", "")).toBe(90);
  });

  it("is case-insensitive", () => {
    expect(supplyLengthDays("MEDICAID", "")).toBe(60);
  });

  it("words the note the way the prototype did", () => {
    expect(supplyLengthNote("Medicaid", "")).toBe("Medicaid — 60 day supply");
    expect(supplyLengthNote("Humana", "")).toBe("90 day supply");
  });
});

describe("75-day supply — Aetna Commercial only, never a default", () => {
  it("offers 75 to Aetna Commercial and nobody else (Aetna Medicare dropped 2026-10-01)", () => {
    expect(payerAllows75Days("Aetna Commercial")).toBe(true);
    expect(payerAllows75Days("Aetna Medicare")).toBe(false);
    for (const p of BOARD_PAYERS.filter((x) => x !== "Aetna Commercial")) {
      expect(payerAllows75Days(p)).toBe(false);
    }
  });

  it("puts 75 in the option list for Aetna only", () => {
    expect(supplyLengthOptions("Aetna Commercial")).toEqual(["30", "60", "75", "90"]);
    expect(supplyLengthOptions("Medicare A&B")).toEqual(["30", "60", "90"]);
    expect(supplyLengthOptions("")).toEqual(["30", "60", "90"]);
  });

  it("⚠️ never DEFAULTS anyone to 75, Aetna included", () => {
    // A patient only lands on 75 because a rep chose it. If this ever fires,
    // an Aetna order is being built at a cadence nobody asked for.
    for (const p of BOARD_PAYERS) {
      expect(supplyLengthDays(p, "")).not.toBe(75);
      expect([60, 90]).toContain(supplyLengthDays(p, ""));
    }
  });

  it("keeps every offered length inside the option list it came from", () => {
    for (const p of BOARD_PAYERS) {
      expect(supplyLengthOptions(p)).toContain(String(supplyLengthDays(p, "")));
    }
  });
});

describe("DEFAULT_INFUSION_QTY", () => {
  it("is a flat 3 and does NOT track the supply length", () => {
    // Josh, 2026-09-09: "medicaid should stick to 3 boxes". Deriving qty from
    // the 60-day Medicaid cadence would have moved ~99 live patients 3 → 2.
    expect(DEFAULT_INFUSION_QTY).toBe(3);
  });
});

describe("the Subscription profile's Frequency max (Josh, 2026-10-01)", () => {
  it("Medicaid and Fidelis Low-Cost — EXACT primary labels — top out at 60", () => {
    expect(profileFrequencyMaxDays("Medicaid")).toBe(60);
    expect(profileFrequencyMaxDays("Fidelis Low-Cost")).toBe(60);
    expect(profileFrequencyDays("Medicaid")).toEqual([30, 60]);
    expect(profileFrequencyPayer("Fidelis Low-Cost")).toBe("Fidelis Low-Cost");
  });

  it("⚠️ other Medicaid-named and Fidelis plans follow the 90 rule — \"that's it\"", () => {
    for (const p of ["Fidelis Medicaid", "United Medicaid", "Anthem BCBS Medicaid (JLJ)", "Fidelis Commercial", "Fidelis Medicare", "Fidelis NJ"]) {
      expect(profileFrequencyMaxDays(p)).toBe(90);
      expect(profileFrequencyDays(p)).toEqual([30, 60, 90]);
    }
  });

  it("Aetna Commercial tops out at 75 (no 90); Aetna Medicare is 90", () => {
    expect(profileFrequencyDays("Aetna Commercial")).toEqual([30, 60, 75]);
    expect(profileFrequencyPayer("Aetna Commercial")).toBe("Aetna Commercial");
    expect(profileFrequencyDays("Aetna Medicare")).toEqual([30, 60, 90]);
  });

  it("everyone else: 30, 60 or 90 — never 75", () => {
    for (const p of BOARD_PAYERS.filter((x) => !["Medicaid", "Fidelis Low-Cost", "Aetna Commercial"].includes(x))) {
      expect(profileFrequencyDays(p)).toEqual([30, 60, 90]);
    }
    expect(profileFrequencyDays("")).toEqual([30, 60, 90]);
  });
});

describe("profileFrequencyRefusal — why a saved or picked frequency isn't offered", () => {
  it("names the payer's max", () => {
    expect(profileFrequencyRefusal("Fidelis Low-Cost", 90)).toBe("Fidelis Low-Cost goes up to 60 days.");
    expect(profileFrequencyRefusal("Aetna Commercial", 90)).toBe("Aetna Commercial goes up to 75 days.");
  });
  it("75 for anyone but Aetna Commercial", () => {
    expect(profileFrequencyRefusal("Aetna Medicare", 75)).toBe("75 days is Aetna Commercial only.");
    expect(profileFrequencyRefusal("Medicaid", 75)).toBe("Medicaid goes up to 60 days.");
  });
  it("null for an offered frequency or an unreadable one", () => {
    expect(profileFrequencyRefusal("Medicaid", 60)).toBeNull();
    expect(profileFrequencyRefusal("Humana", 90)).toBeNull();
    expect(profileFrequencyRefusal("Aetna Commercial", 75)).toBeNull();
    expect(profileFrequencyRefusal("Humana", NaN)).toBeNull();
  });
});
