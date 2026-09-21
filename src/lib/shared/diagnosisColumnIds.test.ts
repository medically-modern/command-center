/**
 * Diagnosis moved from a `status` column to a `dropdown` on 2026-09-21.
 *
 * WHY THIS TEST EXISTS: monday status columns cap at 39 labels / label-id 160,
 * and all three columns the app writes were sitting at exactly that, so
 * `create_labels_if_missing` had nowhere to put a new ICD-10 code and monday
 * dropped the write at HTTP 200 with no `errors[]`. A stray OLD id here would
 * read a frozen column and write into one nothing displays — silently, which is
 * the whole failure mode the conversion removes. Same guard, same reasoning, as
 * notesColumnIds.test.ts. CLAUDE.md §5.40.
 */
import { describe, it, expect } from "vitest";
import { COL as MASHEKE } from "@/lib/masheke/mondayApi";
import { COL as SAMANTHA } from "@/lib/samantha/mondayApi";
import { COL as WELCOME } from "@/lib/welcomeCall/mondayApi";
import { COL as FINAL } from "@/lib/finalConfirm/mondayApi";
import { COL as SUBSCRIPTION } from "@/lib/subscription/mondayApi";
import { COL as ORDERS } from "@/lib/orders/mondayApi";

/** Created 2026-09-21 beside the status originals; see scripts/diagnosis-migration. */
const NEW = {
  ME: "dropdown_mm7daf4m",
  INS: "dropdown_mm7dkdq8",
  WC: "dropdown_mm7dvqts",
  SUB: "dropdown_mm7d2p2h",
  ORDER: "dropdown_mm7dds6y",
};

/** The full status columns these replaced. Retitled "(retired)", never deleted. */
const RETIRED = ["color_mm1wf7rv", "color_mkxrxv9w", "color_mm189t0b"];

describe("Diagnosis points at the uncapped dropdown columns", () => {
  it("every role COL map", () => {
    expect(MASHEKE.diagnosis).toBe(NEW.ME);
    expect(SAMANTHA.diagnosis).toBe(NEW.INS);
    expect(WELCOME.diagnosis).toBe(NEW.WC);
    expect(FINAL.diagnosis).toBe(NEW.WC);
    expect(SUBSCRIPTION.diagnosis).toBe(NEW.SUB);
    expect(ORDERS.diagnosisCode).toBe(NEW.ORDER);
  });

  it("every id is a dropdown, not a status column", () => {
    for (const id of Object.values(NEW)) expect(id.startsWith("dropdown_")).toBe(true);
  });

  it("no retired status id survives anywhere in src/", async () => {
    // A source scan, the listColumns.test.ts convention: a re-pointed COL map
    // does not help if some component still hardcodes the old id (masheke's
    // mapping did exactly that before this conversion).
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) return walk(p);
        return /\.tsx?$/.test(f) ? [p] : [];
      });
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), "src"))) {
      if (file.endsWith("diagnosisColumnIds.test.ts")) continue;
      const body = readFileSync(file, "utf8");
      for (const id of RETIRED) {
        // Secondary Claims keeps its own status Diagnosis (color_mky2gpz5) and
        // is deliberately out of scope; it is not in RETIRED.
        if (body.includes(id)) offenders.push(`${file} -> ${id}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
