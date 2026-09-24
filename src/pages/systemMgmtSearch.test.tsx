/**
 * System Management → Search, rendered, on the path where Monday finds nobody.
 *
 * Reported 2026-09-24: a manager searched a name, the box said "Searching all
 * boards for …" with a spinner and never stopped. The patient is filed on
 * every board under a different first name, so the honest answer was "No
 * patients found" — but the page only renders that once `searchedQuery`
 * equals `query.trim()`, and the hook stored the raw text. A name typed or
 * pasted with a space on either end therefore never counted as answered, and
 * the empty result sat behind a spinner for ever. Nothing errored anywhere:
 * the request had long since come back.
 *
 * The hook's half of the contract is in useLiveSearch.test.tsx; this pins what
 * the rep actually sees.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const searchPatientsLive = vi.fn();
vi.mock("@/lib/systemMgmt/mondayApi", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/systemMgmt/mondayApi")>();
  return { ...mod, searchPatientsLive: (...a: unknown[]) => searchPatientsLive(...a) };
});

// The seven-board snapshot feeds only the chart and the totals; Search must
// answer without it, so the page is rendered with an empty one.
vi.mock("@/hooks/systemMgmt/useSystemPatients", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/hooks/systemMgmt/useSystemPatients")>();
  return {
    ...mod,
    useSystemPatients: () => ({
      patients: [],
      escalated: [],
      completionMap: new Map(),
      loading: false,
      hydrating: false,
      error: null,
      refetch: async () => {},
      removeEscalation: async () => {},
    }),
  };
});

import SystemMgmtPage from "./SystemMgmtPage";

function renderSearch() {
  render(
    <MemoryRouter initialEntries={["/system-mgmt?tab=search"]}>
      <SystemMgmtPage />
    </MemoryRouter>,
  );
  return screen.getByPlaceholderText(/Search by patient name/);
}

beforeEach(() => {
  searchPatientsLive.mockReset();
  searchPatientsLive.mockResolvedValue([]);
});

describe("System Management search — nobody found", () => {
  it("says so, rather than searching for ever", async () => {
    const box = renderSearch();
    fireEvent.change(box, { target: { value: "jane doe" } });
    expect(await screen.findByText(/No patients found matching/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(/Searching all boards/)).not.toBeInTheDocument();
  });

  it("says so when the name was typed with a space on either end", async () => {
    const box = renderSearch();
    fireEvent.change(box, { target: { value: " jane doe " } });
    expect(await screen.findByText(/No patients found matching/, {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByText(/Searching all boards/)).not.toBeInTheDocument();
    expect(searchPatientsLive).toHaveBeenCalledTimes(1);
    expect(searchPatientsLive.mock.calls[0][0]).toBe("jane doe");
  });
});
