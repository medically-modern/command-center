import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Every patient queue hides a patient the moment a send advances them out of
 * it (lib/shared/pendingAdvance). This scans the source for that wiring rather
 * than testing behaviour, for the same reason `listColumns.test.ts` scans:
 * a queue that loses the guard does not fail — it goes back to showing an
 * advanced patient, with a live Send button, until the next poll, which is
 * exactly the state that got three patients re-sent on 2026-09-03.
 *
 * ⚠️ Three hazards, one per assertion:
 *  1. `applyPendingAdvances` must be applied to the list the sidebar renders,
 *     or the hide disagrees with the queue and hides the wrong people.
 *  2. The deep-link injection must respect the marker, or a re-injected
 *     patient gets the live Send button straight back.
 *  3. `markAdvanced` must be exported, or no page can call it.
 */
const HOOKS = [
  "src/hooks/masheke/useMondayPatients.ts",
  "src/hooks/samantha/useMondayPatients.ts",
  "src/hooks/welcomeCall/useMondayPatients.ts",
  "src/hooks/finalConfirm/useMondayPatients.ts",
  "src/hooks/profile/useMondayPatients.ts",
];

describe.each(HOOKS)("%s", (path) => {
  const src = readFileSync(path, "utf8");

  it("applies the pending-advance filter to its own queue list", () => {
    expect(src).toContain('from "@/lib/shared/pendingAdvance"');
    expect(src).toContain("applyPendingAdvances(");
  });

  it("does not re-inject a deep-linked patient it just hid", () => {
    expect(src).toMatch(/!pendingAdvanceRef\.current\.has\(/);
  });

  it("exposes markAdvanced so a page can call it on a confirmed advance", () => {
    expect(src).toMatch(/const markAdvanced = useCallback\(/);
    expect(src).toMatch(/return \{[\s\S]{0,400}markAdvanced/);
  });
});

/**
 * The pages that own an advancing send must actually call it — a hook that
 * offers `markAdvanced` and a page that never calls it looks wired and is not.
 * Listed per queue rather than globbed: a page absent from this list is a
 * deliberate carve-out (Subscription writes no Stage Advancer at all; the two
 * Chase pages log attempts and never leave the stage; DVS is a read-only
 * monitor), and adding one should be a decision, not an accident.
 */
const CALLERS = [
  "src/pages/EvaluatePage.tsx",
  "src/pages/SendRequestPage.tsx",
  "src/pages/ConfirmReceiptPage.tsx",
  "src/pages/ChaseBenefitsPage.tsx",
  "src/pages/SubmitAuthPage.tsx",
  "src/pages/AuthOutstandingPage.tsx",
  "src/pages/WelcomeCallPage.tsx",
  "src/pages/FinalConfirmPage.tsx",
  "src/pages/ProfilePage.tsx",
  "src/pages/UnverifiedReferralsPage.tsx",
];

describe.each(CALLERS)("%s", (path) => {
  const src = readFileSync(path, "utf8");
  it("takes markAdvanced from the hook and calls it", () => {
    expect(src).toContain("markAdvanced");
    expect(src).toMatch(/markAdvanced\(/);
  });
});

describe("the Insurance pages gate the hide on what the send actually wrote", () => {
  it.each([
    ["src/pages/ChaseBenefitsPage.tsx", "benefits"],
    ["src/pages/SubmitAuthPage.tsx", "submitAuth"],
    ["src/pages/AuthOutstandingPage.tsx", "authOutstanding"],
  ])("%s", (path, queue) => {
    // ⚠️ Insurance is the one board where a send can legitimately write NO
    // stage (Auth Outstanding with nothing resolved) or this queue's own stage
    // (Benefits SoS). Hiding unconditionally there takes live work off the
    // rep's screen — so these three must go through `stageLeavesQueue`.
    const src = readFileSync(path, "utf8");
    expect(src).toContain(`stageLeavesQueue(sent.stageIndex, "${queue}")`);
  });
});
