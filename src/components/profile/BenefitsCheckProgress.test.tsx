/**
 * The benefits-check progress card (Brandon, 2026-09-24: *"make the 'Running
 * benefits check…' … a little sexier looking - it looks like 1990's arial font
 * with poor spacing"*) — and the page wiring that decides whose screen it is on.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { BenefitsCheckProgress, SLOW_AFTER_SECONDS, formatElapsed } from "./BenefitsCheckProgress";

afterEach(() => vi.useRealTimers());

describe("BenefitsCheckProgress", () => {
  it("names the step the run is really on, and ticks the ones behind it", () => {
    const { container } = render(<BenefitsCheckProgress phase="verifying" startedAt={Date.now()} />);
    expect(screen.getByRole("status")).toHaveTextContent("Confirming they saved…");
    const steps = [...container.querySelectorAll("li")];
    expect(steps.map((li) => li.className)).toEqual(["bcp-step done", "bcp-step now", "bcp-step todo"]);
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(steps[0]).toHaveTextContent("✓Save details");
  });

  it("the payer step says how long it usually takes, then that it is running long", () => {
    vi.useFakeTimers();
    const start = Date.now();
    render(<BenefitsCheckProgress phase="running" startedAt={start} />);
    expect(screen.getByRole("status")).toHaveTextContent("Asking the payer…");
    expect(screen.getByText(/usually 20 to 40 seconds/)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime((SLOW_AFTER_SECONDS + 1) * 1000); });
    expect(screen.getByText(/Taking longer than usual/)).toBeInTheDocument();
    expect(screen.getByText(formatElapsed(SLOW_AFTER_SECONDS + 1))).toBeInTheDocument();
  });

  it("draws nothing for a phase that is not a running one", () => {
    for (const phase of ["idle", "done", "error"] as const) {
      const { container } = render(<BenefitsCheckProgress phase={phase} startedAt={null} />);
      expect(container).toBeEmptyDOMElement();
    }
  });

  it("formats the clock as m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(7.9)).toBe("0:07");
    expect(formatElapsed(72)).toBe("1:12");
  });
});

describe("the intake page renders it for the right patient only", () => {
  const page = readFileSync(join(process.cwd(), "src/pages/UnverifiedReferralsPage.tsx"), "utf8");

  it("the card replaces the bare 'Running benefits check…' line", () => {
    expect(page).toContain("{stediHere && (\n                  <BenefitsCheckProgress");
    // The button no longer repeats what the card says.
    expect(page).not.toContain('"Running benefits check…" : "Run benefits check"');
    // The old line — a Tailwind margin `.pf-root *` zeroes — is gone.
    expect(page).not.toMatch(/"mt-2 text-xs " \+\s*\(stedi\.state\.phase/);
  });

  it("every Stedi line is scoped to the patient the run was for", () => {
    expect(page).toContain("const stediHere = !!selected && stedi.state.runningId === selected.id;");
    expect(page).toContain("const stediAbout = !!selected && stedi.state.forId === selected.id;");
    expect(page).toContain('stediAbout && stedi.state.phase === "error"');
    expect(page).toContain('stediAbout && stedi.state.phase === "done"');
    // A greyed-out Run says why when the check running is somebody else's.
    expect(page).toContain("{stediElsewhere && (");
  });
});
