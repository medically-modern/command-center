// Acceptance tests for the Primary/Secondary suggestion engine.
// Cases are the scrubbed real patients baked into the redesign prototype
// (profile-sendoff-redesign-v2.html TEST_PATIENTS), asserting the engine's
// deterministic routing rules. Run: npx vitest run src/lib/profile/primaryInsurance.test.ts
import { describe, it, expect } from "vitest";
import {
  suggestPrimary, suggestSecondary, isCoverageActive, primaryPayerMismatch,
  type SuggestionInputs, type StediSnapshot,
} from "./primaryInsurance";

function mk(
  o: {
    gins: string; memberId?: string; address?: string; requestType?: string;
  } & Partial<StediSnapshot> & { active?: string },
): SuggestionInputs {
  return {
    stediDone: true,
    generalInsurance: o.gins,
    memberId: o.memberId ?? "",
    patientAddress: o.address ?? "",
    requestType: o.requestType ?? "CGM",
    stedi: {
      active: o.active ?? "Active",
      covtype: o.covtype ?? "",
      plan: o.plan ?? "",
      payerName: o.payerName ?? "",
      homeplan: o.homeplan ?? "",
      medid: o.medid ?? "",
      qmb: o.qmb ?? "No",
      ma: o.ma ?? false,
      mltc: o.mltc ?? false,
      managedMedicaid: o.managedMedicaid ?? "",
      primaryPayer: o.primaryPayer ?? "",
    },
  };
}

describe("suggestPrimary — payer routing", () => {
  it("returns null before Stedi runs", () => {
    expect(suggestPrimary({ ...mk({ gins: "Humana" }), stediDone: false })).toBeNull();
  });

  it("inactive coverage → no suggestion + INACTIVE warning", () => {
    const sg = suggestPrimary(mk({ gins: "Medicaid", active: "No" }));
    expect(sg?.value).toBeNull();
    expect(sg?.warnings.some((w) => w.code === "INACTIVE")).toBe(true);
  });

  it("Anthem + NJ address → Horizon BCBS (host Blue)", () => {
    const sg = suggestPrimary(mk({
      gins: "Anthem / BCBS", address: "30 Ravine Avenue, Wyckoff, NJ, USA",
      homeplan: "Horizon Blue Cross and Blue Shield of New Jersey", covtype: "Commercial",
    }));
    expect(sg?.value).toBe("Horizon BCBS");
  });

  it("Anthem JLJ Medicaid + pump → Anthem BCBS Medicaid (JLJ)", () => {
    const sg = suggestPrimary(mk({
      gins: "Anthem / BCBS", memberId: "JLJ735970080", requestType: "Insulin Pump",
      plan: "NEW YORK MEDICAID-LONG ISLAND- HARP", covtype: "Medicaid",
    }));
    expect(sg?.value).toBe("Anthem BCBS Medicaid (JLJ)");
  });

  it("Anthem NY Medicaid + Supplies Only → drops to plain Medicaid", () => {
    const sg = suggestPrimary(mk({
      gins: "Anthem / BCBS", memberId: "JLJ716456572", requestType: "Supplies Only",
      address: "1504 SHERIDAN AVE, BRONX, NY 10457", plan: "NEW YORK MEDICAID", covtype: "Medicaid",
    }));
    expect(sg?.value).toBe("Medicaid");
  });

  it("Fidelis Medicaid Managed Care → Fidelis Medicaid", () => {
    const sg = suggestPrimary(mk({
      gins: "Fidelis", requestType: "Insulin Pump",
      plan: "Fidelis Medicaid Managed Care", covtype: "Medicaid",
    }));
    expect(sg?.value).toBe("Fidelis Medicaid");
  });

  it("Fidelis Essential Plan → Fidelis Low-Cost", () => {
    const sg = suggestPrimary(mk({ gins: "Fidelis", plan: "Essential Plan 1", covtype: "Medicaid" }));
    expect(sg?.value).toBe("Fidelis Low-Cost");
  });

  // CHIP regex fix (Brandon 2026-07-15, member JLJ730667355): "NY CHIP" is
  // Child Health Plus = Low-Cost — before the fix it skipped the Low-Cost
  // branch, hit the covtype check, and mis-suggested Medicaid (JLJ) (then the
  // supplies-only fork demoted the pill to plain "Medicaid").
  it('Anthem "NY CHIP" plan → Anthem BCBS Low-Cost (JLJ), not Medicaid', () => {
    const sg = suggestPrimary(mk({
      gins: "Anthem / BCBS", memberId: "JLJ730667355", requestType: "Supplies Only",
      address: "1504 SHERIDAN AVE, BRONX, NY 10457",
      plan: "NY CHIP - MEMBER AND STATE BILLING", covtype: "Medicaid",
    }));
    expect(sg?.value).toBe("Anthem BCBS Low-Cost (JLJ)");
    expect(sg?.warnings.some((w) => w.code === "CHECK_MEDICAID_ID")).toBe(false);
  });

  // Anjuman Begum (Brandon, 2026-07-20): MLTC member with a JLJ member ID.
  // The pill already said Low-Cost (JLJ) but carried no warning — a rep
  // seeing a Medicaid ID on the card could still route Medicaid. MLTC DME
  // is carved to the plan, so the warning states it explicitly.
  it("Anthem MLTC plan → Low-Cost (JLJ) + MLTC_PLAN warning", () => {
    const sg = suggestPrimary(mk({
      gins: "Anthem / BCBS", memberId: "JLJ733871286",
      plan: "NEW YORK MLTC", covtype: "Medicaid", payerName: "ANTHEM",
    }));
    expect(sg?.value).toBe("Anthem BCBS Low-Cost (JLJ)");
    expect(sg?.warnings.some((w) => w.code === "MLTC_PLAN")).toBe(true);
    expect(sg?.warnings.find((w) => w.code === "MLTC_PLAN")?.message).toContain("NEW YORK MLTC");
  });

  it("Anthem MLTC via the Stedi MLTC flag column → same warning", () => {
    const sg = suggestPrimary(mk({
      gins: "Anthem / BCBS", memberId: "JLJ733871286",
      plan: "SOME PLAN", covtype: "Medicaid", mltc: true,
    }));
    expect(sg?.value).toBe("Anthem BCBS Low-Cost (JLJ)");
    expect(sg?.warnings.some((w) => w.code === "MLTC_PLAN")).toBe(true);
  });
  it('United "CHIP" plan → United Low-Cost', () => {
    expect(suggestPrimary(mk({
      gins: "United Healthcare", plan: "NY CHIP PREMIUM", covtype: "Medicaid", requestType: "Supplies Only",
    }))?.value).toBe("United Low-Cost");
  });
  it('other-payer "CHIP" plan → Low-Cost (classifyCoverage)', () => {
    expect(suggestPrimary(mk({
      gins: "Other", payerName: "SOME PAYER", plan: "NY CHIP - MEMBER AND STATE BILLING",
      covtype: "Medicaid", requestType: "Supplies Only",
    }))?.value).toBe("Low-Cost");
  });
  it('"\\bchip\\b" is word-bounded — CHIPPEWA plan is NOT Low-Cost', () => {
    expect(suggestPrimary(mk({
      gins: "Anthem / BCBS", plan: "CHIPPEWA HEALTH PLAN", covtype: "Commercial",
      address: "1504 SHERIDAN AVE, BRONX, NY 10457", requestType: "Supplies Only",
    }))?.value).toBe("Anthem BCBS Commercial");
  });

  it("Fidelis Wellcare Dual → Fidelis Medicare + NY Medicaid secondary", () => {
    const inp = mk({
      gins: "Fidelis", requestType: "Insulin Pump",
      plan: "Wellcare Fidelis Dual Liberty Sync (Upstate)", covtype: "Medicaid",
    });
    expect(suggestPrimary(inp)?.value).toBe("Fidelis Medicare");
    expect(suggestSecondary(inp)).toBe("NY Medicaid");
  });

  it("United DUAL COMPLETE → United Medicare + NY Medicaid secondary", () => {
    const inp = mk({
      gins: "United Healthcare", requestType: "Supplies + CGM",
      payerName: "NY UNITEDHEALTHCARE DUAL COMPLETE HMOPOS FULL H338",
      plan: "NY UNITEDHEALTHCARE DUAL COMPLETE HMOPOS FULL H338",
      covtype: "Medicare Advantage", ma: true,
    });
    expect(suggestPrimary(inp)?.value).toBe("United Medicare");
    expect(suggestSecondary(inp)).toBe("NY Medicaid");
  });

  it("straight Medicare A&B → Medicare A&B", () => {
    const sg = suggestPrimary(mk({ gins: "Medicare A&B", covtype: "Medicare A&B", payerName: "Medicare A&B" }));
    expect(sg?.value).toBe("Medicare A&B");
  });

  it("unmapped Medicare Advantage → no confident pick + MA_PRIMARY", () => {
    const sg = suggestPrimary(mk({
      gins: "Medicare A&B", payerName: "Senior Whole Health Medicare Complete Care",
      plan: "Senior Whole Health Medicare Complete Care", covtype: "Medicare Advantage", ma: true, qmb: "Yes",
    }));
    expect(sg?.value).toBeNull();
    expect(sg?.warnings.some((w) => w.code === "MA_PRIMARY")).toBe(true);
  });

  // Samira Delacruz (2026-07-16): MA + QMB=Yes → D-SNP dual. MA_DUAL rides
  // alongside MA_PRIMARY; the "Check card" null pick is unchanged.
  it("MA + QMB=Yes → MA_DUAL alongside MA_PRIMARY", () => {
    const sg = suggestPrimary(mk({
      gins: "Medicare A&B", payerName: "Senior Whole Health of New York",
      plan: "Senior Whole Health", covtype: "Medicare Advantage", ma: true, qmb: "Yes",
    }));
    expect(sg?.value).toBeNull();
    expect(sg?.warnings.some((w) => w.code === "MA_PRIMARY")).toBe(true);
    expect(sg?.warnings.some((w) => w.code === "MA_DUAL")).toBe(true);
  });

  it("MA without QMB → MA_PRIMARY only, no MA_DUAL", () => {
    const sg = suggestPrimary(mk({
      gins: "Medicare A&B", payerName: "Some MA Carrier",
      plan: "Some MA Advantage", covtype: "Medicare Advantage", ma: true, qmb: "No",
    }));
    expect(sg?.warnings.some((w) => w.code === "MA_PRIMARY")).toBe(true);
    expect(sg?.warnings.some((w) => w.code === "MA_DUAL")).toBe(false);
  });

  // §1a HARD BLOCK (HANDOFF 2026-07-20): Hollander picked Medicare A&B
  // past the warning — MA now always carries MA_PRIMARY (and the select
  // disables the Medicare A&B option off this same flag).
  it("MA → single MA_PRIMARY hard-block warning (no duplicate MA_UNMAPPED)", () => {
    const sg = suggestPrimary(mk({
      gins: "Medicare A&B", payerName: "UnitedHealthcare Group Medicare Advantage",
      covtype: "Medicare Advantage", ma: true, qmb: "No",
    }));
    expect(sg?.value).toBeNull();
    expect(sg?.warnings.some((w) => w.code === "MA_PRIMARY")).toBe(true);
    // No duplicate second MA warning (Brandon, 2026-07-20).
    expect(sg?.warnings.some((w) => w.code === "MA_UNMAPPED")).toBe(false);
    expect(sg?.warnings.filter((w) => w.code === "MA_PRIMARY").length).toBe(1);
    expect(sg?.warnings.find((w) => w.code === "MA_PRIMARY")?.message)
      .toContain("UnitedHealthcare Group Medicare Advantage");
  });

  // §1b SOFT BLOCK (HANDOFF 2026-07-20) — Anthony Thompson: CMS COB file
  // reports BCBS SC primary (MSP type 43, spouse's LGHP). NO suggestion
  // (Brandon, 2026-07-20): the rep always re-runs the check against the
  // commercial payer, and THAT check produces the suggestion.
  it("MSP commercial-primary (BCBS) → NO suggestion + MSP_PRIMARY", () => {
    const sg = suggestPrimary(mk({
      gins: "Medicare A&B", payerName: "Medicare A&B", covtype: "Medicare A&B",
      primaryPayer: "BLUE CROSS BLUE SHIELD S.C.",
    }));
    expect(sg?.value).toBeNull();
    expect(sg?.confidence).toBe("low");
    expect(sg?.warnings.some((w) => w.code === "MSP_PRIMARY")).toBe(true);
    expect(sg?.reason).toContain("re-run the check");
  });

  // Jeremy Baluyot: Aetna Health type 43 — same, no family mapping.
  it("MSP commercial-primary (Aetna) → NO suggestion + MSP_PRIMARY", () => {
    const sg = suggestPrimary(mk({
      gins: "Medicare A&B", payerName: "Medicare A&B", covtype: "Medicare A&B",
      primaryPayer: "AETNA HEALTH INC.",
    }));
    expect(sg?.value).toBeNull();
    expect(sg?.warnings.some((w) => w.code === "MSP_PRIMARY")).toBe(true);
  });

  it("MSP primary with unmapped carrier → null pick + MSP_PRIMARY", () => {
    const sg = suggestPrimary(mk({
      gins: "Medicare A&B", payerName: "Medicare A&B", covtype: "Medicare A&B",
      primaryPayer: "SOME EMPLOYER TRUST",
    }));
    expect(sg?.value).toBeNull();
    expect(sg?.warnings.some((w) => w.code === "MSP_PRIMARY")).toBe(true);
  });

  // Asif Sheikh–type: situational MSP records (auto/WC) are filtered by the
  // backend and never land in Stedi Primary Payer — a plain "Medicare"
  // value must keep the green Medicare A&B pill.
  it("Stedi Primary Payer = Medicare → normal Medicare A&B pill, no MSP block", () => {
    const sg = suggestPrimary(mk({
      gins: "Medicare A&B", payerName: "Medicare A&B", covtype: "Medicare A&B",
      primaryPayer: "Medicare",
    }));
    expect(sg?.value).toBe("Medicare A&B");
    expect(sg?.confidence).toBe("high");
    expect(sg?.warnings.some((w) => w.code === "MSP_PRIMARY")).toBe(false);
  });

  it("blank Stedi Primary Payer (older items) → unchanged Medicare A&B pill", () => {
    const sg = suggestPrimary(mk({
      gins: "Medicare A&B", payerName: "Medicare A&B", covtype: "Medicare A&B",
    }));
    expect(sg?.value).toBe("Medicare A&B");
    expect(sg?.warnings.length).toBe(0);
  });

  // Ryan Impellizeri (Brandon, 2026-07-20): Fidelis Essential Plan 271 with a
  // 2120 NM1*PRP naming UHC StudentResources as PRIMARY. Every branch — not
  // just Medicare — must surface the mismatch.
  it("non-Medicare COB record (Fidelis → UHC StudentResources) → PRIMARY_PAYER_MISMATCH", () => {
    const sg = suggestPrimary(mk({
      gins: "Fidelis", payerName: "Fidelis Care New York", covtype: "Medicaid",
      plan: "Essential Plan 1", primaryPayer: "United Healthcare Student Resource",
    }));
    expect(sg?.warnings.some((w) => w.code === "PRIMARY_PAYER_MISMATCH")).toBe(true);
    expect(sg?.warnings.find((w) => w.code === "PRIMARY_PAYER_MISMATCH")?.message)
      .toContain("United Healthcare Student Resource");
    // NO suggestion at all (Brandon, 2026-07-20): the re-run against the
    // named primary produces the suggestion — never a pill from this check.
    expect(sg?.value).toBeNull();
    expect(sg?.confidence).toBe("low");
    expect(sg?.reason).toContain("re-run the check");
  });

  it("COB mismatch with unmapped primary carrier → null pick (Check card)", () => {
    const sg = suggestPrimary(mk({
      gins: "Fidelis", payerName: "Fidelis Care New York", covtype: "Medicaid",
      plan: "Essential Plan 1", primaryPayer: "SOME EMPLOYER TRUST FUND",
    }));
    expect(sg?.value).toBeNull();
    expect(sg?.warnings.some((w) => w.code === "PRIMARY_PAYER_MISMATCH")).toBe(true);
  });

  it("matching primary payer (payer name echoed) → no mismatch warning", () => {
    const sg = suggestPrimary(mk({
      gins: "Fidelis", payerName: "Fidelis Care New York", covtype: "Medicaid",
      plan: "Essential Plan 1", primaryPayer: "Fidelis Care New York",
    }));
    expect(sg?.warnings.some((w) => w.code === "PRIMARY_PAYER_MISMATCH")).toBe(false);
  });

  it("Medicare MSP branch keeps MSP_PRIMARY only — no duplicate mismatch warning", () => {
    const sg = suggestPrimary(mk({
      gins: "Medicare A&B", payerName: "Medicare A&B", covtype: "Medicare A&B",
      primaryPayer: "AETNA HEALTH INC.",
    }));
    expect(sg?.warnings.some((w) => w.code === "MSP_PRIMARY")).toBe(true);
    expect(sg?.warnings.some((w) => w.code === "PRIMARY_PAYER_MISMATCH")).toBe(false);
  });

  it("primaryPayerMismatch treats Medicare/Medicare A&B and substrings as matches", () => {
    expect(primaryPayerMismatch("Medicare", "Medicare A&B")).toBe(false);
    expect(primaryPayerMismatch("ANTHEM", "ANTHEM")).toBe(false);
    expect(primaryPayerMismatch("", "Fidelis Care New York")).toBe(false);
    expect(primaryPayerMismatch("United Healthcare Student Resource", "Fidelis Care New York")).toBe(true);
  });

  it("Humana Gold Plus (MA) → Humana", () => {
    const sg = suggestPrimary(mk({
      gins: "Humana", payerName: "Humana Gold Plus", plan: "Humana Gold Plus",
      covtype: "Medicare Advantage", ma: true,
    }));
    expect(sg?.value).toBe("Humana");
  });

  // Rulebook example 11 (Lakisha Valdez): NYSDOH + Molina managed plan →
  // keep the Medicaid suggestion, warn supplies-only. Real Stedi writes
  // Coverage Type as plain "Medicaid" and the MCO in its own column.
  it("NYSDOH + Managed Medicaid (Molina) → Medicaid + supplies-only warning", () => {
    const sg = suggestPrimary(mk({
      gins: "Medicaid", payerName: "NYSDOH", covtype: "Medicaid", requestType: "Insulin Pump + CGM",
      plan: "NEW YORK MEDICAID", managedMedicaid: "MOLINA HEALTHCARE OF NY INC MAINSTR",
    }));
    expect(sg?.value).toBe("Medicaid");
    const warn = sg?.warnings.find((w) => w.code === "MANAGED_MEDICAID");
    expect(warn?.message).toContain("MOLINA HEALTHCARE OF NY INC MAINSTR");
  });

  it("NYSDOH without managed plan → no managed-medicaid warning", () => {
    const sg = suggestPrimary(mk({ gins: "Medicaid", payerName: "NYSDOH", covtype: "Medicaid", plan: "NEW YORK MEDICAID", requestType: "Supplies Only" }));
    expect(sg?.value).toBe("Medicaid");
    expect(sg?.warnings.some((w) => w.code === "MANAGED_MEDICAID")).toBe(false);
  });

  it('Stedi "—" none-marker in Managed Medicaid → no warning', () => {
    const sg = suggestPrimary(mk({ gins: "Medicaid", payerName: "NYSDOH", covtype: "Medicaid", plan: "NEW YORK MEDICAID", managedMedicaid: "—", requestType: "Supplies Only" }));
    expect(sg?.warnings.some((w) => w.code === "MANAGED_MEDICAID")).toBe(false);
  });

  // The warning is scoped to the NYSDOH branch — a Medicaid plan routed to a
  // mapped carrier (here Aetna Better Health) must not pick it up even with a
  // populated Managed Medicaid column.
  it("mapped-carrier Medicaid + populated Managed Medicaid → no NYSDOH warning", () => {
    const sg = suggestPrimary(mk({
      gins: "Aetna", payerName: "AETNA BETTER HEALTH OF NEW YORK", covtype: "Medicaid",
      plan: "AETNA BETTER HEALTH MEDICAID", managedMedicaid: "AETNA BETTER HEALTH OF NEW YORK",
      requestType: "Supplies Only",
    }));
    expect(sg?.value).toBe("Medicaid"); // no pump requested → medicaidFork drops to plain Medicaid
    expect(sg?.warnings.some((w) => w.code === "MANAGED_MEDICAID")).toBe(false);
  });
});

// CGM-only + any Medicaid flavor → Can't Serve (Brandon 2026-07-14; supersedes
// the rulebooks' §6.5 fork for that row). Advisory only — value stays null so
// nothing can be applied or written.
describe("Can't Serve — CGM-only for Medicaid", () => {
  // Hunora Lewis (item 12517509742): Fidelis managed Medicaid, CGM referral.
  const hunora = (requestType: string) => mk({
    gins: "Fidelis", requestType, plan: "Fidelis Medicaid Managed Care",
    covtype: "Medicaid", medid: "GZ63048E",
  });

  it("Hunora: Fidelis Medicaid + CGM → Can't Serve", () => {
    const sg = suggestPrimary(hunora("CGM"));
    expect(sg?.cantServe).toBe(true);
    expect(sg?.value).toBeNull();
    expect(sg?.reason).toBe("");
  });
  it("Hunora: Supplies + CGM → Medicaid (serve supplies only, unchanged demotion)", () => {
    const sg = suggestPrimary(hunora("Supplies + CGM"));
    expect(sg?.cantServe).toBeUndefined();
    expect(sg?.value).toBe("Medicaid");
  });
  it("Hunora: Insulin Pump → Fidelis Medicaid (unchanged)", () => {
    expect(suggestPrimary(hunora("Insulin Pump"))?.value).toBe("Fidelis Medicaid");
  });
  it("Can't Serve suppresses the NY Medicaid secondary backstop", () => {
    expect(suggestSecondary(hunora("CGM"))).toBe("");
    expect(suggestSecondary(hunora("Insulin Pump"))).toBe("NY Medicaid");
  });

  // Lakisha Valdez–type: NYSDOH + Molina MCO in the Managed Medicaid column.
  const lakisha = (requestType: string) => mk({
    gins: "Medicaid", payerName: "NYSDOH", covtype: "Medicaid", requestType,
    plan: "ELIGIBLE PCP", managedMedicaid: "MOLINA HEALTHCARE OF NY INC MAINSTR",
  });

  it("Lakisha: NYSDOH + Molina + Insulin Pump + CGM → Medicaid + managed warning (unchanged)", () => {
    const sg = suggestPrimary(lakisha("Insulin Pump + CGM"));
    expect(sg?.value).toBe("Medicaid");
    expect(sg?.warnings.some((w) => w.code === "MANAGED_MEDICAID")).toBe(true);
  });
  it("Lakisha: CGM → Can't Serve", () => {
    expect(suggestPrimary(lakisha("CGM"))?.cantServe).toBe(true);
  });

  it("straight NYSDOH, no MCO: CGM → Can't Serve", () => {
    const sg = suggestPrimary(mk({ gins: "Medicaid", payerName: "NYSDOH", covtype: "Medicaid", plan: "NEW YORK MEDICAID", requestType: "CGM" }));
    expect(sg?.cantServe).toBe(true);
  });
  it("straight NYSDOH, no MCO: Supplies Only → Medicaid (unchanged)", () => {
    const sg = suggestPrimary(mk({ gins: "Medicaid", payerName: "NYSDOH", covtype: "Medicaid", plan: "NEW YORK MEDICAID", requestType: "Supplies Only" }));
    expect(sg?.cantServe).toBeUndefined();
    expect(sg?.value).toBe("Medicaid");
  });

  it("Anthem NY managed Medicaid (JLJ): CGM → Can't Serve", () => {
    const sg = suggestPrimary(mk({
      gins: "Anthem / BCBS", memberId: "JLJ735970080", requestType: "CGM",
      address: "1504 SHERIDAN AVE, BRONX, NY 10457",
      plan: "NEW YORK MEDICAID-LONG ISLAND- HARP", covtype: "Medicaid",
    }));
    expect(sg?.cantServe).toBe(true);
  });

  it("unmapped managed carrier (Molina payer) Medicaid: CGM → Can't Serve", () => {
    const sg = suggestPrimary(mk({
      gins: "Other", payerName: "MOLINA HEALTHCARE OF NY", covtype: "Medicaid",
      plan: "MOLINA MEDICAID MANAGED CARE", requestType: "CGM",
    }));
    expect(sg?.cantServe).toBe(true);
  });

  it("Wellcare dual / D-SNP: CGM → Can't Serve", () => {
    const sg = suggestPrimary(mk({
      gins: "Wellcare", payerName: "WELLCARE", plan: "Wellcare Dual Align D-SNP",
      covtype: "Medicaid", requestType: "CGM",
    }));
    expect(sg?.cantServe).toBe(true);
  });

  it("commercial coverage: CGM stays unchanged (rule doesn't apply)", () => {
    const sg = suggestPrimary(mk({
      gins: "Anthem / BCBS", requestType: "CGM", address: "30 Ravine Avenue, Wyckoff, NJ, USA",
      homeplan: "Horizon Blue Cross and Blue Shield of New Jersey", covtype: "Commercial",
    }));
    expect(sg?.cantServe).toBeUndefined();
    expect(sg?.value).toBe("Horizon BCBS");
  });

  it('"Insulin Pump + CGM" / "Supplies + CGM" are NOT CGM-only', () => {
    expect(suggestPrimary(hunora("Insulin Pump + CGM"))?.cantServe).toBeUndefined();
    expect(suggestPrimary(hunora("Supplies + CGM"))?.cantServe).toBeUndefined();
  });
});

describe("suggestSecondary — Medicaid backstop", () => {
  it("QMB=Yes → NY Medicaid", () => {
    expect(suggestSecondary(mk({ gins: "Humana", qmb: "Yes", plan: "Humana Gold Plus", ma: true }))).toBe("NY Medicaid");
  });
  it("Medicaid ID returned → NY Medicaid", () => {
    expect(suggestSecondary(mk({ gins: "Cigna", medid: "FB17532H", covtype: "Commercial" }))).toBe("NY Medicaid");
  });
  it("no backstop → no secondary", () => {
    expect(suggestSecondary(mk({ gins: "Cigna", covtype: "Commercial" }))).toBe("");
  });
  it("non-CIN Medicaid ID on a CHP plan → no secondary", () => {
    // Emma Novick shape: Fidelis CHP kid, Stedi returned a non-CIN id and
    // QMB=No — the referral's wrong "NY Medicaid" claim must never surface
    // as an engine suggestion.
    expect(suggestSecondary(mk({
      gins: "Fidelis", plan: "Child Health Plus", covtype: "Medicaid", medid: "50980348",
    }))).toBe("");
  });
});

describe("isCoverageActive", () => {
  it("treats Active / Yes as active", () => {
    expect(isCoverageActive({ active: "Active" } as StediSnapshot)).toBe(true);
    expect(isCoverageActive({ active: "Yes" } as StediSnapshot)).toBe(true);
    expect(isCoverageActive({ active: "No" } as StediSnapshot)).toBe(false);
  });
});
