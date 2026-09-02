import { describe, it, expect } from "vitest";
import { phoneMatchVariants, rcNameStrength, resolveDisplayName } from "./directory";

/** Stand-in for the app's formatter — the module takes it as an argument so it
 *  stays pure and these cases don't depend on presentation. */
const fmt = (p: string) => {
  const d = String(p).replace(/\D/g, "").slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : "";
};

describe("rcNameStrength", () => {
  it("treats a real contact name as strong", () => {
    expect(rcNameStrength("CareCentrix", "+13475550101")).toBe("strong");
    expect(rcNameStrength("Dr. Maju Lim", "")).toBe("strong");
  });

  it("rejects a blank or placeholder name", () => {
    for (const junk of ["", "   ", "Wireless Caller", "UNKNOWN", "Toll Free", "Scam Likely"]) {
      expect(rcNameStrength(junk, "+13475550101")).toBe("junk");
    }
  });

  it("rejects the number written back at us, however it is punctuated", () => {
    expect(rcNameStrength("8155237259", "+18155237259")).toBe("junk");
    expect(rcNameStrength("(815) 523-7259", "8155237259")).toBe("junk");
    expect(rcNameStrength("+18155237259", "+18155237259")).toBe("junk");
  });

  it("demotes a CITY ST carrier CNAM to weak, not junk", () => {
    // It names a place rather than a person, so a patient name beats it — but
    // it still beats a bare number when we have nothing else.
    expect(rcNameStrength("LA JOLLA CA", "+18583666900")).toBe("weak");
    expect(rcNameStrength("NEW YORK NY", "")).toBe("weak");
  });

  it("does not demote an all-caps name whose last word is not a state", () => {
    expect(rcNameStrength("MEDICALLY MODERN LP", "")).toBe("strong");
    expect(rcNameStrength("TONASILA GRAY", "")).toBe("strong");
  });
});

describe("resolveDisplayName", () => {
  it("prefers RingCentral's contact — Josh's rule, RC first", () => {
    const r = resolveDisplayName(
      { rcName: "CareCentrix", directoryName: "Tonasila Gray", phone: "+18155237259" },
      fmt,
    );
    expect(r).toEqual({ label: "CareCentrix", source: "rc" });
  });

  it("falls back to our boards when RingCentral has only a number", () => {
    const r = resolveDisplayName({ rcName: "", directoryName: "Tonasila Gray", phone: "+18155237259" }, fmt);
    expect(r).toEqual({ label: "Tonasila Gray", source: "directory" });
  });

  it("beats a CITY ST CNAM with the patient name", () => {
    const r = resolveDisplayName(
      { rcName: "LA JOLLA CA", directoryName: "Tonasila Gray", phone: "+18155237259" },
      fmt,
    );
    expect(r).toEqual({ label: "Tonasila Gray", source: "directory" });
  });

  it("still shows a CNAM when the boards know nobody", () => {
    const r = resolveDisplayName({ rcName: "LA JOLLA CA", directoryName: "", phone: "+18583666900" }, fmt);
    expect(r).toEqual({ label: "LA JOLLA CA", source: "cnam" });
  });

  it("falls all the way back to the formatted number", () => {
    const r = resolveDisplayName({ rcName: "Wireless Caller", phone: "+18155237259" }, fmt);
    expect(r).toEqual({ label: "(815) 523-7259", source: "number" });
  });

  it("never returns an empty label", () => {
    expect(resolveDisplayName({ phone: "" }, fmt).label).toBe("");
    expect(resolveDisplayName({ phone: "12345" }, fmt).label).toBe("12345");
  });
});

describe("phoneMatchVariants", () => {
  it("asks for BOTH digit shapes the boards actually hold", () => {
    // ⚠️ Verified live 2026-09-02: the Welcome Call board holds `9739511857`
    // and `16078737352` in the same column, and `any_of` is an exact match —
    // one shape alone returns 200 with no rows, which reads as "not a patient".
    expect(phoneMatchVariants("8155237259")).toEqual(["8155237259", "18155237259", "+18155237259"]);
  });

  it("normalises whatever shape it is given", () => {
    expect(phoneMatchVariants("+1 (815) 523-7259")).toEqual([
      "8155237259",
      "18155237259",
      "+18155237259",
    ]);
  });

  it("returns nothing for a number that isn't 10 digits", () => {
    expect(phoneMatchVariants("911")).toEqual([]);
    expect(phoneMatchVariants("")).toEqual([]);
  });
});
