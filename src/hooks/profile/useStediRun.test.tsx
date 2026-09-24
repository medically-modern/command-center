/**
 * `useStediRun` — the two things 2026-09-24 changed about it, each of which
 * fails silently on screen:
 *
 *  1. A run is ABOUT one patient (`forId`), and that survives the run ending,
 *     so "didn't run: details didn't save" is printed on that patient and not
 *     on the next one a rep opens.
 *  2. The deadline no longer hides behind the patient match. A rep who pressed
 *     Run and opened another patient used to leave the hook "running" for
 *     good — Run greyed out on every patient until they went back.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Patient } from "@/lib/profile/workflow";

const writePatientProfile = vi.fn();
const verifyProfileWritten = vi.fn();
const triggerStediRun = vi.fn();
vi.mock("@/lib/profile/mondayWrite", () => ({
  writePatientProfile: (...a: unknown[]) => writePatientProfile(...(a as [])),
  verifyProfileWritten: (...a: unknown[]) => verifyProfileWritten(...(a as [])),
  triggerStediRun: (...a: unknown[]) => triggerStediRun(...(a as [])),
}));

import { STEDI_TIMEOUT_MS, useStediRun } from "./useStediRun";

const patient = (id: string, over: Partial<Patient> = {}) =>
  ({ id, name: `Patient ${id}`, dob: "1960-01-01", generalInsurance: "Aetna", workingMemberId: "W1", ...over }) as Patient;

describe("useStediRun", () => {
  beforeEach(() => {
    writePatientProfile.mockReset().mockResolvedValue(undefined);
    verifyProfileWritten.mockReset().mockResolvedValue({ ok: true, mismatches: [] });
    triggerStediRun.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("stamps the run with its patient and a start time", async () => {
    const { result } = renderHook(() => useStediRun());
    await act(async () => { await result.current.start(patient("A")); });
    expect(result.current.state).toMatchObject({ phase: "running", runningId: "A", forId: "A" });
    expect(typeof result.current.state.startedAt).toBe("number");
    expect(result.current.isRunning).toBe(true);
  });

  it("⚠️ a run that never reached the payer keeps the patient it was about", async () => {
    verifyProfileWritten.mockResolvedValue({ ok: false, mismatches: ["Member ID"] });
    const { result } = renderHook(() => useStediRun());
    await act(async () => { await result.current.start(patient("A")); });
    expect(result.current.state).toMatchObject({ phase: "error", runningId: null, forId: "A", startedAt: null });
    expect(result.current.state.message).toMatch(/^Not run — details didn't save: Member ID/);
    expect(triggerStediRun).not.toHaveBeenCalled();
  });

  it("⚠️ times out while ANOTHER patient is open — Run is not greyed out for good", async () => {
    const { result } = renderHook(() => useStediRun());
    await act(async () => { await result.current.start(patient("A")); });
    // The rep has moved on: only patient B is ever observed from here.
    act(() => { result.current.observe(patient("B")); });
    expect(result.current.isRunning).toBe(true);

    const later = Date.now() + STEDI_TIMEOUT_MS + 1_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    let finished = false;
    act(() => { finished = result.current.observe(patient("B")); });
    expect(finished).toBe(true);
    expect(result.current.isRunning).toBe(false);
    // …and the timeout is A's news, not B's.
    expect(result.current.state).toMatchObject({ phase: "done", forId: "A", runningId: null });
  });

  it("a patient who is not the one running never settles the run", async () => {
    const { result } = renderHook(() => useStediRun());
    await act(async () => { await result.current.start(patient("A")); });
    let finished = true;
    act(() => { finished = result.current.observe(patient("B", { stediPlanName: "Gold" })); });
    expect(finished).toBe(false);
    expect(result.current.state.runningId).toBe("A");
  });

  it("reset forgets the patient", async () => {
    const { result } = renderHook(() => useStediRun());
    await act(async () => { await result.current.start(patient("A")); });
    act(() => result.current.reset());
    expect(result.current.state).toEqual({ phase: "idle", runningId: null, forId: null, startedAt: null, message: null });
  });
});
