/**
 * The safety properties of the shared name-directory store.
 *
 * These are not incidental. Resolving a name per row is exactly the shape of
 * INCIDENT_2026-08-20_RINGCENTRAL.md, and CLAUDE.md §5.28 forbade doing it at
 * all until this store made it a batched read. What follows pins the brakes —
 * plus the one thing a review caught before it reached a rep: a failed Monday
 * batch must not be remembered as "these people are on no board".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";

const fetchDirectoryNames = vi.fn();
vi.mock("@/lib/commsHub/dossierApi", () => ({
  fetchDirectoryNames: (...args: unknown[]) => fetchDirectoryNames(...args),
}));

import { useDirectoryNames, __resetDirectoryNamesForTest } from "./useDirectoryNames";

const TONASILA = "8155237259";
const JEANNIE = "5305293799";

/** A resolved batch, in the shape the API returns. */
const ok = (pairs: [string, string][] = []) => ({ ok: true, names: new Map(pairs) });

/** A promise this test controls the settling of — how a pass is held in flight
 *  while another call arrives. */
function deferred() {
  let resolve: (v: unknown) => void = () => {};
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function Probe({ keys, tag = "out" }: { keys: string[]; tag?: string }) {
  // A NEW array identity every render — the caller shape this hook has to
  // survive. Handing an array straight to a dep array is how the incident
  // happened.
  const names = useDirectoryNames([...keys]);
  return <span data-testid={tag}>{names.get(TONASILA) ?? "—"}</span>;
}

describe("useDirectoryNames", () => {
  beforeEach(() => {
    __resetDirectoryNamesForTest();
    fetchDirectoryNames.mockReset();
    fetchDirectoryNames.mockResolvedValue(ok([[TONASILA, "Tonasila Gray"]]));
  });

  it("resolves a number to the name our boards hold", async () => {
    render(<Probe keys={[TONASILA]} />);
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("Tonasila Gray"));
  });

  it("makes ONE request no matter how many consumers are mounted", async () => {
    render(
      <>
        <Probe keys={[TONASILA]} tag="a" />
        <Probe keys={[TONASILA]} tag="b" />
        <Probe keys={[TONASILA]} tag="c" />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId("a")).toHaveTextContent("Tonasila Gray"));
    expect(fetchDirectoryNames).toHaveBeenCalledTimes(1);
  });

  it("asks about a number ONCE per session, misses included", async () => {
    // ⚠️ Without the miss-caching, every unmatched number is asked about again
    // on the next render that changes the list — forever.
    fetchDirectoryNames.mockResolvedValue(ok());
    const { rerender } = render(<Probe keys={[TONASILA]} />);
    await waitFor(() => expect(fetchDirectoryNames).toHaveBeenCalledTimes(1));
    rerender(<Probe keys={[TONASILA, JEANNIE]} />);
    await waitFor(() => expect(fetchDirectoryNames).toHaveBeenCalledTimes(2));
    // Only the number we have no answer for is in the second batch.
    expect(fetchDirectoryNames.mock.calls[1][0]).toEqual([JEANNIE]);
  });

  it("does NOT record a failed batch as 'on no board'", async () => {
    // The bug this test exists for: Monday 500s and 503s happen (§9 records ten
    // on 2026-09-01 alone). Caching that as a miss froze 60 conversations at a
    // bare phone number for the rest of the session, with nothing retrying.
    fetchDirectoryNames.mockResolvedValueOnce({ ok: false, names: new Map() });
    const { rerender } = render(<Probe keys={[TONASILA]} />);
    await waitFor(() => expect(fetchDirectoryNames).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("out")).toHaveTextContent("—");

    // The next pass asks again, and the name lands.
    rerender(<Probe keys={[TONASILA, JEANNIE]} />);
    await waitFor(() => expect(screen.getByTestId("out")).toHaveTextContent("Tonasila Gray"));
    expect(fetchDirectoryNames.mock.calls[1][0]).toContain(TONASILA);
  });

  it("does not re-fetch when the caller re-renders with an equal set of keys", async () => {
    // The dependency is a value-compared STRING, not the array — a caller
    // rebuilding the array on every render must not re-fire the effect.
    const { rerender } = render(<Probe keys={[TONASILA]} />);
    await waitFor(() => expect(fetchDirectoryNames).toHaveBeenCalledTimes(1));
    for (let i = 0; i < 5; i++) rerender(<Probe keys={[TONASILA]} />);
    await act(async () => {});
    expect(fetchDirectoryNames).toHaveBeenCalledTimes(1);
  });

  it("treats a re-ordered list as the same set", async () => {
    // A poll landing in a different order is not new information.
    const { rerender } = render(<Probe keys={[TONASILA, JEANNIE]} />);
    await waitFor(() => expect(fetchDirectoryNames).toHaveBeenCalledTimes(1));
    rerender(<Probe keys={[JEANNIE, TONASILA]} />);
    await act(async () => {});
    expect(fetchDirectoryNames).toHaveBeenCalledTimes(1);
  });

  it("fetches nothing at all when disabled", async () => {
    function Off() {
      useDirectoryNames([TONASILA], false);
      return <span data-testid="off">x</span>;
    }
    render(<Off />);
    await act(async () => {});
    expect(fetchDirectoryNames).not.toHaveBeenCalled();
  });

  it("ignores keys that aren't a full 10 digits", async () => {
    render(<Probe keys={["911", "", TONASILA]} />);
    await waitFor(() => expect(fetchDirectoryNames).toHaveBeenCalledTimes(1));
    expect(fetchDirectoryNames.mock.calls[0][0]).toEqual([TONASILA]);
  });

  it("never runs two passes at once, even after an earlier one settles", async () => {
    // ⚠️ The exact regression this guards: attaching the `finally` to the wrong
    // promise let an OLDER pass null out `inflight` the moment IT settled —
    // while the pass chained behind it had only just started — so the next call
    // saw an empty slot and ran a THIRD pass alongside. Two resolves cannot
    // catch that; it takes three, with the second still in flight.
    const gate1 = deferred();
    const gate2 = deferred();
    fetchDirectoryNames.mockImplementationOnce(() => gate1.promise);
    fetchDirectoryNames.mockImplementationOnce(() => gate2.promise);

    const { rerender } = render(<Probe keys={[TONASILA]} />);
    await waitFor(() => expect(fetchDirectoryNames).toHaveBeenCalledTimes(1));

    // Pass 2 queues behind pass 1.
    rerender(<Probe keys={[TONASILA, JEANNIE]} />);
    await act(async () => {});
    expect(fetchDirectoryNames).toHaveBeenCalledTimes(1);

    // Pass 1 settles, so pass 2's request goes out — but it is NOT finished.
    await act(async () => {
      gate1.resolve(ok([[TONASILA, "Tonasila Gray"]]));
    });
    await waitFor(() => expect(fetchDirectoryNames).toHaveBeenCalledTimes(2));

    // A third set arrives while pass 2 is still in flight. It must QUEUE, not
    // run alongside — with the bug, `inflight` was already null here and this
    // fired a third request immediately.
    rerender(<Probe keys={[TONASILA, JEANNIE, "3046977788"]} />);
    await act(async () => {});
    expect(fetchDirectoryNames).toHaveBeenCalledTimes(2);

    // And once pass 2 lands, the queued pass runs.
    await act(async () => {
      gate2.resolve(ok());
    });
    await waitFor(() => expect(fetchDirectoryNames).toHaveBeenCalledTimes(3));
  });
});
