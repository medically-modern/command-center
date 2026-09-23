/**
 * Setting the carrier from the card photo — Brandon 2026-09-22, Josh 2026-09-23.
 *
 * The rules here are all about the two things that would be silent if they
 * broke: a write monday accepts and records nowhere, and a Stedi run nobody
 * asked for.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { carrierFromPhoto, carrierOptions, carrierWriteRefusal } from "./carrierAssign";
import { PHOTO_OF_CARD, PHOTO_UPLOAD, intakeInsurance } from "./pills";
import { COL } from "@/lib/profile/mondayApi";

const read = (p: string) => readFileSync(p, "utf8");
/** ⚠️ Comments stripped before a "must not contain" scan — these files
 *  document the very calls they must not make (the module header names
 *  `triggerStediRun` to say it does not run it), so a raw-text scan fails on
 *  the explanation and the only way to pass is to delete it. */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const ASSIGN = "src/lib/careCoordinator/carrierAssign.ts";
const DIALOG = "src/components/careCoordinator/InsuranceCardDialog.tsx";
const CARDS = "src/components/careCoordinator/cards.tsx";
const PAGE = "src/pages/CareCoordinatorPage.tsx";

const live = (labels: Record<string, number>) => ({ [COL.generalInsurance]: labels });

describe("carrierWriteRefusal — the write monday would accept and drop", () => {
  it("refuses a label the board does not have", () => {
    // ⚠️ This is the whole reason the check exists. A status write to a label
    // id a column does not carry is taken at HTTP 200 and written NOWHERE
    // (§5.33), and `writeBenefitsInputs` skips the column silently when it
    // cannot resolve one — so without this the dialog closes green over a board
    // that never changed.
    const refusal = carrierWriteRefusal("Some New Payer", live({ Aetna: 4 }));
    expect(refusal).toContain("Some New Payer");
    expect(refusal).toContain("board");
  });

  it("accepts a label the LIVE board carries, even if our hardcoded map does not", () => {
    // The point of reading labels off the board: a payer added on monday this
    // morning is writable this afternoon without a deploy.
    expect(carrierWriteRefusal("Health Plans Inc (PHCS)", live({ "Health Plans Inc (PHCS)": 159 }))).toBe("");
  });

  it("falls back to the hardcoded map when the board could not be read", () => {
    // ⚠️ A monday blip must degrade to today's behaviour, never to a picker
    // that refuses every carrier — that would make a coordinator believe the
    // whole feature is broken.
    expect(carrierWriteRefusal("Aetna", {})).toBe("");
  });

  it("refuses a blank without naming the board", () => {
    expect(carrierWriteRefusal("", live({ Aetna: 4 }))).toBe("Pick a carrier first.");
    expect(carrierWriteRefusal("   ", live({ Aetna: 4 }))).toBe("Pick a carrier first.");
  });

  it("accepts index 0, which is a real label id", () => {
    // ⚠️ A truthiness test here would refuse the label sitting in slot 0.
    expect(carrierWriteRefusal("Aetna", live({ Aetna: 0 }))).toBe("");
  });
});

describe("carrierFromPhoto — what the pill's glyph claims", () => {
  it("is true once a carrier sits on a row whose answer was a card photo", () => {
    expect(carrierFromPhoto({ generalInsurance: "Aetna", insuranceProvidedVia: PHOTO_OF_CARD })).toBe(true);
  });

  it("is false before a carrier is set — the pill already says 'Photo upload' there", () => {
    expect(carrierFromPhoto({ generalInsurance: "", insuranceProvidedVia: PHOTO_OF_CARD })).toBe(false);
  });

  it("is false for a carrier the patient typed in themselves", () => {
    expect(carrierFromPhoto({ generalInsurance: "Aetna", insuranceProvidedVia: "Entered manually" })).toBe(false);
  });

  it("reads the SAME board answer the pill switches on", () => {
    // ⚠️ Keep-in-agreement: `intakeInsurance`'s switch and this rule both key
    // on `PHOTO_OF_CARD`. Two spellings of one board label is how the glyph
    // ends up on a pill that never said "Photo upload".
    expect(intakeInsurance({ generalInsurance: "", insuranceProvidedVia: PHOTO_OF_CARD, insuranceOther: "" }))
      .toBe(PHOTO_UPLOAD);
  });
});

describe("the pill changes to the carrier by itself", () => {
  it("prefers a real carrier over the photo note, so writing the column IS the pill change", () => {
    // Brandon: *"Once i've assigned it, that general insurance should be the
    // pill, instead of 'Photo Upload'"*. No second rule implements this — and
    // none may, because `intakeFilter.facetValue` calls this same function and
    // the option and the pill have to stay one string (§5.30e).
    expect(intakeInsurance({ generalInsurance: "Aetna", insuranceProvidedVia: PHOTO_OF_CARD, insuranceOther: "" }))
      .toBe("Aetna");
  });
});

describe("carrierOptions", () => {
  const optionsFor = (_id: string, fallback: string[]) => fallback;

  it("hides Stedi — our eligibility vendor, not a health plan", () => {
    // ⚠️ Removed from this picker on 2026-08-13 and silently put back the day
    // the options started coming from the board (§5.33).
    expect(carrierOptions((_id, _f) => ["Aetna", "Stedi", "Cigna"])).toEqual(["Aetna", "Cigna"]);
  });

  it("uses the board's list when there is one", () => {
    expect(carrierOptions((_id, _f) => ["Only This One"])).toEqual(["Only This One"]);
  });

  it("falls back to a non-empty list when the board could not be read", () => {
    // Never an empty select: a picker with no options is indistinguishable
    // from a broken screen.
    expect(carrierOptions(optionsFor).length).toBeGreaterThan(5);
    expect(carrierOptions(optionsFor)).toContain("Aetna");
  });
});

describe("the write itself", () => {
  it("delegates to the profile page's own writer and declares no mutation", () => {
    // ⚠️ Two writers for one column is how they disagree (§5.31c, §5.31d).
    // This is the dashboard's SECOND write and it follows `callAttempt.ts`:
    // the rule lives here, the mutation does not.
    const src = code(ASSIGN);
    expect(src).toContain("writeBenefitsInputs");
    expect(src).not.toContain("change_column_value");
    expect(src).not.toContain("change_multiple_column_values");
    expect(src).not.toMatch(/\bgql\s*[(<]/);
  });

  it("does NOT run a Stedi check, or write anything else Stedi reads", () => {
    // Josh, 2026-09-23: *"it writes to monday only the general insurance,
    // doesnt run a stedi check"*. The member ID is the other half of that
    // input and is on neither the photo nor this screen.
    const src = code(ASSIGN);
    expect(src).not.toContain("triggerStediRun");
    expect(src).not.toContain("writePatientProfile");
    expect(src).not.toContain("verifyProfileWritten");
    expect(src).not.toContain("memberIdWorking");
    // The blank second argument IS the "only the general insurance" guarantee.
    expect(src).toMatch(/writeBenefitsInputs\(itemId,\s*carrier\.trim\(\),\s*""\)/);
  });

  it("refuses BEFORE it writes", () => {
    // ⚠️ `writeBenefitsInputs` skips an unresolvable label silently, so a check
    // after the write cannot tell a save from a no-op.
    const src = code(ASSIGN);
    const refusal = src.indexOf("if (refusal) throw");
    const write = src.indexOf("await writeBenefitsInputs");
    expect(refusal).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(refusal);
  });
});

describe("the wiring", () => {
  it("keys the pressable pill on the FILE, never on the pill's words", () => {
    // ⚠️ Gated on `PHOTO_UPLOAD` the pill would go inert the moment a carrier
    // was set — i.e. the press disables itself, leaving no way back to the
    // photo and no way to correct a carrier misread off it.
    const src = code(CARDS);
    expect(src).toMatch(/if \(!open \|\| !lead\.hasInsuranceCard\) return undefined;/);
    expect(src).not.toContain("PHOTO_UPLOAD");
  });

  it("opens the dialog rather than handing the photo straight to the viewer", () => {
    // The picker has to be on the same surface as the photo: the viewer is
    // full-screen, so a dropdown behind it is covered exactly when it is needed.
    const src = code(CARDS);
    expect(src).not.toContain("openFileViewer");
    expect(src).toContain("onInsuranceCard");
  });

  it("shows the carrier at once instead of re-reading 1,754 rows", () => {
    // ⚠️ `refetch()` here is four paged monday requests for one one-column
    // write; a minute of the pill still reading "Photo upload" reads as the
    // save not having taken.
    const src = code(PAGE);
    expect(src).toMatch(/onSaved=\{\(id, carrier\) => setCarrierEdits/);
    expect(src).not.toMatch(/onSaved=\{[^}]*refetch/);
  });

  it("keys both dialogs on the patient, so nothing survives a change of card", () => {
    const src = code(PAGE);
    expect(src).toMatch(/key=\{cardTarget\?\.itemId \?\? "no-card"\}/);
  });

  it("resolves the signed photo url on open, never off the list row", () => {
    // ⚠️ The file column's own text is a `protected_static` link that 302s to a
    // login page, and the signed asset url expires in an hour (§5.30f).
    const src = code(DIALOG);
    expect(src).toContain("fetchInsuranceCardAsset");
  });
});

/**
 * The three follow-ups from the same conversation (Josh, 2026-09-23).
 *
 * All on the INTAKE PROFILE page, not the dashboard — §5.30's two-screens rule,
 * and the reason each block names its screen.
 */
describe("the Already in System pill in the intake SIDEBAR", () => {
  const SIDEBAR = "src/components/profile/PatientsSidebar.tsx";

  it("reads the dup-check VERDICT, never the Already In System flag", () => {
    // ⚠️ On a partial lead the duplicate check is deliberately flag-only and
    // never writes that column, because writing it trips automation 7922049614
    // and takes the item out of this queue (§5.21). Reading the flag would hide
    // the pill from most of the population it exists for.
    const src = code(SIDEBAR);
    expect(src).toContain("isAlreadyInSystemResult(p.dupCheckResult)");
    expect(src).not.toContain("p.alreadyInSystem");
  });

  it("uses the shared rule rather than testing the label text here", () => {
    // One rule, two screens: the dashboard card and this row must agree about
    // what counts as a match.
    const src = code(SIDEBAR);
    expect(src).toContain('from "@/lib/profile/dupCheckFlag"');
  });

  it("keeps the dashboard card's own pill — Josh: the red on the dashboard is fine", () => {
    expect(code("src/components/careCoordinator/cards.tsx")).toContain("inSystem");
  });

  it("carries the column in the SLIM list read, or every row reads blank", () => {
    // §5.25: the intake list fetches ~10 columns for ~1,900 rows. A field read
    // on a row but missing from that set is the §5.11 trap — "" on every row,
    // no error. `listColumns.test.ts` is the general guard; this names the one.
    const api = code("src/lib/profile/mondayApi.ts");
    const slim = api.slice(api.indexOf("export const LIST_COLUMN_IDS"));
    expect(slim.slice(0, slim.indexOf("];"))).toContain("COL.dupCheckResult");
  });
});

describe("calling from the intake profile page", () => {
  const PAGE = "src/pages/UnverifiedReferralsPage.tsx";
  const DIAL = "src/components/shared/DialPatientDialog.tsx";

  it("dials in the page instead of handing the call to RingCentral", () => {
    // Josh: *"when i click on a phone call number it still opens ring central,
    // it should call via a pop up inside the command center"*. `PatientContact`
    // renders a `tel:` anchor unless it is given `onCall`.
    expect(code(PAGE)).toMatch(/onCall=\{\(\) => setDialOpen\(true\)\}/);
  });

  it("DIALS ONLY — the page already owns the attempt step", () => {
    // ⚠️ Two attempt forms on one screen is the shape §5.30e records finding on
    // this very page with Propose Stuck: two dialogs onto one write. The popup
    // hands off to the page's own dialog rather than growing a second.
    const src = code(DIAL);
    expect(src).not.toContain("logCallAttempt");
    expect(src).not.toContain("logContactAttempt");
    expect(src).not.toContain("appendIntakeNote");
    expect(code(PAGE)).toMatch(/onLogAttempt=\{\(\) => setAttemptOpen\(true\)\}/);
  });

  it("mounts no CallOverlay of its own", () => {
    // One is mounted app-wide by `IncomingCallHost`; `softphoneRules.test.ts`
    // pins that callers must not mount their own.
    expect(code(DIAL)).not.toContain("CallOverlay");
  });

  it("is keyed on the patient, so it cannot ring the previous one", () => {
    expect(code(PAGE)).toMatch(/<DialPatientDialog[\s\S]{0,200}key=\{selected\.id\}/);
  });

  it("leaves every other header's tel: hand-off untouched", () => {
    // `onCall` is opt-in on `PatientContact`; absent, the number is the anchor
    // it has always been (§5.30g). Only the dashboard card and this page opt in.
    const optIn = ["src/components/careCoordinator/cards.tsx", PAGE]
      .filter((f) => /onCall[=:]/.test(code(f)));
    expect(optIn).toHaveLength(2);
  });
});

describe("the intake exit row", () => {
  const CSS = "src/pages/profile/intake.css";

  it("sizes all four buttons to their labels rather than stretching two of them", () => {
    // Josh: *"make the buttons the same sizes right now advance and log call
    // attempt are huge"*. The left pair used to take `flex:1 1 0` inside a
    // `flex:1 1 320px` group and grew to fill the row.
    const css = read(CSS);
    expect(css).toMatch(/\.pf-root \.exit-group \{[^}]*flex:0 1 auto/);
    expect(css).toMatch(/\.pf-root \.exit-group > \.btn \{[^}]*flex:0 1 auto/);
    expect(css).not.toMatch(/\.pf-root \.exit-group > \.btn \{[^}]*flex:1 1 0/);
  });

  it("drops the right pair's size-down, so 'the same size' is true of the type too", () => {
    const css = read(CSS);
    expect(css).not.toMatch(/\.pf-root \.exit-group\.alt > \.btn \{/);
  });

  it("keeps Propose Stuck in the right-hand group", () => {
    // The size levelled; the LAYOUT point Brandon made on 2026-09-17 did not.
    // An escalation still sits away from the button pressed after every good call.
    const page = read("src/pages/UnverifiedReferralsPage.tsx");
    const alt = page.indexOf('exit-group alt');
    expect(alt).toBeGreaterThan(-1);
    expect(page.indexOf("Propose Stuck", alt)).toBeGreaterThan(alt);
  });
});
