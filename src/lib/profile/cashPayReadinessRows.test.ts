/**
 * The readiness checklist is filtered for cash pay patients by matching row
 * LABELS (`cashPayIntake.CASH_PAY_DROPPED_ROW_LABELS`), and the rows themselves
 * live in two 2,000+ line pages. That string coupling is the whole risk: a row
 * renamed or added on either page silently stops being dropped, and the only
 * symptom is a cash pay patient who cannot advance — with the row sitting there
 * saying "missing" and no way to satisfy it. Exactly what stranded Debbie
 * Hinze, and exactly what ProfilePage's "Member ID 2 (NY Medicaid)" did until
 * 2026-09-22: the list carried the intake page's wording, "Member ID 2
 * (required for NY Medicaid)", and matched nothing.
 *
 * So this scans both pages for every checklist label and checks each one is
 * accounted for. A new row fails the build until somebody decides whether a
 * cash pay patient can satisfy it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { applyCashPayReadiness } from "./cashPayIntake";
import { DOCTOR_FAX_ROW_LABEL } from "./doctorFaxRequired";
import type { Patient } from "./workflow";

const cashPay = { generalInsurance: "Cash Pay" } as Patient;
const insured = { generalInsurance: "Aetna", primaryInsurance: "Aetna Commercial" } as Patient;

/** Rows a cash pay patient is still asked for. Product and identity, never
 *  insurance — plus the doctor, which Cardinal's order payload requires. */
const KEPT = [
  "Gender",
  "Address",
  "Phone",
  "CGM Type",
  "Pump Type",
  "Doctor selected",
  DOCTOR_FAX_ROW_LABEL,
];

/** Rows dropped for a cash pay patient. Must match CASH_PAY_DROPPED_ROW_LABELS
 *  — asserted below by running the real filter rather than by re-listing it. */
const DROPPED = [
  "Primary Insurance",
  "Member ID 1",
  "Member ID 2 (required for NY Medicaid)",
  "Member ID 2 (NY Medicaid)",
  "Secondary Insurance",
  "Benefits verified active",
  "CGM Coverage Path",
  "Insulin Pump Coverage Path",
  "IP Coverage Path",
  "Serving",
];

function labelsIn(file: string): string[] {
  const src = readFileSync(resolve(__dirname, "../../pages", file), "utf8");
  const found = new Set<string>();
  for (const m of src.matchAll(/\blabel:\s*"([^"]+)"/g)) found.add(m[1]);
  // The fax row is pushed by constant, not by literal, on both pages.
  if (src.includes("DOCTOR_FAX_ROW_LABEL")) found.add(DOCTOR_FAX_ROW_LABEL);
  return [...found];
}

describe("every checklist row on both intake pages is accounted for", () => {
  // ProfilePage also uses `label:` for form fields and result cells, so the
  // scan is deliberately over-broad and the allowlist absorbs the extras: an
  // unknown label is a failure whether it is a checklist row or not, which is
  // the safe direction.
  const NON_CHECKLIST = new Set(["Send link", "Open Calendly"]);

  for (const page of ["ProfilePage.tsx", "UnverifiedReferralsPage.tsx"]) {
    it(`${page} introduces no label the cash pay filter has never heard of`, () => {
      const unknown = labelsIn(page)
        .filter((l) => !KEPT.includes(l) && !DROPPED.includes(l) && !NON_CHECKLIST.has(l));
      expect(unknown, `decide whether a cash pay patient can satisfy: ${unknown.join(", ")}`)
        .toEqual([]);
    });
  }
});

describe("what the filter actually does", () => {
  it("drops every row in DROPPED for a cash pay patient", () => {
    const rows = DROPPED.map((label) => ({ label, ok: false }));
    expect(applyCashPayReadiness(rows, cashPay)).toEqual([]);
  });

  it("keeps every row in KEPT for a cash pay patient", () => {
    const rows = KEPT.map((label) => ({ label, ok: false }));
    expect(applyCashPayReadiness(rows, cashPay).map((r) => r.label)).toEqual(KEPT);
  });

  it("⚠️ the three rows that were blocking a cash pay patient are gone", () => {
    // Josh, 2026-09-22, pointing at a live checklist reading "3 missing".
    const rows = [
      { label: "Secondary Insurance", ok: false },
      { label: "Benefits verified active", ok: false },
      { label: "Serving", ok: false },
      { label: "Doctor selected", ok: true },
    ];
    expect(applyCashPayReadiness(rows, cashPay).map((r) => r.label)).toEqual(["Doctor selected"]);
  });

  it("⚠️ keeps the DOCTOR rows — Cardinal's order payload requires one", () => {
    const rows = [
      { label: "Member ID 1", ok: false },
      { label: "Doctor selected", ok: false },
      { label: DOCTOR_FAX_ROW_LABEL, ok: false },
    ];
    const kept = applyCashPayReadiness(rows, cashPay).map((r) => r.label);
    expect(kept).toEqual(["Doctor selected", DOCTOR_FAX_ROW_LABEL]);
  });

  it("leaves an insured patient's checklist exactly as it was", () => {
    const rows = [...DROPPED, ...KEPT].map((label) => ({ label, ok: true }));
    expect(applyCashPayReadiness(rows, insured)).toEqual(rows);
  });
});
