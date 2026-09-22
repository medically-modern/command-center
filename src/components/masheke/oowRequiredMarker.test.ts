/**
 * The OOW Date's required marker and the Send gate ask ONE question.
 *
 * Josh, 2026-09-22: *"For oow pumps, if you put invalid, it doesn't say oow
 * date is required, but masheke saying it won't advance unless you put in a
 * date"*.
 *
 * ⚠️ The two read the SAME state through two different fields, and that is the
 * whole bug. `setIpReceived("Invalid")` writes **`ipScriptReceived = "Yes"`**
 * alongside `ipScriptValid = "Invalid"` — an invalid script is still a script
 * in hand — so `getMissingRequiredFields`, which keys on `ipScriptReceived ===
 * "Yes"`, correctly disabled Send on a blank OOW Date. The marker beside the
 * field asked `ipReceivedVal === "Yes"` instead, which is the DISPLAY value and
 * reads "Invalid" — so the field rendered unmarked and the "Language
 * Requirements" header dropped its "— all required", above a Send button
 * disabled on exactly that field.
 *
 * ⚠️ THE FIX IS NOT A NEW GATE. The gate was already right; a second hard stop
 * would be the dead-end class this codebase records reversing five times over
 * (§5.10 · §5.20 · §5.31c · §5.32c · §5.39d). Only the marker moved, onto the
 * same predicate the gate uses.
 *
 * Run: npx vitest run src/components/masheke/oowRequiredMarker.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "./EvaluatePanel.tsx"), "utf8");

/** Everything between two markers, so a scan can be scoped to one block. */
const between = (from: string, to: string) => {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return src.slice(a, b);
};

describe("an INVALID script is a script in hand", () => {
  it("both setters write received = 'Yes' for the Invalid answer", () => {
    // This is what makes the gate fire, and therefore what the marker has to
    // agree with. If either setter ever stops doing it, the gate changes
    // meaning and this file is the reminder to move the marker with it.
    for (const s of ["setCgmReceived", "setIpReceived"] as const) {
      const body = between(`const ${s} = `, "};");
      expect(body).toMatch(/v === "Invalid"/);
      const invalid = body.slice(body.indexOf('v === "Invalid"'));
      expect(invalid).toMatch(/update\("(cgm|ip)ScriptReceived", "Yes"\)/);
      expect(invalid).toMatch(/update\("(cgm|ip)ScriptValid", "Invalid"\)/);
    }
  });

  it("the Send gate keys on scriptReceived === 'Yes', so Invalid is gated", () => {
    const fn = between("function getMissingRequiredFields", "\n}\n");
    expect(fn).toMatch(/state\.cgmScriptReceived === "Yes"/);
    expect(fn).toMatch(/state\.ipScriptReceived === "Yes"/);
    expect(fn).toMatch(/if \(cfg\.showOow && !state\.oowDate\) missing\.push\("OOW Date"\)/);
  });
});

describe("the required marker tracks that gate by construction", () => {
  it("⚠️ reqReq IS scriptInHand — never re-derived from receivedVal === 'Yes'", () => {
    expect(src).toMatch(/const cgmReqReq = cgmScriptInHand;/);
    expect(src).toMatch(/const ipReqReq = ipScriptInHand;/);
    // The predicate they now share is the "Yes OR Invalid" one, which is
    // exactly `scriptReceived === "Yes"` after the setters above.
    expect(src).toMatch(/const cgmScriptInHand = cgmReceivedVal === "Yes" \|\| cgmReceivedVal === "Invalid";/);
    expect(src).toMatch(/const ipScriptInHand = ipReceivedVal === "Yes" \|\| ipReceivedVal === "Invalid";/);
  });

  it("the regression shape is gone: no marker reads receivedVal === 'Yes' alone", () => {
    expect(src).not.toMatch(/const cgmReqReq = cgmReceivedVal === "Yes";/);
    expect(src).not.toMatch(/const ipReqReq = ipReceivedVal === "Yes";/);
  });

  it("the OOW Date row and its header both render off ipReqReq", () => {
    expect(src).toMatch(/<ReqRow label="OOW Date" required=\{ipReqReq\} missing=\{!state\.oowDate\}>/);
    expect(src).toMatch(/Language Requirements\{ipReqReq \? " — all required" : ""\}/);
  });

  it("every IP language row is marked from the same flag", () => {
    // One flag for the whole block: a row left on its own predicate is how the
    // pair drifts back apart.
    const rows = [
      "Diabetes Education",
      "3\\+ Injections / Day",
      "CGM Use",
      "Blood Sugar Issues",
      "Letter of MN on File",
      "OOW Date",
      "OOW on Script",
      "Malfunction",
    ];
    for (const label of rows) {
      expect(src).toMatch(new RegExp(`<ReqRow label="${label}" required=\\{ipReqReq\\}`));
    }
  });

  it("the CGM coverage path is marked from its own twin", () => {
    expect(src).toMatch(/missing=\{cgmReqReq && !state\.cgmCoveragePath\}/);
    expect(src).toMatch(/required=\{cgmReqReq\}/);
  });
});
