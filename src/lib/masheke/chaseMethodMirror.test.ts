import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PARACHUTE_ROLE_METHODS } from "./chaseMethods";

/**
 * The two baseline generators carry the chase-method list as a literal.
 *
 * They are plain `.mjs` run on Railway and in CI and cannot import
 * `chaseMethods.ts`, so the list genuinely lives in three files — which that
 * module's header records, and the §5.8 counting contract says to change in
 * one commit. This is the check that makes that instruction enforceable.
 *
 * ⚠️ A drift here is **silent**: the patient is counted in the wrong bar all
 * day, the burndown grows phantom +in/-out chips against the sidebar, and
 * nothing errors. Source-scanned, like `listColumns.test.ts` and
 * `directoryCoverage.test.ts`.
 */
const MIRRORS = ["scripts/snapshot-baseline.mjs", "services/baseline-cron/index.mjs"];

/** The literal each generator buckets on, as written. */
function mirroredList(file: string): string[] {
  const src = readFileSync(resolve(process.cwd(), file), "utf8");
  const m = src.match(/roleId = \[([^\]]*)\]\.includes\(cm\)/);
  if (!m) {
    throw new Error(
      `${file}: no \`[...].includes(cm)\` chase bucketing found. If the shape changed, ` +
        `update this test in the same commit — do not delete it.`,
    );
  }
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("the chase-method list is the same in all three places", () => {
  it.each(MIRRORS)("%s mirrors lib/masheke/chaseMethods.ts", (file) => {
    // Order is not the contract — membership is.
    expect(mirroredList(file).slice().sort()).toEqual([...PARACHUTE_ROLE_METHODS].sort());
  });

  it.each(MIRRORS)("%s still routes everything else to chaseFax", (file) => {
    const src = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(src).toContain('.includes(cm) ? "chaseParachute" : "chaseFax"');
  });
});
