/**
 * T-RO: this feature can never write to monday. T-PII: fixtures contain no personal data.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { gql, READ_ONLY_ERROR } from "./data/gql";

function files(dir: string): string[] {
  if (statSync(dir).isFile()) return [dir];
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : [p]; });
}
const ROOTS = ["src/lib/onboardingOversight", "src/components/onboardingOversight", "src/hooks/useOnboardingOversight.ts", "src/pages/OnboardingOversightPage.tsx"]; // final architect review: hook and page too
const all = ROOTS.flatMap((r) => { try { return files(r); } catch { return []; } }).filter((f) => /\.(ts|tsx)$/.test(f));

describe("T-RO read-only guard", () => {
  it("rejects any mutation before a network call", async () => {
    await expect(gql("mutation { change_column_value(board_id: 1) { id } }")).rejects.toThrow(READ_ONLY_ERROR);
  });
  it("no dashboard source file contains a mutation or imports CC write helpers", () => {
    for (const f of all) {
      if (f.endsWith("guards.test.ts") || f.endsWith("data/gql.ts") || f.endsWith(".local.test.ts")) continue; // local probes are git-excluded and never shipped
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\bmutation\b/i);
      expect(src, f).not.toMatch(/approveProposedStuck|returnProposedToQueue|approveInsuranceStuck|returnInsuranceToQueue|returnInsuranceToManager|escalateSubmitAuthToFinal/);
      expect(src, f).not.toMatch(/\bwrite[A-Z]\w*\s*\(/); // "or other write* functions" (spec T-RO)
    }
  });
});

describe("T-PII fixtures", () => {
  it("contain no name/phone/email/dob/member keys or phone/email-looking values", () => {
    for (const f of all.filter((x) => x.includes("__fixtures__"))) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\b(name|phone|email|dob|member)\s*:/i);
      expect(src, f).not.toMatch(/\b\d{3}[-.]\d{3}[-.]\d{4}\b/);
      expect(src, f).not.toMatch(/[\w.]+@[\w-]+\.[a-z]{2,}/i);
    }
  });
});
