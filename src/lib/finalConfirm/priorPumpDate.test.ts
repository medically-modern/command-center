import { describe, it, expect } from "vitest";
import { needsPriorPumpDate as finalConfirmRule } from "./workflow";
import { needsPriorPumpDate as welcomeCallRule } from "../welcomeCall/workflow";

/**
 * Prior Pump Purchase Date is only collected when Medicare may bill pump
 * supplies against a patient-owned pump: Original Medicare + Pump Qty 0 +
 * serving includes pump/supplies. A CGM-only patient must never be asked for
 * it (Final Profile Confirmation bug, 2026-07: Medicare A&B · CGM-only
 * patients were prompted for a pump date).
 *
 * The rule lives in BOTH the Welcome Call and Final Confirm modules (per-role
 * convention) — this file keeps the two in agreement.
 */
const RULES = [
  ["finalConfirm", finalConfirmRule],
  ["welcomeCall", welcomeCallRule],
] as const;

const PUMP_SUPPLIES_SERVINGS = ["Insulin Pump", "Supplies Only", "Supplies + CGM", "Insulin Pump + CGM"];

describe("needsPriorPumpDate", () => {
  it("never asks a CGM-only patient, even on Original Medicare", () => {
    for (const [name, rule] of RULES) {
      expect(rule("Medicare A&B", "0", "CGM"), name).toBe(false);
    }
  });

  it("asks Original Medicare + Pump Qty 0 for every pump-supplies serving", () => {
    for (const [name, rule] of RULES) {
      for (const serving of PUMP_SUPPLIES_SERVINGS) {
        expect(rule("Medicare A&B", "0", serving), `${name}: ${serving}`).toBe(true);
      }
    }
  });

  it("does not ask when a pump is being sold (Pump Qty 1)", () => {
    for (const [name, rule] of RULES) {
      expect(rule("Medicare A&B", "1", "Insulin Pump + CGM"), name).toBe(false);
    }
  });

  it("does not ask non-Original-Medicare patients (Advantage plans included)", () => {
    for (const [name, rule] of RULES) {
      expect(rule("United Medicare", "0", "Supplies Only"), name).toBe(false);
      expect(rule("Aetna Commercial", "0", "Supplies Only"), name).toBe(false);
      expect(rule("Medicaid", "0", "Supplies Only"), name).toBe(false);
    }
  });

  it("trusts unknown (blank) serving as pump-served so a missing column can't wipe a collected date", () => {
    for (const [name, rule] of RULES) {
      expect(rule("Medicare A&B", "0", ""), name).toBe(true);
      expect(rule("Medicare A&B", "0", "  "), name).toBe(true);
    }
  });

  it("the two role modules agree across the full matrix", () => {
    const insurances = ["Medicare A&B", "United Medicare", "Aetna Commercial", ""];
    const qtys = ["0", "1", ""];
    const servings = ["", "CGM", ...PUMP_SUPPLIES_SERVINGS];
    for (const ins of insurances) {
      for (const qty of qtys) {
        for (const serving of servings) {
          expect(finalConfirmRule(ins, qty, serving), `${ins} / qty ${qty} / ${serving}`).toBe(
            welcomeCallRule(ins, qty, serving),
          );
        }
      }
    }
  });
});
