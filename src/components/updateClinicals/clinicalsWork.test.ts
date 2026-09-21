/**
 * The Update Clinicals work pane (§5.39c4) — the properties that are silent
 * when they break. Every scan is verified to fail when its protection is
 * removed.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
/** Code, not prose — both files document the writers they own. */
const live = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => l.trim() && !l.trim().startsWith("//")).join("\n");

const WORK = read("src/components/updateClinicals/ClinicalsWork.tsx");
const PAGE = read("src/pages/UpdateClinicalsPage.tsx");
const FAX = read("src/pages/FaxBarPage.tsx");

describe("⚠️⚠️ one implementation, two screens", () => {
  it("the page renders the PANE rather than its own copy of the flow", () => {
    // This pane WRITES: the visit date sets MN Expiry AND the MR rung behind
    // read-back verification (§5.36), the reply card writes its columns, and
    // Submit moves the Stage Advancer that board automations fire on. A second
    // copy of any of that in the Fax bar is two writers for one column
    // (§5.31c · §5.31d) with a stage move attached.
    expect(live(PAGE)).toContain("<ClinicalsWorkPane");
    expect(live(FAX)).toContain("<ClinicalsWorkPane");
    for (const [name, src] of [["page", PAGE], ["fax bar", FAX]] as const) {
      const code = live(src);
      expect(code, `${name} must not re-implement a card`).not.toMatch(
        /function (VisitDateCard|RecordsReplyCard|SubmitCard|PatientClinicalsCard)\(/,
      );
      expect(code, `${name} must not write directly`).not.toMatch(
        /saveVisitDateVerified|recordRecordsReplyVerified|returnToEvaluateVerified/,
      );
    }
  });

  it("the three writers live in the pane's module and nowhere else", () => {
    const code = live(WORK);
    expect(code).toContain("saveVisitDateVerified");
    expect(code).toContain("recordRecordsReplyVerified");
    expect(code).toContain("returnToEvaluateVerified");
  });
});

describe("⚠️ the boards are read only where the pane is shown", () => {
  it("the Fax bar mounts the list inside FaxPane, not on the page", () => {
    // Two board reads (Subscription + Medical Necessity). `FaxPane` exists only
    // once a rep has picked a fax, so glancing at the inbox costs what it
    // always did — "on open, never on render".
    const i = FAX.indexOf("function FaxPane(");
    expect(i).toBeGreaterThan(0);
    expect(FAX.indexOf("useClinicalsPatients()")).toBeGreaterThan(i);
  });
});

describe("⚠️ a draft cannot survive onto another patient", () => {
  it("the cards are keyed by patient inside the pane", () => {
    // Both hold a typed draft in component state and the pane keeps the same
    // instance across a selection change — §9's notes-box rule.
    expect(WORK).toContain("key={`visit-${selected.id}`}");
    expect(WORK).toContain("key={`reply-${selected.id}`}");
  });

  it("⚠️ and the Fax bar clears its selection when the FAX changes", () => {
    // A patient picked while reading one fax must not still be selected under
    // the next, one Save from the wrong chart.
    expect(live(FAX)).toContain("useEffect(() => setWorkId(null), [fax.id]);");
  });
});

describe("⚠️ nothing offers an action that would select nobody", () => {
  it("a patient with no clinicals row is listed but has no button", () => {
    // The fax directory knows a patient by board item; this flow needs the
    // merged row, which exists only for Subscription and live Medical
    // Necessity. A patient of this office sitting in Insurance is genuinely
    // with them — they just have nothing to update here, and the row says so.
    const code = live(FAX);
    expect(code).toContain("workable.has(p.itemId) ? (");
    expect(code).toContain("nothing to update");
  });
});

describe("⚠️ the fax bar says which fax the pane is about", () => {
  it("passes a context line naming the sending office", () => {
    expect(live(FAX)).toContain("context={");
    expect(FAX).toContain("this fax came from");
  });

  it("⚠️ and does NOT steal the caret from the fax just opened", () => {
    // The pane is the second thing on that screen; autofocusing its search
    // scrolls a rep away from the document they opened. The page keeps the
    // focus, where the search IS the screen.
    expect(live(FAX)).toContain("autoFocusSearch={false}");
    expect(live(PAGE)).not.toContain("autoFocusSearch");
  });

  it("⚠️ offers no second 'likely matches' list", () => {
    // *Their patients* directly above IS that list — the same
    // `buildFaxDirectory` join. Two copies on one screen is the duplication a
    // card stops being read for.
    expect(live(WORK)).not.toContain("Likely matches");
  });
});

describe("nothing was taken away", () => {
  it("/update-clinicals is still its own page with its own door", () => {
    expect(PAGE).toContain("export default UpdateClinicalsPage");
    expect(live(PAGE)).toContain("<ClinicalsSidebar");
    expect(read("src/App.tsx")).toContain("/update-clinicals");
  });
});
