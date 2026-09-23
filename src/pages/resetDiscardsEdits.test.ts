import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ⚠️ A stage page's Reset must DISCARD the rep's edits. It must never WRITE an
 * edit of its own.
 *
 * Until 2026-09-23 five Reset buttons (Welcome Call · Final Confirm · Benefits ·
 * Submit Auth · Auth Outstanding) called `clearOverlay` and then
 * `update(id, { …blanks })` to empty the form on screen. `update` writes the OVERLAY, and every refetch merges the overlay
 * back over the board — so the blanks outlived the "refetching from Monday"
 * the toast promised, and the next Send wrote them:
 *   · Insurance: `notes: ""` replaced the shared Call Reference Notes column
 *     (every Insurance stage's history for the patient), and Add note then
 *     appended one line onto "" and wrote that over the column too.
 *   · Final Confirm: the five Last Bill dates are written unconditionally, so a
 *     blank CLEARS them — Reset → Send erased every one (§5.32e: "NEVER EVER
 *     should something be deleted").
 *   · Welcome Call: the always-written order columns (Greptile, PR #57).
 * The other six (the five masheke stages and Subscription) called
 * `clearOverlay` alone, which drops the overlay entry but changes nothing
 * RENDERED — the edits stayed on screen until a
 * refetch landed, and a failed refetch made them permanent.
 *
 * `discardEdits` does the whole job: drop the overlay, forget it in storage,
 * and put the board's own copy back on screen synchronously. So the rule this
 * file holds every page to is short — Reset calls `discardEdits`, and nothing
 * in it calls `update` or `clearOverlay`. A source scan, the
 * `listColumns.test.ts` convention: the hazard is one line in a click handler,
 * invisible on screen, and it costs a patient's history.
 */

const PAGES_DIR = __dirname;

/** The body of `resetForNewPatient`, found by brace depth from its `=>`. */
function resetBody(src: string): string | null {
  const start = src.indexOf("const resetForNewPatient");
  if (start < 0) return null;
  const open = src.indexOf("{", src.indexOf("=>", start));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

const pages = readdirSync(PAGES_DIR)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => ({ file: f, body: resetBody(readFileSync(join(PAGES_DIR, f), "utf8")) }))
  .filter((p): p is { file: string; body: string } => p.body !== null);

describe("every stage page's Reset discards edits and writes none", () => {
  /* A rename would otherwise shrink this suite to nothing and pass. Eleven on
     2026-09-23: the five masheke stages, the three Insurance stages, Welcome
     Call, Final Confirm and Subscription. */
  it("finds the Reset handlers", () => {
    expect(pages.map((p) => p.file).sort()).toEqual([
      "AuthOutstandingPage.tsx",
      "ChaseBenefitsPage.tsx",
      "ChaseClinicalsPage.tsx",
      "ConfirmReceiptPage.tsx",
      "DoctorAppointmentsPage.tsx",
      "EvaluatePage.tsx",
      "FinalConfirmPage.tsx",
      "SendRequestPage.tsx",
      "SubmitAuthPage.tsx",
      "SubscriptionPage.tsx",
      "WelcomeCallPage.tsx",
    ]);
  });

  for (const { file, body } of pages) {
    describe(file, () => {
      it("calls discardEdits", () => {
        expect(
          body.includes("discardEdits("),
          "Reset must restore the board's copy on screen — clearOverlay alone leaves the edits rendered until a refetch lands",
        ).toBe(true);
      });

      it("never writes the overlay", () => {
        expect(
          /\bupdate\(/.test(body),
          "Reset calls update(): that writes the OVERLAY, which every refetch merges back over the board and the next Send writes to Monday",
        ).toBe(false);
      });

      it("does not call clearOverlay instead", () => {
        expect(
          /\bclearOverlay\(/.test(body),
          "clearOverlay drops the overlay entry but changes nothing rendered — use discardEdits",
        ).toBe(false);
      });
    });
  }
});
