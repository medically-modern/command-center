/**
 * ⚠️⚠️ **EVERY SEARCH HIT DEAD-ENDED, AND THE MESSAGE BLAMED MONDAY.**
 *
 * `/patient/:itemId?board=` carries an item and a board and nothing else, so
 * `PatientPage` built its `DossierPick` with `name: ""`, `phone: ""`. The
 * lookup then found the record by SEARCHING ITS NAME — with an empty needle,
 * which matches nothing — so the screen rendered "No board record was found for
 * this item. It may have been deleted on Monday." for every patient opened from
 * the header search (Josh, 2026-09-18: *"nothing is working on search"*).
 *
 * The record is resolved BY ID now, which is exact and needs nothing from the
 * caller. These scans pin that; the live shape was verified against the gateway
 * (item 12936243860 → Joseph Bowser, board 18406060017).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const live = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).join("\n");

describe("⚠️ the picked record is found by id, not by name", () => {
  const api = live(read("lib/commsHub/dossierApi.ts"));

  it("reads the item by id", () => {
    expect(api).toContain("fetchDossierItemById");
    expect(api).toMatch(/items \(ids: \$ids\)/);
  });

  it("resolves the anchor before anything depends on a name", () => {
    // The name/phone used for the trail must come from the record when the
    // caller could not supply them — that is the whole fix.
    expect(api).toMatch(/const anchorItem = await fetchDossierItemById\(pick\.boardId, pick\.itemId\)/);
    expect(api).toMatch(/const name = pick\.name \|\| anchorItem\?\.name/);
    expect(api).toMatch(/const phone = pick\.phone \|\| anchorItem\?\.phone/);
  });

  it("never filters the phone pass on a blank name", () => {
    // personKey("") matches nobody, so an unguarded filter silently returned
    // an empty trail for exactly the caller this fix is for.
    expect(api).toMatch(/const mine = name \? byNumber\.filter/);
  });

  it("⚠️ refuses an item that lives on another board", () => {
    // items(ids:) is board-agnostic. Mapping a foreign record with this
    // board's column ids reads every field blank and files it under the wrong
    // board — verified live that `board { id }` is returned to check against.
    expect(api).toMatch(/board \{ id \}/);
    expect(api).toMatch(/raw\.board\?\.id.*!==.*String\(boardId\)/);
  });
});

describe("⚠️ the patient screen still passes what it has", () => {
  it("PatientPage builds its pick from the URL only", () => {
    // It has no name or phone to give — which is precisely why the lookup may
    // never require them again.
    const page = live(read("pages/PatientPage.tsx"));
    expect(page).toMatch(/itemId && boardId \? \{ itemId, boardId, name: "", phone: "" \}/);
  });
});
