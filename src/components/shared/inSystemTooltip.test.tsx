/**
 * The "Already in System" hover (Brandon, 2026-09-29) — rendered, and wired
 * onto every pill that says it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { InSystemTooltip } from "./InSystemTooltip";

const NOTE = `[9/2/2026, 10:05 AM] Duplicate Check: Duplicate
Linked by: phone, DOB.
Recommended: Close this referral as a duplicate.
Straight duplicate of a patient we already have, with nothing new. Phone and DOB matched.
—Claude`;

describe("InSystemTooltip", () => {
  it("shows the label and the one sentence when the pill is focused", async () => {
    render(
      <InSystemTooltip notes={NOTE} verdict="Duplicate">
        <span tabIndex={0}>Already in System</span>
      </InSystemTooltip>,
    );
    await act(async () => {
      fireEvent.focus(screen.getByText("Already in System"));
    });
    const hint = await screen.findAllByText("Straight duplicate of a patient we already have, with nothing new.");
    expect(hint.length).toBeGreaterThan(0);
  });

  it("notes not read yet → the caller's line, never 'no write-up'", async () => {
    render(
      <InSystemTooltip notes={undefined} pending="Matched to a patient we already have">
        <span tabIndex={0}>Already in System</span>
      </InSystemTooltip>,
    );
    await act(async () => {
      fireEvent.focus(screen.getByText("Already in System"));
    });
    expect((await screen.findAllByText("Matched to a patient we already have")).length).toBeGreaterThan(0);
  });
});

describe("wiring — every Already in System pill carries the hover", () => {
  const files = [
    "src/components/careCoordinator/PatientCard.tsx",
    "src/pages/ProfilePage.tsx",
    "src/pages/UnverifiedReferralsPage.tsx",
    "src/components/profile/PatientsSidebar.tsx",
  ];
  for (const f of files) {
    it(f, () => {
      const src = readFileSync(f, "utf8");
      expect(src).toMatch(/<InSystemTooltip[\s\S]{0,1200}?(Already In System|Already in System|In system)/);
    });
  }
  it("the dashboard card passes the verdict it already reads", () => {
    const cards = readFileSync("src/components/careCoordinator/cards.tsx", "utf8");
    expect(cards.match(/inSystemVerdict=\{lead\.dupCheckResult\}/g)?.length).toBe(3);
  });
});
