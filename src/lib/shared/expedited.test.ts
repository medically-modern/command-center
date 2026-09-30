/**
 * Expedited (§5.56) — the mark, the four columns, and every place that must
 * read it. A column missing from a board's read list reads blank with no error
 * (§5.11), which here would quietly make every expedited patient wait a day.
 *
 * Run: npx vitest run src/lib/shared/expedited.test.ts
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { EXPEDITED_COL, EXPEDITED_INDEX, EXPEDITED_LABEL, isExpedited } from "./expedited";
import * as profileApi from "../profile/mondayApi";
import * as mashekeApi from "../masheke/mondayApi";
import * as samanthaApi from "../samantha/mondayApi";
import * as welcomeCallApi from "../welcomeCall/mondayApi";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

describe("isExpedited", () => {
  it("is true only for the label", () => {
    expect(isExpedited("Expedited")).toBe(true);
    expect(isExpedited(" expedited ")).toBe(true);
  });
  it("blank, missing or anything else is normal", () => {
    for (const v of ["", null, undefined, "Done", "Expedite"]) expect(isExpedited(v)).toBe(false);
  });
});

describe("the four columns — ids and the label read back 2026-09-30", () => {
  it("names each board's column, and they are all different", () => {
    expect(EXPEDITED_COL).toEqual({
      profileSendOff: "color_mm7pywyh",
      medicalEvaluation: "color_mm7pkb92",
      insurance: "color_mm7ppqbn",
      welcomeCall: "color_mm7p9hm0",
    });
    // The hops copy by LABEL TEXT, so the text is the cross-board contract.
    expect(EXPEDITED_LABEL).toBe("Expedited");
    expect(EXPEDITED_INDEX).toBe(2);
  });

  it.each([
    ["Profile Send Off", profileApi.COL.expedited, profileApi.READ_COLUMN_IDS, EXPEDITED_COL.profileSendOff],
    ["Medical Evaluation", mashekeApi.COL.expedited, mashekeApi.READ_COLUMN_IDS, EXPEDITED_COL.medicalEvaluation],
    ["Insurance", samanthaApi.COL.expedited, samanthaApi.READ_COLUMN_IDS, EXPEDITED_COL.insurance],
    ["Welcome Call", welcomeCallApi.COL.expedited, welcomeCallApi.READ_COLUMN_IDS, EXPEDITED_COL.welcomeCall],
  ])("%s maps it AND reads it", (_board, col, readIds, want) => {
    expect(col).toBe(want);
    expect(readIds).toContain(want);
  });

  it("Insurance's auth-group read (Submit Auth) carries it too", () => {
    expect(samanthaApi.AUTH_READ_COLUMN_IDS).toContain(EXPEDITED_COL.insurance);
  });

  it("each board's mapping puts it on the Patient", () => {
    expect(read("lib/profile/mondayMapping.ts")).toMatch(/expedited: col\(item, COL\.expedited\)/);
    expect(read("lib/masheke/mondayMapping.ts")).toMatch(/expedited: col\(item, COL\.expedited\)/);
    expect(read("lib/samantha/mondayMapping.ts")).toMatch(/expedited: cv\(COL\.expedited\)\?\.text/);
    expect(read("lib/welcomeCall/mondayMapping.ts")).toMatch(/expedited: txt\(COL\.expedited\)/);
  });
});

describe("the tick — managers only, intake stages only", () => {
  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(n) && !/\.test\./.test(n) ? [p] : [];
    });
  }

  it("is mounted on the two intake pages and nowhere else", () => {
    const mounts = walk(ROOT)
      .map((f) => ({ f: f.slice(ROOT.length + 1), n: (readFileSync(f, "utf8").match(/<ExpediteToggle\b/g) ?? []).length }))
      .filter((x) => x.n > 0);
    expect(mounts).toEqual(
      expect.arrayContaining([
        { f: "pages/ProfilePage.tsx", n: 1 },
        { f: "pages/UnverifiedReferralsPage.tsx", n: 2 },
      ]),
    );
    expect(mounts).toHaveLength(2);
  });

  it("Referral Intake only — never an Already In System patient", () => {
    const src = read("pages/ProfilePage.tsx");
    expect(src).toMatch(/!selectedInSystem && \(\s*<ExpediteToggle/);
  });

  it("Info Collection's copy is left-pane only, so Clean-Up never shows two", () => {
    const src = read("pages/UnverifiedReferralsPage.tsx");
    expect(src).toMatch(/\{!isCleanUp && \(\s*<ExpediteToggle/);
  });

  it("asks the SIGNED-IN person whether they are a manager", () => {
    const src = read("components/profile/ExpediteToggle.tsx");
    expect(src).toMatch(/useAccessContext\(\)/);
    expect(src).toMatch(/access\.type === "manager"/);
    expect(src).not.toMatch(/viewAs/);
  });
});
