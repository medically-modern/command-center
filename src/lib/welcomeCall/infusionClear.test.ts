/**
 * An emptied infusion set / quantity must CLEAR its Monday column, not be
 * skipped.
 *
 * ── The bug this pins ──
 * Two everyday actions empty these controls automatically: correcting Pump Type
 * (`setsInvalidatedByPump`, which also toasts "Infusion set cleared"), and
 * removing the second set (`setTwoTransition`). Both left the rep looking at an
 * emptied control while `buildDataTasks` pushed NO TASK AT ALL for the column —
 * `if (p.infusionSet1Index !== null)` / `if (p.qtyInf1 !== "")`. So the send
 * reported success, the screen said "no set", and Monday kept the incompatible
 * set and its quantity, which the create-item automations then copied onto the
 * order. Nothing errored anywhere.
 *
 * It is also a straight contradiction of the requirement in
 * `infusionSelection.ts`'s own header (Brandon, 2026-09-09): "If Set 2 is
 * removed … write blanks to Infusion Set 2 / Qty Inf. 2 on Monday — don't leave
 * the old values on the board."
 *
 * ⚠️ Verified safe against the live board first: none of the four
 * order-creation automations (7918340959 · 7918341001 · 7918341011 ·
 * 7921725444) has a CONDITION on an infusion column — every condition is on
 * Pump Qty / Monitor Qty. These five columns are only ever COPIED, so writing a
 * blank changes which values are copied and no branch that is taken.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { infusionSetWriteAction } from "./infusionSelection";

interface CapturedSend {
  tasks: Array<{ label: string; columnId: string; value?: unknown; fn: () => Promise<unknown> }>;
}
const captured: CapturedSend[] = [];

vi.mock("../shared/verifiedWrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/verifiedWrite")>();
  return {
    ...actual,
    executeWritesWithVerification: async (opts: CapturedSend) => {
      captured.push(opts);
      return [] as string[];
    },
  };
});
// The 2000-char guard reads the live board; this suite is about task shape.
vi.mock("../shared/columnType", () => ({
  isCappedColumn: async () => false,
  assertTextLikeFits: async () => {},
}));

beforeEach(() => {
  captured.length = 0;
  vi.stubEnv("VITE_MONDAY_API_TOKEN", "test-token");
  globalThis.fetch = (async () => ({ ok: true, json: async () => ({ data: {} }) })) as never;
});

/** Every required Patient field, blank — the overlay turns on what each case needs. */
const blank = {
  id: "1", name: "", dob: "", phone: "", email: "", address: "", gender: "", primaryInsurance: "",
  primaryInsuranceIndex: null, primaryInsuranceEdited: null, primaryInsuranceIndexEdited: null,
  memberId1: "", memberId1Edited: null, secondaryInsurance: "", memberId2: "", serving: "",
  servingIndex: null, servingEdited: null, servingIndexEdited: null, pumpType: "",
  pumpTypeIndex: null, cgmType: "", cgmTypeIndex: null, requestType: "", doctorName: "",
  doctorNpi: "", referralSource: "", referralReceivedDate: "", diagnosis: "", notes: "",
  secondaryInsuranceIndex: null, secondaryInsuranceEdited: null, memberId2Edited: null,
  monitorQty: "", pumpQty: "", qtyInf1: "", infusionSet1: "", infusionSet1Index: null,
  qtyInf2: "", infusionSet2: "", infusionSet2Index: null, qtyCartridge: "",
  medicarePriorPumpDate: "", monitorPurchaseDate: "", subscriptionType: "",
  subscriptionTypeIndex: null, welcomeCallText: "", welcomeCallTextIndex: null,
  orderHandling: "", orderHandlingIndex: null, callAttempts: "", followUp: "", followUpDate: "",
  cgmAuthResult: "", sensorsAuthResult: "", ipAuthResult: "", infusionSetAuthResult: "",
  cartridgeAuthResult: "", cgmAuthStart: "", cgmAuthEnd: "", sensorsAuthStart: "",
  sensorsAuthEnd: "", ipAuthStart: "", ipAuthEnd: "", infusionSetAuthStart: "",
  infusionSetAuthEnd: "", cartridgeAuthStart: "", cartridgeAuthEnd: "", pos: "", deductible: "",
  deductibleRemaining: "", oopMax: "", oopMaxRemaining: "", stediCoinsurance: "", stediQmb: "",
  cgmLastBillDate: "", sensorsLastBillDate: "", ipLastBillDate: "", infusionSetLastBillDate: "",
  cartridgeLastBillDate: "", ipNextOrderDate: "", sensorsNextOrderDate: "",
  suppliesNextOrderDate: "", ipNextOrderDateEdited: null, sensorsNextOrderDateEdited: null,
  suppliesNextOrderDateEdited: null, advanceDecision: "", advanceDecisionIndex: null,
  phoneEdited: null, addressEdited: null, addressLat: null, addressLng: null, escalated: false,
  receivedAt: "", lastUpdated: "", neverBilledIsCar: false, neverBilledCgm: false,
  sosNeverBilledMonitor: false, sosLastBillMonitor: "",
};

const taskFor = (label: string) => captured[0].tasks.find((t) => t.label === label);

describe("infusionSetWriteAction", () => {
  it("writes the index when the app has one", () => {
    expect(infusionSetWriteAction(4, "AutoSoft 90")).toBe("write");
  });

  it("clears when both the index and the label are empty — the rep emptied it", () => {
    expect(infusionSetWriteAction(null, "")).toBe("clear");
    expect(infusionSetWriteAction(null, "   ")).toBe("clear");
  });

  it("SKIPS an unmappable label — a read failure must not destroy a real set", () => {
    // The board holds a set whose `value` did not parse into an index. Clearing
    // here would delete a live selection on the strength of a bad read.
    expect(infusionSetWriteAction(null, "AutoSoft XC 6 mm")).toBe("skip");
  });
});

describe("Welcome Call send — an emptied set/quantity clears its column", () => {
  it("clears both sets and all three quantities when the UI emptied them", async () => {
    const { sendPatientToMonday } = await import("./mondayWrite");
    await sendPatientToMonday(blank as never);

    for (const label of ["Infusion Set 1", "Infusion Set 2"]) {
      const t = taskFor(label);
      expect(t, `${label} must be written, not skipped`).toBeDefined();
      expect(t!.value, `${label} clears with {}`).toEqual({});
    }
    for (const label of ["Infusion Set 1 Qty", "Infusion Set 2 Qty", "Qty Cartridge"]) {
      const t = taskFor(label);
      expect(t, `${label} must be written, not skipped`).toBeDefined();
      // ⚠️ "" and not "0" — 0 is a real quantity on this board, blank is "no set".
      expect(t!.value, `${label} clears with ""`).toBe("");
    }
  });

  it("still writes real values unchanged", async () => {
    const { sendPatientToMonday } = await import("./mondayWrite");
    await sendPatientToMonday({
      ...blank,
      infusionSet1: "AutoSoft 90", infusionSet1Index: 4, qtyInf1: "3",
      qtyCartridge: "3",
    } as never);
    expect(taskFor("Infusion Set 1")!.value).toEqual({ index: 4 });
    expect(taskFor("Infusion Set 1 Qty")!.value).toBe("3");
    expect(taskFor("Qty Cartridge")!.value).toBe("3");
  });

  it("leaves an unmappable board label alone rather than clearing it", async () => {
    const { sendPatientToMonday } = await import("./mondayWrite");
    await sendPatientToMonday({
      ...blank,
      infusionSet1: "AutoSoft XC 6 mm", infusionSet1Index: null,
    } as never);
    expect(taskFor("Infusion Set 1")).toBeUndefined();
  });
});
