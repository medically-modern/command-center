/**
 * The load bar's two shapes. Which branch renders is decided by whether a
 * denominator exists at all, and getting that wrong is silent — an invented
 * percentage looks exactly like a real one.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { PipelineColumn } from "./PipelineColumn";
import { emptyProgress } from "@/lib/careCoordinator/loadProgress";

const column = (progress: React.ComponentProps<typeof PipelineColumn>["progress"]) =>
  render(
    <PipelineColumn tint="sky" title="Patient Intake" subtitle="sub" count={0} progress={progress}>
      <div />
    </PipelineColumn>,
  );

describe("PipelineColumn load bar", () => {
  it("names the column, counts real rows and shows a percentage when one is earned", () => {
    column({ ...emptyProgress(1754), loaded: 1204, pages: 3 });
    const bar = screen.getByRole("progressbar", { name: "Loading Patient Intake" });
    expect(bar).toHaveTextContent("Loading patient intake…");
    expect(bar).toHaveTextContent("1,204 of ~1,754 patients");
    expect(bar).toHaveTextContent("69%");
    expect(bar).toHaveAttribute("aria-valuenow", "69");
  });

  it("goes indeterminate — no number, no aria position — when nothing is remembered", () => {
    // A first-ever visit. Monday reports no total, so there is nothing to be a
    // percentage OF, and reporting 0 would be read aloud as stalled.
    column({ ...emptyProgress(null), loaded: 500, pages: 1 });
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveTextContent("500 patients");
    expect(bar.textContent).not.toMatch(/%/);
    expect(bar).not.toHaveAttribute("aria-valuenow");
  });

  it("renders no bar at all when nothing is loading", () => {
    column(null);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
