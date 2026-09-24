import { describe, expect, it } from "vitest";
import {
  ANTHEM_NETWORK_HEADLINE, ANTHEM_NETWORK_STATES, ANTHEM_STATES_TEXT, NETWORK_CARD_CHECK_TEXT,
  anthemNetworkGuidance, networkShortLabel, networkToneOf, networkVerdictOf,
} from "./networkVerdict";
import { ANTHEM_HOST_PLAN } from "./primaryInsurance";

/** The four strings the backend writes from 2026-09-24 (commit 02f5d81). */
const CHECK = "Check with patient: lives in NY, NJ, FL or TN?";

describe("networkVerdictOf", () => {
  it("reads the backend's four verdicts", () => {
    expect(networkVerdictOf("Yes")).toBe("yes");
    expect(networkVerdictOf("No")).toBe("no");
    expect(networkVerdictOf(CHECK)).toBe("checkWithPatient");
    expect(networkVerdictOf("Check manually")).toBe("checkManually");
  });

  it("matches the two Check answers by prefix, so a reworded tail still pops up", () => {
    expect(networkVerdictOf("Check with patient: lives in NY, NJ, FL, TN or WY?")).toBe("checkWithPatient");
    expect(networkVerdictOf("  check manually — plan not in rules ")).toBe("checkManually");
  });

  it("an old row's Unknown, or anything new, is 'other' — never a No", () => {
    expect(networkVerdictOf("Unknown")).toBe("other");
    expect(networkVerdictOf("PPO — see plan")).toBe("other");
  });

  it("blank is none", () => {
    expect(networkVerdictOf("")).toBe("none");
    expect(networkVerdictOf("  ")).toBe("none");
    expect(networkVerdictOf(null)).toBe("none");
  });
});

describe("tone and label — Brandon's chip spec", () => {
  it("Yes green, No red, both Checks amber, anything else neutral", () => {
    expect(networkToneOf(networkVerdictOf("Yes"))).toBe("good");
    expect(networkToneOf(networkVerdictOf("No"))).toBe("bad");
    expect(networkToneOf(networkVerdictOf(CHECK))).toBe("warn");
    expect(networkToneOf(networkVerdictOf("Check manually"))).toBe("warn");
    expect(networkToneOf(networkVerdictOf("Unknown"))).toBe("neutral");
    expect(networkToneOf(networkVerdictOf(""))).toBe("neutral");
  });

  it("the box prints short labels; unknown text verbatim; blank a dash", () => {
    expect(networkShortLabel(CHECK)).toBe("Check with patient");
    expect(networkShortLabel("Check manually")).toBe("Check manually");
    expect(networkShortLabel("in-network")).toBe("Yes");
    expect(networkShortLabel("No")).toBe("No");
    expect(networkShortLabel(" Unknown ")).toBe("Unknown");
    expect(networkShortLabel("")).toBe("—");
  });
});

describe("the Anthem states", () => {
  it("are NY plus every state the suggestion engine sends to its own Blue plan", () => {
    expect([...ANTHEM_NETWORK_STATES].sort()).toEqual(["NY", ...Object.keys(ANTHEM_HOST_PLAN)].sort());
    for (const s of ANTHEM_NETWORK_STATES) expect(ANTHEM_STATES_TEXT).toContain(s);
  });

  it("Wyoming is in every sentence (Josh, 2026-09-24)", () => {
    expect(ANTHEM_NETWORK_HEADLINE).toContain("WY");
    expect(NETWORK_CARD_CHECK_TEXT).toBe("Only in-network if patient lives in NY, NJ, FL, TN or WY?");
  });
});

describe("anthemNetworkGuidance", () => {
  it("NJ, FL, TN and WY: switch Primary Insurance to that state's plan", () => {
    const cases: Record<string, string> = {
      "12 Main St, Newark, NJ 07102": "Horizon BCBS",
      "5 Ocean Dr, Miami, FL 33139": "BCBS FL",
      "9 Broad St, Nashville, TN 37203": "BCBS TN",
      "1 Elk Rd, Cheyenne, WY 82001": "BCBS WY",
    };
    for (const [addr, plan] of Object.entries(cases)) {
      const g = anthemNetworkGuidance({ stediAddress: addr, patientAddress: "" });
      expect(g.switchTo).toBe(plan);
      expect(g.summary).toContain(plan);
      expect(g.steps.join(" ")).toContain(`change Primary Insurance to ${plan}`);
    }
  });

  it("insurance in NY but the profile elsewhere: fix the address, not the plan", () => {
    const g = anthemNetworkGuidance({
      stediAddress: "4 Pine St, Albany, NY 12207", patientAddress: "22 Oak Ave, Scranton, PA 18503",
    });
    expect(g.switchTo).toBeNull();
    expect(g.profileState).toBe("PA");
    expect(g.summary).toMatch(/says PA/);
    expect(g.steps.join(" ")).toMatch(/correct the address/);
  });

  it("any other state: confirm where they live, and say it's out of network if they stay", () => {
    const g = anthemNetworkGuidance({ stediAddress: "22 Oak Ave, Scranton, PA 18503" });
    expect(g.insuranceState).toBe("PA");
    expect(g.switchTo).toBeNull();
    expect(g.summary).toBe("Insurance has them in PA — confirm where they live before moving forward.");
    expect(g.steps.at(-1)).toBe("If they really do live in PA, we're not in network for them.");
    expect(g.steps.join(" ")).toContain("Horizon BCBS, BCBS FL, BCBS TN or BCBS WY");
  });

  it("no readable state: still asks, never guesses one", () => {
    const g = anthemNetworkGuidance({ stediAddress: "" });
    expect(g.insuranceState).toBe("");
    expect(g.summary).toBe("Confirm where they live before moving forward.");
  });
});
