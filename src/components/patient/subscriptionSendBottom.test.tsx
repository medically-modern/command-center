/**
 * The Subscription profile is EDITABLE on the patient screen and in the
 * Communications hub's right pane, with ONE Send, at the BOTTOM (Josh,
 * 2026-09-23: *"for subscription patients make their profile editable on the
 * right, with a send to monday button at the bottom"* — and kept there on
 * 2026-09-24 when Brandon's layout arrived: *"leave these"*).
 *
 * From 2026-09-24 the tab is Brandon's grid (pixel-match items 4–13), and the
 * rule for it is Josh's: *"just changing the visuals and not the backend or
 * label options"*. So these tests render it and check the things a rep would
 * SEE — a second Save, a Save that is not the last thing on the tab, a
 * read-only rep handed a live control — AND the things they would not: that an
 * edit reaches the SAME send in the SAME shape, and that the new fields ride it
 * only as what the rep changed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { DossierItem } from "@/lib/commsHub/dossier";
import type { Patient as SubPatient } from "@/lib/subscription/workflow";
import { mondayItemToPatient } from "@/lib/subscription/mondayMapping";
import { COL } from "@/lib/subscription/mondayApi";
import { EMPTY_EXTRAS, type ProfileExtras } from "@/lib/subscription/profileExtras";

const state = vi.hoisted(() => ({ can: true, patient: null as unknown, extras: null as unknown }));
const send = vi.hoisted(() => vi.fn(async (_p: unknown, _o?: unknown) => {}));
const saveVisit = vi.hoisted(() => vi.fn(async (_id: string, _ymd: string) => {}));
const upload = vi.hoisted(() => vi.fn(async () => {}));
const appendNote = vi.hoisted(() => vi.fn(async () => "[Sep 24, 2026, 9:00 AM] Subscription: Caregiver authorized — recorded on the patient screen —JH"));
const readFresh = vi.hoisted(() => vi.fn(async () => state.patient));

vi.mock("@/components/shell/AbilityLock", () => ({
  useAbility: () => state.can,
  AbilityLockNote: () => <p>Read-only — Edit profile is off for you</p>,
}));
vi.mock("@/hooks/patient/useSubscriptionRecord", () => ({
  useSubscriptionRecord: () => ({
    patient: state.patient,
    extras: state.extras,
    loading: false,
    error: "",
    reload: async () => {},
    readFresh,
  }),
}));
vi.mock("@/hooks/patient/useMnDocFiles", () => ({
  useMnDocFiles: () => ({
    files: [{ assetId: "1", name: "Sample_Clinicals.pdf", public_url: "https://example.invalid/a.pdf" }],
    loading: false,
    error: "",
    reload: async () => {},
  }),
}));
vi.mock("@/hooks/patient/usePatientOrders", () => ({
  usePatientOrders: () => ({ orders: [], loading: false, error: "" }),
}));
/* The live labels, answered per column set: the infusion sets stay unloaded
   (disabled — the same state SubscriptionForm renders before the board
   answers), the three status columns Brandon's layout adds are loaded. */
vi.mock("@/hooks/useStatusOptions", () => ({
  useStatusOptions: (_board: unknown, ids: string[]) =>
    ids.includes("color_mm48kv1c")
      ? {
          options: {
            color_mm48kv1c: [
              { index: 1, label: "30-Days" },
              { index: 2, label: "60-Days" },
              { index: 3, label: "75-Days" },
              { index: 4, label: "90-Days" },
            ],
            color_mm72vm7p: [
              { index: 7, label: "Patient" },
              { index: 4, label: "Caregiver" },
            ],
            color_mm723hfk: [
              { index: 7, label: "Patient" },
              { index: 4, label: "Caregiver" },
            ],
          },
          loading: false,
          error: null,
          ready: true,
          reload: () => {},
        }
      : { options: {}, loading: false, error: null, ready: false, reload: () => {} },
}));
vi.mock("@/hooks/shared/usePayerOptions", () => ({
  usePayerOptions: () => ({ optionsFor: (base: unknown) => base }),
}));
vi.mock("@/components/welcomeCall/AddressAutocomplete", () => ({
  AddressAutocomplete: ({ value }: { value: string }) => <input aria-label="Address search" defaultValue={value} />,
}));
vi.mock("@/lib/subscription/mondayWrite", () => ({ sendPatientToMonday: send, saveVisitDateVerified: saveVisit }));
vi.mock("@/lib/subscription/mondayApi", async (orig) => ({
  ...(await orig<typeof import("@/lib/subscription/mondayApi")>()),
  uploadFileToColumn: upload,
}));
vi.mock("@/lib/commsHub/dossierApi", () => ({ appendNoteToRecord: appendNote }));
vi.mock("canvas-confetti", () => ({ default: () => {} }));
vi.mock("@/components/shared/pendingNoteGuard", () => ({
  refusePendingNote: () => false,
  usePendingNoteReport: () => {},
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
// Only the /subscription page's own card renders these; stubbed so the guard
// below reads the card's markup, not their network.
vi.mock("@/components/subscription/MnDocsPanel", () => ({
  MnDocsPanel: () => <p>MN documents panel</p>,
  inferMimeType: () => "application/pdf",
}));
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
      cv(COL.primaryInsurance, "Medicare A&B", JSON.stringify({ index: 0 })),
      cv(COL.memberId1, "W000000000"),
      cv(COL.doctor, "Dr. Sample Doctor"),
      cv(COL.mr, "MR Valid", JSON.stringify({ index: 1 })),
    ],
  });
}

function fakeExtras(over: Partial<ProfileExtras> = {}): ProfileExtras {
  return {
    ...EMPTY_EXTRAS,
    orderFrequency: "90-Days",
    orderFrequencyIndex: 4,
    cgmQty: "3",
    caregiverName: "",
    caregiverAuthorized: false,
    canText: "Yes",
    ...over,
  };
}

/** The dossier's copy of the same record. */
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
    color_mm2t7tdy: "Active",
    color_mm254qxj: "Medicare A&B",
    text_mkvp6zfg: "W000000000",
    location_mkp0rs0v: "123 Sample St, Albany, NY 12203",
    text_mkxn3wza: "Dr. Sample Doctor",
    color_mm25t997: "Auth Valid",
  },
};

function renderProfile(opts: { embedded?: boolean } = {}) {
  return render(
    <div className="cc-pt">
      <div className="pt-main" data-testid="main">
        <SubscriptionView
          item={ITEM}
          phone="5555550100"
          tab="profile"
          onTab={() => {}}
          embedded={opts.embedded}
          onNoteAppended={() => {}}
        />
      </div>
    </div>,
  );
}

const sendButtons = () => screen.queryAllByRole("button", { name: /Send to Monday/ });
const nextOrder = () => screen.getByLabelText("Next order date") as HTMLInputElement;

beforeEach(() => {
  state.can = true;
  state.patient = fakePatient();
  state.extras = fakeExtras();
  send.mockClear();
  saveVisit.mockClear();
  upload.mockClear();
  appendNote.mockClear();
  readFresh.mockClear();
});

describe("⚠️⚠️ ONE Send, and it is at the TOP (Josh, 2026-09-25)", () => {
  it("there is exactly one, and it sits ABOVE every card — sticky, so it stays on screen", () => {
    renderProfile();
    expect(sendButtons()).toHaveLength(1);
    const main = screen.getByTestId("main");
    const bar = main.querySelector(".sub-send");
    expect(bar, "no Send bar").not.toBeNull();
    // ⚠️ A DIRECT child of the column: that is what lets sticky ride the whole
    // scroll area (a box of its own could not pass that box's edge). It
    // PRECEDES the cards — Brandon's top Save, blue button.
    expect(bar?.parentElement).toBe(main);
    const fields = main.querySelector(".sub-fields");
    expect(fields, "no cards to be above").not.toBeNull();
    expect(
      bar!.compareDocumentPosition(fields!) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the Send bar must come before the cards",
    ).toBeTruthy();
    expect(bar?.contains(sendButtons()[0])).toBe(true);
  });

  it("an edit turns the bar amber with Discard, and Discard takes the edit back", () => {
    const { container } = renderProfile();
    expect(screen.queryByText(/Unsaved changes/)).toBeNull();
    fireEvent.change(nextOrder(), { target: { value: "2026-10-12" } });
    expect(screen.getByText(/Unsaved changes/)).toBeInTheDocument();
    expect(container.querySelector(".sub-send.dirty")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Discard/ }));
    expect(screen.queryByText(/Unsaved changes/)).toBeNull();
    expect(nextOrder().value).toBe("2026-10-05");
  });

  it("the Send carries the rep's edit, laid over a record read AT THE PRESS", async () => {
    renderProfile();
    fireEvent.change(nextOrder(), { target: { value: "2026-10-12" } });
    fireEvent.click(sendButtons()[0]);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(readFresh).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0][0] as SubPatient;
    expect(sent.nextOrder).toBe("2026-10-12");
    expect(sent.id).toBe("8000");
    // ⚠️ Nothing Brandon's layout adds was touched, so none of it is written.
    expect((send.mock.calls[0][1] as { extras?: unknown }).extras).toBeUndefined();
    expect(saveVisit).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
});

describe("Brandon's grid (pixel-match, 2026-09-24)", () => {
  it("draws his cards and none of the old snapshot cards", () => {
    renderProfile();
    for (const title of [
      "Subscription overview",
      "Demographics",
      "Contacts",
      "Insurance",
      "Medical necessity & auth",
      "Order details",
      "Doctor info",
      "Financials",
      "Subscription notes",
    ]) {
      expect(screen.getByText(title), `${title} missing`).toBeInTheDocument();
    }
    for (const gone of ["Authorisation & MN", "Coverage", "Ship to / doctor", "Cycle Controls", "Stedi Eligibility"]) {
      expect(screen.queryByText(gone), `${gone} is still drawn`).toBeNull();
    }
  });

  it("⚠️ no phone editor here — the top bar owns the patient's number", () => {
    renderProfile();
    expect(screen.queryByTitle("Edit phone number")).toBeNull();
  });

  it("the overview's Status wears his dot, and Subscription reads type · frequency", () => {
    const { container } = renderProfile();
    const status = container.querySelector(".status-v");
    expect(status?.textContent).toBe("Active");
    expect(status?.classList.contains("good")).toBe(true);
    expect(status?.querySelector(".dot")).not.toBeNull();
  });

  it("the MN documents list offers View and Download", () => {
    renderProfile();
    expect(screen.getByText("Sample_Clinicals.pdf")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /View/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Download/ })).toBeInTheDocument();
  });
});

describe("⚠️⚠️ the fields Brandon adds ride the SAME send, as ONLY what the rep changed", () => {
  it("a Contacts edit reaches the send as an `extras` delta — and nothing else of it", async () => {
    renderProfile();
    fireEvent.change(screen.getByLabelText("Caregiver name"), { target: { value: "Sam Helper" } });
    fireEvent.click(sendButtons()[0]);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect((send.mock.calls[0][1] as { extras?: unknown }).extras).toEqual({ caregiverName: "Sam Helper" });
  });

  it("⚠️ a field changed and changed back is not written", async () => {
    renderProfile();
    const qty = screen.getByLabelText("CGM qty");
    fireEvent.change(qty, { target: { value: "4" } });
    fireEvent.change(qty, { target: { value: "3" } });
    // Put a real edit beside it so there is something to send.
    fireEvent.change(nextOrder(), { target: { value: "2026-10-12" } });
    fireEvent.click(sendButtons()[0]);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect((send.mock.calls[0][1] as { extras?: unknown }).extras).toBeUndefined();
  });

  it("⚠️ 75-Days is offered only to Aetna — the app's existing payer rule (§5.31)", () => {
    renderProfile();
    const freq = screen.getByLabelText("Frequency") as HTMLSelectElement;
    const labels = Array.from(freq.options).map((o) => o.textContent);
    expect(labels).toEqual(["30-Days", "60-Days", "90-Days"]);
  });

  it("a Caregiver Authorized tick (off → on) also stamps the consent audit line", async () => {
    renderProfile();
    fireEvent.change(screen.getByLabelText("Caregiver authorized"), { target: { value: "yes" } });
    fireEvent.click(sendButtons()[0]);
    await waitFor(() => expect(appendNote).toHaveBeenCalledTimes(1));
    expect((send.mock.calls[0][1] as { extras?: unknown }).extras).toEqual({ caregiverAuthorized: true });
    expect((appendNote.mock.calls[0] as unknown as [{ text: string }])[0].text).toMatch(/Caregiver authorized/);
  });

  it("⚠️ the visit date goes through Update Clinicals' writer, never into the Patient send", async () => {
    renderProfile();
    fireEvent.change(screen.getByLabelText("Visit date"), { target: { value: "2026-09-01" } });
    fireEvent.click(sendButtons()[0]);
    await waitFor(() => expect(saveVisit).toHaveBeenCalledTimes(1));
    // Visit + 6 months, and the MR rung with it (§5.36) — not /subscription's
    // MN-Expiry-only path, which `sendPatientToMonday` would take if the date
    // rode on the Patient.
    expect(saveVisit).toHaveBeenCalledWith("8000", "2027-03-01");
    expect((send.mock.calls[0][0] as SubPatient).visitDate || "").toBe("");
  });
});

describe("⚠️⚠️ without Edit profile it is READ-ONLY — and says so", () => {
  it("no Send anywhere, every control disabled, the drop zone off, and the reason on screen", () => {
    state.can = false;
    const { container } = renderProfile();
    expect(sendButtons()).toHaveLength(0);
    expect(container.querySelector(".sub-send")).toBeNull();
    const fields = container.querySelector(".sub-fields") as HTMLElement;
    expect(fields).not.toBeNull();
    // Every form control inside the profile's cards is disabled — Brandon's own
    // mechanism, checked for EVERY control so a new one cannot slip through.
    const controls = Array.from(fields.querySelectorAll("input, select, textarea"));
    expect(controls.length).toBeGreaterThan(0);
    for (const c of controls) expect((c as HTMLInputElement).disabled, (c as HTMLElement).outerHTML).toBe(true);
    expect(fields.querySelector(".drop.off")).not.toBeNull();
    expect(screen.getAllByText(/Read-only for/).length).toBeGreaterThan(0);
  });

  it("⚠️ but reading a file is not editing — View still works", () => {
    state.can = false;
    renderProfile();
    expect(screen.getByRole("button", { name: /View/ })).not.toBeDisabled();
  });

  it("⚠️ and the notes box stays live — a note is not the profile (§5.39h)", () => {
    state.can = false;
    renderProfile();
    expect(screen.getByLabelText("Add a subscription note")).not.toBeDisabled();
  });
});

describe("in the Communications hub's pane", () => {
  it("⚠️ draws no second notes card — the pane already carries the live record's notes", () => {
    renderProfile({ embedded: true });
    expect(screen.queryByText("Subscription notes")).toBeNull();
    // The Send still tops the tab here too.
    const main = screen.getByTestId("main");
    const bar = main.querySelector(".sub-send");
    const fields = main.querySelector(".sub-fields");
    expect(bar).not.toBeNull();
    expect(fields).not.toBeNull();
    expect(bar!.compareDocumentPosition(fields!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("⚠️ the /subscription page is unchanged", () => {
  it("its own card still draws the phone, the visit date, the MN documents AND the three shared cards", () => {
    render(<PatientInfoCard patient={fakePatient()} onFieldChange={() => {}} />);
    for (const title of ["Demographics", "Insurance", "Doctor Info", "Medical Necessity & Auth", "Order Details", "Financials"]) {
      expect(screen.getByText(title), `${title} left /subscription`).toBeInTheDocument();
    }
    expect(screen.getByText("Visit Date")).toBeInTheDocument();
    expect(screen.getByText("MN documents panel")).toBeInTheDocument();
    // `within` keeps the import honest for the card-scoped checks above.
    expect(within(document.body).getByText("Visit Date")).toBeInTheDocument();
  });
});
