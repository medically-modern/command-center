import { describe, it, expect } from "vitest";
import {
  frequencyState,
  frequencyInvalidated,
  daysToLabel,
  labelToDays,
  ORDER_FREQUENCY_INDEX,
} from "./orderFrequency";

describe("label ↔ days", () => {
  it("round-trips", () => {
    for (const d of ["30", "60", "75", "90"]) expect(labelToDays(daysToLabel(d))).toBe(d);
  });
  it("is blank-safe both ways", () => {
    expect(daysToLabel("")).toBe("");
    expect(labelToDays("")).toBe("");
    expect(labelToDays("90 days")).toBe("");
  });
});

describe("ORDER_FREQUENCY_INDEX", () => {
  /* ⚠️ Read off the LIVE column 2026-09-09. Monday assigned these from the
     label COLOUR, not the `index` the create call asked for (the §5.12/§5.20
     trap), and a write to an index the column doesn't have is dropped without
     an error. If this ever needs changing, read `settings_str` — don't guess. */
  it("carries the indices the board actually assigned", () => {
    expect(ORDER_FREQUENCY_INDEX).toEqual({
      "30-Days": 154,
      "60-Days": 16,
      "75-Days": 3,
      "90-Days": 107,
    });
  });

  it("has an index for every label the rules can produce", () => {
    for (const d of ["30", "60", "75", "90"]) {
      expect(ORDER_FREQUENCY_INDEX[daysToLabel(d)]).toBeTypeOf("number");
    }
  });
});

describe("frequencyState", () => {
  const args = { boardLabel: "", edited: null as string | null, primaryInsurance: "Aetna", secondaryInsurance: "" };

  it("shows OUR guess with a hint when nothing is set", () => {
    const f = frequencyState({ ...args, primaryInsurance: "Fidelis Medicaid" });
    expect(f.days).toBe("60");
    expect(f.auto).toBe(true);
    expect(f.hint).toBe("default for Medicaid");
  });

  it("names the non-Medicaid default too", () => {
    const f = frequencyState({ ...args, primaryInsurance: "Cigna" });
    expect(f.days).toBe("90");
    expect(f.hint).toBe("default — 90 days");
  });

  /* Brandon: the hint flips to "edited" once the rep changes it. */
  it("reports a rep override as edited", () => {
    const f = frequencyState({ ...args, edited: "75" });
    expect(f.days).toBe("75");
    expect(f.edited).toBe(true);
    expect(f.hint).toBe("edited");
  });

  /* A value already on the board is neither our guess nor this call's edit, so
     it gets no hint — "one muted hint ONLY while the value is auto-set". */
  it("says nothing about a value the board already holds", () => {
    const f = frequencyState({ ...args, boardLabel: "30-Days" });
    expect(f.days).toBe("30");
    expect(f.auto).toBe(false);
    expect(f.edited).toBe(false);
    expect(f.hint).toBe("");
  });

  it("offers 75 only to Aetna", () => {
    expect(frequencyState({ ...args, primaryInsurance: "Aetna" }).options).toContain("75");
    expect(frequencyState({ ...args, primaryInsurance: "Cigna" }).options).not.toContain("75");
  });
});

describe("frequencyInvalidated", () => {
  /* Pick 75 for Aetna, then correct the plan — nothing downstream re-checks it,
     so the send would write a cadence that payer will not pay for. */
  it("catches a length the new payer doesn't offer", () => {
    expect(frequencyInvalidated("75", "Cigna")).toBe(true);
    expect(frequencyInvalidated("75", "Aetna")).toBe(false);
  });
  it("leaves an ordinary length alone", () => {
    expect(frequencyInvalidated("90", "Cigna")).toBe(false);
    expect(frequencyInvalidated("", "Cigna")).toBe(false);
  });
});
