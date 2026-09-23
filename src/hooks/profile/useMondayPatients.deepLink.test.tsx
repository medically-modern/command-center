// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

/**
 * A DEEP-LINKED patient keeps the rep's edits across a poll (MM-1094).
 *
 * Janelle, 2026-09-23: *"All fields keep resetting and showing as red after I
 * made an update. Happened with the address, gender, insurance, and serving
 * fields."* The patient sat in New Form — Partial Leads and was
 * opened on `/profile`, whose queue is 1. Intake — so she reached the page only
 * as a deep link, which this hook re-fetches and INJECTS on every poll.
 *
 * The group's own rows were run through the overlay; the injected one was not.
 * Every 15 seconds (every 4 while a Stedi check polls) the rep's unsaved edits
 * were replaced by Monday's copy — blank on the board, so red on screen. The
 * overlay itself still held the edits, which is why typing seemed to work and
 * then "reset". The masheke, samantha, welcomeCall and subscription hooks all
 * merged the overlay into their injected patient; this one never did (since the
 * injection landed, 2026-05-11).
 */

const fetchGroupItems = vi.fn();
const fetchItemById = vi.fn();

vi.mock("@/lib/profile/mondayApi", async () => {
  const actual = await vi.importActual<typeof import("@/lib/profile/mondayApi")>(
    "@/lib/profile/mondayApi",
  );
  return {
    ...actual,
    hasToken: () => true,
    fetchGroupItems: (...a: unknown[]) => fetchGroupItems(...a),
    fetchItemById: (...a: unknown[]) => fetchItemById(...a),
  };
});

import { useMondayPatients } from "./useMondayPatients";
import { COL, LIST_COLUMN_IDS } from "@/lib/profile/mondayApi";

const INTAKE = "group_mm1xf2jb";
const PARTIAL_LEADS = "group_mm5z87zt";

/** A patient in 1. Intake — the queue `/profile` reads. */
function queueItem(id: string, name: string) {
  return {
    id,
    name,
    group: { id: INTAKE },
    column_values: [{ id: COL.dob, text: "01/02/1980", value: null }],
  };
}

/** The deep-linked patient: another group, and blank where the rep is typing. */
function deepLinkedItem(id: string, name: string) {
  return {
    id,
    name,
    group: { id: PARTIAL_LEADS },
    column_values: [
      { id: COL.dob, text: "03/04/1950", value: null },
      { id: COL.gender, text: "", value: null },
      { id: COL.serving, text: "", value: null },
      { id: COL.primaryInsurance, text: "Medicare A&B", value: null },
    ],
  };
}

beforeEach(() => {
  localStorage.clear();
  fetchGroupItems.mockReset();
  fetchItemById.mockReset();
  fetchGroupItems.mockResolvedValue([queueItem("1", "Ann Lee")]);
  fetchItemById.mockResolvedValue(deepLinkedItem("2", "Jane Doe"));
});

describe("a deep-linked patient from another group (full-width caller — ProfilePage)", () => {
  it("is injected into the list", async () => {
    const { result } = renderHook(() => useMondayPatients("2", INTAKE));
    await waitFor(() => expect(result.current.patients.map((p) => p.id)).toContain("2"));
  });

  it("keeps the rep's edits across a poll — the MM-1094 reset", async () => {
    const { result } = renderHook(() => useMondayPatients("2", INTAKE));
    await waitFor(() => expect(result.current.patients.map((p) => p.id)).toContain("2"));

    act(() =>
      result.current.updateLocal("2", {
        gender: "Female",
        serving: "CGM",
        primaryInsurance: "Humana",
        patientAddress: "12 Main St, Albany, NY 12203",
      }),
    );
    const jane = () => result.current.patients.find((p) => p.id === "2");
    expect(jane()?.gender).toBe("Female");

    // The 15s poll (or the Stedi watcher's 4s one). Monday still has the
    // fields blank; the edit must survive it.
    await act(async () => { await result.current.refetch(true); });

    expect(jane()?.gender).toBe("Female");
    expect(jane()?.serving).toBe("CGM");
    expect(jane()?.primaryInsurance).toBe("Humana");
    expect(jane()?.patientAddress).toBe("12 Main St, Albany, NY 12203");
  });

  it("still picks up Monday's value for a field the rep has NOT touched", async () => {
    const { result } = renderHook(() => useMondayPatients("2", INTAKE));
    await waitFor(() => expect(result.current.patients.map((p) => p.id)).toContain("2"));
    act(() => result.current.updateLocal("2", { gender: "Female" }));

    fetchItemById.mockResolvedValue({
      ...deepLinkedItem("2", "Jane Doe"),
      column_values: [
        ...deepLinkedItem("2", "Jane Doe").column_values.filter((c) => c.id !== COL.dob),
        { id: COL.dob, text: "05/06/1951", value: null },
      ],
    });
    await act(async () => { await result.current.refetch(true); });

    const jane = result.current.patients.find((p) => p.id === "2");
    expect(jane?.dob).toBe("05/06/1951");
    expect(jane?.gender).toBe("Female");
  });

  it("keeps the as-received snapshot PRE-edit", async () => {
    const { result } = renderHook(() => useMondayPatients("2", INTAKE));
    await waitFor(() => expect(result.current.patients.map((p) => p.id)).toContain("2"));
    act(() => result.current.updateLocal("2", { gender: "Female" }));
    await act(async () => { await result.current.refetch(true); });

    // The "What We Received" card reads this. An overlay leaking into it would
    // show the rep's own edit back to them as though the patient had said it.
    expect(result.current.getReceived("2")?.gender).toBe("");
  });

  it("restores a saved edit when the page is opened again", async () => {
    const first = renderHook(() => useMondayPatients("2", INTAKE));
    await waitFor(() => expect(first.result.current.patients.map((p) => p.id)).toContain("2"));
    act(() => first.result.current.updateLocal("2", { gender: "Female" }));
    act(() => first.result.current.saveOverlay("2"));
    first.unmount();

    // Save Progress on /profile is browser-only: a re-open must still show it.
    const again = renderHook(() => useMondayPatients("2", INTAKE));
    await waitFor(() =>
      expect(again.result.current.patients.find((p) => p.id === "2")?.gender).toBe("Female"),
    );
  });
});

describe("the same injection on the two-tier page (narrow list)", () => {
  it("keeps the edit on the injected list row too", async () => {
    const { result } = renderHook(() =>
      useMondayPatients("2", INTAKE, { listColumns: LIST_COLUMN_IDS }),
    );
    await waitFor(() => expect(result.current.patients.map((p) => p.id)).toContain("2"));
    act(() => result.current.updateLocal("2", { gender: "Female" }));
    await act(async () => { await result.current.refetch(true); });
    expect(result.current.patients.find((p) => p.id === "2")?.gender).toBe("Female");
  });
});
