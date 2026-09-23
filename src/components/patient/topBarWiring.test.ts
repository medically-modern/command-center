/**
 * ⚠️ **The top bar's email and pencils are WIRED** (§5.46g).
 *
 * §5.31b's rule: *"a module nobody calls does not fail; it is absent, and its
 * green tests say otherwise."* Every assertion here is a source scan, because
 * each failure is silent on screen — a column that is not fetched reads blank
 * on every patient, an unchecked save reports success having written nothing,
 * and a second mutation beside `updatePatientContact` is the §5.31c/§5.31d
 * two-writers failure on a column three other features join on.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** Comments document the very things these scans forbid. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const DOSSIER_API = src("src/lib/commsHub/dossierApi.ts");
/** The top bar lives in the patient screen's BODY since it gained a second host
 *  — the Communications hub's right pane (COMMS_INBOX_PLAN.md §7). Both hosts
 *  render it, so these scans follow the code there; the page is checked below
 *  to still render it. */
const PAGE = src("src/components/patient/PatientBody.tsx");
const FIELD = src("src/components/patient/TopBarContact.tsx");
const SCREEN = src("src/lib/patient/patientScreen.ts");
const CSS = src("src/pages/patient/redesign.css");

describe("the host", () => {
  it("the patient screen still renders the body — one top bar, two hosts", () => {
    expect(code(src("src/pages/PatientPage.tsx"))).toContain("<PatientBody dossier={dossier} itemId={itemId} params={params} setParam={setParam} onSaved={reload} />");
    expect(code(src("src/components/commsHub/HubPatientPane.tsx"))).toContain("<PatientBody");
  });
});

describe("the read", () => {
  it("⚠️ dossierCols asks for the email column", () => {
    expect(DOSSIER_API).toContain('import { emailColumns } from "../patient/contactEdit"');
    expect(code(DOSSIER_API)).toContain("...emailColumns(board.boardId),");
  });
});

describe("the write", () => {
  it("⚠️ ONE writer — the field calls updatePatientContact and hand-rolls nothing", () => {
    expect(FIELD).toContain('from "@/lib/commsHub/dossierApi"');
    expect(code(FIELD)).toContain("updatePatientContact(");
    expect(code(FIELD)).not.toMatch(/change_(multiple_)?column_value/);
    expect(code(FIELD)).not.toMatch(/executeWritesWithVerification/);
    // The value shape is the rule module's, never re-derived at the call site:
    // a bare string sent to an email column is refused at HTTP 200.
    expect(code(FIELD)).toContain("contactWrites(target, field, draft)");
  });

  it("⚠️ the refusal is checked BEFORE the write, and blocks it", () => {
    // `planPhoneWrite` / `planEmailWrite` SKIP what they cannot parse rather
    // than throwing, so an unchecked save is green and empty (§5.32d).
    expect(code(FIELD)).toContain("if (!target || why || refusal || saving) return;");
    expect(code(FIELD)).toMatch(/emailRefusal\(draft\)/);
    expect(code(FIELD)).toMatch(/phoneRefusal\(draft\)/);
  });

  it("⚠️ gated TWICE — the control and the handler", () => {
    // §5.39h's rule: the button is what a rep sees, the handler is what stops
    // the write when the URL, a stale tab or a revoked ability reaches it.
    expect(PAGE).toContain('useAbility("editProfile")');
    expect(code(PAGE)).toContain("canEdit={canEditProfile}");
    expect(code(FIELD)).toContain("!canEdit");
  });

  it("⚠️ a failed save KEEPS the draft, so a rep fixes it rather than retyping", () => {
    const body = code(FIELD);
    const start = body.indexOf("catch (e)");
    expect(start).toBeGreaterThan(-1);
    // The catch block alone, up to `finally` — setOpen(false) belongs to the
    // success path and must not appear in it.
    const block = body.slice(start, body.indexOf("} finally", start));
    expect(block).toContain("toast.error");
    expect(block).not.toContain("setOpen(false)");
  });
});

describe("the render", () => {
  it("⚠️ the page passes the email in — topBarFacts cannot read it itself", () => {
    // `contactEdit` reads `infoStrip`, which reads `patientScreen`: reading the
    // email inside `topBarFacts` is an import cycle that resolves to undefined
    // at init time.
    expect(code(PAGE)).toContain("patientEmail(dossier)");
    expect(code(PAGE)).toContain("topBarFacts(dossier, email)");
    expect(code(SCREEN)).not.toContain("contactEdit");
  });

  it("⚠️ it really is Brandon's four facts now", () => {
    const fn = code(SCREEN).slice(code(SCREEN).indexOf("export function topBarFacts"));
    for (const label of ["Patient name", "DOB", "Email", "Phone"]) {
      expect(fn).toContain(`"${label}"`);
    }
  });

  it("⚠️ the editable facts are keyed on the RECORD", () => {
    // A draft that survives a patient switch is saved onto whoever is open
    // now — §9's notes-box rule with a phone number in it.
    expect(code(PAGE)).toMatch(/key=\{`\$\{f\.label\}-\$\{active\?\.itemId \?\? itemId\}`\}/);
  });

  it("⚠️ an inert pencil is SHOWN with a reason, never hidden", () => {
    // §5.39h's AbilityLock rule, and `aria-disabled` rather than `disabled`
    // because a disabled button shows no tooltip in most browsers.
    expect(code(FIELD)).toContain('aria-disabled={why ? true : undefined}');
    expect(code(FIELD)).toContain("title={why ||");
    expect(CSS).toContain('.cc-pt .btn.ghost.tbpen[aria-disabled="true"]');
  });
});
