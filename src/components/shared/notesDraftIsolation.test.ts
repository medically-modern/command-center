import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Brandon, 2026-09-03: a note typed on Final Profile Confirmation, never Added,
 * survived "Confirm Profile & Send" AND the switch to the next patient — one
 * click from being filed under the wrong person. Two rules, both scanned from
 * source because a page that loses either does not fail, it quietly goes back
 * to leaking drafts:
 *
 *  1. Every notes box is keyed by the patient it shows, so a patient switch
 *     unmounts it (and its draft) instead of reusing the instance.
 *  2. Every notes box reports its draft to `lib/shared/pendingNote`, and every
 *     action that leaves the patient refuses while one is pending.
 */
const read = (p: string) => readFileSync(p, "utf8");

// Every place a stage mounts a notes box. SystemMgmtPage's <NotesPanel> is a
// different component (the Search escalation modal, opened per patient) and is
// deliberately not listed.
const MOUNTS = [
  "src/pages/WelcomeCallPage.tsx",
  "src/pages/FinalConfirmPage.tsx",
  "src/pages/SubscriptionPage.tsx",
  "src/pages/SubmitAuthPage.tsx",
  "src/pages/ChaseBenefitsPage.tsx",
  "src/pages/DvsPage.tsx",
  "src/components/samantha/AuthOutstandingPanel.tsx",
  "src/components/samantha/InsurancePanel.tsx",
  "src/components/masheke/EvaluatePanel.tsx",
  "src/components/masheke/SendRequestPanel.tsx",
  "src/components/masheke/ChaseClinicalsPanel.tsx",
];

describe.each(MOUNTS)("%s keys its notes box by patient", (path) => {
  it("every <NotesPanel mount carries key={…id}", () => {
    const lines = read(path).split("\n").filter((l) => l.includes("<NotesPanel"));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/key=\{(selected|patient)\.id\}/);
  });
});

const BOXES = [
  "src/components/finalConfirm/NotesPanel.tsx",
  "src/components/welcomeCall/NotesPanel.tsx",
  "src/components/subscription/NotesPanel.tsx",
  "src/components/samantha/NotesPanel.tsx",
  "src/components/masheke/NotesPanel.tsx",
  "src/pages/ProfilePage.tsx", // NotesComposer
  "src/pages/UnverifiedReferralsPage.tsx", // noteDraft
];

describe.each(BOXES)("%s reports its draft", (path) => {
  it("calls usePendingNoteReport with the live draft", () => {
    expect(read(path)).toMatch(/usePendingNoteReport\(/);
  });
});

// Actions that leave the patient: the send on each stage page, the three
// Profile Send Off exits, the intake exits, the Chase attempt save.
const GUARDED: [string, number][] = [
  ["src/pages/WelcomeCallPage.tsx", 1],
  ["src/pages/FinalConfirmPage.tsx", 1],
  ["src/pages/SubscriptionPage.tsx", 1],
  ["src/pages/ChaseBenefitsPage.tsx", 1],
  ["src/pages/SubmitAuthPage.tsx", 1],
  ["src/pages/AuthOutstandingPage.tsx", 1],
  ["src/pages/ProfilePage.tsx", 3],
  ["src/pages/UnverifiedReferralsPage.tsx", 1],
  ["src/components/masheke/ChaseClinicalsPanel.tsx", 1],
];

describe.each(GUARDED)("%s refuses to leave the patient with un-added note text", (path, count) => {
  it(`calls refusePendingNote() ${count}×`, () => {
    const n = (read(path).match(/refusePendingNote\(\)/g) ?? []).length;
    expect(n).toBe(count);
  });
});

describe("the masheke sends keep their own pending-text gate", () => {
  it.each(["src/components/masheke/EvaluatePanel.tsx", "src/components/masheke/SendRequestPanel.tsx"])("%s", (path) => {
    const src = read(path);
    expect(src).toMatch(/pendingNoteText\.trim\(\)\.length > 0/);
    // and reset it with the patient, or a remounted (empty) box would leave a stale block behind
    expect(src).toMatch(/setPendingNoteText\(""\)/);
  });
});
