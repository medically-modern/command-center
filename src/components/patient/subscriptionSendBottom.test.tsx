/**
 * The Subscription profile is EDITABLE on the patient screen and in the
 * Communications hub's right pane, with ONE Send, at the BOTTOM (Josh,
 * 2026-09-23: *"for subscription patients make their profile editable on the
 * right, with a send to monday button at the bottom"*).
 *
 * Rendered, not scanned: the failures worth catching here are all things a
 * rep would SEE — a second Save, a Save that is not the last thing on the tab,
 * a fact rendered twice (once as an input, once read-only), a read-only rep
 * handed a live form, an edit that never reaches the send.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DossierItem } from "@/lib/commsHub/dossier";
import type { Patient as SubPatient } from "@/lib/subscription/workflow";
import { mondayItemToPatient } from "@/lib/subscription/mondayMapping";
import { COL } from "@/lib/subscription/mondayApi";

const state = vi.hoisted(() => ({ can: true, patient: null as unknown }));
const send = vi.hoisted(() => vi.fn(async (_p: unknown, _o?: unknown) => {}));
const readFresh = vi.hoisted(() => vi.fn(async () => state.patient));

vi.mock("@/components/shell/AbilityLock", () => ({
  useAbility: () => state.can,
  AbilityLockNote: () => <p>Read-only — Edit profile is off for you</p>,
}));
vi.mock("@/hooks/patient/useSubscriptionRecord", () => ({
  useSubscriptionRecord: () => ({
    patient: state.patient,
    loading: false,
    error: "",
    reload: async () => {},
    readFresh,
  }),
}));
vi.mock("@/hooks/patient/usePatientOrders", () => ({
  usePatientOrders: () => ({ orders: [], loading: false, error: "" }),
}));
vi.mock("@/hooks/useStatusOptions", () => ({
  useStatusOptions: () => ({ options: {}, loading: false, error: null, ready: false, reload: () => {} }),
}));
vi.mock("@/hooks/shared/usePayerOptions", () => ({
  usePayerOptions: () => ({ optionsFor: (base: unknown) => base }),
}));
vi.mock("@/components/welcomeCall/AddressAutocomplete", () => ({
  AddressAutocomplete: ({ value }: { value: string }) => <input aria-label="Address search" defaultValue={value} />,
}));
vi.mock("@/lib/subscription/mondayWrite", () => ({ sendPatientToMonday: send }));
vi.mock("canvas-confetti", () => ({ default: () => {} }));
vi.mock("@/components/shared/pendingNoteGuard", () => ({ refusePendingNote: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
// Only the /subscription page's own card renders these three; stubbed so the
// guard below reads the card's markup, not their network.
vi.mock("@/components/subscription/MnDocsPanel", () => ({ MnDocsPanel: () => <p>MN documents panel</p> }));
vi.mock("@/components/shared/CallHistoryButton", () => ({ CallHistoryButton: () => null }));
vi.mock("@/components/shared/PatientProfileStatus", () => ({ SubscriptionProfileStatus: () => null }));

import { SubscriptionView } from "./SubscriptionView";
import { PatientInfoCard } from "@/components/subscription/PatientInfoCard";

const cv = (id: string, text: string, value: string | null = null) => ({ id, text, value });

/** A FAKE Subscription record, through the slice's own mapping. */
function fakePatient(): SubPatient {
  return mondayItemToPatient({
    id: "8000",
    name: "Jane Sample",
    group: { id: "topics" },
    column_values: [
      cv(COL.subscription, "Sensors & Supplies", JSON.stringify({ index: 2 })),
      cv(COL.orderingCycle, "Next Order Awaiting", JSON.stringify({ index: 2 })),
      cv(COL.nextOrder, "2026-10-05"),
      cv(
        COL.address,
        "123 Sample St, Albany, NY 12203",
        JSON.stringify({ address: "123 Sample St, Albany, NY 12203", lat: 1, lng: 2 }),
      ),
      cv(COL.primaryInsurance, "Aetna Commercial", JSON.stringify({ index: 13 })),
      cv(COL.memberId1, "W000000000"),
      cv(COL.doctor, "Dr. Sample Doctor"),
      // An MR status is what makes /subscription draw its Visit Date field, so
      // with it here "no visit date in the pane" is a real absence, not a blank.
      cv(COL.mr, "MR Valid", JSON.stringify({ index: 1 })),
    ],
  });
}

/** The dossier's copy of the same record, carrying the facts the read-only
 *  COVERAGE and SHIP TO / DOCTOR cards would draw if they were not filtered. */
const ITEM: DossierItem = {
  itemId: "8000",
  name: "Jane Sample",
  phone: "5555550100",
  boardId: 18407459988,
  boardName: "Subscription Board - Updated",
  groupId: "topics",
  groupTitle: "Subscriptions",
  isCompleted: false,
  isStuck: false,
  escalationText: "",
  escalationLevel: null,
  isProposedStuck: false,
  dob: "03/14/1958",
  route: "/subscription",
  stageAdvancerText: "",
  notes: "",
  notesColId: "text_mm6vp1z3",
  notesColType: "text",
  nextActionDate: "",
  daysSinceStage: "",
  createdAt: "",
  cols: {
    color_mm254qxj: "Aetna Commercial",
    text_mkvp6zfg: "W000000000",
    location_mkp0rs0v: "123 Sample St, Albany, NY 12203",
    text_mkxn3wza: "Dr. Sample Doctor",
    color_mm25t997: "Auth Valid",
  },
};

function renderProfile() {
  return render(
    <div className="cc-pt">
      <div className="pt-main" data-testid="main">
        <SubscriptionView item={ITEM} phone="5555550100" tab="profile" onTab={() => {}} />
      </div>
    </div>,
  );
}

const sendButtons = () => screen.queryAllByRole("button", { name: /Send to Monday/ });

beforeEach(() => {
  state.can = true;
  state.patient = fakePatient();
  send.mockClear();
  readFresh.mockClear();
});

describe("⚠️⚠️ ONE Send, and it is at the BOTTOM", () => {
  it("there is exactly one, and it is the last thing on the tab — after every card and the footer", () => {
    renderProfile();
    expect(sendButtons()).toHaveLength(1);
    const main = screen.getByTestId("main");
    const bar = main.querySelector(".sub-send");
    expect(bar, "no Send bar").not.toBeNull();
    // ⚠️ A DIRECT child of the column, and its last: that is what lets it pin to
    // the bottom of the scroll area from the first frame (a box of its own
    // could not rise above that box's top edge).
    expect(bar?.parentElement).toBe(main);
    expect(main.lastElementChild).toBe(bar);
    expect(bar?.contains(sendButtons()[0])).toBe(true);
  });

  it("an edit turns the bar amber with Discard, and Discard takes the edit back", () => {
    const { container } = renderProfile();
    expect(screen.queryByText(/Unsaved changes/)).toBeNull();
    const date = container.querySelector(".sub-fields input[type=date]") as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2026-10-12" } });
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
    expect(container.querySelector(".sub-send.dirty")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Discard/ }));
    expect(screen.queryByText(/Unsaved changes/)).toBeNull();
    expect((container.querySelector(".sub-fields input[type=date]") as HTMLInputElement).value).toBe("2026-10-05");
  });

  it("the Send carries the rep's edit, laid over a record read AT THE PRESS", async () => {
    const { container } = renderProfile();
    const date = container.querySelector(".sub-fields input[type=date]") as HTMLInputElement;
    fireEvent.change(date, { target: { value: "2026-10-12" } });
    fireEvent.click(sendButtons()[0]);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(readFresh).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0][0] as SubPatient;
    expect(sent.nextOrder).toBe("2026-10-12");
    expect(sent.id).toBe("8000");
  });
});

describe("the profile's address, insurance and doctor are editable here", () => {
  it("the /subscription page's own three cards render, and the read-only copies of their facts do not", () => {
    renderProfile();
    for (const title of ["Demographics", "Insurance", "Doctor Info"]) {
      expect(screen.getByText(title), `${title} card missing`).toBeInTheDocument();
    }
    // One fact editable and the same fact read-only on one screen is worse
    // than either alone — the snapshot cards for these two sections are gone.
    expect(screen.queryByText("Coverage")).toBeNull();
    expect(screen.queryByText("Ship to / doctor")).toBeNull();
    // …while the one it does not replace stays.
    expect(screen.getByText("Authorisation & MN")).toBeInTheDocument();
  });

  it("⚠️ no phone editor and no visit date here — the top bar and Update Clinicals own those", () => {
    const { container } = renderProfile();
    expect(screen.queryByTitle("Edit phone number")).toBeNull();
    expect(screen.queryByText("Visit Date")).toBeNull();
    expect(container.querySelectorAll(".sub-fields input[type=date]")).toHaveLength(1); // Next Order Date only
  });
});

describe("⚠️⚠️ without Edit profile it is READ-ONLY — and says so", () => {
  it("no Send anywhere, the fields are inert, and the reason is on screen", () => {
    state.can = false;
    const { container } = renderProfile();
    expect(sendButtons()).toHaveLength(0);
    expect(container.querySelector(".sub-send")).toBeNull();
    const fields = container.querySelector(".sub-fields");
    expect(fields?.hasAttribute("inert"), "the read-only fields are not inert").toBe(true);
    // The three cards are INSIDE the inert box, not beside it.
    expect(fields?.textContent).toMatch(/Demographics[\s\S]*Insurance[\s\S]*Doctor Info/);
    expect(screen.getAllByText(/Read-only — Edit profile is off for you/).length).toBeGreaterThan(0);
  });
});

describe("⚠️ the /subscription page is unchanged by the extraction", () => {
  it("its own card still draws the phone, the visit date, the MN documents AND the three shared cards", () => {
    // The three cards were lifted OUT of this component so a second screen can
    // render them; this is the guard that lifting them did not drop anything
    // from the page that always had them.
    render(<PatientInfoCard patient={fakePatient()} onFieldChange={() => {}} />);
    for (const title of ["Demographics", "Insurance", "Doctor Info", "Medical Necessity & Auth", "Order Details", "Financials"]) {
      expect(screen.getByText(title), `${title} left /subscription`).toBeInTheDocument();
    }
    expect(screen.getByText("Visit Date")).toBeInTheDocument();
    expect(screen.getByText("MN documents panel")).toBeInTheDocument();
  });
});
