/**
 * The live search's pure halves: what a typed query asks Monday for, and how
 * the rows Monday returns are ordered without losing any of them.
 */
import { describe, it, expect } from "vitest";
import {
  LIVE_SEARCH_PER_BOARD,
  dobNeedles,
  liveSearchRules,
  looseSearchTerms,
  phoneNeedlesFor,
} from "./mondayApi";
import { rankLiveResults, searchPatients } from "@/hooks/systemMgmt/useSystemPatients";
import type { SystemPatient } from "./mondayApi";

function patient(name: string, over: Partial<SystemPatient> = {}): SystemPatient {
  return {
    id: name.replace(/\W/g, ""),
    name,
    phone: "",
    dob: "",
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
    expect(liveSearchRules("  Delgado,   Jose ")).toEqual({ kind: "name", terms: ["Delgado", "Jose"] });
  });

  it("strips punctuation from the ends of words but not the middle of a name", () => {
    expect(liveSearchRules("O'Brien, Mary.")).toEqual({ kind: "name", terms: ["O'Brien", "Mary"] });
    expect(liveSearchRules("smith-jones")).toEqual({ kind: "name", terms: ["smith-jones"] });
    // A word that is ONLY punctuation contributes no rule.
    expect(liveSearchRules("jose , delgado")).toEqual({ kind: "name", terms: ["jose", "delgado"] });
  });

  it("still asks nothing when punctuation is all there is", () => {
    expect(liveSearchRules(",,")).toBeNull();
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

/**
 * ⚠️ §5.44 — three ways the search returned "No patient matches" for a patient
 * who is right there. All three were reported by Josh on 2026-09-21 and all
 * three were reproduced against the LIVE boards before being fixed.
 */
describe("⚠️ a number typed with its country code", () => {
  it("is matched on the last ten digits AS WELL AS what was typed", () => {
    // Live, 2026-09-21: `19738008324` → 0 rows, `9738008324` → the patient.
    // The boards hold BOTH shapes, so the ten digits match either.
    expect(phoneNeedlesFor("19738008324")).toEqual(["19738008324", "9738008324"]);
  });

  it("a ten-digit number asks once — there is nothing to strip", () => {
    expect(phoneNeedlesFor("9738008324")).toEqual(["9738008324"]);
  });

  it("a partial number is left exactly as typed", () => {
    expect(phoneNeedlesFor("8008324")).toEqual(["8008324"]);
  });

  it("⚠️ a 12-digit tracking number keeps its full form — it is not a phone number", () => {
    // §5.35: a FedEx number arrives as a phone query and is matched against the
    // order identifier columns as typed. It gets the last-ten needle too, but
    // `rulesLiteral` only sends the typed digits to the identifier columns.
    expect(phoneNeedlesFor("772043170012")[0]).toBe("772043170012");
  });
});

describe("⚠️ a date of birth is a DOB query, not a phone query", () => {
  it("⚠️⚠️ a DASHED date used to strip to digits and search the PHONE columns", () => {
    // `01-15-1957` → `01151957` → eight digits → asked of the phone columns.
    // Silently the wrong question, which is why it returned nothing.
    expect(liveSearchRules("01-15-1957")).toEqual({
      kind: "dob",
      needles: ["01/15/1957", "1/15/1957"],
    });
  });

  it("reads slashes, dashes and dots, and an ISO date", () => {
    for (const q of ["02/24/1981", "02-24-1981", "02.24.1981", "1981-02-24"]) {
      expect(liveSearchRules(q), q).toEqual({
        kind: "dob",
        needles: ["02/24/1981", "2/24/1981"],
      });
    }
  });

  it("⚠️ asks for BOTH paddings, because the boards hold both", () => {
    // `12/5/1960` and `02/24/1981` are live values in the same column, and
    // contains_text is a contiguous substring — so a typed `12/05/1960` does
    // not match a stored `12/5/1960` unless the unpadded form is asked for too.
    expect(dobNeedles("12/05/1960")).toEqual(["12/05/1960", "12/5/1960"]);
    expect(dobNeedles("12/5/1960")).toEqual(["12/05/1960", "12/5/1960"]);
  });

  it("⚠️ BARE DIGITS are never a date — that would hijack phone search", () => {
    expect(dobNeedles("02241981")).toBeNull();
    expect(liveSearchRules("9738008324")).toEqual({ kind: "phone", digits: "9738008324" });
  });

  it("rejects an impossible date and a two-digit year rather than guessing", () => {
    expect(dobNeedles("13/24/1981")).toBeNull();
    expect(dobNeedles("02/32/1981")).toBeNull();
    expect(dobNeedles("02/24/81")).toBeNull();
    expect(dobNeedles("02/24/1800")).toBeNull();
  });

  it("a name is still a name", () => {
    expect(liveSearchRules("jose delgado")).toEqual({ kind: "name", terms: ["jose", "delgado"] });
  });
});

describe("⚠️ the loose pass — one misspelled letter returned nothing", () => {
  it("offers the typed words when there are two or more", () => {
    // Live, 2026-09-21: the board holds MEGHAN HEMBERGER, so "megan" matches
    // nothing and ANDing it with "hemberger" matches nothing either.
    expect(looseSearchTerms("megan hemberger")).toEqual(["megan", "hemberger"]);
  });

  it("⚠️ declines a single word — there is nothing to loosen", () => {
    // One term is already the broadest name query `contains_text` can express.
    expect(looseSearchTerms("hemberger")).toBeNull();
  });

  it("declines a phone or a DOB", () => {
    expect(looseSearchTerms("9738008324")).toBeNull();
    expect(looseSearchTerms("02/24/1981")).toBeNull();
  });
});
