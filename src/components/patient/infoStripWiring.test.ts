/**
 * ⚠️ **The info strip is WIRED** (§5.46f).
 *
 * §5.31b's rule: *"a module nobody calls does not fail; it is absent, and its
 * green tests say otherwise."* Every assertion here is a source scan, because
 * each failure is silent on screen — a column that is not fetched reads blank
 * on every patient, a `created_at` that is not asked for leaves every intake
 * patient with no stage start, and a second strip builder left behind in
 * `patientScreen.ts` is two modules owning one set of ids.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const DOSSIER_API = src("src/lib/commsHub/dossierApi.ts");
const DOSSIER = src("src/lib/commsHub/dossier.ts");
const VIEW = src("src/components/patient/OnboardingView.tsx");
const SCREEN = src("src/lib/patient/patientScreen.ts");
const CSS = src("src/pages/patient/redesign.css");

/** Comments document the very things these scans forbid, so they are stripped
 *  before matching — otherwise the only way to pass is to delete the prose. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the read", () => {
  it("⚠️ dossierCols asks for the info-strip columns", () => {
    expect(DOSSIER_API).toContain('import { infoStripColumns } from "../patient/infoStrip"');
    expect(code(DOSSIER_API)).toContain("...infoStripColumns(board.boardId),");
  });

  it("⚠️ BOTH item queries ask for created_at", () => {
    // Profile Send Off has no stage-start column, so the item's creation date
    // is the only one there is — and the patient screen reaches a record by id
    // as often as by phone. A query missing it leaves the largest population on
    // the screen with a blank Stage start and no days in stage.
    const queries = code(DOSSIER_API).match(/items\s*\(ids:|items \{ id name/g) ?? [];
    expect(queries.length).toBeGreaterThan(0);
    expect(code(DOSSIER_API)).toContain("items { id name created_at group { id title }");
    expect(code(DOSSIER_API)).toContain("id name created_at board { id } group { id title }");
  });

  it("⚠️ the record carries it", () => {
    expect(code(DOSSIER_API)).toContain('createdAt: (it.created_at ?? "").trim(),');
    expect(code(DOSSIER)).toContain("createdAt: string;");
  });

  it("⚠️ the id list is still de-duplicated", () => {
    // Four patient-screen modules declare what they need rather than trusting
    // another to fetch it, so the lists overlap on purpose.
    expect(code(DOSSIER_API)).toContain(".filter((c, i, all) => all.indexOf(c) === i)");
  });
});

describe("the render", () => {
  it("⚠️ the view builds the strip from infoStrip, not a local copy", () => {
    // The stage heading's "N days here" chip imports from the same module
    // (pixel-match Phase 2), so the import names more than one thing now.
    expect(VIEW).toMatch(/import \{[^}]*\binfoStripFacts\b[^}]*\} from "@\/lib\/patient\/infoStrip"/);
    expect(code(VIEW)).toContain("infoStripFacts(dossier)");
  });

  it("⚠️ there is no second strip builder in patientScreen", () => {
    // `infoFacts` was six facts of which one was Brandon's, and two restated
    // the top bar one row above. Re-adding it here is two modules owning one
    // set of column ids — the §5.46b two-readers hazard, inside one screen.
    expect(code(SCREEN)).not.toContain("export function infoFacts");
    expect(code(VIEW)).not.toContain("infoFacts(");
  });

  it("⚠️ the tone, the note and the chip all reach the DOM", () => {
    // Each is a fact the strip exists to carry: `warn` is "this patient has sat
    // here over a fortnight", the note is the days count, and the chip is the
    // one place the screen says a patient is stuck.
    expect(code(VIEW)).toContain("f.tone ? ` ${f.tone}` : \"\"");
    expect(code(VIEW)).toContain("f.note && (");
    expect(code(VIEW)).toContain("f.sub && (");
    expect(code(VIEW)).toContain("f.chip && (");
    expect(CSS).toContain(".cc-pt .fact .v.warn");
    expect(CSS).toContain(".cc-pt .fact .v .chip.stuckchip");
  });

  it("⚠️ the strip is still four columns — eight facts is two full rows", () => {
    expect(CSS).toContain(".cc-pt .strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));");
  });
});
