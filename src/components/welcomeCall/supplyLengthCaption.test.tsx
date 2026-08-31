/**
 * The caption under Supply Length describes the PAYER RULE, while the select
 * above it holds whatever the rep chose. Once those two differ, an unprefixed
 * caption reads as the live answer and the pair looks self-contradictory —
 * "30 days" sitting over "Medicaid — 60 day supply" (reported 2026-08-31).
 *
 * These pin the prefix, and that a derived (un-overridden) value does NOT get
 * it — saying "Overrides" when nothing was overridden is the same defect the
 * other way round.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SupplyLengthField } from "./CallIntakeFields";
import { emptyIntake } from "@/lib/welcomeCall/callIntake";

const renderField = (over: Record<string, unknown>, note: string) =>
  render(
    <SupplyLengthField
      intake={{ ...emptyIntake(), ...over }}
      onChange={() => {}}
      derivedNote={note}
    />,
  );

describe("Supply Length caption", () => {
  it("shows the payer rule plainly when the rep has not overridden", () => {
    renderField({ supplyLength: "60", supplyLengthManual: false }, "Medicaid — 60 day supply");
    expect(screen.getByText("Medicaid — 60 day supply")).toBeTruthy();
    expect(screen.queryByText(/Overrides/)).toBeNull();
  });

  it("says the rep's value overrides the payer rule once they pick one", () => {
    renderField({ supplyLength: "30", supplyLengthManual: true }, "Medicaid — 60 day supply");
    expect(screen.getByText("Overrides Medicaid — 60 day supply")).toBeTruthy();
  });

  it("prefixes the non-Medicaid wording too", () => {
    renderField({ supplyLength: "30", supplyLengthManual: true }, "90 day supply");
    expect(screen.getByText("Overrides 90 day supply")).toBeTruthy();
  });

  it("renders no caption at all when there is no derived note", () => {
    const { container } = renderField({ supplyLength: "90", supplyLengthManual: true }, "");
    expect(container.querySelector("p")).toBeNull();
  });
});
