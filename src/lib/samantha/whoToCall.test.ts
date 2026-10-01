/**
 * Who to call on Benefits (HANDOFF-Josh-Who-To-Call.md §5). One test per row
 * of the handoff's table. FAKE patients and addresses only.
 */
import { describe, expect, it } from "vitest";
import { CARECENTRIX, CARECENTRIX_STATES, carecentrixAuthNote, step2Suggestion, whoToCall } from "./whoToCall";
import { expectedPos, IN_FOOTPRINT_STATES } from "@/lib/shared/pos";
import type { Patient } from "./workflow";

const p = (over: Partial<Patient>): Patient => ({ id: "1", name: "Test Patient", ...over }) as Patient;

const NJ = "1 Main St, Wyckoff, NJ 07481";
const NJ2 = "2 Oak Ave, Summit, NJ 07901";
const FL = "3 Bay Rd, Tampa, FL 33602";
const NY = "4 State St, Albany, NY 12207";
const TX = "5 Elm St, Dallas, TX 75201";

const cc = { name: CARECENTRIX, side: "billed" } as const;

describe("the CareCentrix route — NJ and FL addresses", () => {
  it("#1 Horizon member in NJ: CareCentrix for network, auth, SoS; the home plan for active and DME", () => {
    const w = whoToCall(p({ primaryInsurance: "Horizon BCBS", homePlan: "Horizon BCBSNJ", patientAddress: NJ, memberId1: "YKZ3HZN000" }))!;
    expect(w.route).toBe("carecentrix");
    expect(w.byCheck["in-network"]).toEqual(cc);
    expect(w.byCheck.auth).toEqual(cc);
    expect(w.byCheck.sos).toEqual(cc);
    expect(w.byCheck.active).toEqual({ name: "Horizon BCBSNJ", side: "member" });
    expect(w.byCheck["dme-benefits"]).toEqual({ name: "Horizon BCBSNJ", side: "member" });
    expect(w.dmeInNetworkOnly).toBe(true);
  });

  it("#2 Florida Blue card, NJ address: still CareCentrix; the member's plan is BCBS Florida", () => {
    const w = whoToCall(p({ primaryInsurance: "Horizon BCBS", homePlan: "BCBS Florida", patientAddress: NJ2, memberId1: "VMAH000" }))!;
    expect(w.route).toBe("carecentrix");
    expect(w.byCheck.active.name).toBe("BCBS Florida");
    expect(w.byCheck["dme-benefits"].name).toBe("BCBS Florida");
    expect(w.byCheck.auth).toEqual(cc);
  });

  it("#3 no Stedi home plan: the member's plan falls back to Primary Insurance", () => {
    const w = whoToCall(p({ primaryInsurance: "Horizon BCBS", patientAddress: NJ, memberId1: "NJX3HZN000" }))!;
    expect(w.route).toBe("carecentrix");
    expect(w.byCheck.active).toEqual({ name: "Horizon BCBS", side: "member" });
  });

  it("#4 ⚠️ the ADDRESS wins over the label: Anthem with an NJ address is CareCentrix", () => {
    const w = whoToCall(p({ primaryInsurance: "Anthem BCBS Commercial", homePlan: "Anthem BCBS", patientAddress: NJ }))!;
    expect(w.route).toBe("carecentrix");
    expect(w.byCheck["in-network"]).toEqual(cc);
  });

  it("#5 FEP (R + 8 digits) gets no pills", () => {
    expect(whoToCall(p({ primaryInsurance: "Horizon BCBS", patientAddress: NJ, memberId1: "R59954629" }))).toBeNull();
    expect(whoToCall(p({ primaryInsurance: "Horizon BCBS", patientAddress: NJ, memberId1: "r12345678" }))).toBeNull();
  });

  it("#9a Florida Blue member in FL", () => {
    const w = whoToCall(p({ primaryInsurance: "BCBS FL", homePlan: "Florida Blue", patientAddress: FL }))!;
    expect(w.route).toBe("carecentrix");
    expect(w.byCheck["in-network"]).toEqual(cc);
    expect(w.byCheck.auth).toEqual(cc);
    expect(w.byCheck.sos).toEqual(cc);
    expect(w.byCheck.active).toEqual({ name: "Florida Blue", side: "member" });
    expect(w.byCheck["dme-benefits"]).toEqual({ name: "Florida Blue", side: "member" });
    expect(w.dmeInNetworkOnly).toBe(true);
  });

  it("#9b BCBS FL with no home plan: active and DME go to BCBS FL", () => {
    const w = whoToCall(p({ primaryInsurance: "BCBS FL", patientAddress: FL }))!;
    expect(w.byCheck.active.name).toBe("BCBS FL");
    expect(w.byCheck["dme-benefits"].name).toBe("BCBS FL");
  });

  it("#9c BCBS FL FEP gets no pills", () => {
    expect(whoToCall(p({ primaryInsurance: "BCBS FL", patientAddress: FL, memberId1: "R12345678" }))).toBeNull();
  });

  it("the CareCentrix route never collapses — step 2 is one CareCentrix chip", () => {
    const w = whoToCall(p({ primaryInsurance: "Horizon BCBS", homePlan: "Horizon BCBSNJ", patientAddress: NJ }))!;
    expect(step2Suggestion(w)).toEqual([{ prefix: "", target: cc }]);
  });

  it("CARECENTRIX_STATES is exactly NJ and FL, both inside the POS footprint", () => {
    expect([...CARECENTRIX_STATES].sort()).toEqual(["FL", "NJ"]);
    for (const s of CARECENTRIX_STATES) expect(IN_FOOTPRINT_STATES.has(s)).toBe(true);
  });
});

describe("the BlueCard route — every other resolved state", () => {
  it("#6 Anthem NY with an Anthem home plan collapses to one plan on every check", () => {
    const w = whoToCall(p({ primaryInsurance: "Anthem BCBS Commercial", homePlan: "Anthem BCBS", patientAddress: NY }))!;
    expect(w.route).toBe("bluecard");
    const billed = { name: "Anthem BCBS Commercial", side: "billed" };
    for (const k of ["in-network", "active", "dme-benefits", "auth", "sos"] as const) expect(w.byCheck[k]).toEqual(billed);
    expect(w.dmeInNetworkOnly).toBe(false);
    expect(step2Suggestion(w)).toEqual([{ prefix: "", target: billed }]);
  });

  it("#7 Anthem NY with a BCBS Connecticut home plan: network and SoS billed, the rest the member's plan", () => {
    const w = whoToCall(p({ primaryInsurance: "Anthem BCBS Commercial", homePlan: "BCBS Connecticut", patientAddress: NY }))!;
    expect(w.route).toBe("bluecard");
    expect(w.byCheck["in-network"]).toEqual({ name: "Anthem BCBS Commercial", side: "billed" });
    expect(w.byCheck.sos).toEqual({ name: "Anthem BCBS Commercial", side: "billed" });
    for (const k of ["active", "dme-benefits", "auth"] as const) {
      expect(w.byCheck[k]).toEqual({ name: "BCBS Connecticut", side: "member" });
    }
    expect(step2Suggestion(w)).toEqual([
      { prefix: "Auth →", target: { name: "BCBS Connecticut", side: "member" } },
      { prefix: "SoS →", target: { name: "Anthem BCBS Commercial", side: "billed" } },
    ]);
  });

  it("#8 out-of-state (TX) is BlueCard as #7, and POS is Office (the POS 11 banner)", () => {
    const pt = p({ primaryInsurance: "Anthem BCBS Commercial", homePlan: "BCBS Texas", patientAddress: TX });
    const w = whoToCall(pt)!;
    expect(w.route).toBe("bluecard");
    expect(w.byCheck.active).toEqual({ name: "BCBS Texas", side: "member" });
    expect(w.byCheck["in-network"]).toEqual({ name: "Anthem BCBS Commercial", side: "billed" });
    expect(expectedPos(pt.primaryInsurance!, pt.patientAddress!)).toBe("Office");
  });

  it("#9 BCBS TN collapses to BCBS TN", () => {
    const w = whoToCall(p({ primaryInsurance: "BCBS TN", homePlan: "BCBS TN", patientAddress: "6 Pine St, Nashville, TN 37203" }))!;
    expect(w.route).toBe("bluecard");
    expect(new Set(Object.values(w.byCheck).map((t) => t.name))).toEqual(new Set(["BCBS TN"]));
  });
});

describe("no pills", () => {
  it("#10 a non-Blue payer", () => {
    expect(whoToCall(p({ primaryInsurance: "Aetna Commercial", patientAddress: NY }))).toBeNull();
    expect(whoToCall(p({ primaryInsurance: "Medicare A&B", patientAddress: NJ }))).toBeNull();
  });

  it("#11 an address that resolves to no state — never guessed", () => {
    expect(whoToCall(p({ primaryInsurance: "Horizon BCBS", homePlan: "Horizon", patientAddress: "" }))).toBeNull();
    expect(whoToCall(p({ primaryInsurance: "Horizon BCBS", homePlan: "Horizon", patientAddress: "see notes" }))).toBeNull();
    expect(whoToCall(p({ primaryInsurance: "Horizon BCBS" }))).toBeNull();
  });
});

describe("the CareCentrix auth banner (handoff §2b)", () => {
  it("names the host plan and the member's plan on the CareCentrix route", () => {
    expect(carecentrixAuthNote(p({ primaryInsurance: "Horizon BCBS", homePlan: "BCBS Florida", patientAddress: NJ2 }))).toEqual({
      host: "Horizon BCBS",
      member: "BCBS Florida",
    });
    expect(carecentrixAuthNote(p({ primaryInsurance: "BCBS FL", patientAddress: FL }))).toEqual({
      host: "BCBS FL",
      member: "BCBS FL",
    });
  });

  it("is null on the BlueCard route and with no pills", () => {
    expect(carecentrixAuthNote(p({ primaryInsurance: "Anthem BCBS Commercial", homePlan: "BCBS Connecticut", patientAddress: NY }))).toBeNull();
    expect(carecentrixAuthNote(p({ primaryInsurance: "Horizon BCBS", patientAddress: NJ, memberId1: "R59954629" }))).toBeNull();
  });
});
