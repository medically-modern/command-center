/**
 * The brakes on the Can Text lookup.
 *
 * It runs when a patient is OPENED, on a page a rep clicks through all day —
 * INCIDENT_2026-08-20's shape. What makes it safe is that the gateway answers
 * from Postgres with no RingCentral call; what keeps it cheap anyway is
 * everything pinned below. A miss that isn't cached, or an array dependency,
 * turns one lookup per patient into one per render.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";

const fetchCanTextEvidence = vi.fn();
vi.mock("@/lib/assignedPatients/messagingApi", () => ({
  fetchCanTextEvidence: (...a: unknown[]) => fetchCanTextEvidence(...a),
  messagingConfigured: () => true,
}));

import { useCanTextEvidence, __resetCanTextEvidence } from "./useCanTextEvidence";

const A = "(555) 555-0100";
const B = "5555550101";

function Probe({ numbers }: { numbers: string[] }) {
  // A NEW array identity every render — the caller shape this has to survive.
  const evidence = useCanTextEvidence([...numbers]);
  return <div data-testid="out">{JSON.stringify(evidence)}</div>;
}

beforeEach(() => {
  __resetCanTextEvidence();
  fetchCanTextEvidence.mockReset();
});

describe("useCanTextEvidence", () => {
  it("asks once and reports a yes keyed by the caller's own spelling", async () => {
    fetchCanTextEvidence.mockResolvedValue({ [A]: "yes" });
    const { getByTestId } = render(<Probe numbers={[A]} />);
    await waitFor(() => expect(getByTestId("out").textContent).toContain("yes"));
    expect(JSON.parse(getByTestId("out").textContent!)).toEqual({ [A]: "yes" });
    expect(fetchCanTextEvidence).toHaveBeenCalledTimes(1);
  });

  it("⚠️ CACHES MISSES — a patient we have never texted is not re-asked", async () => {
    fetchCanTextEvidence.mockResolvedValue({});
    const { rerender, getByTestId } = render(<Probe numbers={[A]} />);
    await waitFor(() => expect(fetchCanTextEvidence).toHaveBeenCalledTimes(1));
    rerender(<Probe numbers={[A]} />);
    rerender(<Probe numbers={[A]} />);
    await act(async () => {});
    expect(fetchCanTextEvidence).toHaveBeenCalledTimes(1);
    expect(getByTestId("out").textContent).toBe("{}");
  });

  it("does not re-ask on a re-render with a fresh array identity", async () => {
    fetchCanTextEvidence.mockResolvedValue({ [A]: "yes" });
    const { rerender } = render(<Probe numbers={[A, B]} />);
    await waitFor(() => expect(fetchCanTextEvidence).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 5; i++) rerender(<Probe numbers={[A, B]} />);
    await act(async () => {});
    expect(fetchCanTextEvidence).toHaveBeenCalledTimes(1);
  });

  it("asks only about numbers it has not already asked about", async () => {
    fetchCanTextEvidence.mockResolvedValue({});
    const { rerender } = render(<Probe numbers={[A]} />);
    await waitFor(() => expect(fetchCanTextEvidence).toHaveBeenCalledTimes(1));
    rerender(<Probe numbers={[A, B]} />);
    await waitFor(() => expect(fetchCanTextEvidence).toHaveBeenCalledTimes(2));
    // The second call carries the NEW number only.
    expect(fetchCanTextEvidence.mock.calls[1][0]).toEqual([B.replace(/\D/g, "")]);
  });

  it("⚠️ does NOT cache a failure, and never surfaces one", async () => {
    fetchCanTextEvidence.mockRejectedValueOnce(new Error("gateway down"));
    const { getByTestId, unmount } = render(<Probe numbers={[A]} />);
    await waitFor(() => expect(fetchCanTextEvidence).toHaveBeenCalledTimes(1));
    // Silent: the rep is simply asked the question, as they were before.
    expect(getByTestId("out").textContent).toBe("{}");
    unmount();

    fetchCanTextEvidence.mockResolvedValue({ [A]: "yes" });
    const again = render(<Probe numbers={[A]} />);
    await waitFor(() => expect(again.getByTestId("out").textContent).toContain("yes"));
  });

  it("asks nothing for a patient with no number", async () => {
    render(<Probe numbers={["", "   "]} />);
    await act(async () => {});
    expect(fetchCanTextEvidence).not.toHaveBeenCalled();
  });
});
