/**
 * The Care Coordinator page composes two reads into two columns and a day
 * strip. This renders it against fixture data so a broken import, a hook that
 * throws, or a card that can't render its entry fails HERE rather than on the
 * coordinator's screen. The rules themselves are tested in
 * lib/careCoordinator/workflow.test.ts; this checks they reach the DOM in
 * Brandon's 2026-09-14 shape.
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { IntakeLead, WelcomeCallItem } from "@/lib/careCoordinator/workflow";
import { etToday } from "@/lib/masheke/etDate";

/**
 * The page's clock and one extra lead, settable per test (§5.30k's morning
 * rest is a function of the time of day, and the suite runs at any hour).
 * `vi.hoisted` so the mock factories below can read it.
 */
const scenario = vi.hoisted(() => ({ nowMinutes: null as number | null, extraLeads: [] as unknown[] }));
vi.mock("@/lib/scheduledCalls/workflow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scheduledCalls/workflow")>();
  return { ...actual, nowMinutesEt: () => scenario.nowMinutes ?? actual.nowMinutesEt() };
});

const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
/** YYYY-MM-DD shifted by whole days, no weekend clamp, DST-proof. */
function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days, 12)).toISOString().slice(0, 10);
}
const TODAY = etToday();
/**
 * An ISO instant on the ET calendar day `days` back, at ET midday.
 *
 * ⚠️ NOT `hoursAgo`, and the difference is not cosmetic. A card's age is
 * WHOLE ET CALENDAR DAYS (`formatDaysSince` → `daysBetween`) while the
 * readiness bucket is ELAPSED HOURS (`READY_AFTER_HOURS`), so an hour offset
 * that is not a multiple of 24 renders a different number depending on the
 * time of day the suite runs: `hoursAgo(38 + 24)` read "2 days" from 2 PM ET
 * and "3 days" before it, so the build passed every afternoon and failed every
 * morning (first red: the 9 AM baseline commit, 2026-09-15). Midday keeps the
 * ET date unambiguous through DST, and three days back is 60-84h old at any
 * clock time, so it clears the 48h gate whenever the suite runs.
 */
const etDaysAgo = (days: number) => `${shiftYmd(TODAY, -days)}T16:00:00Z`;

const intake = (over: Partial<IntakeLead>): IntakeLead => ({
  id: "i", name: "Lead", groupId: "group_mm5z87zt", createdAt: hoursAgo(72), phone: "3475550101",
  email: "x@example.com", dropOffStep: "Step 4 - Doctor", attemptCounter: "", dropOffAttempt: "2",
  requestType: "CGM", pumpNeed: "", reasonForInquiry: "Denied by insurance", proceedPreference: "Wants a call first",
  scheduledCallTime: "", bookingStatus: "", intakeCallComplete: "", intakeEscalation: "", referralType: "Patient",
  referralSource: "Patient", alreadyInSystem: "", followUp: "", followUpDate: "", dupCheckResult: "", state: "NY",
  generalInsurance: "Anthem", insuranceProvidedVia: "Entered manually", insuranceOther: "", calendlyEventUri: "",
  providedDoctorName: "Dr. Okafor", providedClinicPhone: "5555550100", ipCoveragePath: "", cgmCoveragePath: "Insulin",
  hasInsuranceCard: false, stediError: "", stediActive: "Yes", stediPlanName: "Test Plan", stediInNetwork: "", intakeWarnings: "", intakeWarningAcks: "",
  ...over,
});
const wc = (over: Partial<WelcomeCallItem>): WelcomeCallItem => ({
  id: "w", name: "Welcomer", groupId: "group_mm1wvq8p", createdAt: hoursAgo(48), phone: "3475550103",
  email: "welcomer@example.com",
  escalation: "", followUp: "", followUpDate: "", serving: "Insulin Pump", requestType: "Insulin Pump", pumpQty: "1",
  ipLastBillDate: "", medicarePriorPumpDate: "", callAttempts: "", doctorName: "Dr. Kaminski",
  primaryInsurance: "Medicare A&B", referralReceivedDate: shiftYmd(TODAY, -3),
  referralSource: "Tandem", ipCoveragePath: "OOW Pump", cgmCoveragePath: "", doctorPhone: "", clinicName: "",
  clinicAddress: "1 Main St, Albany, NY 12207", welcomeCallText: "Send", ...over,
});

const fetchItemNotes = vi.fn(async () => "[Sep 3, 2026, 11:07 AM] Patient Intake: Call attempt 1 — left a vm —MT");

/**
 * The batched notes read that replaced the per-card one on 2026-09-17, when
 * notes became open by default. The rule it has to satisfy is ONE request per
 * column, not one per patient — the whole reason notes are not in the list
 * query (§5.25).
 */
/** "Sep 29, 2026" — today in the note stamp's own words (ET). */
const TODAY_STAMP = new Date().toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" });
const fetchItemNotesBatch = vi.fn(async (ids: readonly string[], _columnId: string) =>
  new Map(ids.map((id) => [id, id === "ready"
    ? "[Sep 2] Patient Intake: first call, no answer —MT\n[Sep 3, 2026, 11:07 AM] Patient Intake: Call attempt 1 — left a vm —MT"
    : id === "rested"
      ? `[${TODAY_STAMP}, 9:05 AM] Patient Intake: Call attempt 1 — no answer, try after lunch —MT`
      : ""])));

vi.mock("@/lib/careCoordinator/mondayApi", () => ({
  INTAKE_GROUP_IDS: ["group_mm5z87zt", "group_mm5zgeak", "group_mm6c3rhb"],
  INTAKE_FORM_GROUP_IDS: ["group_mm5z87zt", "group_mm5zgeak"],
  INTAKE_FORM_GROUPS: { partial: "group_mm5z87zt", completed: "group_mm5zgeak" },
  NOTES_COLUMN: { intake: "text_mm389fs", chase: "text_mm6vevjf", welcome: "text_mm6vqq2k" },
  fetchIntakeLeads: async () => [
    intake({ id: "booked", name: "Marcus Delaney", scheduledCallTime: `${TODAY} 23:59`, bookingStatus: "Scheduled" }),
    intake({ id: "booked-later", name: "Priya Natarajan", scheduledCallTime: `${shiftYmd(TODAY, 2)} 10:30`, bookingStatus: "Scheduled" }),
    intake({ id: "ready", name: "Eleanor Boyd", createdAt: etDaysAgo(3), groupId: "group_mm5zgeak" }),
    intake({ id: "pushed", name: "Theo Marsh", attemptCounter: "1", followUpDate: shiftYmd(TODAY, 1) }),
    intake({ id: "import", name: "Hubert Baldwin", dropOffStep: "", referralType: "Doctor", referralSource: "SNJ [2.0]", attemptCounter: "1" }),
    intake({ id: "fresh", name: "Josen Man", createdAt: hoursAgo(3) }),
    intake({ id: "mgr", name: "Escalated Person", intakeEscalation: "Manager Escalation Required" }),
    ...(scenario.extraLeads as IntakeLead[]),
  ],
  fetchWelcomeCallItems: async () => [
    wc({ id: "now", name: "Amara Nwosu", address: "12 Oak St, Albany, NY 12207, USA" }),
    wc({ id: "snz", name: "Gerald Pham", followUp: "Done", followUpDate: shiftYmd(TODAY, 3) }),
    wc({ id: "esc", name: "Manager Case", escalation: "Escalation Required", escalationIndex: 0 }),
  ],
  fetchItemNotes: (...a: unknown[]) => fetchItemNotes(...(a as [])),
  fetchItemNotesBatch: (...a: unknown[]) => fetchItemNotesBatch(...(a as [readonly string[], string])),
}));

/**
 * The all-time call and text counts behind the card's counter line — ONE
 * batched Postgres read through the gateway since 2026-09-24 (Brandon: "they're
 * all 0's — can we connect this to how many outbound calls in total have ever
 * gone to the patient?"). Mocked so the page's wiring is exercised: a patient
 * we have reached, and a Welcome Call patient whose honest answer is zero.
 */
const invalidateContactTotals = vi.fn();
vi.mock("@/hooks/careCoordinator/useContactTotals", () => ({
  totalsKey: (raw: unknown) => String(raw ?? "").replace(/\D/g, "").slice(-10),
  invalidateContactTotals: (...a: unknown[]) => invalidateContactTotals(...a),
  useContactTotals: () => ({
    byNumber: new Map([
      ["3475550101", { callsOut: 2, callsIn: 1, textsOut: 4, textsIn: 2, reachedByCall: true }],
      ["3475550103", { callsOut: 0, callsIn: 0, textsOut: 0, textsIn: 0, reachedByCall: false }],
    ]),
    coverage: { callsSince: "2026-06-18T16:00:00Z", textsSince: "2026-08-01T16:00:00Z" },
  }),
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
  afterEach(() => {
    scenario.nowMinutes = null;
    scenario.extraLeads = [];
  });

  it("renders the overview, the strip above the columns, and Today by default", async () => {
    mount();
    expect(screen.getByRole("heading", { level: 1, name: "My Patients" })).toBeInTheDocument();
    expect(screen.getByText("Dana Whitfield")).toBeInTheDocument();

    const intakeCol = await screen.findByRole("region", { name: "Patient Intake" });
    // Big title, no subtitle.
    expect(within(intakeCol).getByRole("heading", { level: 3 })).toHaveTextContent("Patient Intake");
    expect(within(intakeCol).queryByText(/Callbacks first/)).toBeNull();

    // Today: the booked call and one unscheduled; the pushed one is in Future.
    expect(await within(intakeCol).findByText("Marcus Delaney")).toBeInTheDocument();
    expect(within(intakeCol).getByText("Eleanor Boyd")).toBeInTheDocument();
    expect(within(intakeCol).queryByText("Theo Marsh")).toBeNull();
    expect(within(intakeCol).queryByText("Priya Natarajan")).toBeNull();
    // Josen Man (3h old) is inside the automated window; Hubert Baldwin never touched the form;
    // the escalated one is a manager's — all three counted in the small print, none listed.
    expect(within(intakeCol).queryByText("Josen Man")).toBeNull();
    expect(within(intakeCol).queryByText("Hubert Baldwin")).toBeNull();
    expect(within(intakeCol).queryByText("Escalated Person")).toBeNull();
    // ⚠️ The "Not shown: …" small print is GONE (Brandon, 2026-09-17). The rows
    // are still excluded and still computed; the page just no longer accounts
    // for them on screen. Asserted so a future session does not re-add the
    // paragraph without re-reading the note in CareCoordinatorPage.tsx.
    expect(within(intakeCol).queryByText(/with a manager — see Oversight/)).toBeNull();
    expect(within(intakeCol).queryByText(/imported\/referral rows/)).toBeNull();
    expect(within(intakeCol).queryByText(/Not shown:/)).toBeNull();
    // No "With a manager" or "Exhausted" sections anywhere.
    expect(screen.queryByRole("button", { name: /With a manager/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Exhausted/ })).toBeNull();

    // The header's Today / Future groupings carry the four numbers.
    const groupings = within(intakeCol).getByRole("group", { name: /Patient Intake — Today or Future/ });
    const [todayBtn, futureBtn] = within(groupings).getAllByRole("button");
    expect(todayBtn).toHaveAttribute("aria-pressed", "true");
    expect(todayBtn).toHaveTextContent(/Scheduled: 1/);
    expect(todayBtn).toHaveTextContent(/Unscheduled: 1/);
    expect(futureBtn).toHaveTextContent(/Scheduled: 1/);
    expect(futureBtn).toHaveTextContent(/Unscheduled: 1/);

    // Welcome Call: Amara is Today, Gerald is Future, the escalated one is counted only.
    const wcCol = screen.getByRole("region", { name: "Welcome Call" });
    expect(await within(wcCol).findByText("Amara Nwosu")).toBeInTheDocument();
    expect(within(wcCol).queryByText("Gerald Pham")).toBeNull();
    expect(within(wcCol).queryByText("Manager Case")).toBeNull();
    expect(within(wcCol).queryByText(/Not shown:/)).toBeNull();
    // No gateway in this build: the column must SAY Scheduled can't be filled.
    expect(within(wcCol).getByRole("status")).toHaveTextContent(/need the gateway/);

    // Overview: 4 intake (booked today + booked later + ready + pushed) + 2 welcome.
    const summary = screen.getByLabelText("Summary");
    expect(summary).toHaveTextContent(/Total in pipeline\s*6/);
    expect(summary).toHaveTextContent(/Patient Intake\s*4/);
    expect(summary).toHaveTextContent(/Welcome Call\s*2/);

    // The strip sits ABOVE the columns in the document.
    const strip = screen.getByRole("region", { name: "My schedule" });
    expect(strip.compareDocumentPosition(intakeCol) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The load bars are GONE once the reads resolved.
    expect(screen.queryAllByRole("progressbar")).toHaveLength(0);
  });

  it("a morning attempt rests the card until noon — off Today, at the front of Future as 'Back at 12 PM' (Josh, 2026-09-29)", async () => {
    scenario.extraLeads = [intake({ id: "rested", name: "Morning Caller", createdAt: etDaysAgo(3), groupId: "group_mm5zgeak", attemptCounter: "1" })];
    scenario.nowMinutes = 10 * 60;
    const { unmount } = mount();
    const intakeCol = await screen.findByRole("region", { name: "Patient Intake" });
    await within(intakeCol).findByText("Eleanor Boyd");
    // Once the notes land she is gone from Today…
    await vi.waitFor(() => expect(within(intakeCol).queryByText("Morning Caller")).toBeNull());
    const groupings = within(intakeCol).getByRole("group", { name: /Patient Intake — Today or Future/ });
    const [todayBtn, futureBtn] = within(groupings).getAllByRole("button");
    expect(todayBtn).toHaveTextContent(/Unscheduled: 1/);
    expect(futureBtn).toHaveTextContent(/Unscheduled: 2/);
    // …and sits in Future, first, saying when she is back.
    fireEvent.click(futureBtn);
    const names = within(intakeCol).getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(names.indexOf("Morning Caller")).toBeGreaterThanOrEqual(0);
    expect(names.indexOf("Morning Caller")).toBeLessThan(names.indexOf("Theo Marsh"));
    const card = within(intakeCol).getByText("Morning Caller").closest("article")!;
    expect(within(card).getByText("Back at 12 PM")).toBeInTheDocument();
    unmount();

    // At 1 PM the same patient is simply back on Today — nothing was written.
    scenario.nowMinutes = 13 * 60;
    mount();
    const col2 = await screen.findByRole("region", { name: "Patient Intake" });
    expect(await within(col2).findByText("Morning Caller")).toBeInTheDocument();
    expect(within(col2).queryByText("Back at 12 PM")).toBeNull();
  });

  it("switching a column to Future shows its future lists, and there is NO second switch", async () => {
    mount();
    const intakeCol = await screen.findByRole("region", { name: "Patient Intake" });
    await within(intakeCol).findByText("Marcus Delaney");

    // ⚠️ Brandon, 2026-09-16: "get rid of the today only tomorrow + too below
    // it on both sides". One toggle decides both sections. Its absence is also
    // what keeps the two columns level — it drew only under Today, so a column
    // on Future had a shorter Scheduled bar than its neighbour.
    expect(within(intakeCol).queryByRole("button", { name: "Tomorrow+ too" })).toBeNull();
    expect(within(intakeCol).queryByRole("button", { name: "Today only" })).toBeNull();
    // Today means today: tomorrow's booking is not quietly folded in.
    expect(within(intakeCol).queryByText("Priya Natarajan")).toBeNull();

    // Future: the later booking and the pushed lead; today's are gone.
    const groupings = within(intakeCol).getByRole("group", { name: /Patient Intake — Today or Future/ });
    fireEvent.click(within(groupings).getAllByRole("button")[1]);
    expect(within(intakeCol).getByText("Priya Natarajan")).toBeInTheDocument();
    expect(within(intakeCol).getByText("Theo Marsh")).toBeInTheDocument();
    expect(within(intakeCol).queryByText("Marcus Delaney")).toBeNull();
    expect(within(intakeCol).queryByText("Eleanor Boyd")).toBeNull();
  });

  it("filters Patient Intake on five facets, multi-select, intake only", async () => {
    // Brandon, 2026-09-17, replacing the Partial / Complete / All toggle. The
    // rules are in lib/careCoordinator/intakeFilter.test.ts; this is the wiring.
    mount();
    const intakeCol = await screen.findByRole("region", { name: "Patient Intake" });
    await within(intakeCol).findByText("Eleanor Boyd");
    const filter = within(intakeCol).getByRole("group", { name: "Filter Patient Intake" });
    expect(within(filter).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Request type", "Insurance", "Pump path", "CGM path", "Form",
    ]);

    // ⚠️ Only the Patient Intake column carries it (Josh, 2026-09-17: "5 facet
    // filter on intake only for now").
    const welcomeCol = screen.getByRole("region", { name: "Welcome Call" });
    expect(within(welcomeCol).queryByRole("group", { name: "Filter Patient Intake" })).toBeNull();

    // Eleanor Boyd is a COMPLETED form, so choosing Partial must drop her.
    fireEvent.click(within(filter).getByRole("button", { name: /^Form/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Partial/ }));
    expect(within(intakeCol).queryByText("Eleanor Boyd")).toBeNull();

    // Multi-select: adding Completed brings her back WITHOUT dropping Partial.
    fireEvent.click(screen.getByRole("button", { name: /Completed/ }));
    expect(within(intakeCol).getByText("Eleanor Boyd")).toBeInTheDocument();

    // And clearing is one control, which only exists while something is on.
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(within(intakeCol).getByText("Eleanor Boyd")).toBeInTheDocument();
  });

  it("the card carries Brandon's content and nothing else", async () => {
    mount();
    const intakeCol = await screen.findByRole("region", { name: "Patient Intake" });
    const name = await within(intakeCol).findByText("Eleanor Boyd");
    const card = name.closest("article")!;
    // ⚠️ The row under the name LEADS WITH THE STATE (Brandon, 2026-09-24:
    // "State: NY; Doctor: …"), from the web form's State. Doctor / Clinic
    // from the PROVIDED columns.
    expect(card).toHaveTextContent("State: NY; Doctor: Dr. Okafor · Clinic: 5555550100");
    // ⚠️ Brandon's fixed grid (2026-09-16): every slot renders, in this order,
    // with its caption, and a blank one is a faint em dash rather than nothing.
    // The captions lining up card to card IS the feature.
    const captions = Array.from(card.querySelectorAll("[data-pill-caption]")).map((e) => e.textContent);
    expect(captions).toEqual(["Request type", "Insurance", "Pump path", "CGM path", "Form"]);
    const pillText = Array.from(card.querySelectorAll("span.rounded-full")).map((e) => e.textContent);
    expect(pillText).toEqual(["CGM", "Anthem", "Insulin", "Completed"]);
    // Pump path is blank on this fixture, so its slot holds the dash.
    expect(card).toHaveTextContent("—");
    // Days since intake, no hours, no "waiting".
    expect(card).toHaveTextContent(/3 days/);
    expect(card).not.toHaveTextContent(/waiting/);
    // Counts, buttons.
    // ⚠️⚠️ **ALL-TIME COUNTS, ON ONE LINE WITH THE DOCTOR, FROM 2026-09-24**
    // (Brandon: "they're all 0's — can we connect this to how many outbound
    // calls in total have ever gone to the patient?" and "bring this up to a
    // single line — first the gray outbound, then next to it the green
    // inbound — all on the same line as the doctor info"). The fixture's
    // number has 2 out / 1 in calls and 4 out / 2 in texts, each titled by its
    // direction and by how far back the archive reaches.
    const since = (d: string) => new RegExp(`since ${d}(, \\d{4})?`);
    expect(within(card).getByTitle(new RegExp(`^2 calls to this patient ${since("Jun 18").source} — and they picked up at least once$`)))
      .toHaveTextContent("2");
    expect(within(card).getByTitle(new RegExp(`^4 texts to this patient ${since("Aug 1").source}$`))).toHaveTextContent("4");
    expect(within(card).getByTitle(new RegExp(`^1 call from this patient ${since("Jun 18").source}$`))).toHaveTextContent("1");
    expect(within(card).getByTitle(new RegExp(`^2 texts from this patient ${since("Aug 1").source}$`))).toHaveTextContent("2");
    // One line: the counts sit in the SAME row as State / Doctor, not a row of
    // their own.
    const detailRow = within(card).getByTitle(/^State: NY; Doctor:/).parentElement!;
    expect(within(detailRow).getByTitle(/^2 calls to this patient/)).toBeInTheDocument();
    expect(within(detailRow).getByTitle(/^2 texts from this patient/)).toBeInTheDocument();
    // ⚠️ `Call Log (3)` went with the Calls button it rode on (Josh,
    // 2026-09-24, §5.50): every Text and Calls button in the app became ONE
    // Communications button, which opens the patient's whole history.
    expect(within(card).getByRole("button", { name: /^Communications$/ })).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: /Call Log/ })).toBeNull();
    // ⚠️ And the number DIALS IN THE PAGE — a <button>, never a `tel:` link.
    // This card took `onCall` from 2026-09-22 and never handed it on, so every
    // Call here was a handoff to the RingCentral app until 2026-09-24.
    expect(card.querySelector('a[href^="tel:"]')).toBeNull();
    expect(within(card).getByTitle(/from the Command Center$/).tagName).toBe("BUTTON");
    expect(within(card).getByRole("button", { name: /Booking Link/ })).toBeInTheDocument();
    expect(within(card).queryByText("Active")).toBeNull();
    expect(within(card).queryByText(/Web form/)).toBeNull();
    // ⚠️ The NAME is the link now, and "Open" and "See notes" are gone.
    expect(within(card).queryByRole("link", { name: /^Open/ })).toBeNull();
    expect(within(card).queryByRole("button", { name: /See notes/ })).toBeNull();
    expect(within(card).getByRole("link", { name: "Eleanor Boyd" }))
      .toHaveAttribute("href", "/unverified-referrals?patientId=ready&from=care-coordinator");
    // ⚠️ The copy-number button went with them (Josh, 2026-09-17).
    expect(within(card).queryByRole("button", { name: /Copy phone/ })).toBeNull();
    // ⚠️ The In-Network readout renders only once a check has run — this
    // fixture's column is blank, so the line is absent rather than an em dash
    // (Josh, 2026-09-22: "display whatever stedi came back with").
    expect(within(card).queryByText(/In network:/)).toBeNull();

    // A scheduled card shows the time; the booked one is "up next" (darker).
    const booked = within(intakeCol).getByText("Marcus Delaney").closest("article")!;
    expect(booked).toHaveTextContent("11:59 PM");
    expect(booked.className).toMatch(/bg-slate-200/);
    expect(card.className).not.toMatch(/bg-slate-200/);

    // Welcome Call card: Primary Insurance in the insurance slot, and ⚠️
    // REFERRAL SOURCE back in slot five, replacing Form (Brandon, 2026-09-17).
    // A Welcome Call patient never filled in the web form, so a "Form" caption
    // there would imply one they skipped.
    const wcCol = screen.getByRole("region", { name: "Welcome Call" });
    const wcCard = (await within(wcCol).findByText("Amara Nwosu")).closest("article")!;
    const wcPills = Array.from(wcCard.querySelectorAll("span.rounded-full")).map((e) => e.textContent);
    expect(wcPills).toEqual(["Insulin Pump", "Medicare A&B", "OOW Pump", "Tandem"]);
    const wcCaptions = Array.from(wcCard.querySelectorAll("[data-pill-caption]")).map((e) => e.textContent);
    expect(wcCaptions).toEqual(["Request type", "Insurance", "Pump path", "CGM path", "Referral"]);
    // ⚠️ And every pill on this side is NEUTRAL (Brandon, same day) — none of
    // them carries the intake column's green/amber/rose.
    for (const pill of Array.from(wcCard.querySelectorAll("span.rounded-full"))) {
      expect(pill.className).toContain("border-border");
    }
    // ⚠️ The State comes out of the PATIENT's address on this board — it has
    // no State column (Josh, 2026-09-24) — and never out of the clinic's,
    // which is the one printed right beside it.
    expect(wcCard).toHaveTextContent("State: NY; Doctor: Dr. Kaminski · Clinic: 1 Main St, Albany, NY 12207");
    // ⚠️ Zero is a real answer here: the gateway answers every number it is
    // asked about, and this one has no call and no text in the archives.
    expect(within(wcCard).getByTitle(/^0 calls to this patient since Jun 18/)).toHaveTextContent("0");
    expect(within(wcCard).getByTitle(/^0 texts from this patient since Aug 1/)).toHaveTextContent("0");
    // The Welcome Call card carries the same one Communications button (§5.50).
    expect(within(wcCard).getByRole("button", { name: /^Communications$/ })).toBeInTheDocument();
    expect(wcCard.querySelector('a[href^="tel:"]')).toBeNull();
  });

  it("shows the newest note by default, in ONE batched read per column", async () => {
    // Brandon, 2026-09-17: notes open by default; more than one line, click to
    // expand. ⚠️ The batching is the load-bearing half — one request per column
    // rather than one per patient, which is why notes are still not in the list
    // query (§5.25) and why `fetchItemNotes` must stay unused here.
    mount();
    const intakeCol = await screen.findByRole("region", { name: "Patient Intake" });
    const card = (await within(intakeCol).findByText("Eleanor Boyd")).closest("article")!;

    // The NEWEST line, not the first — the log appends, so the last line is
    // what the last call found out.
    expect(await within(card).findByText(/Call attempt 1 — left a vm/)).toBeInTheDocument();
    expect(within(card).queryByText(/first call, no answer/)).toBeNull();

    // Two lines, so it offers to expand — and then shows the whole thing.
    fireEvent.click(within(card).getByRole("button", { name: /Expand notes/ }));
    expect(within(card).getByText(/first call, no answer/)).toBeInTheDocument();

    // ⚠️ One request per column, and never the per-card read.
    expect(fetchItemNotes).not.toHaveBeenCalled();
    // The request that carried THIS card also carried the rest of the column.
    // (The morning-rest test above adds a lead of its own, which the cache
    // fetches once in a batch of its own — not a per-card read.)
    const intakeCalls = fetchItemNotesBatch.mock.calls.filter((c) => c[1] === "text_mm389fs" && c[0].includes("ready"));
    expect(intakeCalls).toHaveLength(1);
    // Every card the column rendered, in one go.
    expect(intakeCalls[0][0]).toEqual(expect.arrayContaining(["booked", "ready"]));
  });

  it("opens the booking-link dialog on the right call for each column, with NO picker", async () => {
    mount();
    const wcCol = await screen.findByRole("region", { name: "Welcome Call" });
    const wcCard = (await within(wcCol).findByText("Amara Nwosu")).closest("article")!;
    fireEvent.click(within(wcCard).getByRole("button", { name: /Booking Link/ }));
    const dialog = await screen.findByRole("dialog");
    // ⚠️ Brandon, 2026-09-16: the card has already answered "which call", so on
    // a card the dropdown is a way to get it wrong and nothing else. It is
    // STATED instead — removing the control is not the same as removing the
    // confirmation that a welcome-call link is what's about to go out.
    expect(within(dialog).queryByRole("combobox")).toBeNull();
    expect(dialog).toHaveTextContent("Welcome call");
    expect((within(dialog).getByRole("textbox", { name: /Message/ }) as HTMLTextAreaElement).value).toContain("records-medicallymodern/welcome-call");
  });

  it("keeps the picker on the header's own Booking link button", async () => {
    mount();
    // That one is opened with no patient in hand, so the choice is real
    // (Brandon: "keep the booking link in top right corner and keep the drop-down").
    fireEvent.click(await screen.findByRole("button", { name: /Booking link/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("combobox")).toHaveValue("intake");
  });
});
