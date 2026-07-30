/**
 * Manager-only insurance-identity correction (2026-07-30).
 *
 * Two things are pinned here. The obvious one is the diff/note/product-impact
 * behaviour the dialog renders. The one that matters more is the last block:
 * every column this flow WRITES must be in the list the read path FETCHES.
 * That's the invariant the Benefits universal-check bug broke — the writes
 * landed, the reads never asked for the columns, and the round-trip looked
 * broken for weeks. Here it would be worse than invisible: an unfetched column
 * reads blank, so `diffIdentity` would report a change on every open and the
 * dialog would happily re-write a value that was already correct.
 */
import { describe, it, expect } from "vitest";
import {
  diffIdentity,
  identityDraftFrom,
  identityNoteText,
  productImpact,
  IDENTITY_STATUS_COLUMNS,
  IDENTITY_TEXT_COLUMNS,
  type IdentityDraft,
} from "./managerIdentityEdit";
import { READ_COLUMN_IDS, AUTH_READ_COLUMN_IDS } from "./mondayApi";
import { EMPTY_INSURANCE, type Patient } from "./workflow";
import { isManagerEscalationView } from "../shared/managerOrigin";

function patient(over: Partial<Patient> = {}): Patient {
  return {
    id: "1",
    name: "Test Patient",
    notes: "",
    insurance: structuredClone(EMPTY_INSURANCE),
    serving: "CGM",
    primaryInsurance: "Cigna",
    secondaryInsurance: "None",
    memberId1: "W1234",
    memberId2: "",
    ...over,
  } as Patient;
}

const draftOf = (p: Patient, over: Partial<IdentityDraft> = {}): IdentityDraft => ({
  ...identityDraftFrom(p),
  ...over,
});

describe("diffIdentity", () => {
  it("is empty when nothing moved — the Save button stays disabled", () => {
    const p = patient();
    expect(diffIdentity(p, draftOf(p))).toEqual([]);
  });

  it("reports each changed field with its board-facing label", () => {
    const p = patient();
    const changes = diffIdentity(p, draftOf(p, { primaryInsurance: "Aetna Commercial" }));
    expect(changes).toEqual([
      { field: "primaryInsurance", label: "Primary Insurance", from: "Cigna", to: "Aetna Commercial" },
    ]);
  });

  it("reports several changes in field order", () => {
    const p = patient();
    const changes = diffIdentity(
      p,
      draftOf(p, { serving: "Insulin Pump + CGM", memberId2: "M-9" }),
    );
    expect(changes.map((c) => c.field)).toEqual(["serving", "memberId2"]);
  });

  it("trims member IDs — a stray space is not a correction", () => {
    const p = patient({ memberId1: "W1234" });
    expect(diffIdentity(p, draftOf(p, { memberId1: "  W1234  " }))).toEqual([]);
    expect(diffIdentity(p, draftOf(p, { memberId1: " W9999 " }))[0].to).toBe("W9999");
  });

  it("treats filling a blank field as a change, and clearing one too", () => {
    const blank = patient({ primaryInsurance: "" as Patient["primaryInsurance"], memberId1: "" });
    expect(diffIdentity(blank, draftOf(blank, { primaryInsurance: "Humana" }))[0]).toMatchObject({
      from: "",
      to: "Humana",
    });
    const filled = patient({ memberId1: "W1234" });
    expect(diffIdentity(filled, draftOf(filled, { memberId1: "" }))[0]).toMatchObject({
      from: "W1234",
      to: "",
    });
  });
});

describe("identityNoteText", () => {
  it("names every field and both values, so the notes column explains itself", () => {
    const p = patient();
    const changes = diffIdentity(
      p,
      draftOf(p, { primaryInsurance: "Aetna Commercial", serving: "Insulin Pump" }),
    );
    expect(identityNoteText(changes)).toBe(
      'Manager correction — Serving: "CGM" → "Insulin Pump"; Primary Insurance: "Cigna" → "Aetna Commercial"',
    );
  });

  it("renders an empty side as (blank) rather than an empty quote", () => {
    const p = patient({ memberId2: "" });
    const changes = diffIdentity(p, draftOf(p, { memberId2: "M-9" }));
    expect(identityNoteText(changes)).toBe('Manager correction — Member ID 2: (blank) → "M-9"');
  });
});

describe("productImpact — the caveat the dialog has to show", () => {
  it("is null when the product set is untouched", () => {
    const p = patient();
    expect(productImpact(p, draftOf(p, { memberId1: "W-9" }))).toBeNull();
  });

  it("lists products gained when Serving widens", () => {
    const p = patient({ serving: "CGM" });
    const impact = productImpact(p, draftOf(p, { serving: "Insulin Pump + CGM" }));
    expect(impact?.removed).toEqual([]);
    expect(impact?.added).toEqual(expect.arrayContaining(["Insulin Pump", "Infusion Sets", "Cartridges"]));
  });

  it("lists products LOST when Serving narrows — the answers that go dark", () => {
    const p = patient({ serving: "Insulin Pump + CGM" });
    const impact = productImpact(p, draftOf(p, { serving: "CGM" }));
    expect(impact?.added).toEqual([]);
    expect(impact?.removed).toEqual(expect.arrayContaining(["Insulin Pump", "Infusion Sets", "Cartridges"]));
  });

  it("stays null when a secondary change only re-routes billing", () => {
    // Fidelis Medicaid + NY Medicaid sends supplies to Medicaid instead of the
    // primary — same products, different payer, so nothing goes dark.
    const p = patient({ serving: "Supplies Only", primaryInsurance: "Fidelis Medicaid", secondaryInsurance: "None" });
    expect(productImpact(p, draftOf(p, { secondaryInsurance: "NY Medicaid" }))).toBeNull();
  });

  it("is null while the payer is still unset — an incomplete draft warns about nothing", () => {
    const p = patient({ primaryInsurance: "" as Patient["primaryInsurance"] });
    expect(productImpact(p, draftOf(p, { serving: "Insulin Pump" }))).toBeNull();
  });
});

describe("who gets the affordance", () => {
  it("is the two manager escalation columns and nothing else", () => {
    expect(isManagerEscalationView("manager-intervention")).toBe(true);
    expect(isManagerEscalationView("final-decisions")).toBe(true);
    // Processor Overview mirrors the rep's own queue — read-only there.
    expect(isManagerEscalationView("overview")).toBe(false);
    // An ordinary rep visit, or an older oversight link with no param.
    expect(isManagerEscalationView(null)).toBe(false);
  });
});

describe("write columns are fetched columns", () => {
  const written = [
    ...Object.values(IDENTITY_STATUS_COLUMNS),
    ...Object.values(IDENTITY_TEXT_COLUMNS),
  ];

  it.each(written)("%s is in READ_COLUMN_IDS (Benefits fetch)", (colId) => {
    expect(READ_COLUMN_IDS).toContain(colId);
  });

  it.each(written)("%s is in AUTH_READ_COLUMN_IDS (Submit Auth / Auth Outstanding fetch)", (colId) => {
    expect(AUTH_READ_COLUMN_IDS).toContain(colId);
  });
});
