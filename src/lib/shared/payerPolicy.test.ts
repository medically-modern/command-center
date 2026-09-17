/**
 * The offline half of the payer-policy drift check, wired into the unit suite
 * so it rides the existing deploy gate (deploy.yml runs `npx vitest run`).
 *
 * This covers only the consumers inside THIS repo. The copies in
 * reorder-patient-form and coins-form-payment need the network, so they are
 * checked by .github/workflows/payer-policy-drift.yml instead.
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../../..");

type Finding = {
  consumer: string;
  severity: "drift" | "error" | "declared";
  field: string;
  detail: string;
  reason?: string;
};

function runCheck(): { checked: string[]; findings: Finding[] } {
  // The script exits 1 on drift, which execFileSync turns into a throw; the
  // report is on stdout either way, so read it off the error and carry on.
  try {
    const out = execFileSync(
      process.execPath,
      ["scripts/check-payer-policy.mjs", "--offline", "--json"],
      { cwd: ROOT, encoding: "utf8" },
    );
    return JSON.parse(out);
  } catch (err) {
    const e = err as { stdout?: string };
    if (!e.stdout) throw err;
    return JSON.parse(e.stdout);
  }
}

describe("payer policy stays in sync with payerPolicy.json", () => {
  const result = runCheck();

  it("checks both estimators in this repo", () => {
    expect(result.checked).toContain("command-center-test/welcomeCall");
    expect(result.checked).toContain("command-center-test/profile");
  });

  it("finds no undeclared drift", () => {
    const drift = result.findings.filter((f) => f.severity === "drift");
    expect(
      drift,
      `Undeclared payer-policy drift:\n` +
        drift.map((f) => `  ${f.consumer} → ${f.field}: ${f.detail}`).join("\n") +
        `\n\nUpdate the estimator to match src/lib/shared/payerPolicy.json, or record` +
        `\nthe difference under that consumer's "deviations" with a reason.`,
    ).toEqual([]);
  });

  it("can actually read every constant it claims to check", () => {
    // Guards the failure mode where someone renames a constant and the regex
    // silently stops matching — the check would otherwise go quietly green.
    const errors = result.findings.filter((f) => f.severity === "error");
    expect(
      errors,
      `The drift check could not read something and skipped it:\n` +
        errors.map((f) => `  ${f.consumer} → ${f.field}: ${f.detail}`).join("\n"),
    ).toEqual([]);
  });

  it("every declared deviation carries a reason", () => {
    const declared = result.findings.filter((f) => f.severity === "declared");
    for (const f of declared) {
      expect(f.reason, `${f.consumer} → ${f.field} is declared but gives no reason`).toBeTruthy();
    }
  });

  it("lists every consumer with the constants needed to check it", () => {
    const policy = JSON.parse(
      readFileSync(path.join(ROOT, "src/lib/shared/payerPolicy.json"), "utf8"),
    );
    const consumers = Object.entries(policy.consumers).filter(([k]) => !k.startsWith("$"));
    expect(consumers.length).toBeGreaterThanOrEqual(5);
    for (const [name, c] of consumers as [string, Record<string, unknown>][]) {
      expect(c.repo, `${name} has no repo`).toBeTruthy();
      expect(c.path, `${name} has no path`).toBeTruthy();
      expect(c.constants, `${name} has no constants map`).toBeTruthy();
    }
  });
});
