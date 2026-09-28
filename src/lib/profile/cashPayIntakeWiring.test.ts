import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  advanceWriteForLive, ADVANCE_TO_MN, ADVANCE_TO_WELCOME_CALL,
} from "./cashPayIntake";
import { MOVE_TO_ONBOARDING_INDEX } from "./mondayMapping";
import type { Patient } from "./workflow";

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
    // ⚠️ `!== undefined`, never truthiness: correcting a mistaken Cash Pay
    // CLEARS Primary (`primaryInsurance: ""`, 2026-09-28), and a truthiness
    // test would drop the clear — leaving `verified` on Cash Pay, which is
    // exactly what Advance writes.
    expect(handler).toMatch(/next\.primaryInsurance !== undefined/);
  });
});

describe("⚠️ the benefit check and section 1 are actually HIDDEN, not just hideable", () => {
  /* `benefitCheckApplies` and `verifiedInsuranceStepApplies` shipped alongside
     `primaryInsuranceForGeneral` and, like it, had NO CALLERS — tested, green,
     and absent from the product, while CLAUDE.md §5.48 said the benefit check
     was hidden. A rule nobody calls does not fail; it is absent. */
  it("the intake page gates the benefit-check actions", () => {
    const src = read("src/pages/UnverifiedReferralsPage.tsx");
    expect(src).toContain("benefitCheckApplies");
    expect(src).toMatch(/const showBenefitCheck = benefitCheckApplies\(selected\)/);
    /* The two buttons are the point: Run fails on identifiers that do not
       exist, and Start Insurance Follow-Up texts a cash pay patient asking for
       a card they have said they do not have. */
    expect(src).toMatch(/\{showBenefitCheck && \(\s*<div/);
  });

  it("the intake page gates section 1, and renumbers what is left", () => {
    const src = read("src/pages/UnverifiedReferralsPage.tsx");
    expect(src).toMatch(/const showVerifiedInsurance = verifiedInsuranceStepApplies\(selected\)/);
    expect(src).toMatch(/\{showVerifiedInsurance && \(\s*<Card step=\{1\} title="Verified Insurance"/);
    /* A list that starts at 2 is a list with a hole — the rep reads the number
       as their place in it. */
    expect(src).toContain("step={showVerifiedInsurance ? 2 : 1}");
    expect(src).toContain("step={showVerifiedInsurance ? 3 : 2}");
  });

  it("⚠️ neither page leaves a card that just STOPS — each says why", () => {
    /* Hiding a control without saying why is the failure §5.39g records; a rep
       who finds a card ending where they expect a button concludes the page is
       broken. Both notes name cash pay and where the price comes from instead. */
    for (const page of PAGES) {
      expect(read(page), page).toMatch(/Cash pay — there is no insurance to check/);
    }
    expect(read("src/pages/UnverifiedReferralsPage.tsx"))
      .toContain("Cash pay — no insurance to verify");
  });

  it("the /profile route gates its Stedi run too", () => {
    /* Both routes reach Advance to MN, and §5.19b is the standing lesson about
       a rule living on one of them. */
    const src = read("src/pages/ProfilePage.tsx");
    expect(src).toContain("benefitCheckApplies");
    expect(src).toMatch(/\{benefitCheckApplies\(pt\) && \(/);
    expect(src).toMatch(/\{!benefitCheckApplies\(pt\) && \(/);
  });

  it("⚠️ the General Insurance picker is NEVER hidden — it is how Cash Pay is chosen", () => {
    /* Hiding the payer picker on a cash pay patient would be a gate with no
       passing move: there would be no way to change your mind back (§5.10 ·
       §5.20 · §5.31c · §5.31f · §5.39d). */
    const prof = read("src/pages/ProfilePage.tsx");
    const at = prof.indexOf('<Field label="General Insurance" required>');
    expect(at).toBeGreaterThan(-1);
    expect(prof.slice(Math.max(0, at - 600), at)).not.toContain("benefitCheckApplies");
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

describe("the Welcome Call route is live, and only one module decides it", () => {
  it("✅ the flag is on, behind a verified automation", () => {
    /* Flipped 2026-09-22 after monday automation 7923595946 was proved end to
       end: a throwaway Profile Clean-Up item carrying Cash Pay was advanced, the
       source landed in Completed, and a Welcome Call item appeared in the
       Welcome Call group with Primary Insurance = Cash Pay, DOB, phone, doctor
       and Serving.

       ⚠️ That test mattered because the failure would have been SILENT: the
       automation still carries 23 mappings aimed at Medical Evaluation column
       ids, and a create-item step carrying ids the destination board lacks could
       have been refused outright — no Welcome Call item, source item moved to
       Completed anyway, patient out of the pipeline with nothing erroring.

       If this fails, the flag was turned off. That is a safe state — cash pay
       then advances on "Advance to MN" as it always did — but confirm it was
       deliberate. */
    expect(read("src/lib/profile/cashPayIntake.ts"))
      .toMatch(/CASH_PAY_SKIPS_TO_WELCOME_CALL = true/);
  });

  it("⚠️ neither page hardcodes the label — advanceLabelForLive is the only decider", () => {
    /* The pages must keep asking the module which label to write. A literal on
       a page would write "Advance to Welcome Call" for an INSURED patient too,
       whose automation (7917676280) triggers on "Advance to MN" — so they would
       land nowhere, silently. */
    for (const page of PAGES) {
      expect(read(page), page).not.toContain("Advance to Welcome Call");
      /* And the button copy really is the module's answer — the copy and the
         write must be one fact (Josh, 2026-09-25: "it should say advance to
         welcome call ONLY if its a cash pay"). */
      expect(read(page), page).toContain("advanceLabelForLive(");
    }
  });

  /* ⚠️⚠️ THE REGRESSION THIS BLOCK EXISTS FOR (pre-production flight check,
     2026-09-25): from 2026-09-22 the flag was true, `advanceLabelForLive`
     computed the right label, and NOTHING CALLED IT — both writers hardcoded
     "Advance to MN" for the index lookup AND the §9 `expectedText`, so every
     cash pay advance fired 7917676280 and landed on Medical Evaluation. The
     old version of this block only grepped the PAGES for a literal, which
     passes with the feature absent entirely (§5.31b: a module nobody calls
     does not fail; it is absent, and its green tests say otherwise). These
     pin the task the writers actually build, and the call sites. */
  const cashPay = { generalInsurance: "Cash Pay" } as Patient;
  const mirroredOnly = { primaryInsurance: "Cash Pay" } as Patient;
  const insured = { generalInsurance: "Aetna", primaryInsurance: "Aetna Commercial" } as Patient;

  it("⚠️ a cash pay patient's advance carries id 6 / Advance to Welcome Call", () => {
    expect(advanceWriteForLive(cashPay)).toEqual({ label: ADVANCE_TO_WELCOME_CALL, index: 6 });
    // Either payer column alone is enough — a board row that arrived by
    // another route may carry only the mirrored Primary (§5.48's marker rule).
    expect(advanceWriteForLive(mirroredOnly)).toEqual({ label: ADVANCE_TO_WELCOME_CALL, index: 6 });
  });

  it("⚠️ an insured patient's advance carries id 1 / Advance to MN — and so does a blank one", () => {
    expect(advanceWriteForLive(insured)).toEqual({ label: ADVANCE_TO_MN, index: 1 });
    // No insurance ON FILE is not cash pay — cash pay is a rep's explicit pick.
    expect(advanceWriteForLive({} as Patient)).toEqual({ label: ADVANCE_TO_MN, index: 1 });
    expect(advanceWriteForLive(null)).toEqual({ label: ADVANCE_TO_MN, index: 1 });
  });

  it("the index map carries both ids the board really assigned", () => {
    /* Read back from the live `settings_str` (2026-09-25) and from automation
       7923595946's own trigger variable (desired value: the raw 6). Monday
       drops a status write to a label id the column does not have at HTTP 200
       with nothing in the logs, so a wrong id here is a patient who advances
       nowhere, silently. */
    expect(MOVE_TO_ONBOARDING_INDEX["Advance to MN"]).toBe(1);
    expect(MOVE_TO_ONBOARDING_INDEX["Advance to Welcome Call"]).toBe(6);
  });

  const WRITERS = [
    "src/lib/profile/mondayWrite.ts",
    "src/lib/profile/unverifiedWrite.ts",
  ];

  it("⚠️⚠️ BOTH writers derive the advancer from advanceWriteForLive — index and expectedText together", () => {
    for (const w of WRITERS) {
      const src = read(w);
      expect(src, w).toContain("advanceWriteForLive(p)");
      /* The §9 no-op guard must name the label the write actually carries: a
         guard reading "Advance to MN" on a cash pay advance either refuses a
         real advance (the column never reads MN) or waves a real no-op
         through. So the expectedText comes from the SAME derived value as the
         index — never a literal. */
      expect(src, w).toContain("expectedText: advance.label");
      expect(src, w).not.toContain('MOVE_TO_ONBOARDING_INDEX["Advance to MN"]');
      expect(src, w).not.toContain('expectedText: "Advance to MN"');
    }
  });
});
