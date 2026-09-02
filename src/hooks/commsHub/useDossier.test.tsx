/**
 * Switching patient must CLEAR the dossier, not hold the last one.
 *
 * ⚠️ Not a cosmetic rule. `PatientDossierPanel`'s note composer writes to
 * `dossier.active.itemId`, and `AssignedPatientsPage` derives `threadPatient`
 * — which carries `mondayItemId` onto an outbound text — from the same object.
 * Leaving the previous patient in place while the next one loads means a note
 * or a text typed in that window is filed against the patient the rep just
 * navigated away from.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

const fetchDossierItems = vi.fn();
const peekDossierItems = vi.fn();
vi.mock("@/lib/commsHub/dossierApi", () => ({
  dossierConfigured: () => true,
  fetchDossierItems: (...a: unknown[]) => fetchDossierItems(...a),
  peekDossierItems: (...a: unknown[]) => peekDossierItems(...a),
}));

import { useDossier } from "./useDossier";

const item = (name: string, phone: string) => ({
  itemId: `${name}-1`,
  name,
  phone,
  boardId: 18410804557,
  boardName: "Welcome Call",
  groupId: "g",
  groupTitle: "Welcome Call",
  isCompleted: false,
  isStuck: false,
  dob: "",
  route: "/welcome-call",
  stageAdvancerText: "",
  notes: "",
  notesColId: "long_text_mm2ffsme",
  notesColType: "long_text" as const,
  nextActionDate: "",
  daysSinceStage: "",
  cols: {},
});

/**
 * ⚠️ The dossier and the loading flag are reported SEPARATELY on purpose.
 * Rendering `loading ? "LOADING" : name` hides the bug: with the stale dossier
 * still in state, the probe shows "LOADING" either way and the test passes
 * against the very thing it exists to catch. What matters is that `dossier` is
 * null DURING the load, because that object is what the note composer and the
 * outbound-text attribution read.
 */
function Probe({ phone, prefer }: { phone: string; prefer?: string }) {
  const { dossier, loading, people, selected, selectPerson } = useDossier(phone, prefer);
  return (
    <>
      <span data-testid="name">{dossier?.name ?? "NONE"}</span>
      <span data-testid="state">{loading ? "LOADING" : "IDLE"}</span>
      <span data-testid="count">{people.length}</span>
      <span data-testid="selected">{selected}</span>
      <button data-testid="next" onClick={() => selectPerson(selected + 1)}>next</button>
    </>
  );
}

describe("useDossier", () => {
  beforeEach(() => {
    fetchDossierItems.mockReset();
    peekDossierItems.mockReset();
    peekDossierItems.mockReturnValue(null);
  });

  it("clears the previous patient the moment the number changes", async () => {
    let release: (v: unknown) => void = () => {};
    fetchDossierItems.mockResolvedValueOnce([item("Robert Arkus", "+17138254957")]);
    const { rerender } = render(<Probe phone="+17138254957" />);
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Robert Arkus"));

    // The next patient's lookup is held open — this is the whole window.
    fetchDossierItems.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    rerender(<Probe phone="+18155237259" />);

    // ⚠️ The dossier is GONE, not merely covered by a spinner. A note or a
    // text sent in this window would otherwise be filed against Robert Arkus.
    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("LOADING"));
    expect(screen.getByTestId("name")).toHaveTextContent("NONE");

    await act(async () => {
      release([item("Tonasila Gray", "+18155237259")]);
    });
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Tonasila Gray"));
  });

  it("renders a cached patient with no loading flash", async () => {
    // Clicking back and forth between two threads must not blink a spinner over
    // data already in the session cache.
    peekDossierItems.mockReturnValue([item("Tonasila Gray", "+18155237259")]);
    render(<Probe phone="+18155237259" />);
    expect(screen.getByTestId("name")).toHaveTextContent("Tonasila Gray");
    expect(screen.getByTestId("state")).toHaveTextContent("IDLE");
    await act(async () => {});
    expect(fetchDossierItems).not.toHaveBeenCalled();
  });

  it("reports a number on no board as NONE rather than the last patient", async () => {
    fetchDossierItems.mockResolvedValueOnce([item("Robert Arkus", "+17138254957")]);
    const { rerender } = render(<Probe phone="+17138254957" />);
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Robert Arkus"));

    fetchDossierItems.mockResolvedValueOnce([]);
    rerender(<Probe phone="+18583666900" />);
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("NONE"));
  });

  it("does not leave the last patient up when the lookup fails", async () => {
    fetchDossierItems.mockResolvedValueOnce([item("Robert Arkus", "+17138254957")]);
    const { rerender } = render(<Probe phone="+17138254957" />);
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Robert Arkus"));

    fetchDossierItems.mockRejectedValueOnce(new Error("Monday 503"));
    rerender(<Probe phone="+18155237259" />);
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("NONE"));
  });

  it("clears when the selection is dropped entirely", async () => {
    fetchDossierItems.mockResolvedValueOnce([item("Robert Arkus", "+17138254957")]);
    const { rerender } = render(<Probe phone="+17138254957" />);
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("Robert Arkus"));
    rerender(<Probe phone="" />);
    await waitFor(() => expect(screen.getByTestId("name")).toHaveTextContent("NONE"));
  });
});


describe("a number shared by two patients", () => {
  // John and Sue Hartley share 3046977788 on the live boards.
  const SHARED = "+13046977788";
  const both = [
    { ...item("Sue Hartley", SHARED), itemId: "sue", boardId: 18406352652, boardName: "Profile Send Off" },
    item("John Hartley Jr", SHARED),
  ];

  it("reports BOTH people and defaults to the furthest along", () => {
    // Merged, the pane blended their paths and notes under one header.
    peekDossierItems.mockReturnValue(both);
    render(<Probe phone={SHARED} />);
    expect(screen.getByTestId("count")).toHaveTextContent("2");
    // John is on Welcome Call, Sue on Profile Send Off.
    expect(screen.getByTestId("name")).toHaveTextContent("John Hartley Jr");
  });

  it("switches the ACTIVE dossier, which is what notes and texts are filed against", () => {
    peekDossierItems.mockReturnValue(both);
    render(<Probe phone={SHARED} />);
    act(() => screen.getByTestId("next").click());
    expect(screen.getByTestId("selected")).toHaveTextContent("1");
    expect(screen.getByTestId("name")).toHaveTextContent("Sue Hartley");
  });

  it("ignores a selection outside the list", () => {
    peekDossierItems.mockReturnValue([item("Robert Arkus", "+17138254957")]);
    render(<Probe phone="+17138254957" />);
    act(() => screen.getByTestId("next").click());
    expect(screen.getByTestId("name")).toHaveTextContent("Robert Arkus");
    expect(screen.getByTestId("selected")).toHaveTextContent("0");
  });

  it("resets the selection when the number changes", () => {
    // Or the next number opens on an index that means nothing on it.
    peekDossierItems.mockReturnValue(both);
    const { rerender } = render(<Probe phone={SHARED} />);
    act(() => screen.getByTestId("next").click());
    expect(screen.getByTestId("selected")).toHaveTextContent("1");
    peekDossierItems.mockReturnValue([item("Robert Arkus", "+17138254957")]);
    rerender(<Probe phone="+17138254957" />);
    expect(screen.getByTestId("selected")).toHaveTextContent("0");
    expect(screen.getByTestId("name")).toHaveTextContent("Robert Arkus");
  });
});


describe("opening on the patient a rep actually picked", () => {
  const SHARED = "+13046977788";
  const both = [
    { ...item("Sue Hartley", SHARED), itemId: "sue", boardId: 18406352652, boardName: "Profile Send Off" },
    item("John Hartley Jr", SHARED),
  ];

  it("opens on the NAMED patient, not the default one", () => {
    // Reported: searching "Sue Hartley" and clicking her opened John, who
    // shares the line and wins the default ordering. The click passed only the
    // phone number, throwing away the choice the rep had already made.
    peekDossierItems.mockReturnValue(both);
    render(<Probe phone={SHARED} prefer="Sue Hartley" />);
    expect(screen.getByTestId("name")).toHaveTextContent("Sue Hartley");
    expect(screen.getByTestId("selected")).toHaveTextContent("1");
  });

  it("still lists everyone, so the rep can switch back", () => {
    peekDossierItems.mockReturnValue(both);
    render(<Probe phone={SHARED} prefer="Sue Hartley" />);
    expect(screen.getByTestId("count")).toHaveTextContent("2");
  });

  it("falls back to the default when the name matches nobody", () => {
    peekDossierItems.mockReturnValue(both);
    render(<Probe phone={SHARED} prefer="Someone Else" />);
    expect(screen.getByTestId("name")).toHaveTextContent("John Hartley Jr");
  });

  it("matches through a rep annotation on the board title", () => {
    peekDossierItems.mockReturnValue([
      { ...item("Sue Hartley (copy)", SHARED), itemId: "sue" },
      item("John Hartley Jr", SHARED),
    ]);
    render(<Probe phone={SHARED} prefer="Sue Hartley" />);
    expect(screen.getByTestId("name")).toHaveTextContent("Sue Hartley");
  });

  it("ignores an empty preference", () => {
    peekDossierItems.mockReturnValue(both);
    render(<Probe phone={SHARED} prefer="" />);
    expect(screen.getByTestId("name")).toHaveTextContent("John Hartley Jr");
  });
});
