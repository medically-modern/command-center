import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PARACHUTE_ROLE_METHODS, isParachuteRoleMethod } from "./chaseMethods";
import { chaseRoleFor, chaseRoleLabel } from "./apptOutreach";

/** Every live label on Clinicals Method `color_mm1xw7y5`, plus the blank. */
const LIVE_METHODS = ["Fax", "Parachute", "Email", "Dashboard", ""];

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("the Email, Parachute & Dashboards chase role", () => {
  it("works Parachute, Email and Dashboard", () => {
    expect(isParachuteRoleMethod("Parachute")).toBe(true);
    expect(isParachuteRoleMethod("Email")).toBe(true);
    expect(isParachuteRoleMethod("Dashboard")).toBe(true);
  });

  it("leaves Fax — and a blank method — to the fax role", () => {
    // A missing method counts as fax so nobody falls through the cracks (§5.9).
    expect(isParachuteRoleMethod("Fax")).toBe(false);
    expect(isParachuteRoleMethod("")).toBe(false);
    expect(isParachuteRoleMethod(undefined)).toBe(false);
    expect(isParachuteRoleMethod(null)).toBe(false);
  });

  it("puts every live label in EXACTLY ONE role", () => {
    // The two roles are complements, so this is what stops a method landing in
    // both queues or — the silent one — in neither.
    for (const m of LIVE_METHODS) {
      const inParachute = isParachuteRoleMethod(m);
      const inFax = !isParachuteRoleMethod(m);
      expect([inParachute, inFax].filter(Boolean)).toHaveLength(1);
    }
  });

  it("routes chaseRoleFor by the same rule", () => {
    expect(chaseRoleFor("Dashboard")).toBe("chaseParachute");
    expect(chaseRoleFor("Parachute")).toBe("chaseParachute");
    expect(chaseRoleFor("Email")).toBe("chaseParachute");
    expect(chaseRoleFor("Fax")).toBe("chaseFax");
    expect(chaseRoleFor(undefined)).toBe("chaseFax");
    expect(chaseRoleLabel("Dashboard")).toBe("Chase Clinicals — Email, Parachute & Dashboards");
  });
});

describe("the copies that cannot import the rule (§5.8 counting contract)", () => {
  // The baseline generators are plain .mjs — one runs on Railway at 9 AM, one
  // in CI at build time. They carry the list as a literal, and a drift is
  // SILENT: the Operations tab grows phantom +in/-out chips all day.
  for (const rel of ["scripts/snapshot-baseline.mjs", "services/baseline-cron/index.mjs"]) {
    it(`${rel} carries the same method list`, () => {
      const src = read(rel);
      const m = src.match(/\[([^\]]*)\]\.includes\(cm\)/);
      expect(m, `no \`[...].includes(cm)\` chase split found in ${rel}`).toBeTruthy();
      const listed = m![1]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      expect(listed.sort()).toEqual([...PARACHUTE_ROLE_METHODS].sort());
    });
  }

  it("the Oversight chase filters reference the shared list, never a literal", () => {
    // Ten filters across five chart pairs. A literal re-introduced here is the
    // §5.9 trap: the chart quietly disagrees with the queue it links to.
    const src = read("src/lib/oversight/oversightApi.ts");
    expect(src).toContain('from "../masheke/chaseMethods"');
    expect(src.match(/value: PARACHUTE_ROLE_METHODS/g) ?? []).toHaveLength(10);
    expect(src).not.toMatch(/value: \["Email", ?"Parachute"\]/);
  });
});
