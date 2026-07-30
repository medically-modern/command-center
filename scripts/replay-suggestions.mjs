// scripts/replay-suggestions.mjs — suggestion-engine corpus replay (Gate 2).
//
// Diffs the suggestion engine at --old-ref against the WORKING TREE over
// every historical Stedi check, so any semantic change to
// src/lib/profile/primaryInsurance.ts ships pre-reviewed against real
// traffic. See REGRESSION.md; corpus file comes from the backend repo's
// scripts/export_engine_corpus.py.
//
// Usage:
//   node scripts/replay-suggestions.mjs --corpus engine_corpus.json [--old-ref origin/main]
//
// Exit code 1 when any per-check diff exists (board-state dual-simulation
// diffs are listed for review but don't fail — they're often the point of
// the change; the reviewer decides).

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1]] : null)).filter(Boolean),
);
const corpusPath = args.corpus;
const oldRef = args["old-ref"] || "origin/main";
if (!corpusPath) {
  console.error("usage: node scripts/replay-suggestions.mjs --corpus engine_corpus.json [--old-ref origin/main]");
  process.exit(2);
}

const ENGINE = "src/lib/profile/primaryInsurance.ts";
const work = mkdtempSync(join(tmpdir(), "engine-replay-"));

function bundle(tag, source) {
  const ts = join(work, `${tag}.ts`);
  const mjs = join(work, `${tag}.mjs`);
  writeFileSync(ts, source);
  execSync(`npx esbuild ${ts} --format=esm --outfile=${mjs}`, { stdio: "pipe" });
  return mjs;
}

const oldSrc = execSync(`git show ${oldRef}:${ENGINE}`, { encoding: "utf8" });
const newSrc = readFileSync(ENGINE, "utf8");
const OLD = await import(pathToFileURL(bundle("old", oldSrc)).href);
const NEW = await import(pathToFileURL(bundle("new", newSrc)).href);

const records = JSON.parse(readFileSync(corpusPath, "utf8"));
const REQUEST_TYPES = ["CGM", "Supplies Only", "Insulin Pump + CGM"];

function run(mod, rec, snap, rt, gins) {
  const inp = {
    stediDone: true, generalInsurance: gins, memberId: "",
    patientAddress: rec.address || "", requestType: rt, stedi: snap,
  };
  const p = mod.suggestPrimary(inp);
  return {
    v: p?.value ?? null, conf: p?.confidence ?? null, cant: !!p?.cantServe,
    warn: (p?.warnings ?? []).map((w) => w.code).sort().join(","),
    sec: mod.suggestSecondary(inp),
  };
}

let identical = 0;
const perCheckDiffs = [];
const boardDiffs = [];
for (const rec of records) {
  const scenarios = [["per-check", rec.snap, rec.gins]];
  if (rec.snap_board) {
    scenarios.push(["board-state", rec.snap_board, rec.gins]);
    scenarios.push(["board-state-wrong-gins", rec.snap_board, "Wellcare"]);
  }
  for (const [kind, snap, gins] of scenarios) {
    if (!snap) continue;
    for (const rt of REQUEST_TYPES) {
      const a = run(OLD, rec, snap, rt, gins);
      const b = run(NEW, rec, snap, rt, gins);
      if (JSON.stringify(a) === JSON.stringify(b)) { identical++; continue; }
      const d = { id: rec.id, kind, gins, rt, old: a, new: b };
      (kind === "per-check" ? perCheckDiffs : boardDiffs).push(d);
    }
  }
}

console.log(`old-ref: ${oldRef}   records: ${records.length}`);
console.log(`identical: ${identical}   per-check diffs: ${perCheckDiffs.length}   board-state diffs: ${boardDiffs.length}`);
for (const d of [...perCheckDiffs, ...boardDiffs].slice(0, 60)) {
  console.log(`[${d.kind}] ${d.id} gins=${d.gins} rt=${d.rt}`);
  console.log(`   old: ${JSON.stringify(d.old)}`);
  console.log(`   new: ${JSON.stringify(d.new)}`);
}
if (perCheckDiffs.length) {
  console.error(`\nFAIL: ${perCheckDiffs.length} per-check diffs — every one must be explained or fixed before pushing.`);
  process.exit(1);
}
console.log("\nOK: no per-check regressions. Review board-state diffs above — each must be an intended change.");
