// Domain rules for the redesigned Auth Outstanding tab — tracked cards,
// derived SoS recheck, Auth Review Complete gating, daily-bucket snooze.
import { describe, expect, it } from "vitest";
import {
  authOutstandingOutcome,
  derivedRecheckSos,
  effectiveResult,
  isSnoozedAuthOutstanding,
  nextOrderPreviewYmd,
  recheckComplete,
  trackedCards,
  validateAuthReviewForComplete,
} from "./authOutstandingReview";
import type { Patient, ProductCodeId, ProductCodeState } from "./workflow";

const TODAY = "2026-07-21";

function patient(
  codes: Partial<Record<ProductCodeId, Partial<ProductCodeState>>>,
  over: Partial<Patient> = {},
): Patient {
  const full: Record<string, ProductCodeState> = {};
  for (const [cid, st] of Object.entries(codes)) {
    full[cid] = { status: "pending", ...st } as ProductCodeState;
  }
  return {
    id: "1",
    name: "Test",
    primaryInsurance: "Horizon BCBS",
    serving: "Insulin Pump + CGM",
    secondaryInsurance: "None",
    insurance: { universal: { "in-network": "", active: "", "dme-benefits": "" }, codes: full },
    ...over,
  } as Patient;
}

describe("trackedCards", () => {
  it("tracks Submitted products only, not resolved or Required ones", () => {
    const p = patient({
      pump: { _mondayAuthLabel: "Submitted" },
      "cgm-sensors": { _mondayAuthLabel: "Auth Valid" },
      "cgm-monitor": { _mondayAuthLabel: "No Auth Needed" },
      "infusion-sets": { _mondayAuthLabel: "Required" },
      cartridges: { _mondayAuthLabel: "Not Serving" },
    });
    expect(trackedCards(p).map((r) => r.product)).toEqual(["insulin_pump"]);
  });

  it("keeps a partial-saved No Auth Needed card open while SoS is still deferred (skip)", () => {
    const p = patient({
      pump: { _mondayAuthLabel: "No Auth Needed", sos: "skip" },
      "cgm-sensors": { _mondayAuthLabel: "Submitted" },
    });
    expect(trackedCards(p).map((r) => r.product)).toEqual(["sensors", "insulin_pump"]);
  });

  it("drops the No Auth Needed card once the recheck resolved (sos no longer skip)", () => {
    const p = patient({
      pump: { _mondayAuthLabel: "No Auth Needed", sos: "clear" },
    });
    expect(trackedCards(p)).toEqual([]);
  });

  it("never tracks DVS-routed supplies", () => {
    const p = patient(
      {
        pump: { _mondayAuthLabel: "Submitted" },
        "infusion-sets": { _mondayAuthLabel: "Submitted" },
        cartridges: { _mondayAuthLabel: "Submitted" },
      },
      { primaryInsurance: "Fidelis Medicaid", secondaryInsurance: "NY Medicaid", serving: "Insulin Pump" },
    );
    expect(trackedCards(p).map((r) => r.product)).toEqual(["insulin_pump"]);
  });
});

describe("effectiveResult", () => {
  it("local result wins; NAN board label fills in for hydrated partial saves", () => {
    expect(effectiveResult({ status: "pending", authOutstandingResult: "denied" } as ProductCodeState)).toBe("denied");
    expect(effectiveResult({ status: "pending", _mondayAuthLabel: "No Auth Needed" } as ProductCodeState)).toBe("no-auth-needed");
    expect(effectiveResult({ status: "pending", _mondayAuthLabel: "Submitted" } as ProductCodeState)).toBe("");
    expect(effectiveResult(undefined)).toBe("");
  });
});

describe("recheckComplete + derivedRecheckSos", () => {
  it("never-billed completes and derives clear", () => {
    const st = { status: "pending", sosEntry: "never" } as ProductCodeState;
    expect(recheckComplete(st)).toBe(true);
    expect(derivedRecheckSos(st, "cgm-sensors", false, TODAY)).toBe("clear");
  });

  it("billed needs date + valid units; derives by strict cutoff", () => {
    const incomplete = { status: "pending", sosEntry: "billed", lastBillDate: "2026-05-01" } as ProductCodeState;
    expect(recheckComplete(incomplete)).toBe(false);

    // 90-day lookback: cutoff = 2026-04-22. A bill before it is clear.
    const clear = { ...incomplete, units: "12", lastBillDate: "2026-04-21" } as ProductCodeState;
    expect(recheckComplete(clear)).toBe(true);
    expect(derivedRecheckSos(clear, "cgm-sensors", false, TODAY)).toBe("clear");

    // Exactly on the cutoff is NOT clear (strict <).
    const onCutoff = { ...clear, lastBillDate: "2026-04-22" } as ProductCodeState;
    expect(derivedRecheckSos(onCutoff, "cgm-sensors", false, TODAY)).toBe("not-clear");
  });

  it("uses the 60-day lookback for supplies when the patient has Medicaid", () => {
    // 60-day cutoff = 2026-05-22; a 2026-05-01 bill clears with Medicaid but
    // not without (90-day cutoff = 2026-04-22).
    const st = { status: "pending", sosEntry: "billed", lastBillDate: "2026-05-01", units: "30" } as ProductCodeState;
    expect(derivedRecheckSos(st, "infusion-sets", true, TODAY)).toBe("clear");
    expect(derivedRecheckSos(st, "infusion-sets", false, TODAY)).toBe("not-clear");
  });

  it("pump/monitor use the 4-year lookback", () => {
    const recent = { status: "pending", sosEntry: "billed", lastBillDate: "2024-01-01", units: "1" } as ProductCodeState;
    expect(derivedRecheckSos(recent, "pump", false, TODAY)).toBe("not-clear");
    const old = { ...recent, lastBillDate: "2022-01-01" } as ProductCodeState;
    expect(derivedRecheckSos(old, "pump", false, TODAY)).toBe("clear");
  });

  it("auth=required does NOT auto-complete the recheck (unlike Benefits)", () => {
    const st = { status: "pending", auth: "required" } as ProductCodeState;
    expect(recheckComplete(st)).toBe(false);
    expect(derivedRecheckSos(st, "pump", false, TODAY)).toBe("");
  });
});

describe("nextOrderPreviewYmd", () => {
  it("pump +4yr (non-Medicare) / +5yr (Medicare), sensors by units, supplies 90/60, monitor none", () => {
    expect(nextOrderPreviewYmd("pump", "2026-01-01", false)).toBe("2029-12-31");
    // Medicare A&B primary → pump RUL is 5 years (1825 days).
    expect(nextOrderPreviewYmd("pump", "2026-01-01", false, undefined, true)).toBe("2030-12-31");
    expect(nextOrderPreviewYmd("cgm-sensors", "2026-07-01", false, "1")).toBe("2026-07-31");
    expect(nextOrderPreviewYmd("cgm-sensors", "2026-07-01", false, "3")).toBe("2026-09-29");
    expect(nextOrderPreviewYmd("infusion-sets", "2026-07-01", true)).toBe("2026-08-30");
    expect(nextOrderPreviewYmd("cgm-monitor", "2026-07-01", false)).toBe("");
    expect(nextOrderPreviewYmd("pump", "", false)).toBe("");
  });
});

describe("validateAuthReviewForComplete", () => {
  it("demands a result on every tracked card", () => {
    const p = patient({ pump: { _mondayAuthLabel: "Submitted" } }, { serving: "Insulin Pump" });
    expect(validateAuthReviewForComplete(p)).toEqual(["E0784 · Auth Result"]);
  });

  it("Auth Valid needs ID + Start + End + valid Units", () => {
    const p = patient(
      {
        pump: {
          _mondayAuthLabel: "Submitted",
          authOutstandingResult: "auth-valid",
          authId: "A1",
          authStart: "2026-07-01",
          authUnits: "0",
        },
      },
      { serving: "Insulin Pump" },
    );
    expect(validateAuthReviewForComplete(p)).toEqual(["E0784 · Auth End", "E0784 · Units"]);
  });

  it("No Auth Needed needs a complete recheck; Denied needs nothing", () => {
    const p = patient(
      {
        pump: { _mondayAuthLabel: "Submitted", authOutstandingResult: "no-auth-needed" },
        "cgm-sensors": { _mondayAuthLabel: "Submitted", authOutstandingResult: "denied" },
        "cgm-monitor": { _mondayAuthLabel: "No Auth Needed", sos: "clear" },
      },
    );
    expect(validateAuthReviewForComplete(p)).toEqual([
      "E0784 · SoS recheck (Last Bill Date + Units, or No Billing History)",
    ]);
  });

  it("a hydrated partial-save (NAN label + skip) validates via its recheck", () => {
    const pending = patient({ pump: { _mondayAuthLabel: "No Auth Needed", sos: "skip" } }, { serving: "Insulin Pump" });
    expect(validateAuthReviewForComplete(pending)).toEqual([
      "E0784 · SoS recheck (Last Bill Date + Units, or No Billing History)",
    ]);
    const done = patient(
      { pump: { _mondayAuthLabel: "No Auth Needed", sos: "skip", sosEntry: "never" } },
      { serving: "Insulin Pump" },
    );
    expect(validateAuthReviewForComplete(done)).toEqual([]);
  });

  it("flags never-submitted (Required) products instead of silently un-gating", () => {
    const p = patient({ pump: { _mondayAuthLabel: "Required" } }, { serving: "Insulin Pump" });
    expect(validateAuthReviewForComplete(p)).toEqual(["E0784 · Not submitted yet (Submit Auth)"]);
  });

  it("DVS-routed products never gate", () => {
    const p = patient(
      {
        pump: { _mondayAuthLabel: "Submitted", authOutstandingResult: "denied" },
        "infusion-sets": { _mondayAuthLabel: "Required" },
        cartridges: { _mondayAuthLabel: "Required" },
      },
      { primaryInsurance: "Fidelis Medicaid", secondaryInsurance: "NY Medicaid", serving: "Insulin Pump" },
    );
    expect(validateAuthReviewForComplete(p)).toEqual([]);
  });
});

describe("isSnoozedAuthOutstanding (daily bucket §12)", () => {
  const p = (over: Partial<Patient>) => ({ id: "1", name: "t", ...over }) as Patient;
  it("date-only: future date snoozes, today/past/blank are due, status ignored", () => {
    expect(isSnoozedAuthOutstanding(p({ followUpDate: "2026-07-22" }), TODAY)).toBe(true);
    expect(isSnoozedAuthOutstanding(p({ followUpDate: "2026-07-21" }), TODAY)).toBe(false);
    expect(isSnoozedAuthOutstanding(p({ followUpDate: "2026-07-19" }), TODAY)).toBe(false);
    expect(isSnoozedAuthOutstanding(p({}), TODAY)).toBe(false);
    // Follow Up STATUS alone (dateless) does NOT snooze on this stage.
    expect(isSnoozedAuthOutstanding(p({ followUp: "Follow Up" }), TODAY)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Send outcome — the priority order (PR #22 review, 2026-08-02)
// ─────────────────────────────────────────────────────────────────────

describe("authOutstandingOutcome", () => {
  const facts = (over: Partial<Parameters<typeof authOutstandingOutcome>[0]> = {}) => ({
    anyDenied: false,
    pumpSosNotClear: false,
    allResolved: false,
    allDvsRouted: false,
    hasDvsRouted: false,
    ...over,
  });

  it("advances a fully resolved patient to Complete", () => {
    expect(authOutstandingOutcome(facts({ allResolved: true }))).toEqual({
      stage: "complete",
      escalate: null,
    });
  });

  it("sends a resolved patient with DVS-routed supplies to DVS instead", () => {
    expect(authOutstandingOutcome(facts({ allResolved: true, hasDvsRouted: true }))).toEqual({
      stage: "dvs",
      escalate: null,
    });
  });

  // THE REGRESSION THIS GUARDS. A completed not-clear pump recheck counts as
  // RESOLVED, so without the pump rung outranking `allResolved` the send would
  // advance the patient to Complete — firing the Welcome Call create-item
  // automation — while only flagging a manager.
  it("HOLDS the stage when the pump SoS came back Not Clear, even if all resolved", () => {
    expect(authOutstandingOutcome(facts({ allResolved: true, pumpSosNotClear: true }))).toEqual({
      stage: null,
      // FINAL, not manager: the hold keeps the patient at Auth Outstanding, and
      // that stage's only manager rung is Final Decisions (Josh, 2026-08-03).
      escalate: "final",
    });
  });

  it("holds it for a DVS-routed patient too, rather than exiting to DVS", () => {
    expect(
      authOutstandingOutcome(facts({ allResolved: true, hasDvsRouted: true, pumpSosNotClear: true })),
    ).toEqual({ stage: null, escalate: "final" });
    expect(
      authOutstandingOutcome(facts({ allDvsRouted: true, pumpSosNotClear: true })),
    ).toEqual({ stage: null, escalate: "final" });
  });

  it("lets a denial outrank the pump blocker — Auth Denied has its own queue", () => {
    expect(
      authOutstandingOutcome(facts({ anyDenied: true, pumpSosNotClear: true, allResolved: true })),
      // Manager, not Final: the patient LEAVES this stage for Auth Denied, which
      // is under construction and has no charts at either rung — so writing
      // Final would pre-judge a stage nobody has designed yet.
    ).toEqual({ stage: "authDenied", escalate: "manager" });
  });

  it("routes an all-DVS patient to DVS", () => {
    expect(authOutstandingOutcome(facts({ allDvsRouted: true }))).toEqual({
      stage: "dvs",
      escalate: null,
    });
  });

  it("writes no stage at all for a partial save", () => {
    expect(authOutstandingOutcome(facts())).toEqual({ stage: null, escalate: null });
  });
});
