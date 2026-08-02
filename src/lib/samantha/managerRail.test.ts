/**
 * Manager-view rail narrowing (2026-07-30).
 *
 * Clicking a bar in Pipeline Oversight used to land on a role page whose
 * sidebar listed every patient at that stage — a manager who clicked a bar of
 * 4 got a list of 17 and couldn't walk the cohort they were looking at. These
 * predicates re-express each bar's rule against the samantha Patient model so
 * the page can narrow locally.
 *
 * They MIRROR CHART_FILTERS + reasonBuckets in lib/oversight/oversightApi,
 * which read the same board facts through the OversightPatient model. The two
 * must move together; these tests pin the behaviour of this side.
 */
import { describe, it, expect } from "vitest";
import { railFilterFor, applyRail } from "./managerRail";
import { EMPTY_INSURANCE, type Patient } from "./workflow";

function patient(over: Partial<Patient> = {}): Patient {
  return {
    id: "1",
    name: "Test Patient",
    notes: "",
    insurance: structuredClone(EMPTY_INSURANCE),
    ...over,
  } as Patient;
}

const withUniversal = (u: Record<string, string>, over: Partial<Patient> = {}) =>
  patient({
    insurance: { ...structuredClone(EMPTY_INSURANCE), universal: { ...u } },
    ...over,
  } as Partial<Patient>);

describe("railFilterFor — when to narrow at all", () => {
  it("returns null for an ordinary visit, so a rep's sidebar is never narrowed", () => {
    expect(railFilterFor(null, null)).toBeNull();
    expect(railFilterFor(null, "Inactive insurance")).toBeNull();
  });

  it("returns null for an unknown chart — a stale bookmark must not blank the list", () => {
    expect(railFilterFor("some-old-chart-id", null)).toBeNull();
  });

  it("falls back to the whole chart when the bucket is unrecognised", () => {
    const f = railFilterFor("benefits-manager-escalation", "Renamed Bar");
    expect(f).not.toBeNull();
    // Whole-chart predicate = union of the bars, so an inactive patient matches.
    expect(f!(withUniversal({ active: "not-confirmed" }))).toBe(true);
  });
});

describe("Benefits · Manager Intervention bars", () => {
  const bar = (b: string) => railFilterFor("benefits-manager-escalation", b)!;

  it("Inactive insurance matches only a negative Active answer", () => {
    expect(bar("Inactive insurance")(withUniversal({ active: "not-confirmed" }))).toBe(true);
    expect(bar("Inactive insurance")(withUniversal({ active: "confirmed" }))).toBe(false);
    expect(bar("Inactive insurance")(patient())).toBe(false);
  });

  it("Pump SoS matches an insulin pump flagged not-clear, not other products", () => {
    const pump = patient({
      insurance: { ...structuredClone(EMPTY_INSURANCE), codes: { pump: { status: "pending", sos: "not-clear" } } },
    } as Partial<Patient>);
    const sensors = patient({
      insurance: { ...structuredClone(EMPTY_INSURANCE), codes: { "cgm-sensors": { status: "pending", sos: "not-clear" } } },
    } as Partial<Patient>);
    expect(bar("Pump SoS")(pump)).toBe(true);
    expect(bar("Pump SoS")(sensors)).toBe(false);
  });

  it("Check outstanding >5d needs BOTH the manager label and an overdue day bucket", () => {
    const mk = (label: string | undefined, idx: number | undefined) =>
      patient({ escalationLabel: label, daysSinceStageIndex: idx });
    for (const idx of [2, 3, 4, 6, 7, 8]) {
      expect(bar("Check outstanding >5d")(mk("Manager Escalation Required", idx))).toBe(true);
    }
    // Fresh days, or no label, or the Final label → not this bar.
    expect(bar("Check outstanding >5d")(mk("Manager Escalation Required", 0))).toBe(false);
    expect(bar("Check outstanding >5d")(mk("Manager Escalation Required", 1))).toBe(false);
    expect(bar("Check outstanding >5d")(mk(undefined, 3))).toBe(false);
    expect(bar("Check outstanding >5d")(mk("Final Escalation Required", 3))).toBe(false);
  });

  it("the whole-chart filter is the union of the three bars", () => {
    const all = railFilterFor("benefits-manager-escalation", null)!;
    expect(all(withUniversal({ active: "not-confirmed" }))).toBe(true);
    expect(all(patient({ escalationLabel: "Manager Escalation Required", daysSinceStageIndex: 6 }))).toBe(true);
    expect(all(patient())).toBe(false);
  });
});

describe("Benefits · Final Decisions bars", () => {
  const bar = (b: string) => railFilterFor("benefits-final-escalation", b)!;

  it("Propose Stuck keys on the stamped note, not the escalation label", () => {
    const stamped = patient({ notes: "call log\n\n[Proposed Stuck · 2026-07-30 · JR] payer unresponsive" });
    expect(bar("Propose Stuck")(stamped)).toBe(true);
    expect(bar("Propose Stuck")(patient({ notes: "just an ordinary note" }))).toBe(false);
  });

  it("Universal Check covers out-of-network, Medicare not primary, and no DME", () => {
    expect(bar("Universal Check")(withUniversal({ "in-network": "not-confirmed" }))).toBe(true);
    expect(bar("Universal Check")(withUniversal({ "in-network": "medicare-not-primary" }))).toBe(true);
    expect(bar("Universal Check")(withUniversal({ "dme-benefits": "not-confirmed" }))).toBe(true);
    // Inactive is NOT a Universal Check reason — it escalates to the manager
    // column instead, so it must not pull a patient into this bar.
    expect(bar("Universal Check")(withUniversal({ active: "not-confirmed" }))).toBe(false);
  });

  it("the whole-chart filter is the escalation label, so a no-bar patient is still listed", () => {
    const all = railFilterFor("benefits-final-escalation", null)!;
    // Matches neither bar (the "+N in no bar" case) but belongs to the chart.
    expect(all(patient({ escalationLabel: "Final Escalation Required" }))).toBe(true);
    expect(all(patient({ escalationLabel: "Manager Escalation Required" }))).toBe(false);
  });
});

describe("Submit Auth · Manager Intervention bars", () => {
  const bar = (b: string) => railFilterFor("submit-auth-manager", b)!;

  it("DVS Retry matches either trigger column parked in the queue", () => {
    expect(bar("DVS Retry")(patient({ dvsStatus: "Retry Queued" }))).toBe(true);
    expect(bar("DVS Retry")(patient({ pumpDvsStatus: "Retry Queued" }))).toBe(true);
    expect(bar("DVS Retry")(patient({ dvsStatus: "Running" }))).toBe(false);
  });

  it("DVS Manual Review matches the failed-ish statuses and claims failures", () => {
    expect(bar("DVS Manual Review")(patient({ dvsStatus: "Manual Review" }))).toBe(true);
    expect(bar("DVS Manual Review")(patient({ pumpDvsStatus: "Denied" }))).toBe(true);
    expect(bar("DVS Manual Review")(patient({ claimsStatus: "Claims Denied" }))).toBe(true);
    expect(bar("DVS Manual Review")(patient({ dvsStatus: "Success" }))).toBe(false);
  });

  it("an escalation label alone is NOT manual review — DVS classifies on status first", () => {
    expect(bar("DVS Manual Review")(patient({ escalationLabel: "Manager Escalation Required" }))).toBe(false);
  });

  // 2026-08-02: manual review now auto-raises Manager Escalation Required, and
  // a manager can promote to Final. Janelle's bars must drop the promoted half
  // or a patient she has already handed up stays in her chart forever.
  it("drops a patient once they have been promoted to Final", () => {
    const promoted = { escalationLabel: "Final Escalation Required" };
    expect(bar("DVS Manual Review")(patient({ dvsStatus: "Manual Review", ...promoted }))).toBe(false);
    expect(bar("DVS Retry")(patient({ dvsStatus: "Retry Queued", ...promoted }))).toBe(false);
    // …and keeps them while they are still only at Manager.
    expect(bar("DVS Manual Review")(patient({ dvsStatus: "Manual Review", escalationLabel: "Manager Escalation Required" }))).toBe(true);
  });
});

describe("Submit Auth · Final Decisions bars", () => {
  const bar = (b: string) => railFilterFor("submit-auth-final-escalation", b)!;
  const FINAL = "Final Escalation Required";

  it("mirrors the Manager Intervention bars, one rung up", () => {
    expect(bar("DVS Manual Review")(patient({ dvsStatus: "Manual Review", escalationLabel: FINAL }))).toBe(true);
    expect(bar("DVS Retry")(patient({ dvsStatus: "Retry Queued", escalationLabel: FINAL }))).toBe(true);
    expect(
      bar("Propose Stuck")(patient({ escalationLabel: FINAL, notes: "[Proposed Stuck · 2026-08-02 · JR] payer will not budge" })),
    ).toBe(true);
  });

  it("excludes the not-yet-promoted half that still belongs to Janelle", () => {
    const atManager = { escalationLabel: "Manager Escalation Required" };
    expect(bar("DVS Manual Review")(patient({ dvsStatus: "Manual Review", ...atManager }))).toBe(false);
    expect(bar("DVS Retry")(patient({ dvsStatus: "Retry Queued", ...atManager }))).toBe(false);
  });

  it("is the union of its bars — this chart has no stage rule of its own", () => {
    // Two of the three bars are stage-DVS patients, so a chart-level "Submit
    // Auth." rule would filter them out (see CHART_FILTERS).
    const whole = railFilterFor("submit-auth-final-escalation", null)!;
    expect(whole(patient({ dvsStatus: "Manual Review", escalationLabel: FINAL }))).toBe(true);
    expect(whole(patient({ escalationLabel: FINAL }))).toBe(false);
  });
});

describe("Auth Outstanding · Final Decisions bar", () => {
  const FINAL = "Final Escalation Required";

  it("Propose Stuck keys on the stamp", () => {
    const bar = railFilterFor("auth-outstanding-final-escalation", "Propose Stuck")!;
    expect(bar(patient({ escalationLabel: FINAL, notes: "[Proposed Stuck · 2026-08-02 · JR] no auth after 30d" }))).toBe(true);
    expect(bar(patient({ escalationLabel: FINAL }))).toBe(false);
  });

  it("still lists a Final patient with no stamp — the bucket only subdivides", () => {
    const whole = railFilterFor("auth-outstanding-final-escalation", null)!;
    expect(whole(patient({ escalationLabel: FINAL }))).toBe(true);
    expect(whole(patient({ escalationLabel: "Manager Escalation Required" }))).toBe(false);
  });
});

describe("Submit Auth · Manager Intervention · Propose Stuck bar", () => {
  const bar = (b: string) => railFilterFor("submit-auth-manager", b)!;

  it("needs the manager label AND the stamp", () => {
    const proposed = patient({
      escalationLabel: "Manager Escalation Required",
      notes: "[Proposed Stuck · 2026-07-30 · BE] portal rejects the NPI",
    });
    expect(bar("Propose Stuck")(proposed)).toBe(true);
    // A manually-escalated patient with no proposal stays out.
    expect(bar("Propose Stuck")(patient({ escalationLabel: "Manager Escalation Required" }))).toBe(false);
  });
});

describe("applyRail", () => {
  const inactive = withUniversal({ active: "not-confirmed" }, { id: "a" });
  const clean = patient({ id: "b" });
  const list = [inactive, clean];

  it("passes the list through untouched when there is no filter", () => {
    expect(applyRail(list, null, null)).toHaveLength(2);
  });

  it("narrows to the bar", () => {
    const f = railFilterFor("benefits-manager-escalation", "Inactive insurance");
    expect(applyRail(list, f, null).map((p) => p.id)).toEqual(["a"]);
  });

  it("always keeps the deep-linked patient, even when they no longer match", () => {
    // The manager clicked that row; opening a page without it on screen is
    // worse than one extra row (state can change between fetch and load).
    const f = railFilterFor("benefits-manager-escalation", "Inactive insurance");
    expect(applyRail(list, f, "b").map((p) => p.id)).toEqual(["a", "b"]);
  });
});
