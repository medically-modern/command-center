/**
 * Brandon's 2026-09-24 notes on the Care Coordinator ("Masani") dashboard card,
 * rendered — because every one of them is a thing a coordinator SEES, and a
 * card that quietly loses one reads as correct.
 *
 *  1. One network pill replaces the benefits-check banners and "In network:".
 *  2. Outbound (gray) then inbound (green) counts, on the doctor line.
 *  3. "State: NY; Doctor: …", N/A when we have none.
 *  4. Ann Hawkins's "Photo upload" pill presses, though no photo arrived.
 *  7. "Already in System" sits beside the name.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { IntakeLead, WelcomeCallItem } from "@/lib/careCoordinator/workflow";
import {
  IntakeReviewCard, IntakeUnscheduledCard, WelcomeUnscheduledCard, type CardExtras,
} from "./cards";

const TODAY = "2026-09-24";

const lead = (over: Partial<IntakeLead> = {}): IntakeLead => ({
  id: "L1", name: "Rosa Quintero", groupId: "group_mm5zgeak", createdAt: "2026-09-20T16:00:00Z",
  phone: "3475550101", email: "r@example.com", dropOffStep: "Completed", attemptCounter: "",
  dropOffAttempt: "", requestType: "CGM", pumpNeed: "", reasonForInquiry: "", proceedPreference: "",
  scheduledCallTime: "", bookingStatus: "", intakeCallComplete: "", intakeEscalation: "",
  referralType: "Patient", referralSource: "Patient", alreadyInSystem: "", followUp: "", followUpDate: "",
  dupCheckResult: "", state: "Florida", generalInsurance: "Aetna", insuranceProvidedVia: "Entered manually",
  insuranceOther: "", calendlyEventUri: "", providedDoctorName: "Dr. Ames", providedClinicPhone: "5555550100",
  ipCoveragePath: "", cgmCoveragePath: "Insulin", hasInsuranceCard: false,
  stediError: "", stediActive: "Yes", stediPlanName: "Plan", stediInNetwork: "",
  ...over,
});

const wc = (over: Partial<WelcomeCallItem> = {}): WelcomeCallItem => ({
  id: "W1", name: "Walter Nash", groupId: "group_mm1wvq8p", createdAt: "2026-09-20T16:00:00Z",
  phone: "3475550103", email: "w@example.com", escalation: "", followUp: "", followUpDate: "",
  serving: "CGM", requestType: "CGM", pumpQty: "", ipLastBillDate: "", medicarePriorPumpDate: "",
  callAttempts: "", doctorName: "Dr. Kim", primaryInsurance: "Aetna", referralReceivedDate: "",
  referralSource: "Doctor", ipCoveragePath: "", cgmCoveragePath: "", doctorPhone: "", clinicName: "",
  // ⚠️ The CLINIC is in New Jersey on purpose: the State must come from the
  // patient's own address, never from the clinic address printed beside it.
  clinicAddress: "9 Clinic Rd, Hoboken, NJ 07030", welcomeCallText: "",
  ...over,
});

const extras = (over: Partial<CardExtras> = {}): CardExtras => ({
  notes: "",
  contact: {
    callsOut: 3, callsIn: 1, textsOut: 5, textsIn: 2,
    callsSince: "2026-06-18T16:00:00Z", textsSince: "2026-08-01T16:00:00Z",
  },
  reached: { byText: true, byCall: true },
  ...over,
});

const unscheduled = (item: IntakeLead) => ({ item, attempts: 0, followUpDate: "", overdueDays: 0, waitingMs: 0 });

function renderIntake(l: IntakeLead, e: CardExtras = extras()) {
  return render(
    <MemoryRouter>
      <IntakeUnscheduledCard entry={unscheduled(l)} today={TODAY} onBookingLink={() => {}} extras={e} />
    </MemoryRouter>,
  ).container.querySelector("article")!;
}

describe("the row under the name — State, then Doctor", () => {
  it("leads with the state as a code, whatever the form wrote", () => {
    const card = renderIntake(lead({ state: "Florida" }));
    expect(card).toHaveTextContent("State: FL; Doctor: Dr. Ames · Clinic: 5555550100");
  });

  it("says N/A when the form has no state — Brandon's own words", () => {
    const card = renderIntake(lead({ state: "" }));
    expect(card).toHaveTextContent("State: N/A; Doctor: Dr. Ames");
  });

  it("prints a state it does not recognise verbatim rather than guessing", () => {
    expect(renderIntake(lead({ state: "Ontario" }))).toHaveTextContent("State: Ontario;");
  });

  it("reads a Welcome Call patient's state from THEIR address, never the clinic's", () => {
    const { container } = render(
      <MemoryRouter>
        <WelcomeUnscheduledCard
          entry={{ item: wc({ address: "12 Oak St, Brooklyn, NY 11201, USA" }), attempts: 0, followUpDate: "", overdueDays: 0, waitingMs: 0 }}
          today={TODAY} onBookingLink={() => {}} extras={extras()}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector("article")).toHaveTextContent("State: NY; Doctor: Dr. Kim");
  });

  it("an address with no readable state is N/A on Welcome Call too", () => {
    const { container } = render(
      <MemoryRouter>
        <WelcomeUnscheduledCard
          entry={{ item: wc({ address: "" }), attempts: 0, followUpDate: "", overdueDays: 0, waitingMs: 0 }}
          today={TODAY} onBookingLink={() => {}} extras={extras()}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector("article")).toHaveTextContent("State: N/A;");
  });
});

describe("the counts — one line, on the doctor row, gray out then green in", () => {
  it("puts both directions in the State/Doctor row, outbound first", () => {
    const card = renderIntake(lead());
    const row = within(card).getByTitle(/^State: FL;/).parentElement!;
    const out = within(row).getByTitle(/^3 calls to this patient since Jun 18/);
    const inbound = within(row).getByTitle(/^1 call from this patient since Jun 18/);
    // DOM order IS reading order: gray outbound, then green inbound.
    expect(out.compareDocumentPosition(inbound) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(row).getByTitle(/^5 texts to this patient since Aug 1/)).toHaveTextContent("5");
    expect(within(row).getByTitle(/^2 texts from this patient since Aug 1/)).toHaveTextContent("2");
  });

  it("says when one of our calls was picked up — the fact no count can express", () => {
    const card = renderIntake(lead());
    expect(within(card).getByTitle(/and they picked up at least once$/)).toHaveTextContent("3");
  });

  it("draws NO counters before the count lands — four zeroes would be a claim", () => {
    const card = renderIntake(lead(), extras({ contact: undefined, reached: undefined }));
    expect(within(card).queryByTitle(/to this patient/)).toBeNull();
  });

  it("an archive that is not running is an em dash, never zero", () => {
    const card = renderIntake(lead(), extras({
      contact: { callsOut: null, callsIn: null, textsOut: 4, textsIn: 0, callsSince: null, textsSince: null },
    }));
    const calls = within(card).getAllByTitle(/the call archive isn't running/);
    expect(calls).toHaveLength(2);
    for (const c of calls) expect(c).toHaveTextContent("—");
  });
});

describe("the network pill replaces the banners and the 'In network:' line", () => {
  it("shows nothing at all before a check has run", () => {
    const card = renderIntake(lead({ stediInNetwork: "", stediActive: "", stediPlanName: "" }));
    expect(card).not.toHaveTextContent(/In-network|Out-of-network|Check failed|Network unknown/);
    expect(card).not.toHaveTextContent(/Benefits check/);
    expect(card).not.toHaveTextContent(/In network:/);
  });

  it.each([
    ["Yes", "In-network"],
    ["No", "Out-of-network"],
    ["Unknown", "Network unknown"],
  ])("In Network %s renders the %s pill", (raw, label) => {
    const card = renderIntake(lead({ stediInNetwork: raw }));
    expect(within(card).getByText(label)).toBeInTheDocument();
    expect(card).not.toHaveTextContent(/In network:/);
  });

  it("a failed check is a red 'Check failed' pill carrying the payer's reason — and no banner", () => {
    const err = "Incorrect information | AAA 73 — Invalid/Missing Subscriber/Insured Name";
    const card = renderIntake(lead({ stediError: err, stediActive: "", stediPlanName: "" }));
    const pill = within(card).getByText("Check failed");
    expect(pill).toHaveAttribute("title", expect.stringContaining("AAA 73"));
    expect(card).not.toHaveTextContent(/Benefits check failed$/);
    expect(card.querySelector(".bg-rose-50")).toBeNull();
  });

  it("the Review card's banner says only what the pill cannot", () => {
    const l = lead({ stediError: "AAA 73", stediActive: "", stediPlanName: "", requestType: "CGM", cgmCoveragePath: "" });
    const { container } = render(
      <MemoryRouter>
        <IntakeReviewCard
          entry={{ item: l, waitingMs: 0, blocker: "CGM Coverage Path not chosen" }}
          today={TODAY} onBookingLink={() => {}} extras={extras()}
        />
      </MemoryRouter>,
    );
    const card = container.querySelector("article")!;
    expect(within(card).getByText("Check failed")).toBeInTheDocument();
    expect(card).toHaveTextContent("CGM Coverage Path not chosen");
    expect(card).not.toHaveTextContent("Benefits check failed");
  });
});

describe("Already in System sits BESIDE the name", () => {
  it("shares the name's row rather than taking one of its own", () => {
    const card = renderIntake(lead({ dupCheckResult: "Duplicate" }));
    const pill = within(card).getByText("Already in System");
    const name = within(card).getByRole("link", { name: "Rosa Quintero" });
    expect(pill.parentElement).toBe(name.closest("h4")!.parentElement);
  });
});

describe("Ann Hawkins — a card photo chosen and never sent", () => {
  it("still presses, and tells the dialog there is no photo to open", () => {
    const onInsuranceCard = vi.fn();
    const card = renderIntake(
      lead({ name: "Ann Hawkins", generalInsurance: "", insuranceProvidedVia: "Photo of card", hasInsuranceCard: false }),
      extras({ onInsuranceCard }),
    );
    // The pill wraps a titled label in a titled button; the BUTTON is the press.
    const pill = within(card).getAllByTitle(/chose to send a card photo, but none came through/)
      .find((el) => el.tagName === "BUTTON")!;
    expect(pill).toBeDefined();
    fireEvent.click(pill);
    expect(onInsuranceCard).toHaveBeenCalledWith(expect.objectContaining({ name: "Ann Hawkins", hasPhoto: false }));
  });

  it("a carrier typed in by the patient stays an ordinary label", () => {
    const card = renderIntake(lead({ insuranceProvidedVia: "Entered manually" }), extras({ onInsuranceCard: vi.fn() }));
    expect(within(card).queryByRole("button", { name: /Aetna/ })).toBeNull();
  });
});

describe("Communications opens as a side panel from this card", () => {
  it("renders the Communications button (the panel itself mounts only when opened)", () => {
    const card = renderIntake(lead());
    expect(within(card).getByRole("button", { name: /^Communications$/ })).toBeInTheDocument();
    screen.getAllByRole("article"); // the card rendered, and nothing else threw
  });
});
