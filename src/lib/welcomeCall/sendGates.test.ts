import { emptyIntake } from "./callIntake";
import { describe, it, expect } from "vitest";
import {
  unmetSendRequirements,
  needsPumpConfirmation,
  pumpConfirmLabel,
  pumpConfirmationStale,
  ADVANCE_INDEX,
  DONT_ADVANCE_INDEX,
} from "./sendGates";
import { emptyIntake } from "./callIntake";

const withConfirms = (over: Partial<Record<"pump" | "address", boolean>>) => {
  const i = emptyIntake();
  i.confirmed = { ...i.confirmed, ...over };
  return i;
};

const req = (o: Partial<Parameters<typeof unmetSendRequirements>[0]> = {}) =>
  unmetSendRequirements({
    advanceDecisionIndex: ADVANCE_INDEX,
    serving: "Insulin Pump + CGM",
    pumpType: "t:slim",
    intake: withConfirms({}),
    ...o,
  });

const keys = (r: ReturnType<typeof req>) => r.map((x) => x.key);

describe("⚠️ the gates apply to Advance only", () => {
  it("lists nothing on Don't Advance, however little was confirmed", () => {
    // A rep who could not reach the patient cannot have confirmed anything
    // with them. Gating the hold would strand the patient with no way to
    // record what happened (Brandon, 2026-09-09).
    expect(req({ advanceDecisionIndex: DONT_ADVANCE_INDEX })).toEqual([]);
  });

  it("lists nothing while the decision is still unmade", () => {
    // validatePatientForSend already blocks on "pick Advance or Don't
    // Advance"; listing confirmations underneath would ask a rep to tick boxes
    // before making the decision that decides whether they apply.
    expect(req({ advanceDecisionIndex: null })).toEqual([]);
  });

  it("lists both when advancing with nothing confirmed", () => {
    expect(keys(req())).toEqual(["pump-confirmed", "address-confirmed"]);
  });

  it("clears each requirement as it is ticked", () => {
    expect(keys(req({ intake: withConfirms({ pump: true }) }))).toEqual(["address-confirmed"]);
    expect(keys(req({ intake: withConfirms({ address: true }) }))).toEqual(["pump-confirmed"]);
    expect(req({ intake: withConfirms({ pump: true, address: true }) })).toEqual([]);
  });
});

describe("⚠️ the pump gate is scoped to selling a pump DEVICE", () => {
  it("does not apply to a supplies-only patient who already owns their pump", () => {
    // servingIncludesPump is TRUE for "Supplies Only" — conflating the two is
    // CLAUDE.md §5.22's $3,787 pump. This must key on servingSellsPumpDevice.
    for (const serving of ["Supplies Only", "Supplies + CGM", "CGM"]) {
      expect(needsPumpConfirmation(serving), serving).toBe(false);
      expect(keys(req({ serving }))).toEqual(["address-confirmed"]);
    }
  });

  it("applies to the two servings that sell a pump", () => {
    for (const serving of ["Insulin Pump", "Insulin Pump + CGM"]) {
      expect(needsPumpConfirmation(serving), serving).toBe(true);
    }
  });

  it("does not apply when Serving is blank", () => {
    // Brandon: "Hide it and don't require it when Insulin Pump isn't in
    // Serving." A blank serving does not name a pump, so the gate is off.
    // ⚠️ This also keeps the gate and the Pump section in step: requiring a
    // tick that lives in a section the rep cannot see would block the send
    // with no way to satisfy it.
    expect(needsPumpConfirmation("")).toBe(false);
  });

  it("address confirmation is required regardless of serving", () => {
    for (const serving of ["CGM", "Supplies Only", "Insulin Pump", ""]) {
      expect(keys(req({ serving }))).toContain("address-confirmed");
    }
  });
});

describe("the label names the model", () => {
  it("puts the pump in the checkbox text", () => {
    expect(pumpConfirmLabel("t:slim")).toBe(
      "Pump type confirmed verbally with the patient (t:slim)",
    );
  });

  it("drops the parenthetical when no pump is set yet", () => {
    expect(pumpConfirmLabel("")).toBe("Pump type confirmed verbally with the patient");
  });

  it("names the model in the blocker sentence too", () => {
    expect(req()[0].label).toContain("t:slim");
  });
});

describe("⚠️ a pump change invalidates an existing confirmation", () => {
  const stale = (confirmedModel: string, pumpType: string, confirmed = true) =>
    pumpConfirmationStale({ confirmed, confirmedModel, pumpType });

  it("goes stale when the model changes under a tick", () => {
    // The rep said "t:slim" out loud. Left checked after a change to Mobi, the
    // audit line would claim a conversation that never happened about the pump
    // now on order.
    expect(stale("t:slim", "Mobi")).toBe(true);
  });

  it("is not stale while the model is unchanged", () => {
    expect(stale("t:slim", "t:slim")).toBe(false);
  });

  it("is not stale when the box was never ticked", () => {
    expect(stale("", "t:slim", false)).toBe(false);
    expect(stale("t:slim", "Mobi", false)).toBe(false);
  });

  it("goes stale when the pump is cleared entirely", () => {
    expect(stale("t:slim", "")).toBe(true);
  });

  it("⚠️ treats a tick with NO recorded model as stale", () => {
    // Blocks written before pumpConfirmedModel existed. The confirmation was
    // real, but we cannot say which pump it was about, and assuming it still
    // holds is exactly the failure this guards. Re-asking costs one question.
    expect(stale("", "t:slim")).toBe(true);
  });
});

describe("an incomplete secondary blocks Advance", () => {
  const base = {
    advanceDecisionIndex: 1,
    serving: "CGM",
    pumpType: "",
    intake: { ...emptyIntake(), confirmed: { ...emptyIntake().confirmed, address: true } },
  };

  /* Brandon called the Member ID 2 / CIN / Insurance Notes rules "required",
     and carved out ONLY Unknown from gating. Shown as amber text alone, a rep
     could pick NY Medicaid, type nothing and advance — handing the payer and
     DVS work downstream an incomplete policy (Greptile, PR #56). */
  it("surfaces what the secondary question still needs", () => {
    const out = unmetSendRequirements({ ...base, secondaryMissing: ["Needs a CIN."] });
    expect(out.map((r) => r.label)).toContain("Needs a CIN.");
    expect(out.every((r) => r.key !== "address-confirmed")).toBe(true);
  });

  it("asks nothing when the answer is complete", () => {
    expect(unmetSendRequirements({ ...base, secondaryMissing: [] })).toEqual([]);
    expect(unmetSendRequirements(base)).toEqual([]);
  });

  /* ⚠️ Still Advance-only. A rep who couldn't reach the patient and is holding
     cannot have collected a CIN either. */
  it("never blocks Don't Advance", () => {
    expect(
      unmetSendRequirements({ ...base, advanceDecisionIndex: 2, secondaryMissing: ["Needs a CIN."] }),
    ).toEqual([]);
  });
});
