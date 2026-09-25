/**
 * The header search, rendered — Brandon's row (name · DOB, the stage chip, WHICH
 * field matched) and his count line (§5.52). The search itself is mocked; what
 * is pinned here is what a rep sees for a given answer.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const state = {
  results: [] as unknown[],
  searching: false,
  tooShort: false,
  error: null as string | null,
};
const useLiveSearch = vi.fn();
vi.mock("@/hooks/systemMgmt/useLiveSearch", () => ({
  useLiveSearch: (...a: unknown[]) => useLiveSearch(...a),
}));

import { GlobalSearch } from "./GlobalSearch";
import { MAX_ROWS, SEARCH_PLACEHOLDER, SEARCH_SCOPE } from "@/lib/shell/searchRow";
import type { SearchFieldValues, SystemPatient } from "@/lib/systemMgmt/mondayApi";

const fields = (over: Partial<SearchFieldValues> = {}): SearchFieldValues => ({
  memberIds: [],
  doctors: [],
  clinics: [],
  doctorPhones: [],
  insurances: [],
  orderNumbers: [],
  poNumbers: [],
  trackingNumbers: [],
  ...over,
});

function row(over: Partial<SystemPatient> & { id: string }): SystemPatient {
  return {
    name: "JAMIE RIVERS",
    phone: "5555550142",
    dob: "03/14/1958",
    boardId: 18410601299,
    boardName: "Insurance",
    groupId: "g",
    groupTitle: "Benefits",
    roleRoute: "/benefits",
    pipelineStage: "Benefits / SoS",
    escalated: false,
    escalationText: "",
    escalationLevel: null,
    escalationNotes: "",
    hasPage: true,
    isCompleted: false,
    daysSinceStage: "",
    notes: "",
    stageAdvancerText: "",
    nextActionDate: "",
    stageStart: "",
    createdAt: "",
    fields: fields({ insurances: ["Humana"], memberIds: ["W123456789"] }),
    ...over,
  };
}

function type(text: string) {
  render(
    <MemoryRouter>
      <GlobalSearch />
    </MemoryRouter>,
  );
  const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
  fireEvent.change(input, { target: { value: text } });
  return input;
}

beforeEach(() => {
  state.results = [];
  state.searching = false;
  state.tooShort = false;
  state.error = null;
  useLiveSearch.mockReset();
  useLiveSearch.mockImplementation(() => ({ ...state, searchedQuery: "", refresh: () => {} }));
});

describe("the header search asks the WIDE question", () => {
  it("passes fields: true to the hook — member id, doctor, clinic, doctor phone, insurance", () => {
    type("humana");
    const last = useLiveSearch.mock.calls.at(-1)!;
    expect(last[0]).toBe("humana");
    expect(last[1]).toEqual({ fields: true });
  });

  it("⚠️ and only the header does — the other two search boxes are unchanged", () => {
    // Josh, 2026-09-24: "leave communications alone". The System Management
    // box is on its way out and was not asked for either.
    const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
    expect(read("src/components/shell/GlobalSearch.tsx")).toContain("fields: true");
    expect(read("src/pages/SystemMgmtPage.tsx")).not.toContain("fields: true");
    expect(read("src/components/commsHub/DossierSearch.tsx")).not.toContain("fields: true");
  });

  it("the placeholder names only what the box searches", () => {
    expect(SEARCH_PLACEHOLDER).toBe("Search patient name, DOB, phone, member ID, order #, doctor…");
    expect(SEARCH_SCOPE).toContain("insurance");
  });
});

describe("a row", () => {
  it("is the name · DOB, the stage chip, and WHICH field matched", () => {
    state.results = [row({ id: "1" })];
    type("humana");
    const btn = screen.getByRole("option");
    expect(btn.querySelector(".nm")?.textContent).toBe("JAMIE RIVERS");
    expect(btn.querySelector(".dob")?.textContent).toBe(" · DOB 03/14/1958");
    expect(btn.querySelector(".st")?.textContent).toBe("Benefits / SoS");
    expect(btn.querySelector(".st")?.className).toContain("onb");
    expect(btn.querySelector(".hit")?.textContent).toBe("Insurance Humana");
    expect(btn.querySelector(".hit b")?.textContent).toBe("Humana");
  });

  it("⚠️ a NAME match prints no caption — the name is the row", () => {
    state.results = [row({ id: "1" })];
    type("jamie");
    expect(screen.getByRole("option").querySelector(".hit")?.textContent).toBe("");
  });

  it("a Subscription patient wears the green chip, a stuck one the red", () => {
    state.results = [
      row({ id: "s", boardId: 18407459988, boardName: "Subscription Board", pipelineStage: "Subscriptions", name: "SUB PERSON", phone: "5555550100", dob: "" }),
      row({ id: "k", groupId: "group_mm5g7twt", groupTitle: "Stuck", pipelineStage: "Stuck", name: "STUCK PERSON", phone: "5555550101", dob: "" }),
    ];
    type("person");
    const chips = screen.getAllByRole("option").map((b) => b.querySelector(".st")?.className ?? "");
    expect(chips.some((c) => c.includes("sub"))).toBe(true);
    expect(chips.some((c) => c.includes("stuck"))).toBe(true);
  });
});

describe("the count line", () => {
  it("counts PEOPLE and says what the box searches", () => {
    state.results = [row({ id: "1" }), row({ id: "2", boardId: 18410804557, boardName: "Welcome Call" })];
    type("humana");
    expect(screen.getByText(`1 match · Enter opens the first · ${SEARCH_SCOPE}`)).toBeTruthy();
  });

  it("says when the rows on screen are not all of them", () => {
    state.results = Array.from({ length: MAX_ROWS + 3 }, (_, i) =>
      row({ id: String(i), name: `PERSON ${i}`, phone: `55555501${String(i).padStart(2, "0")}`, dob: "" }),
    );
    type("person");
    expect(screen.getAllByRole("option")).toHaveLength(MAX_ROWS);
    expect(screen.getByText(new RegExp(`^Showing ${MAX_ROWS} of ${MAX_ROWS + 3} matches`))).toBeTruthy();
  });

  it("is replaced by 'Still looking…' while a pass is still running", () => {
    state.results = [row({ id: "1" })];
    state.searching = true;
    type("humana");
    expect(screen.getByText("Still looking…")).toBeTruthy();
    expect(screen.queryByText(/Enter opens the first/)).toBeNull();
  });
});

describe("the empty states", () => {
  it("nobody found — names the query and the next thing to try", () => {
    type("zzz");
    expect(screen.getByText("No patient matches “zzz”. Try the phone number or DOB.")).toBeTruthy();
  });

  it("too short — says what to type", () => {
    state.tooShort = true;
    type("z");
    expect(screen.getByText(/^Keep typing — a name, DOB, phone, member ID/)).toBeTruthy();
  });

  it("the search failed — says so, never 'no patient'", () => {
    state.error = "Monday request failed (503)";
    type("zzz");
    expect(screen.getByText(/Couldn't reach Monday — Monday request failed/)).toBeTruthy();
    expect(screen.queryByText(/No patient matches/)).toBeNull();
  });
});
