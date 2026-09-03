/**
 * The live search's pure halves: what a typed query asks Monday for, and how
 * the rows Monday returns are ordered without losing any of them.
 */
import { describe, it, expect } from "vitest";
import { liveSearchRules, LIVE_SEARCH_PER_BOARD } from "./mondayApi";
import { rankLiveResults, searchPatients } from "@/hooks/systemMgmt/useSystemPatients";
import type { SystemPatient } from "./mondayApi";

function patient(name: string, over: Partial<SystemPatient> = {}): SystemPatient {
  return {
    id: name.replace(/\W/g, ""),
    name,
    phone: "",
    boardId: 18406352652,
    boardName: "Profile Send Off",
    groupId: "group_mm1xf2jb",
    groupTitle: "Intake",
    roleRoute: "/profile",
    pipelineStage: "Intake",
    escalated: false,
    escalationText: "",
    escalationLevel: null,
    escalationNotes: "",
    hasPage: true,
    isCompleted: false,
    daysSinceStage: "0–2 Days",
    notes: "",
    stageAdvancerText: "",
    nextActionDate: "",
    ...over,
  };
}

describe("liveSearchRules", () => {
  it("asks nothing for an empty or one-letter query", () => {
    expect(liveSearchRules("")).toBeNull();
    expect(liveSearchRules("   ")).toBeNull();
    expect(liveSearchRules("j")).toBeNull();
  });

  it("searches the name by word, ANDed, so word order doesn't matter to Monday", () => {
    expect(liveSearchRules("jose delgado")).toEqual({ kind: "name", terms: ["jose", "delgado"] });
    expect(liveSearchRules("  Delgado,   Jose ")).toEqual({ kind: "name", terms: ["Delgado,", "Jose"] });
  });

  it("caps the number of name terms", () => {
    const r = liveSearchRules("a b c d e f");
    expect(r?.kind).toBe("name");
    expect(r && r.kind === "name" ? r.terms.length : 0).toBeLessThanOrEqual(4);
  });

  it("treats digits with phone punctuation as a phone search on the bare digits", () => {
    expect(liveSearchRules("(347) 555-0101")).toEqual({ kind: "phone", digits: "3475550101" });
    expect(liveSearchRules("+1 347 555 0101")).toEqual({ kind: "phone", digits: "13475550101" });
    expect(liveSearchRules("0101")).toEqual({ kind: "phone", digits: "0101" });
  });

  it("needs three digits before it will ring Monday for a phone", () => {
    expect(liveSearchRules("34")).toBeNull();
    expect(liveSearchRules("347")).toEqual({ kind: "phone", digits: "347" });
  });

  it("fetches a bounded page per board", () => {
    expect(LIVE_SEARCH_PER_BOARD).toBeGreaterThanOrEqual(50);
    expect(LIVE_SEARCH_PER_BOARD).toBeLessThanOrEqual(500);
  });
});

describe("rankLiveResults", () => {
  it("keeps every row Monday matched, even one the local ranker cannot score", () => {
    // "jose delgado" is not a substring of "Delgado, Jose" and the subsequence
    // fallback fails too — the snapshot ranker DROPS this row.
    const rows = [patient("Delgado, Jose"), patient("Jose Delgado")];
    expect(searchPatients(rows, "jose delgado").map((p) => p.name)).toEqual(["Jose Delgado"]);
    expect(rankLiveResults(rows, "jose delgado").map((p) => p.name)).toEqual([
      "Jose Delgado",
      "Delgado, Jose",
    ]);
  });

  it("lifts the exact name above prefixes, and is stable within a rank", () => {
    const rows = [patient("Joseph Odom"), patient("Joseph Christie"), patient("Jose Delgado")];
    expect(rankLiveResults(rows, "jose").map((p) => p.name)).toEqual([
      "Jose Delgado",
      "Joseph Odom",
      "Joseph Christie",
    ]);
  });

  it("ranks phone hits first on a digits query", () => {
    const rows = [patient("Ann 3475", { phone: "" }), patient("Bob", { phone: "(347) 555-0101" })];
    expect(rankLiveResults(rows, "3475").map((p) => p.name)).toEqual(["Bob", "Ann 3475"]);
  });
});
