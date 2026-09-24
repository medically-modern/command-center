/**
 * The intake pages' warnings hook (§5.20b): when the pop-up opens, and what
 * the screen shows for a tick before the board has caught up.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Patient } from "@/lib/profile/workflow";

const writes = vi.hoisted(() => ({ next: "", fail: false, calls: 0 }));
vi.mock("@/lib/profile/intakeWarningAck", () => ({
  setIntakeWarningAck: vi.fn(async () => {
    writes.calls++;
    if (writes.fail) throw new Error("refused");
    return writes.next;
  }),
}));

import { useIntakeWarnings } from "./useIntakeWarnings";

const PUMP = "MEDICARE_PUMP_MEDICAID_ID|CONFIRM:Has NY Medicaid ID|Confirm the Medicaid ID.";
const CHECK = "Check with patient: lives in NY, NJ, FL or TN?";

const pt = (over: Partial<Patient> = {}): Patient => ({
  id: "1", stediInNetwork: "Yes", intakeWarnings: "", intakeWarningAcks: "",
  stediAddress: "", patientAddress: "", formState: "",
  ...over,
}) as Patient;

type Props = { p: Patient | null; running: boolean; enabled?: boolean };
const setup = (initial: Props) =>
  renderHook(({ p, running, enabled }: Props) => useIntakeWarnings(p, { running, stage: "Patient Intake", enabled }), {
    initialProps: initial,
  });

describe("useIntakeWarnings — the pop-up", () => {
  beforeEach(() => { writes.next = ""; writes.fail = false; writes.calls = 0; });

  it("opens when a patient with warnings is opened, and not for one without", () => {
    const h = setup({ p: pt({ intakeWarnings: PUMP }), running: false });
    expect(h.result.current.dialogOpen).toBe(true);
    const h2 = setup({ p: pt(), running: false });
    expect(h2.result.current.dialogOpen).toBe(false);
  });

  it("opens for a Check with patient verdict, with the state guidance", () => {
    const h = setup({ p: pt({ stediInNetwork: CHECK, stediAddress: "1 Main St, Newark, NJ 07102" }), running: false });
    expect(h.result.current.dialogOpen).toBe(true);
    expect(h.result.current.anthem?.switchTo).toBe("Horizon BCBS");
  });

  it("closing it holds for this visit; opening the patient again brings it back", () => {
    const a = pt({ intakeWarnings: PUMP });
    const h = setup({ p: a, running: false });
    act(() => h.result.current.setDialogOpen(false));
    h.rerender({ p: { ...a }, running: false }); // a poll: same answer
    expect(h.result.current.dialogOpen).toBe(false);
    h.rerender({ p: pt({ id: "2" }), running: false }); // another patient
    expect(h.result.current.dialogOpen).toBe(false);
    h.rerender({ p: { ...a }, running: false }); // back again
    expect(h.result.current.dialogOpen).toBe(true);
  });

  it("never while a check is streaming in; once it finishes, yes", () => {
    const h = setup({ p: pt(), running: true });
    h.rerender({ p: pt({ intakeWarnings: PUMP }), running: true });
    expect(h.result.current.dialogOpen).toBe(false);
    h.rerender({ p: pt({ intakeWarnings: PUMP }), running: false });
    expect(h.result.current.dialogOpen).toBe(true);
  });

  it("re-opens after a finished check even when the answer came back the same", () => {
    const a = pt({ intakeWarnings: PUMP });
    const h = setup({ p: a, running: false });
    act(() => h.result.current.setDialogOpen(false));
    h.rerender({ p: { ...a }, running: true });
    h.rerender({ p: { ...a }, running: false });
    expect(h.result.current.dialogOpen).toBe(true);
  });

  it("a new check that clears everything closes it", () => {
    const h = setup({ p: pt({ intakeWarnings: PUMP }), running: false });
    h.rerender({ p: pt({ intakeWarnings: PUMP }), running: true });
    h.rerender({ p: pt(), running: false });
    expect(h.result.current.dialogOpen).toBe(false);
  });

  it("stays shut on a finished record being reviewed", () => {
    const h = setup({ p: pt({ intakeWarnings: PUMP }), running: false, enabled: false });
    expect(h.result.current.dialogOpen).toBe(false);
  });
});

describe("useIntakeWarnings — ticks", () => {
  beforeEach(() => { writes.next = ""; writes.fail = false; writes.calls = 0; });

  it("a tick shows at once, and the gate sees it before the board does", async () => {
    const a = pt({ intakeWarnings: PUMP });
    const h = setup({ p: a, running: false });
    writes.next = "MEDICARE_PUMP_MEDICAID_ID";
    await act(async () => { await h.result.current.toggle(h.result.current.warnings[0], true); });
    expect(h.result.current.acks).toEqual(["MEDICARE_PUMP_MEDICAID_ID"]);
    expect(h.result.current.gatePatient?.intakeWarningAcks).toBe("MEDICARE_PUMP_MEDICAID_ID");
  });

  it("once the board agrees the override retires, and the board leads again", async () => {
    const a = pt({ intakeWarnings: PUMP });
    const h = setup({ p: a, running: false });
    writes.next = "MEDICARE_PUMP_MEDICAID_ID";
    await act(async () => { await h.result.current.toggle(h.result.current.warnings[0], true); });
    h.rerender({ p: { ...a, intakeWarningAcks: "MEDICARE_PUMP_MEDICAID_ID" }, running: false });
    // A check started elsewhere cleared it on the board: the screen follows.
    await waitFor(() => {
      h.rerender({ p: { ...a, intakeWarningAcks: "" }, running: false });
      expect(h.result.current.acks).toEqual([]);
    });
  });

  it("a refused write leaves the box as it was", async () => {
    const h = setup({ p: pt({ intakeWarnings: PUMP }), running: false });
    writes.fail = true;
    let ok = true;
    await act(async () => { ok = await h.result.current.toggle(h.result.current.warnings[0], true); });
    expect(ok).toBe(false);
    expect(h.result.current.acks).toEqual([]);
  });

  it("starting a check clears the ticks on screen at once", () => {
    const h = setup({ p: pt({ intakeWarnings: PUMP, intakeWarningAcks: "MEDICARE_PUMP_MEDICAID_ID" }), running: false });
    expect(h.result.current.acks).toEqual(["MEDICARE_PUMP_MEDICAID_ID"]);
    act(() => h.result.current.markCheckStarted());
    expect(h.result.current.acks).toEqual([]);
    expect(h.result.current.gatePatient?.intakeWarningAcks).toBe("");
  });

  it("no ticking at all on a reviewed record", async () => {
    const h = setup({ p: pt({ intakeWarnings: PUMP }), running: false, enabled: false });
    await act(async () => { await h.result.current.toggle(h.result.current.warnings[0], true); });
    expect(writes.calls).toBe(0);
  });
});
