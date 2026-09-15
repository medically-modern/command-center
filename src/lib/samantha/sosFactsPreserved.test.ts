/**
 * Source-scan guard (the listColumns.test.ts convention): the Benefits send must
 * never write a BLANK over a last-bill date the rep entered.
 *
 * It did, until 2026-09-15. Both gates in the SoS facts block carried
 * `st.auth !== "required"`, reading spec §1's "any previously entered
 * date/units are ignored while Auth = Required" as licence to erase the column.
 * Ignoring a fact for the VERDICT and deleting it from the RECORD are different
 * things, and only the first was asked for.
 *
 * Hope Hebb, Insurance item 13041022056, 2026-09-14 12:50 PM ET (gateway audit):
 * one transaction wrote `date_mm59ejs2: {}` while computing Sensors Next Order
 * Date = 2026-07-26 FROM the very date it was blanking (04/27/2026 + 90). The
 * app used the date and erased it in the same breath; two sends later the
 * derived date went too, because the page re-hydrated from the blanked column.
 *
 * A regression here is silent — green toast, green page, empty column — so this
 * scan is the only thing that would catch it. Verified to fail when either
 * condition is restored.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { derivedSos } from "./benefitsDerive";
import type { ProductCodeState } from "./workflow";

const SRC = "src/lib/samantha/mondayWrite.ts";

/** The declaration body for `const <name> = ...;`, comments stripped. */
function declaration(src: string, name: string): string {
  const m = src.match(new RegExp(`const ${name}\\s*=([\\s\\S]*?);`));
  expect(m, `${name} not found in ${SRC}`).toBeTruthy();
  return m![1].replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("the Benefits send never discards an entered SoS fact", () => {
  const src = readFileSync(SRC, "utf8");

  it("isBilledFact does not gate the last-bill date on the auth being settled", () => {
    const body = declaration(src, "isBilledFact");
    expect(body, "a pending auth must not blank the date the rep typed").not.toMatch(
      /auth\s*!==\s*["']required["']/,
    );
    // It still needs a real answer to write one — a date, from a "billed" entry.
    expect(body).toMatch(/sosEntry\s*===\s*["']billed["']/);
    expect(body).toMatch(/lastBillDate/);
  });

  it("neverChecked does not gate the No-Billing-History answer on the auth either", () => {
    const body = declaration(src, "neverChecked");
    expect(body, "a pending auth must not discard a 'never billed' answer").not.toMatch(
      /auth\s*!==\s*["']required["']/,
    );
    expect(body).toMatch(/sosEntry\s*===\s*["']never["']/);
  });

  it("the Auth Outstanding recheck still clears ONLY on a positive 'never billed'", () => {
    // The other clear in this file is legitimate and must stay: a rep who says
    // the product was never billed is answering, not failing to answer.
    const m = src.match(/SoS Last Bill \(recheck, clear\)[\s\S]{0,400}/);
    expect(m, "recheck clear task missing").toBeTruthy();
    const before = src.slice(0, src.indexOf("SoS Last Bill (recheck, clear)"));
    expect(before).toMatch(/state\.sosEntry\s*===\s*["']never["'][\s\S]*$/);
  });
});

describe("recording the facts cannot change the deferral verdict", () => {
  // This is what makes the fix strictly additive: derivedSos short-circuits on a
  // required auth BEFORE it reads any fact, so the Skip SoS dropdown and the
  // stage routing are untouched — only the record is kept.
  const billedWithPendingAuth = {
    status: "pending",
    auth: "required",
    sosEntry: "billed",
    lastBillDate: "2026-04-27",
    units: "",
  } as unknown as ProductCodeState;

  it("a pending auth still derives skip even with a date on file", () => {
    expect(derivedSos(billedWithPendingAuth, "cgm-sensors", false, "2026-09-14", false, false)).toBe("skip");
  });

  it("…and Humana still derives from the facts (§5.32c), unchanged", () => {
    // Sensors carry a 90-day window, so 04/27 is outside it on 09/14 → Clear.
    // (Which is what Hope Hebb's sensors would have derived, had the date been
    // allowed to land: Clear, never Skip.)
    const verdict = derivedSos(billedWithPendingAuth, "cgm-sensors", false, "2026-09-14", false, true);
    expect(verdict).not.toBe("skip");
    expect(verdict).toBe("clear");
  });
});
