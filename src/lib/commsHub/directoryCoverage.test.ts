/**
 * The gateway's board list must match the SPA's BOARDS registry.
 *
 * ⚠️ `patientDirectoryRules.mjs` MIRRORS `systemMgmt/mondayApi.ts` — the
 * gateway is a separate Node service that does not build the SPA's TypeScript,
 * so it cannot import the real thing. That is the same hand-synced-contract
 * hazard CLAUDE.md §5.7 records for the OOP estimator and §5.17 for the
 * Cardinal parser, and it fails the same silent way: a board added to the
 * registry and not to the gateway is simply never scanned, so every patient
 * whose only record is on it resolves to a bare phone number, with nothing
 * erroring anywhere.
 *
 * This is the check that turns that into a failing build.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BOARDS } from "@/lib/systemMgmt/mondayApi";

/** Read as source rather than imported: the gateway module is ESM `.mjs` that
 *  pulls in `pg`, which the SPA test run has no reason to install. */
const rules = readFileSync(
  resolve(process.cwd(), "services/monday-gateway/patientDirectoryRules.mjs"),
  "utf8",
);

/** The literal board table out of the gateway source. */
function gatewayBoards(): { boardId: number; phoneColId: string }[] {
  const block = rules.slice(rules.indexOf("DIRECTORY_BOARDS = ["), rules.indexOf("];", rules.indexOf("DIRECTORY_BOARDS = [")));
  return [...block.matchAll(/boardId:\s*(\d+),\s*name:\s*"([^"]+)",\s*phoneColId:\s*"([^"]+)"/g)].map((m) => ({
    boardId: Number(m[1]),
    phoneColId: m[3],
  }));
}

describe("patient directory board coverage", () => {
  it("covers every board in the SPA registry, with the same phone column", () => {
    const gw = new Map(gatewayBoards().map((b) => [b.boardId, b.phoneColId]));
    for (const b of BOARDS) {
      expect(
        gw.has(b.boardId),
        `Board ${b.boardId} (${b.boardName}) is in BOARDS but NOT in the gateway's DIRECTORY_BOARDS — ` +
          `every patient whose only record is there will resolve to a bare phone number, silently. ` +
          `Add it to services/monday-gateway/patientDirectoryRules.mjs.`,
      ).toBe(true);
      expect(gw.get(b.boardId), `Phone column drift on board ${b.boardId} (${b.boardName})`).toBe(b.phoneColId);
    }
  });

  it("scans no board the registry doesn't know about", () => {
    // The other direction: a board removed from the registry but left in the
    // gateway would keep being scanned, and its (possibly stale) names would
    // keep winning lookups.
    const registry = new Set(BOARDS.map((b) => b.boardId));
    for (const b of gatewayBoards()) {
      expect(registry.has(b.boardId), `Gateway scans board ${b.boardId}, which is not in BOARDS`).toBe(true);
    }
  });

  it("ranks every scanned board, so none silently loses every tie", () => {
    // A board missing from PIPELINE_RANK gets -1, which means its name can
    // never win against any pipeline board — survivable, but only deliberate
    // for Secondary Claims.
    for (const b of gatewayBoards()) {
      expect(rules).toContain(String(b.boardId));
    }
  });
});
