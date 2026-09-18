import { describe, it, expect } from "vitest";
import { DISTRICT_ENDOCRINE_DASHBOARD_URL, dashboardDefaultMethod } from "./partnerDashboard";

describe("the dashboard link", () => {
  it("is the roster, and a plain constant", () => {
    // ⚠️ Not a per-patient URL (that hash lives in another repo), and not
    // something resolved at click time (a browser only allows a new tab during
    // user activation). Both reasons are in the module header.
    expect(DISTRICT_ENDOCRINE_DASHBOARD_URL).toBe("https://district-endocrine.medicallymodern.com/");
  });
});

describe("what a new doctor's method defaults to", () => {
  it("is Dashboard for a District Endocrine referral", () => {
    expect(dashboardDefaultMethod("District Endocrine")).toBe("Dashboard");
  });

  it("covers the old misspelling the board carried until Sept 2026", () => {
    expect(dashboardDefaultMethod("District Endochrine")).toBe("Dashboard");
  });

  it("leaves every other referral source to the caller's own default", () => {
    for (const src of ["Patient", "Tandem", "Beta Bionics", "CareCentrix", "Doctor", "SNJ", "SNJ [2.0]", "Wellstart", "Solace Advocates", "", "   "]) {
      expect(dashboardDefaultMethod(src)).toBeNull();
    }
    expect(dashboardDefaultMethod(null)).toBeNull();
    expect(dashboardDefaultMethod(undefined)).toBeNull();
  });

  it("trims, and does not match a near-miss", () => {
    expect(dashboardDefaultMethod("  District Endocrine  ")).toBe("Dashboard");
    expect(dashboardDefaultMethod("District Endocrinology")).toBeNull();
    expect(dashboardDefaultMethod("district endocrine")).toBeNull();
  });
});
