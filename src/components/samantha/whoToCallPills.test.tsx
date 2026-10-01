/**
 * "Who to call" pills and the POS 11 banner, rendered in the REAL Benefits
 * components (HANDOFF-Josh-Who-To-Call §3–§4). The rules themselves are pinned
 * in `lib/samantha/whoToCall.test.ts`; this proves they reach the page. FAKE
 * patients only.
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { BenefitsPanel } from "./BenefitsPanel";
import { BenefitsPatientHeader } from "./BenefitsPatientHeader";
import { EMPTY_INSURANCE, type Patient } from "@/lib/samantha/workflow";

const patient = (over: Partial<Patient>): Patient =>
  ({
    id: "1",
    name: "Test Patient",
    dob: "1970-01-01",
    serving: "CGM",
    insurance: structuredClone(EMPTY_INSURANCE),
    ...over,
  }) as Patient;

const renderPanel = (p: Patient) =>
  render(
    <MemoryRouter>
      <div className="bnr">
        <BenefitsPanel
          patient={p}
          onUniversalChange={() => {}}
          onCodeChange={() => {}}
          onCallLogChange={() => {}}
          missing={[]}
          onSend={async () => {}}
        />
      </div>
    </MemoryRouter>,
  );

/** The subcard holding a check's title. */
const card = (title: string) =>
  [...document.querySelectorAll(".uc-title")].find((e) => e.textContent === title)!.closest(".subcard") as HTMLElement;

describe("Step 1 — one Call: pill per check", () => {
  it("Horizon in NJ: CareCentrix (mint) for In-Network, the home plan (teal) for Active and DME", () => {
    renderPanel(patient({ primaryInsurance: "Horizon BCBS", homePlan: "Horizon BCBSNJ", patientAddress: "1 Main St, Wyckoff, NJ 07481" }));
    const net = within(card("In-Network")).getByText("CareCentrix");
    expect(net.className).toBe("sugg-chip2");
    const active = within(card("Insurance Active")).getByText("Horizon BCBSNJ");
    expect(active.className).toBe("sugg-chip2 member");
    expect(within(card("DME Benefits")).getByText("Horizon BCBSNJ").className).toBe("sugg-chip2 member");
    // The in-network-only hint sits on DME Benefits, and only there.
    expect(within(card("DME Benefits")).getByText(/in-network benefits only/)).toBeTruthy();
    expect(within(card("In-Network")).queryByText(/in-network benefits only/)).toBeNull();
  });

  it("no phone numbers anywhere — the payer name only", () => {
    renderPanel(patient({ primaryInsurance: "Horizon BCBS", homePlan: "Horizon BCBSNJ", patientAddress: "1 Main St, Wyckoff, NJ 07481" }));
    for (const chip of document.querySelectorAll(".sugg-chip2")) expect(chip.textContent).not.toMatch(/\d{3}/);
  });

  it("a non-Blue payer, an unresolved address, or FEP: no pills at all", () => {
    for (const over of [
      { primaryInsurance: "Aetna Commercial", patientAddress: "4 State St, Albany, NY 12207" },
      { primaryInsurance: "Horizon BCBS", patientAddress: "" },
      { primaryInsurance: "Horizon BCBS", patientAddress: "1 Main St, Wyckoff, NJ 07481", memberId1: "R59954629" },
    ] as Partial<Patient>[]) {
      const { unmount } = renderPanel(patient(over));
      expect(document.querySelectorAll(".sugg-chip2")).toHaveLength(0);
      expect(screen.queryByText("Suggestion:")).toBeNull();
      unmount();
    }
  });
});

describe("Step 2 — the suggestion in the header", () => {
  const step2 = () => screen.getByText(/Product-Specific SoS/).closest("header") as HTMLElement;

  it("CareCentrix route: one CareCentrix chip", () => {
    renderPanel(patient({ primaryInsurance: "BCBS FL", homePlan: "Florida Blue", patientAddress: "3 Bay Rd, Tampa, FL 33602" }));
    const chips = step2().querySelectorAll(".sugg-chip2");
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe("CareCentrix");
  });

  it("BlueCard with a different home plan: Auth → home plan (teal), SoS → billed plan (mint)", () => {
    renderPanel(patient({ primaryInsurance: "Anthem BCBS Commercial", homePlan: "BCBS Connecticut", patientAddress: "4 State St, Albany, NY 12207" }));
    const chips = [...step2().querySelectorAll(".sugg-chip2")];
    expect(chips.map((c) => [c.textContent, c.className])).toEqual([
      ["Auth →BCBS Connecticut", "sugg-chip2 member"],
      ["SoS →Anthem BCBS Commercial", "sugg-chip2"],
    ]);
  });
});

describe("POS 11 banner on the Benefits header (opt-in)", () => {
  const renderHeader = (p: Patient, showPos11: boolean) =>
    render(
      <MemoryRouter>
        <div className="bnr">
          <BenefitsPatientHeader patient={p} showPos11={showPos11} />
        </div>
      </MemoryRouter>,
    );
  const outOfState = patient({ primaryInsurance: "Anthem BCBS Commercial", homePlan: "BCBS Texas", patientAddress: "5 Elm St, Dallas, TX 75201" });

  it("shows for an out-of-state Blue patient when the page opts in", () => {
    renderHeader(outOfState, true);
    expect(screen.getByText("POS 11 situation")).toBeTruthy();
  });

  it("⚠️ not on a page that didn't opt in (Submit Auth, Auth Outstanding)", () => {
    renderHeader(outOfState, false);
    expect(screen.queryByText("POS 11 situation")).toBeNull();
  });

  it("not for an in-footprint patient", () => {
    renderHeader(patient({ primaryInsurance: "Anthem BCBS Commercial", patientAddress: "4 State St, Albany, NY 12207" }), true);
    expect(screen.queryByText("POS 11 situation")).toBeNull();
  });
});
