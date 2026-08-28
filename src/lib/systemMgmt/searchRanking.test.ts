/**
 * Search ranking — the guard on the 50-row display cap.
 *
 * `SystemMgmtPage` renders `results.slice(0, 50)`. The raw filter returns
 * patients in BOARD order (DTC Intake, Secondary Claims, Subscription, Profile
 * Send Off, …) then board position, and `fuzzyMatch` is a loose subsequence
 * test — so an exact match on a late board could be pushed past the cap by
 * fuzzy noise and never rendered. Live on 2026-08-28, "jose" matched 80
 * patients and Jose Delgado (Profile Send Off, Profile Clean-Up) was #55.
 */
import { describe, it, expect } from "vitest";
import { searchPatients } from "@/hooks/systemMgmt/useSystemPatients";
import type { SystemPatient } from "./mondayApi";

function patient(name: string, over: Partial<SystemPatient> = {}): SystemPatient {
  return {
    id: name.replace(/\W/g, ""),
    name,
    phone: "",
    boardId: 18406352652,
    boardName: "Profile Send Off",
    groupId: "group_mm5z87zt",
    groupTitle: "New Form — Partial Leads",
    roleRoute: "/unverified-referrals",
    pipelineStage: "New Form — Partial Leads",
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

/** The live shape: many fuzzy "j·o·s·e" hits ahead of the real patient. */
function joseHaystack(): SystemPatient[] {
  const noise = [
    "Bob Jones [TEST]", "John Forster", "Joseph McClellan", "Joseph Christie",
    "Joseph DiNapoli", "Joseph Odom", "Josephin Dimino", "Joseph Jedrzejek",
    "Jolene Sexton", "Joan Sanderson",
  ].map((n) => patient(n, { boardId: 18392794310, boardName: "DTC Intake" }));
  return [...noise, patient("Jose Delgado", { groupTitle: "Profile Clean-Up" })];
}

describe("searchPatients ranking", () => {
  it("lifts an exact substring match above fuzzy matches from earlier boards", () => {
    const results = searchPatients(joseHaystack(), "jose");
    // Every name in the haystack fuzzy-matches, so the filter alone would leave
    // Jose Delgado last — where the 50-row cap can hide him.
    expect(results.length).toBe(11);
    expect(results[0].name).toBe("Jose Delgado");
  });

  it("keeps the target inside the rendered window on a realistic queue", () => {
    // 80 "Joseph …" ahead of him, as the live board had. These are prefix
    // matches, not fuzzy ones — which is exactly why a starts-with rule was
    // not enough to rescue him.
    const noise = Array.from({ length: 80 }, (_, i) =>
      patient(`Joseph Filler ${i}`, { boardId: 18392794310, boardName: "DTC Intake" }),
    );
    const results = searchPatients([...noise, patient("Jose Delgado")], "jose");
    expect(results.slice(0, 50).some((p) => p.name === "Jose Delgado")).toBe(true);
  });

  it("ranks name-start above word-start above mid-word above fuzzy", () => {
    const pool = [
      patient("Ladysmith Jones"),     // mid-word substring
      patient("Sam Whitehead"),       // fuzzy only (s·m·i·t·h)
      patient("Rosemary Smithson"),   // later word, prefix only
      patient("Smithers Hall"),       // name start, prefix only
      patient("Eddie Smith"),         // whole word — what "smith" means
    ];
    expect(searchPatients(pool, "smith").map((p) => p.name)).toEqual([
      "Eddie Smith",
      "Smithers Hall",
      "Rosemary Smithson",
      "Ladysmith Jones",
      "Sam Whitehead",
    ]);
  });

  it("is stable within a rank, so board order still decides ties", () => {
    const pool = [
      patient("Eddie Smith", { id: "first", boardName: "DTC Intake" }),
      patient("Carrie Smith", { id: "second" }),
      patient("David Smith", { id: "third" }),
    ];
    expect(searchPatients(pool, "smith").map((p) => p.id)).toEqual([
      "first", "second", "third",
    ]);
  });

  it("ranks a phone hit above a loose name match", () => {
    const pool = [
      patient("Jared Ostrander"),                        // fuzzy "3475" ⇒ no
      patient("Maria Vega", { phone: "(347) 555-0101" }),
    ];
    const results = searchPatients(pool, "3475");
    expect(results.map((p) => p.name)).toEqual(["Maria Vega"]);
  });

  it("still matches nothing on an empty query", () => {
    expect(searchPatients(joseHaystack(), "   ")).toEqual([]);
  });

  it("finds both reported patients by full name", () => {
    const pool = [...joseHaystack(), patient("Eddie Smith")];
    expect(searchPatients(pool, "Jose Delgado").map((p) => p.name)).toEqual(["Jose Delgado"]);
    expect(searchPatients(pool, "Eddie Smith").map((p) => p.name)).toEqual(["Eddie Smith"]);
  });
});
