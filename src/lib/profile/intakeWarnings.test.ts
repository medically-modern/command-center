import { describe, expect, it } from "vitest";
import {
  BLOCK_HINT, FALLBACK_CONFIRM_LABEL, ackNoteLine, cardWarnings, parseAcks,
  parseIntakeWarnings, requiresReason, warningConditions, withAck,
} from "./intakeWarnings";
import { evaluateUnlock } from "./intakeUnlock";
import type { Patient } from "./workflow";

/* The shapes stedi-monday-integration writes (commit 02f5d81, 2026-09-24):
   one warning per line, KEY|TYPE|message. The messages below are placeholders
   — the backend owns the real wording and this module never reads it. */
const MCO = "MEDICAID_MCO_OON|BLOCK|The Medicaid plan on file is an MCO we are not contracted with.";
const PUMP = "MEDICARE_PUMP_MEDICAID_ID|CONFIRM:Has NY Medicaid ID|Original Medicare pump: confirm the patient has a NY Medicaid ID.";
const MGMT = "UHC_AETNA_PUMP_MGMT|CONFIRM:Management approved|UHC/Aetna pump: needs management approval.";

describe("parseIntakeWarnings", () => {
  it("reads one warning per line, BLOCK and CONFIRM", () => {
    const w = parseIntakeWarnings([MCO, PUMP, MGMT].join("\n"));
    expect(w).toEqual([
      { key: "MEDICAID_MCO_OON", type: "block", label: "", message: "The Medicaid plan on file is an MCO we are not contracted with." },
      { key: "MEDICARE_PUMP_MEDICAID_ID", type: "confirm", label: "Has NY Medicaid ID", message: "Original Medicare pump: confirm the patient has a NY Medicaid ID." },
      { key: "UHC_AETNA_PUMP_MGMT", type: "confirm", label: "Management approved", message: "UHC/Aetna pump: needs management approval." },
    ]);
  });

  it("blank, whitespace and empty lines are no warnings", () => {
    expect(parseIntakeWarnings("")).toEqual([]);
    expect(parseIntakeWarnings(null)).toEqual([]);
    expect(parseIntakeWarnings(undefined)).toEqual([]);
    expect(parseIntakeWarnings("  \n\n \r\n")).toEqual([]);
  });

  it("takes CRLF and stray spaces", () => {
    const w = parseIntakeWarnings(` ${MCO} \r\n  ${PUMP}\r\n`);
    expect(w.map((x) => x.key)).toEqual(["MEDICAID_MCO_OON", "MEDICARE_PUMP_MEDICAID_ID"]);
  });

  it("keeps a | inside the message", () => {
    const w = parseIntakeWarnings("K|BLOCK|Medicaid ID on file | ZZ00000Z (not D-SNP)");
    expect(w[0].message).toBe("Medicaid ID on file | ZZ00000Z (not D-SNP)");
  });

  it("extracts the checkbox label after CONFIRM:, any case, any spacing", () => {
    expect(parseIntakeWarnings("K|confirm:  Has NY Medicaid ID (not D-SNP) |m")[0].label)
      .toBe("Has NY Medicaid ID (not D-SNP)");
    expect(parseIntakeWarnings("K|CONFIRM|m")[0].label).toBe(FALLBACK_CONFIRM_LABEL);
  });

  it("an unknown KEY is handled by its TYPE, like any other", () => {
    const [w] = parseIntakeWarnings("SOMETHING_NEW_NEXT_MONTH|BLOCK|New rule.");
    expect(w).toMatchObject({ key: "SOMETHING_NEW_NEXT_MONTH", type: "block", message: "New rule." });
  });

  it("an unknown TYPE is SHOWN as a tick, never dropped and never a block", () => {
    const [w] = parseIntakeWarnings("K|WARN|Heads up.");
    expect(w).toMatchObject({ type: "confirm", label: FALLBACK_CONFIRM_LABEL, message: "K|WARN|Heads up." });
  });

  it("a line that isn't KEY|TYPE|message is still shown, with a comma-free key", () => {
    const [w] = parseIntakeWarnings("Check the plan, then call.");
    expect(w.type).toBe("confirm");
    expect(w.message).toBe("Check the plan, then call.");
    expect(w.key).not.toContain(",");
    expect(w.key).toBe("CHECK_THE_PLAN_THEN_CALL");
  });

  it("a repeated KEY keeps its first line", () => {
    const w = parseIntakeWarnings(`${MCO}\nMEDICAID_MCO_OON|BLOCK|second copy`);
    expect(w).toHaveLength(1);
    expect(w[0].message).toMatch(/not contracted/);
  });

  it("a BLOCK with no message still says something", () => {
    expect(parseIntakeWarnings("SELF_REF_UHC|BLOCK|")[0].message).toBe("SELF_REF_UHC");
  });
});

describe("acks", () => {
  it("parses a comma list, trimmed, de-duplicated", () => {
    expect(parseAcks(" A, B ,,A ,C")).toEqual(["A", "B", "C"]);
    expect(parseAcks("")).toEqual([]);
    expect(parseAcks(null)).toEqual([]);
  });

  it("ticks and unticks one KEY and keeps every other KEY", () => {
    expect(withAck("", "A", true)).toBe("A");
    expect(withAck("A", "B", true)).toBe("A,B");
    expect(withAck("A,B", "A", true)).toBe("B,A");
    expect(withAck("A,B,C", "B", false)).toBe("A,C");
    expect(withAck("OLD_KEY", "A", true)).toBe("OLD_KEY,A");
    expect(withAck("A", "A", false)).toBe("");
  });
});

describe("requiresReason", () => {
  it("an approval / override tick needs a typed reason", () => {
    expect(requiresReason({ type: "confirm", label: "Management approved" })).toBe(true);
    expect(requiresReason({ type: "confirm", label: "Override approved by Corey" })).toBe(true);
  });
  it("an ordinary confirmation does not", () => {
    expect(requiresReason({ type: "confirm", label: "Has NY Medicaid ID" })).toBe(false);
    expect(requiresReason({ type: "confirm", label: "Has NY Medicaid ID (not D-SNP)" })).toBe(false);
    expect(requiresReason({ type: "block", label: "" })).toBe(false);
  });
});

describe("warningConditions — the advance gate", () => {
  const pt = (warnings: string, acks = "") => ({ intakeWarnings: warnings, intakeWarningAcks: acks });

  it("a BLOCK never passes, ticked or not", () => {
    const [c] = warningConditions(pt(MCO, "MEDICAID_MCO_OON"));
    expect(c).toMatchObject({ id: "warn:MEDICAID_MCO_OON", passed: false, hint: BLOCK_HINT });
    expect(c.label).toMatch(/not contracted/);
  });

  it("a CONFIRM passes only when its own KEY is ticked", () => {
    expect(warningConditions(pt(PUMP))[0].passed).toBe(false);
    expect(warningConditions(pt(PUMP, "UHC_AETNA_PUMP_MGMT"))[0].passed).toBe(false);
    const [c] = warningConditions(pt(PUMP, "MEDICARE_PUMP_MEDICAID_ID"));
    expect(c).toMatchObject({ id: "warn:MEDICARE_PUMP_MEDICAID_ID", passed: true, label: "Has NY Medicaid ID" });
    expect(c.hint).toMatch(/NY Medicaid ID/);
  });

  it("no warnings, no rows", () => {
    expect(warningConditions(pt(""))).toEqual([]);
    expect(warningConditions(null)).toEqual([]);
  });
});

describe("evaluateUnlock carries the warnings", () => {
  const ready = {
    formProceedPreference: "Send request now",
    stediEligibilityActive: "Yes",
    stediPlanName: "Plan",
    requestType: "",
  } as unknown as Patient;

  it("a BLOCK locks an otherwise-ready patient, and says why", () => {
    const u = evaluateUnlock({ ...ready, intakeWarnings: MCO, intakeWarningAcks: "" });
    expect(u.unlocked).toBe(false);
    const row = u.conditions.find((c) => c.id === "warn:MEDICAID_MCO_OON");
    expect(row?.passed).toBe(false);
    expect(row?.hint).toBe(BLOCK_HINT);
  });

  it("a CONFIRM locks until ticked, then unlocks", () => {
    expect(evaluateUnlock({ ...ready, intakeWarnings: PUMP, intakeWarningAcks: "" }).unlocked).toBe(false);
    expect(evaluateUnlock({ ...ready, intakeWarnings: PUMP, intakeWarningAcks: "MEDICARE_PUMP_MEDICAID_ID" }).unlocked)
      .toBe(true);
  });

  it("no warnings leaves the gate exactly as it was", () => {
    const u = evaluateUnlock({ ...ready, intakeWarnings: "", intakeWarningAcks: "" });
    expect(u.unlocked).toBe(true);
    expect(u.conditions.map((c) => c.id)).toEqual(["authorised", "stediRan", "active"]);
  });

  it("In Network is still not a condition, whatever it says", () => {
    for (const v of ["No", "Check with patient: lives in NY, NJ, FL or TN?", "Check manually", "Unknown"]) {
      const u = evaluateUnlock({ ...ready, stediInNetwork: v, intakeWarnings: "", intakeWarningAcks: "" });
      expect(u.unlocked).toBe(true);
    }
  });
});

describe("ackNoteLine", () => {
  const w = { key: "UHC_AETNA_PUMP_MGMT", label: "Management approved" };
  it("names the warning, and carries the reason on an override", () => {
    expect(ackNoteLine(w, true)).toBe("Intake warning confirmed: Management approved (UHC_AETNA_PUMP_MGMT)");
    expect(ackNoteLine(w, true, "  Corey OK'd on the 9/24 call ")).toBe(
      "Intake warning overridden: Management approved (UHC_AETNA_PUMP_MGMT) — Corey OK'd on the 9/24 call",
    );
    expect(ackNoteLine(w, false)).toBe("Intake warning un-ticked: Management approved (UHC_AETNA_PUMP_MGMT)");
  });
});

describe("cardWarnings — the Care Coordinator card", () => {
  it("every BLOCK, and each CONFIRM not yet ticked", () => {
    const all = [MCO, PUMP, MGMT].join("\n");
    expect(cardWarnings({ intakeWarnings: all, intakeWarningAcks: "MEDICARE_PUMP_MEDICAID_ID" })).toEqual([
      { tone: "block", text: "Can't advance: The Medicaid plan on file is an MCO we are not contracted with.", title: "The Medicaid plan on file is an MCO we are not contracted with." },
      { tone: "confirm", text: "Confirm: Management approved", title: "UHC/Aetna pump: needs management approval." },
    ]);
  });
  it("nothing when there are none", () => {
    expect(cardWarnings({ intakeWarnings: "", intakeWarningAcks: "" })).toEqual([]);
    expect(cardWarnings({})).toEqual([]);
  });
});
