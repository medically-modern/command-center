/**
 * The fixtures are Mark MECHeal's live records (2026-09-17): patient
 * `13063500233` carrying NPI 1316121049, and the single Doctor DB item
 * `13063514110` "MEIR DERSHOWITZ" that the intake path auto-created beside it.
 */
import { describe, it, expect } from "vitest";
import {
  prefillLocation,
  prefillNpi,
  prefillProfileKey,
  prefillSelection,
  prefillTerm,
} from "./doctorPrefill";

const MEIR = { itemId: "13063514110", name: "MEIR DERSHOWITZ", npi: "1316121049" };

describe("prefillNpi", () => {
  it("takes a 10-digit NPI, however it is punctuated", () => {
    expect(prefillNpi({ doctorNpi: "1316121049" })).toBe("1316121049");
    expect(prefillNpi({ doctorNpi: " 1316121049 " })).toBe("1316121049");
  });

  it("⚠️ refuses anything that is not a whole NPI", () => {
    // searchDoctors is a contains_text search: three digits would match
    // hundreds of doctors, and picking one of them is the bug this guards.
    expect(prefillNpi({ doctorNpi: "131" })).toBe("");
    expect(prefillNpi({ doctorNpi: "13161210499" })).toBe("");
    expect(prefillNpi({ doctorNpi: "" })).toBe("");
    expect(prefillNpi({})).toBe("");
  });
});

describe("prefillTerm — the name fills the BOX, never the selection", () => {
  it("is the doctor's name off the record", () => {
    expect(prefillTerm({ doctorName: "MEIR DERSHOWITZ" })).toBe("MEIR DERSHOWITZ");
  });

  it("is empty when there is no name", () => {
    expect(prefillTerm({})).toBe("");
  });
});

describe("prefillSelection", () => {
  it("selects the one profile behind an NPI — Mark's case", () => {
    expect(prefillSelection([MEIR], "1316121049")).toBe(prefillProfileKey(MEIR));
  });

  it("selects it across several LOCATIONS of the same profile", () => {
    // One doctor, one name spelling, three clinics = still one profile.
    const locs = [MEIR, { ...MEIR, itemId: "2" }, { ...MEIR, itemId: "3" }];
    expect(prefillSelection(locs, "1316121049")).toBe(prefillProfileKey(MEIR));
  });

  it("⚠️ refuses to choose between two name SPELLINGS of one NPI", () => {
    /* DoctorSection's own comment: "Doctors can exist under several spellings
       (e.g. 'JASON SLOANE' vs 'JASON LOUIS SLOANE', same NPI) — the rep picks
       the exact PROFILE, never an NPI-merged blend." */
    const two = [
      { itemId: "1", name: "JASON SLOANE", npi: "1336584390" },
      { itemId: "2", name: "JASON LOUIS SLOANE", npi: "1336584390" },
    ];
    expect(prefillSelection(two, "1336584390")).toBeNull();
  });

  it("⚠️ ignores a record whose NPI merely CONTAINS the query", () => {
    // contains_text, so this really comes back from the search.
    const near = [{ itemId: "9", name: "SOMEBODY ELSE", npi: "13161210499" }];
    expect(prefillSelection(near, "1316121049")).toBeNull();
  });

  it("selects nothing on no match, or with no NPI to go on", () => {
    expect(prefillSelection([], "1316121049")).toBeNull();
    expect(prefillSelection([MEIR], "")).toBeNull();
  });
});

describe("prefillLocation — focus the single location, never choose between many", () => {
  it("focuses Mark's one location, so its notes and followers are readable", () => {
    const key = prefillProfileKey(MEIR);
    expect(prefillLocation([MEIR], key)).toBe("13063514110");
  });

  it("⚠️ focuses nothing when the profile has several — that choice is the rep's", () => {
    const key = prefillProfileKey(MEIR);
    expect(prefillLocation([MEIR, { ...MEIR, itemId: "2" }], key)).toBeNull();
  });

  it("focuses nothing with no profile selected", () => {
    expect(prefillLocation([MEIR], null)).toBeNull();
  });
});

describe("prefillProfileKey matches DoctorSection's own key", () => {
  it("normalizes name and keeps the NPI verbatim", () => {
    // If these two ever diverge the prefill sets a selectedKey that matches no
    // record, and the card renders empty — a silent failure.
    expect(prefillProfileKey({ name: "Meir Dershowitz", npi: "1316121049" }))
      .toBe(prefillProfileKey({ name: "MEIR  DERSHOWITZ", npi: "1316121049" }));
    expect(prefillProfileKey(MEIR)).toBe("meirdershowitz|1316121049");
  });
});
