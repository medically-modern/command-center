/**
 * The Care Coordinator page composes three reads into three columns and a
 * grid. This renders it against fixture data so a broken import, a hook that
 * throws, or a card that can't render its entry fails HERE rather than on the
 * coordinator's screen. The rules themselves are tested in
 * lib/careCoordinator/workflow.test.ts; this checks they reach the DOM.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { ChaseItem, IntakeLead, WelcomeCallItem } from "@/lib/careCoordinator/workflow";
import { etToday } from "@/lib/masheke/etDate";

const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
/** YYYY-MM-DD shifted by whole days, no weekend clamp, DST-proof. */
function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}
const TODAY = etToday();

const intake = (over: Partial<IntakeLead>): IntakeLead => ({
  id: "i", name: "Lead", groupId: "group_mm5z87zt", createdAt: hoursAgo(72), phone: "3475550101",
  email: "x@example.com", dropOffStep: "Step 4 - Doctor", attemptCounter: "", dropOffAttempt: "2",
  requestType: "CGM", pumpNeed: "", reasonForInquiry: "Denied by insurance", proceedPreference: "Wants a call first",
  scheduledCallTime: "", bookingStatus: "", intakeCallComplete: "", intakeEscalation: "", referralType: "Patient",
  referralSource: "Patient", alreadyInSystem: "", followUp: "", followUpDate: "", dupCheckResult: "", state: "NY",
  generalInsurance: "Anthem", calendlyEventUri: "", ...over,
});
const chase = (over: Partial<ChaseItem>): ChaseItem => ({
  id: "c", name: "Chaser", groupId: "group_mm1xf2jb", createdAt: hoursAgo(24 * 7), phone: "3475550102",
  subStage: "Chase Clinicals", nextActionDate: TODAY, escalationIndex: 1, escalation: "Done", mnAttempts: "Attempt 2",
  clinicalsMethod: "Fax", doctorName: "Dr. Ahuja", clinicName: "Endocrinology", requestSentAt: shiftYmd(TODAY, -7),
  appointmentDate: "", dateOfIntake: shiftYmd(TODAY, -7), confirmAttempts: ["", "", ""],
  chaseAttempts: ["9/3/26, 9:00 AM · left vm —MT", "", ""], receiptConfirmedName: "", requestType: "CGM", serving: "CGM",
  ...over,
});
const wc = (over: Partial<WelcomeCallItem>): WelcomeCallItem => ({
  id: "w", name: "Welcomer", groupId: "group_mm1wvq8p", createdAt: hoursAgo(48), phone: "3475550103",
  email: "welcomer@example.com",
  escalation: "", followUp: "", followUpDate: "", serving: "Insulin Pump", requestType: "Insulin Pump", pumpQty: "1",
  ipLastBillDate: "", medicarePriorPumpDate: "", callAttempts: "", doctorName: "Dr. Kaminski",
  primaryInsurance: "Medicare A&B", referralReceivedDate: shiftYmd(TODAY, -3), ...over,
});

const fetchItemNotes = vi.fn(async () => "[Sep 3, 2026, 11:07 AM] Patient Intake: Call attempt 1 — left a vm —MT");

vi.mock("@/lib/careCoordinator/mondayApi", () => ({
  INTAKE_GROUP_IDS: ["group_mm5z87zt", "group_mm5zgeak", "group_mm6c3rhb"],
  INTAKE_FORM_GROUP_IDS: ["group_mm5z87zt", "group_mm5zgeak"],
  NOTES_COLUMN: { intake: "text_mm389fs", chase: "text_mm6vevjf", welcome: "text_mm6vqq2k" },
  fetchIntakeLeads: async () => [
    intake({ id: "booked", name: "Marcus Delaney", scheduledCallTime: `${shiftYmd(TODAY, 1)} 10:30`, bookingStatus: "Scheduled" }),
    intake({ id: "ready", name: "Eleanor Boyd", createdAt: hoursAgo(38 + 24) }),
    intake({ id: "import", name: "Hubert Baldwin", dropOffStep: "", referralType: "Doctor", referralSource: "SNJ [2.0]", attemptCounter: "1" }),
    intake({ id: "fresh", name: "Josen Man", createdAt: hoursAgo(3) }),
    intake({ id: "capped", name: "Tyrell Jackson", attemptCounter: "5" }),
  ],
  fetchChaseItems: async () => [
    chase({ id: "overdue", name: "Rosa Villalobos", subStage: "Confirm Receipt", nextActionDate: shiftYmd(TODAY, -2), mnAttempts: "Attempt 3", clinicalsMethod: "" }),
    chase({ id: "later", name: "Walter Kinney", nextActionDate: shiftYmd(TODAY, 4) }),
    chase({ id: "mgr", name: "Henry Osei", escalationIndex: 0, escalation: "Manager Escalation Required" }),
    chase({ id: "ps", name: "Proposed Stuck", escalationIndex: 2 }),
  ],
  fetchWelcomeCallItems: async () => [
    wc({ id: "now", name: "Amara Nwosu" }),
    wc({ id: "snz", name: "Gerald Pham", followUp: "Done", followUpDate: shiftYmd(TODAY, 3) }),
  ],
  fetchItemNotes: (...a: unknown[]) => fetchItemNotes(...(a as [])),
}));

vi.mock("@/components/AccessProvider", () => ({
  useAccessContext: () => ({
    access: { type: "processor", profile: { name: "Dana Whitfield", roles: ["scheduledCalls"] } },
    email: "dana@medicallymodern.com",
  }),
}));

import CareCoordinatorPage from "./CareCoordinatorPage";

function mount() {
  return render(
    <MemoryRouter initialEntries={["/care-coordinator"]}>
      <CareCoordinatorPage />
    </MemoryRouter>,
  );
}

describe("CareCoordinatorPage", () => {
  it("renders the header, the two visible columns and the grid", async () => {
    mount();
    expect(screen.getByRole("heading", { level: 1, name: "My Patients" })).toBeInTheDocument();
    expect(screen.getByText("Dana Whitfield")).toBeInTheDocument();

    // Intake: booked, ready, exhausted, and the honest small print.
    const intakeCol = await screen.findByRole("region", { name: "Patient Intake" });
    expect(await within(intakeCol).findByText("Marcus Delaney")).toBeInTheDocument();
    expect(within(intakeCol).getByText("Eleanor Boyd")).toBeInTheDocument();
    expect(within(intakeCol).getByText(/1 not yet called/)).toBeInTheDocument();
    // Josen Man (3h old) is inside the automated window; Hubert Baldwin never touched the form.
    expect(within(intakeCol).queryByText("Josen Man")).toBeNull();
    expect(within(intakeCol).queryByText("Hubert Baldwin")).toBeNull();
    expect(within(intakeCol).getByText(/1 imported\/referral rows/)).toBeInTheDocument();
    expect(within(intakeCol).getByText(/1 inside the 48-hour/)).toBeInTheDocument();
    // The exhausted shelf exists, closed.
    expect(within(intakeCol).getByRole("button", { name: /Exhausted · 5 attempts/ })).toHaveAttribute("aria-expanded", "false");

    // Chase is hidden (SHOW_CHASE_COLUMN, 2026-09-10): no column, no chip, and
    // — the half that actually matters — none of its patients counted anywhere.
    // A hidden stage still counted would put a number in "Total in pipeline"
    // that nothing on the page explains.
    expect(screen.queryByRole("region", { name: "Confirm Receipt + Chase Clinicals" })).toBeNull();
    expect(screen.queryByText("Confirm / Chase")).toBeNull();
    expect(screen.queryByText("Rosa Villalobos")).toBeNull();
    expect(screen.queryByText(/proposed stuck/)).toBeNull();

    // Welcome Call: the ops flag and the snoozed shelf.
    const wcCol = screen.getByRole("region", { name: "Welcome Call" });
    expect(await within(wcCol).findByText("Amara Nwosu")).toBeInTheDocument();
    expect(within(wcCol).getByText("1st-time pump")).toBeInTheDocument();
    expect(within(wcCol).queryByText("Gerald Pham")).toBeNull(); // Follow up later, collapsed

    // Header chips: 2 intake (booked + ready) + 2 welcome (now + snoozed). The
    // chase read is stubbed out with the column, so its overdue patient and its
    // escalated one drop out of both counters too.
    expect(screen.getByText("Total in pipeline").parentElement).toHaveTextContent("4");
    expect(screen.getByText(/0 overdue · 0 at escalation/)).toBeInTheDocument();

    // The grid is the old Scheduled Calls page, whole.
    expect(screen.getByRole("region", { name: "My schedule" })).toBeInTheDocument();
  });

  it("offers the schedule-source toggle, and only consults Calendly when it's showing", async () => {
    mount();
    const grid = await screen.findByRole("region", { name: "My schedule" });
    const toggle = within(grid).getByRole("group", { name: /Which calls to show/ });
    expect(within(toggle).getAllByRole("button").map((b) => b.textContent))
      .toEqual(["All calls", "Intake", "Welcome"]);

    // Defaults to showing both, so a welcome-call read is wanted. There is no
    // gateway in this build, so the grid must SAY the welcome half is missing
    // rather than render an empty day as "nothing booked".
    expect(within(grid).getByRole("status")).toHaveTextContent(/Welcome-call bookings need the gateway/);
    expect(within(grid).getByRole("button", { name: /Refresh welcome-call bookings/ })).toBeInTheDocument();

    // Switching to intake-only stops asking, so the notice and the Calendly
    // refresh both go away — nothing is missing from an intake-only view.
    fireEvent.click(within(toggle).getByRole("button", { name: "Intake" }));
    expect(within(grid).queryByRole("status")).toBeNull();
    expect(within(grid).queryByRole("button", { name: /Refresh welcome-call bookings/ })).toBeNull();
  });

  it("fetches a patient's notes only when the drawer is opened", async () => {
    mount();
    const intakeCol = await screen.findByRole("region", { name: "Patient Intake" });
    await within(intakeCol).findByText("Eleanor Boyd");
    expect(fetchItemNotes).not.toHaveBeenCalled();

    fireEvent.click(within(intakeCol).getAllByRole("button", { name: /See notes/ })[0]);
    expect(await within(intakeCol).findByText(/Call attempt 1 — left a vm/)).toBeInTheDocument();
    expect(fetchItemNotes).toHaveBeenCalledTimes(1);
    expect(fetchItemNotes.mock.calls[0]).toEqual(["booked", "text_mm389fs"]);
  });

  it("opens a collapsed section on click and links Open to the stage page", async () => {
    mount();
    const wcCol = await screen.findByRole("region", { name: "Welcome Call" });
    await within(wcCol).findByText("Amara Nwosu");
    // "Follow up later" is closed by default — Gerald Pham is behind it.
    expect(within(wcCol).queryByText("Gerald Pham")).toBeNull();
    fireEvent.click(within(wcCol).getByRole("button", { name: /Follow up later/ }));
    expect(await within(wcCol).findByText("Gerald Pham")).toBeInTheDocument();

    const hrefs = within(wcCol).getAllByRole("link", { name: /Open/ }).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/welcome-call?patientId=now&from=care-coordinator");
    expect(hrefs).toContain("/welcome-call?patientId=snz&from=care-coordinator");
  });
});
