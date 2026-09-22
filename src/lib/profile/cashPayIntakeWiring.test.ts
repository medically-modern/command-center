import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Source scan — the `listColumns.test.ts` convention.
 *
 * Profile Send Off has TWO routes to Advance to MN with TWO separate
 * checklists, and §5.19b records what it costs when a rule lives on one and
 * not the other: the doctor-fax requirement blocked on `/profile` and not on
 * the intake page, while the banner shared by BOTH told reps it blocked on
 * each. Neither file was wrong alone — only the pair was.
 *
 * A cash pay patient who slips through to a checklist that still demands a
 * Member ID is stranded exactly as Debbie Hinze was, and nothing errors: the
 * Advance button simply stays grey. So the wiring is scanned rather than
 * trusted. Every assertion here was verified to fail with its call removed.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const PAGES = [
  "src/pages/UnverifiedReferralsPage.tsx",
  "src/pages/ProfilePage.tsx",
];

describe("both intake routes apply the cash pay readiness rule", () => {
  for (const page of PAGES) {
    it(`${page} calls applyCashPayReadiness`, () => {
      const src = read(page);
      expect(src).toContain("applyCashPayReadiness");
      expect(src).toContain('from "@/lib/profile/cashPayIntake"');
    });

    it(`${page} applies it to the list its button gates on`, () => {
      /* The filter has to wrap the value the checklist memo RETURNS. Calling it
         somewhere else would leave the gate reading the unfiltered rows while
         the screen showed the filtered ones — a greyed-out button whose stated
         reasons are all satisfied. */
      const src = read(page);
      expect(src).toMatch(/return applyCashPayReadiness\(items, selected\);/);
    });
  }
});

describe("both intake routes mirror Cash Pay into Primary Insurance", () => {
  /* ⚠️ `primaryInsuranceForGeneral` shipped with NO CALLER — tested, green,
     and absent from the product. That is §5.31b's failure ("a module nobody
     calls does not fail; it is absent, and its green tests say otherwise"),
     and its cost here is the column the Order board's cash pay card keys on
     staying blank all the way downstream. */
  for (const page of PAGES) {
    it(`${page} pipes its edit handler through cashPayMirrorEdit`, () => {
      const src = read(page);
      expect(src).toContain("cashPayMirrorEdit");
      /* On the HANDLER, not on the picker: a mirror wired to one control is
         one a second control silently skips. */
      expect(src).toMatch(/cashPayMirrorEdit\(patch, selected[.?]*\.?primaryInsurance\)/);
    });
  }

  it("⚠️ the intake page mirrors into `verified` too — that is what Advance writes", () => {
    /* `buildAdvanceTasks` writes Primary Insurance from `opts.verified`, the
       RIGHT pane's state, and that state is seeded once per patient. Section 1
       is hidden for a cash pay patient, so nobody can put it right by hand
       either: mirror into the overlay alone and the column never lands. */
    const src = read("src/pages/UnverifiedReferralsPage.tsx");
    const at = src.indexOf("const edit = useCallback");
    expect(at).toBeGreaterThan(-1);
    const handler = src.slice(at, at + 700);
    expect(handler).toContain("cashPayMirrorEdit");
    expect(handler).toContain("setVerified");
    expect(handler).toContain("primaryInsurance");
  });
});

describe("the benefit-check rule is not re-derived anywhere", () => {
  it("neither page inlines its own Cash Pay string test", () => {
    /* One rule, in lib/shared/cashPay.ts. A second copy is the §5.7/§5.17
       hand-synced hazard, and here it decides whether a patient is asked for
       insurance they do not have. */
    for (const page of PAGES) {
      const src = read(page);
      expect(src, page).not.toMatch(/===\s*["']Cash Pay["']/);
      expect(src, page).not.toMatch(/\/cash\s*pay\/i/);
    }
  });

  it("intakeUnlock reads the shared rule rather than a local copy", () => {
    const src = read("src/lib/profile/intakeUnlock.ts");
    expect(src).toContain('from "../shared/cashPay"');
    expect(src).toContain("isCashPayPatient(p)");
    expect(src).not.toMatch(/===\s*["']Cash Pay["']/);
  });
});

describe("the Welcome Call route stays dark until its automation exists", () => {
  it("nothing writes the new label while the flag is false", () => {
    /* ⚠️ monday workflow 18432110599 is an unpublished draft — its create-item
       mapping could not be built through the API (§10) and needs a person in
       monday's UI. Writing "Advance to Welcome Call" before it is live lands a
       label nothing acts on: the item never leaves Profile Clean-Up and the rep
       has pressed a button that silently did nothing.

       When this test fails, someone has flipped the flag — confirm the
       automation is published FIRST. */
    const src = read("src/lib/profile/cashPayIntake.ts");
    expect(src).toMatch(/CASH_PAY_SKIPS_TO_WELCOME_CALL = false/);

    for (const page of PAGES) {
      expect(read(page), page).not.toContain("Advance to Welcome Call");
    }
  });
});
