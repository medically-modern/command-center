import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Every role hook that injects a DEEP-LINKED patient must run that record
 * through the rep's overlay (MM-1094).
 *
 * A deep link (`?patientId=` from Search, Oversight, the Communications Hub or
 * the Care Coordinator) names a patient who may not be in the page's own queue,
 * so each hook re-fetches that one item on EVERY poll and adds it to the list.
 * Group rows go through the overlay; if the injected one does not, the rep's
 * unsaved edits are replaced by Monday's copy on each poll — fields "reset",
 * and a field blank on the board comes back red. It shipped that way in the
 * Profile hook from 2026-05-11 until Janelle hit it on 2026-09-23, while the
 * masheke, samantha, welcomeCall and subscription hooks had it right.
 *
 * Scanned rather than exercised for the reason `pendingAdvanceCoverage.test.ts`
 * gives: a hook that loses this does not fail, it quietly throws edits away.
 * The Profile hook's behaviour is pinned separately in
 * `profile/useMondayPatients.deepLink.test.tsx`.
 */

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

/** Hooks that keep an edit overlay AND inject a deep-linked patient. */
const HOOKS = walk("src/hooks").filter((p) => {
  const src = readFileSync(p, "utf8");
  return /overlayRef/.test(src) && /fetchItemById\(\s*inject/.test(src);
});

/** Every statement that adds the injected record to the list. */
function injectionCommits(src: string): string[] {
  const out: string[] = [];
  const re = /\.(?:unshift|push)\(([^;]*?\binjected\b[^;]*?)\);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1].trim());
  return out;
}

describe("the scan finds every hook it is meant to cover", () => {
  it.each([
    "src/hooks/profile/useMondayPatients.ts",
    "src/hooks/masheke/useMondayPatients.ts",
    "src/hooks/samantha/useMondayPatients.ts",
    "src/hooks/welcomeCall/useMondayPatients.ts",
    "src/hooks/finalConfirm/useMondayPatients.ts",
    "src/hooks/subscription/useMondayPatients.ts",
  ])("%s", (path) => {
    // A rename or a refactor of the injection must not silently drop a hook
    // out of the guard below.
    expect(HOOKS).toContain(path);
  });
});

describe.each(HOOKS)("%s", (path) => {
  const src = readFileSync(path, "utf8");

  it("adds the injected patient in the same commit as its queue", () => {
    // Appending it in a SECOND setPatients after the list committed makes the
    // patient vanish from the page for the length of the fetch on every poll —
    // the form unmounts, and an unsaved note with it.
    expect(src).not.toMatch(/\[\s*\.\.\.prev\s*,\s*injected\s*\]/);
    expect(injectionCommits(src).length).toBeGreaterThan(0);
  });

  it("never adds the injected record raw — it goes through the overlay", () => {
    for (const arg of injectionCommits(src)) {
      expect(arg).not.toBe("injected");
    }
  });
});
