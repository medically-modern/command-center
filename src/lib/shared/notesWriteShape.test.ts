/**
 * Source-scan guard (the listColumns.test.ts convention): the notes columns are
 * being converted long_text → text in the Monday UI, on no deploy schedule, and
 * prod shares the boards but lags test by a sync. The one write shape that is
 * valid on BOTH sides of that flip is a bare string through
 * change_multiple_column_values (sandbox-verified 2026-09-03: change_column_value
 * rejects a bare string for long_text and a {text} object for text). A later
 * "cleanup" back to change_column_value + {text} would fail loudly on flip day —
 * this test fails the build first.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const ROLES = ["masheke", "samantha", "welcomeCall", "finalConfirm", "subscription", "profile"];

describe("notes writes are flip-safe", () => {
  it("every role's writeLongText sends a bare string via change_multiple_column_values", () => {
    for (const r of ROLES) {
      const src = readFileSync(`src/lib/${r}/mondayApi.ts`, "utf8");
      const m = src.match(/export async function writeLongText\([\s\S]*?\n\}/);
      expect(m, `${r}: writeLongText missing`).toBeTruthy();
      const body = m![0];
      expect(body, `${r}: must use change_multiple_column_values`).toMatch(/change_multiple_column_values/);
      expect(body, `${r}: must not use the strict single-column mutation`).not.toMatch(/change_column_value\(/);
      // Strip comments first — the helper's own comment explains the {text} shape it avoids.
      const code = body.replace(/\/\/[^\n]*/g, "");
      expect(code, `${r}: must not wrap the body in {text}`).not.toMatch(/JSON\.stringify\(\s*\{\s*text\s*\}\s*\)/);
    }
  });

  it("no verified-send task still carries a {text} object for a notes/request-body column", () => {
    const files = [
      "src/components/masheke/ChaseClinicalsPanel.tsx",
      "src/components/masheke/ConfirmReceiptPanel.tsx",
      "src/components/masheke/EvaluatePanel.tsx",
      "src/lib/masheke/mondayWrite.ts",
      "src/lib/welcomeCall/mondayWrite.ts",
      "src/lib/samantha/mondayWrite.ts",
      "src/lib/finalConfirm/mondayWrite.ts",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      // {text, email} is the EMAIL column shape and is fine; a lone {text: x} is not.
      const lone = src.match(/value:\s*\{\s*text:\s*[^,}]+\}/g) ?? [];
      expect(lone, `${f}: ${lone.join(" | ")}`).toEqual([]);
    }
  });

  it("the Oversight manager actions write notes the same flip-safe way (their own helper, not a role's)", () => {
    const src = readFileSync("src/lib/oversight/oversightApi.ts", "utf8");
    const m = src.match(/async function writeLongTextOnBoard\([\s\S]*?\n\}/);
    expect(m, "writeLongTextOnBoard missing").toBeTruthy();
    const code = m![0].replace(/\/\/[^\n]*/g, "");
    expect(code).toMatch(/writeColumnsOnBoard|change_multiple_column_values/);
    expect(code).not.toMatch(/change_column_value\(/);
    expect(code).not.toMatch(/JSON\.stringify\(\s*\{\s*text\s*\}\s*\)/);
    // The object-key form inside a multi-column write is the same hazard.
    const keyed = src.match(/\[(MASHEKE|INSURANCE)_NOTES_COL\]:\s*\{\s*text:/g) ?? [];
    expect(keyed, keyed.join(" | ")).toEqual([]);
  });
});
