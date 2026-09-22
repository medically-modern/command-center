import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OopEstimateCard } from "./OopEstimateCard";
import type { Patient } from "@/lib/welcomeCall/workflow";
import { estimateOop } from "@/lib/welcomeCall/oopEstimator";
import { INVENTORY_HREF } from "@/lib/welcomeCall/cashPayNote";

/**
 * A Cash Pay patient has no payer, so `PAYER_RATE_SCHEDULE` has no entry for
 * them and never can. Without its own branch this card falls into the generic
 * "can't estimate" path and prints the estimator's reason verbatim:
 *
 *     No rate schedule for "Cash Pay"
 *
 * — which reads as a missing payer, i.e. a data problem somebody should go and
 * fix, on the one card a rep uses to tell a patient what they owe.
 */
const pt = (over: Partial<Patient> = {}) => ({
  id: "1", name: "Test Patient",
  primaryInsurance: "", secondaryInsurance: "", secondaryInsuranceEdited: "",
  referralSource: "",
  serving: "Insulin Pump + CGM",
  qtyInf1: "3", qtyInf2: "",
  deductibleRemaining: "", stediCoinsurance: "", oopMaxRemaining: "",
  ...over,
} as unknown as Patient);

const cash = pt({ primaryInsurance: "Cash Pay" });

describe("the estimator genuinely cannot price a cash pay patient", () => {
  it("returns not-ok, with the sentence the card used to print", () => {
    /* The premise of the branch, pinned: if this ever starts returning a
       number, the branch is hiding a real estimate rather than replacing a
       non-answer, and that is a different decision. */
    const r = estimateOop({
      primaryInsurance: "Cash Pay", secondaryInsurance: "", serving: "Insulin Pump + CGM",
      infusionSets: 3, deductibleRemaining: "", stediCoinsurance: "", oopMaxRemaining: "",
    });
    expect(r.ok).toBe(false);
    expect("reason" in r && r.reason).toMatch(/No rate schedule/);
  });
});

describe("the Welcome Call OOP card, for a cash pay patient", () => {
  it("says there is nothing to estimate, and never shows the rate-schedule error", () => {
    render(<OopEstimateCard patient={cash} />);
    expect(screen.getByText(/no benefit to estimate/i)).toBeInTheDocument();
    expect(screen.queryByText(/No rate schedule/)).toBeNull();
  });

  it("⚠️ quotes NO number here — the price becomes real on the order", () => {
    /* Josh's amendment: a link, not a live quote. The quantities on this form
       are still being negotiated on the call, so a figure rendered here is one
       a rep reads to a patient and then changes. */
    const { container } = render(<OopEstimateCard patient={cash} />);
    expect(container.textContent).not.toMatch(/\$\d/);
  });

  it("links to the Cardinal costs, in a new tab, WITH the app's base path", () => {
    /* ⚠️ A bare `/orders?view=stock` lands outside the app on GitHub Pages —
       the router carries a basename and a plain <a> does not apply it. A new
       tab because this form holds unsaved edits mid-call. */
    render(<OopEstimateCard patient={cash} />);
    const link = screen.getByRole("link", { name: /Cardinal costs/i });
    expect(link).toHaveAttribute("href", INVENTORY_HREF);
    expect(INVENTORY_HREF).toBe(`${import.meta.env.BASE_URL}orders?view=stock`);
    expect(INVENTORY_HREF.startsWith(import.meta.env.BASE_URL)).toBe(true);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("⚠️ Primary Insurance is the ONLY marker on this board", () => {
    /* The Welcome Call board has no General Insurance column at all (§5.30e,
       Josh 2026-09-14) and its `Patient` type has no such field — so the
       intake mirror is what makes this branch reachable, not a nicety.
       `isCashPayPatient` reads both columns; here the first is always absent. */
    const asPatient = cash as unknown as Record<string, unknown>;
    expect(asPatient.generalInsurance).toBeUndefined();
    render(<OopEstimateCard patient={cash} />);
    expect(screen.getByText(/no benefit to estimate/i)).toBeInTheDocument();
  });
});

describe("⚠️ it changes nothing for anybody else", () => {
  it("an insured patient still gets the estimate", () => {
    const insured = pt({
      primaryInsurance: "Aetna Commercial",
      deductibleRemaining: "0", stediCoinsurance: "20", oopMaxRemaining: "5000",
    });
    const { container } = render(<OopEstimateCard patient={insured} />);
    expect(screen.queryByText(/no benefit to estimate/i)).toBeNull();
    expect(container.textContent).toMatch(/\$\d/);
  });

  it("a CareCentrix patient still gets their own note", () => {
    const ccx = pt({ primaryInsurance: "Horizon BCBS", referralSource: "CareCentrix" });
    render(<OopEstimateCard patient={ccx} />);
    expect(screen.getByText(/contact carecentrix directly/i)).toBeInTheDocument();
    expect(screen.queryByText(/no benefit to estimate/i)).toBeNull();
  });
});
