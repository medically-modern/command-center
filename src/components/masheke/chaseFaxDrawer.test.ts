/**
 * The Chase Clinicals fax drawer — Email, Parachute & Dashboards (§5.9c).
 *
 * Josh, 2026-09-22: *"Need to add the option (via a drawer that is default
 * hidden) to send a fax for these patients (and generate a script too)"*.
 *
 * Three of the four things below are silent when they break — a drawer that
 * defaults open still works, a send that resolves the patient's own method
 * still sends something, and a second copy of the generate rule still
 * compiles — so they are scanned.
 *
 * Run: npx vitest run src/components/masheke/chaseFaxDrawer.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { missingForScript, showCgmGenerate, showIpGenerate } from "@/lib/masheke/generateScripts";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");
const chase = read("./ChaseClinicalsPanel.tsx");

describe("the drawer is DEFAULT HIDDEN, per patient", () => {
  it("its open flag starts false", () => {
    expect(chase).toMatch(/const \[showFaxDrawer, setShowFaxDrawer\] = useState\(false\)/);
  });

  it("⚠️ it collapses on a patient switch", () => {
    // Carrying it open puts a Send Fax button and the PREVIOUS patient's
    // message draft in front of a rep who just opened somebody else.
    const effect = chase.slice(chase.indexOf('setAttemptNote("");'));
    const body = effect.slice(0, effect.indexOf("}, [patient.id]);"));
    expect(body).toMatch(/setShowFaxDrawer\(false\)/);
    expect(body).toMatch(/setMessageDraft\(null\)/);
  });
});

describe("it is the Email/Parachute/Dashboard role's control", () => {
  it("renders on the parachute role", () => {
    expect(chase).toMatch(/\{effectiveRole === "parachute" && \(/);
  });

  it("⚠️ the fax role's own always-visible re-send box is untouched", () => {
    // Two controls, two audiences. Merging them would cost the Fax role its
    // everyday re-send, which is not behind any drawer.
    expect(chase).toMatch(/\{effectiveRole === "fax" && \(/);
    expect(chase).toMatch(/Re-send the \{isEmail \? "email" : "fax"\}/);
  });
});

describe("⚠️ it sends a FAX, whatever the patient's own method is", () => {
  it("the drawer's button passes the channel explicitly", () => {
    expect(chase).toMatch(/handleResend\("fax"\)/);
  });

  it("the fax role's button stays on 'auto'", () => {
    expect(chase).toMatch(/handleResend\("auto"\)/);
  });

  it("the 'fax' channel takes the doctor's FAX, never the resolved recipient", () => {
    // `recipient` is the doctor's EMAIL for an Email-method patient, so
    // reading it here would quietly send the thing the rep could already send.
    expect(chase).toMatch(/const target = channel === "fax" \? patient\.doctorFax : recipient/);
    expect(chase).toMatch(/const asFax = channel === "fax" \|\| !isEmail/);
  });

  it("an address with an @ passes through; digits become <digits>@rcfax.com", () => {
    // That suffix is what makes RingCentral treat the send as a fax (§5.5).
    expect(chase).toMatch(/target\.includes\("@"\) \? target : `\$\{target\.replace\(\/\\D\/g, ""\)\}@rcfax\.com`/);
  });

  it("refuses with a reason rather than sending nowhere", () => {
    expect(chase).toMatch(/No doctor \$\{asFax \? "fax" : "email"\} on file\./);
    expect(chase).toMatch(/No doctor fax on file — add one above to send\./);
  });
});

describe("generating a script — ONE rule, two panels", () => {
  it("the drawer uses the shared control", () => {
    expect(chase).toMatch(/import \{ GenerateScriptsControl \} from "@\/components\/masheke\/GenerateScriptButtons"/);
    expect(chase).toMatch(/<GenerateScriptsControl/);
  });

  it("⚠️ Send Request reads the same rule rather than its own copy", () => {
    const send = read("./SendRequestPanel.tsx");
    expect(send).toMatch(/from "@\/lib\/masheke\/generateScripts"/);
    expect(send).toMatch(/missingForScript\(patient, "cgm"\)/);
    expect(send).toMatch(/missingForScript\(patient, "ip"\)/);
    expect(send).toMatch(/triggerGenerateScript\(patient\.id, columnId/);
    // The local definitions are gone, not shadowed.
    expect(send).not.toMatch(/function missingForScript\(/);
    expect(send).not.toMatch(/function GenBtn\(/);
    expect(send).not.toMatch(/function GeneratingChip\(/);
  });

  it("the drawer only polls Monday hard while a job is running", () => {
    // DocExport is slow enough that a resting poll leaves the chip up long
    // after the script lands; polling always would be a read per patient per
    // two seconds on a page a rep sits on (INCIDENT_2026-08-20's shape).
    expect(chase).toMatch(/pollingIntervalMs: generating \? 2000 : 0/);
    expect(chase).toMatch(/onGeneratingChange=\{setGenerating\}/);
  });
});

describe("the rule itself", () => {
  it("names every DocExport input that is missing, in reading order", () => {
    expect(missingForScript({}, "cgm")).toEqual(["Name", "DOB", "CGM Type", "Doctor Name", "Doctor NPI"]);
    expect(missingForScript({}, "ip")).toEqual(["Name", "DOB", "Pump Type", "Doctor Name", "Doctor NPI"]);
  });

  it("is empty once the inputs are there", () => {
    const full = { name: "A", dob: "1950-01-01", cgmType: "Dexcom G7", pumpType: "t:slim", doctorName: "D", doctorNpi: "1" };
    expect(missingForScript(full, "cgm")).toEqual([]);
    expect(missingForScript(full, "ip")).toEqual([]);
  });

  it("asks for the OTHER product's type only when that product is served", () => {
    const cgmOnly = { name: "A", dob: "1950-01-01", cgmType: "Dexcom G7", doctorName: "D", doctorNpi: "1" };
    expect(missingForScript(cgmOnly, "cgm")).toEqual([]);
    expect(missingForScript(cgmOnly, "ip")).toEqual(["Pump Type"]);
  });

  it("⚠️ a BLANK serving earns BOTH buttons — a failed read must not hide a script", () => {
    expect(showCgmGenerate(undefined)).toBe(false);
    expect(showIpGenerate(undefined)).toBe(true);
    expect(showCgmGenerate("CGM")).toBe(true);
    expect(showIpGenerate("CGM")).toBe(false);
    expect(showCgmGenerate("Insulin Pump + CGM")).toBe(true);
    expect(showIpGenerate("Insulin Pump + CGM")).toBe(true);
    expect(showCgmGenerate("Supplies + CGM")).toBe(true);
    expect(showIpGenerate("Supplies")).toBe(true);
  });
});

describe("⚠️ the trigger CLEARS before it writes", () => {
  it("or the automation never fires on a re-generate", () => {
    // Monday takes a write of the value a column already holds at HTTP 200,
    // records no activity-log entry and fires nothing (§9's advancer no-op).
    const lib = read("../../lib/masheke/generateScripts.ts");
    const fn = lib.slice(lib.indexOf("export async function triggerGenerateScript"));
    const clear = fn.indexOf("clearStatusColumn");
    const write = fn.indexOf("writeStatusIndex");
    expect(clear).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(clear);
    expect(fn).toMatch(/setTimeout\(r, 250\)/);
  });

  it("cancelling is a CLEAR, never a write of a label the column lacks", () => {
    const lib = read("../../lib/masheke/generateScripts.ts");
    const fn = lib.slice(lib.indexOf("export async function triggerGenerateScript"));
    const elseBranch = fn.slice(fn.indexOf("} else {"));
    expect(elseBranch).toMatch(/clearStatusColumn\(itemId, columnId\)/);
    expect(elseBranch).not.toMatch(/writeStatusIndex/);
  });
});
