/**
 * The column header's Today / Future groupings, and the load bar's two shapes.
 * Which bar branch renders is decided by whether a denominator exists at all,
 * and getting that wrong is silent — an invented percentage looks exactly
 * like a real one.
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { PipelineColumn, Section } from "./PipelineColumn";
import { emptyProgress } from "@/lib/careCoordinator/loadProgress";

const summary = { today: { scheduled: 2, unscheduled: 5 }, future: { scheduled: 1, unscheduled: 3 }, total: 11, overdue: 1 };

const column = (progress: React.ComponentProps<typeof PipelineColumn>["progress"], onHorizon = vi.fn()) =>
  render(
    <PipelineColumn title="Patient Intake" accent="intake" summary={summary} horizon="today" onHorizon={onHorizon} progress={progress}>
      <div />
    </PipelineColumn>,
  );

describe("PipelineColumn header", () => {
  it("shows both groupings' counts and reports the clicked one", () => {
    const onHorizon = vi.fn();
    column(null, onHorizon);
    const group = screen.getByRole("group", { name: /Patient Intake — Today or Future/ });
    const [today, future] = within(group).getAllByRole("button");
    expect(today).toHaveAttribute("aria-pressed", "true");
    expect(today).toHaveTextContent(/Today.*Scheduled: 2.*Unscheduled: 5/);
    expect(future).toHaveTextContent(/Future.*Scheduled: 1.*Unscheduled: 3/);
    fireEvent.click(future);
    expect(onHorizon).toHaveBeenCalledWith("future");
  });
});

describe("Section", () => {
  it("collapses, counts, and pages with a fallback button where the observer is absent", () => {
    const kids = Array.from({ length: 15 }, (_, i) => <div key={i}>Row {i}</div>);
    render(<Section title="Unscheduled" count={15} tone="unscheduled">{kids}</Section>);
    expect(screen.getByText("Row 0")).toBeInTheDocument();
    expect(screen.queryByText("Row 12")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /3 more/ }));
    expect(screen.getByText("Row 14")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Unscheduled/ }));
    expect(screen.queryByText("Row 0")).toBeNull();
  });
});

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
