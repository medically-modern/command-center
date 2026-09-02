import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DIRECTORY_BOARDS,
  MAX_LOOKUP,
  MAX_PAGES,
  PAGE_SIZE,
  boardRank,
  boundLookup,
  collapseRows,
  directoryHealth,
  last10,
  toDirectoryRow,
  toE164,
} from "./patientDirectoryRules.mjs";
import { upsertSql } from "./patientDirectory.mjs";

/** Same shape as smsArchiveRules.test.mjs: resolve from the repo root, since
 *  import.meta.url is not a file: URL under the jsdom environment. */
const src = (f) => readFileSync(resolve(process.cwd(), "services/monday-gateway", f), "utf8");

/** Opaque, like the real HMAC. ⚠️ Deliberately NOT `H(${e164})`: a stub that
 *  echoes its input makes the "no plaintext number" assertion below test the
 *  stub instead of the code. */
const hashed = new Map();
const hash = (e164) => {
  if (!hashed.has(e164)) hashed.set(e164, `h${hashed.size}`);
  return hashed.get(e164);
};
const board = (over = {}) => ({ boardId: 18410804557, name: "Welcome Call", phoneColId: "phone_mm1x44yk", ...over });
const item = (over = {}) => ({
  id: "1",
  name: "Tonasila Gray",
  column_values: [{ id: "phone_mm1x44yk", text: "8155237259" }],
  ...over,
});

describe("phone normalisation", () => {
  it("normalises every shape the boards actually hold to one E.164", () => {
    // ⚠️ Verified on the live boards: `9739511857` and `16078737352` sit in the
    // same column. They MUST hash the same as the formatted form, or a patient
    // silently stops matching.
    for (const shape of ["8155237259", "18155237259", "+18155237259", "(815) 523-7259", "815-523-7259"]) {
      expect(toE164(shape)).toBe("+18155237259");
    }
  });

  it("refuses anything that isn't a full 10 digits", () => {
    expect(toE164("911")).toBe("");
    expect(toE164("")).toBe("");
    expect(last10("+1 (815) 523-7259")).toBe("8155237259");
  });
});

describe("toDirectoryRow", () => {
  it("builds a row with the number HASHED and only four digits kept", () => {
    const row = toDirectoryRow(item(), board(), hash);
    expect(row).toMatchObject({
      phoneHmac: hash("+18155237259"),
      last4: "7259",
      name: "Tonasila Gray",
      boardId: 18410804557,
    });
    // ⚠️ The row carries NO field holding the number — only the hash and the
    // four-digit hint. Asserted on the shape rather than by searching the JSON,
    // which would only ever prove something about the fake hash above.
    expect(Object.keys(row).sort()).toEqual(
      ["boardId", "boardName", "last4", "mondayItemId", "name", "phoneHmac", "rank"].sort(),
    );
    expect(row.last4).toHaveLength(4);
  });

  it("hashes every stored shape of one number to the SAME row", () => {
    // The whole lookup depends on this: a number typed differently on two
    // boards must not become two directory entries.
    const shapes = ["8155237259", "18155237259", "+18155237259", "(815) 523-7259"];
    const hashes = shapes.map((t) => toDirectoryRow(item({ column_values: [{ id: "phone_mm1x44yk", text: t }] }), board(), hash).phoneHmac);
    expect(new Set(hashes).size).toBe(1);
  });

  it("drops an item with no usable phone — it could never be looked up", () => {
    expect(toDirectoryRow(item({ column_values: [] }), board(), hash)).toBeNull();
    expect(toDirectoryRow(item({ column_values: [{ id: "phone_mm1x44yk", text: "" }] }), board(), hash)).toBeNull();
  });

  it("drops a nameless item — a blank name is worse than the number", () => {
    expect(toDirectoryRow(item({ name: "   " }), board(), hash)).toBeNull();
  });

  it("reads the phone from THIS board's column, not another board's", () => {
    const dtc = board({ boardId: 18392794310, name: "DTC Intake", phoneColId: "phone_mkwrkc73" });
    expect(toDirectoryRow(item(), dtc, hash)).toBeNull();
    const ok = toDirectoryRow(item({ column_values: [{ id: "phone_mkwrkc73", text: "8155237259" }] }), dtc, hash);
    expect(ok?.name).toBe("Tonasila Gray");
  });
});

describe("collapseRows", () => {
  const row = (over) => ({ phoneHmac: "H", last4: "7259", name: "x", mondayItemId: "1", boardId: 0, rank: 0, ...over });

  it("keeps ONE row per number — the furthest-along board wins", () => {
    // A patient is one item per board (§6), so the same number arrives several
    // times. The later stage holds the name a rep has actually corrected.
    const out = collapseRows([
      row({ name: "Tonasila Grey", rank: 1, mondayItemId: "a" }),
      row({ name: "Tonasila Gray", rank: 4, mondayItemId: "b" }),
      row({ name: "T Gray", rank: 2, mondayItemId: "c" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Tonasila Gray");
  });

  it("breaks a tie deterministically, not by scan order", () => {
    // Two live items on one board for one number is a household (John and Sue
    // Hartley share 3046977788 live). Monday's scan order is not stable, so
    // without a deterministic tie-break the displayed name would flip between
    // two real people from one day to the next.
    const a = [row({ name: "John Hartley Jr", rank: 1, mondayItemId: "10" }), row({ name: "Sue Hartley", rank: 1, mondayItemId: "20" })];
    expect(collapseRows(a)[0].name).toBe("Sue Hartley");
    expect(collapseRows([...a].reverse())[0].name).toBe("Sue Hartley");
  });

  it("keeps different numbers apart", () => {
    expect(collapseRows([row({ phoneHmac: "A" }), row({ phoneHmac: "B" })])).toHaveLength(2);
  });

  it("ignores nulls, so a dropped item can't blank a batch", () => {
    expect(collapseRows([null, row(), undefined])).toHaveLength(1);
  });

  it("ranks a non-pipeline board below every stage", () => {
    // Secondary Claims is a parallel reconciliation board, not a stage.
    expect(boardRank(18413019028)).toBeLessThan(boardRank(18392794310));
    expect(boardRank(18410804557)).toBeGreaterThan(boardRank(18406352652));
    expect(boardRank(999)).toBe(-1);
  });
});

describe("boundLookup", () => {
  it("normalises, dedupes, and drops what can't be looked up", () => {
    expect(boundLookup(["8155237259", "+1 815 523 7259", "911", "", null])).toEqual(["+18155237259"]);
  });

  it("caps the batch — an unbounded IN list is work a client can ask for", () => {
    const many = Array.from({ length: MAX_LOOKUP + 50 }, (_, i) => String(9000000000 + i));
    expect(boundLookup(many)).toHaveLength(MAX_LOOKUP);
  });

  it("handles no input at all", () => {
    expect(boundLookup(undefined)).toEqual([]);
  });
});

describe("directoryHealth", () => {
  const now = Date.parse("2026-09-02T18:00:00Z");

  it("is ok after a recent clean run", () => {
    const h = directoryHealth({ lastOkAt: "2026-09-02T06:00:00Z", rows: 5200, now });
    expect(h).toMatchObject({ ok: true, stale: false, truncated: false, rows: 5200 });
  });

  it("is NOT ok when no run has ever succeeded, however many rows it holds", () => {
    // A job deployed but never actually running must not read healthy.
    expect(directoryHealth({ rows: 5200, now }).ok).toBe(false);
  });

  it("is NOT ok when the last good run was truncated", () => {
    // It really did sync, which is why the run is still recorded ok — but it
    // did not cover every board, and that verdict belongs here.
    const h = directoryHealth({ lastOkAt: "2026-09-02T06:00:00Z", lastTruncated: true, rows: 5200, now });
    expect(h).toMatchObject({ ok: false, truncated: true });
  });

  it("goes stale rather than silently ageing", () => {
    const h = directoryHealth({ lastOkAt: "2026-08-25T06:00:00Z", rows: 5200, now });
    expect(h).toMatchObject({ ok: false, stale: true });
    expect(h.ageHours).toBeGreaterThan(48);
  });

  it("never leaks a name or a number — counts and timestamps only", () => {
    const h = directoryHealth({ lastOkAt: "2026-09-02T06:00:00Z", rows: 5200, now });
    expect(Object.keys(h).sort()).toEqual(
      ["ageHours", "lastError", "lastOkAt", "lastRunAt", "ok", "rows", "stale", "truncated"].sort(),
    );
  });
});

describe("upsertSql", () => {
  it("binds six columns per row", () => {
    expect(upsertSql(2)).toContain("($1,$2,$3,$4,$5,$6,now()),($7,$8,$9,$10,$11,$12,now())");
  });

  it("UPDATEs on conflict — a renamed patient must overwrite, not be ignored", () => {
    const sql = upsertSql(1);
    expect(sql).toContain("ON CONFLICT (phone_hmac) DO UPDATE");
    expect(sql).not.toContain("DO NOTHING");
    expect(sql).toContain("name           = EXCLUDED.name");
  });
});

describe("the module's own guarantees, read from source", () => {
  it("stores the number only as an HMAC — no plaintext phone column", () => {
    const schema = src("patientDirectory.mjs");
    expect(schema).toContain("phone_hmac      TEXT PRIMARY KEY");
    // A `phone TEXT` column would be the whole PHI argument undone.
    expect(schema).not.toMatch(/^\s+phone\s+TEXT/m);
  });

  it("never deletes rows for absence", () => {
    // A board read that failed halfway would otherwise wipe real names, and a
    // stale name is a far smaller harm than a blank one.
    expect(src("patientDirectory.mjs")).not.toMatch(/DELETE\s+FROM\s+patient_directory\b/i);
  });

  it("keeps the kill switch and the auth gate the docs promise", () => {
    const s = src("patientDirectory.mjs");
    expect(s).toContain('PATIENT_DIRECTORY_ENABLED === "0"');
    // The lookup returns names, so it must be authenticated; health returns
    // counts, so it must not be.
    expect(s).toMatch(/app\.post\("\/directory\/lookup"[\s\S]*?requireCaller/);
    expect(s).toMatch(/app\.post\("\/directory\/refresh"[\s\S]*?requireCaller/);
  });

  it("scans well past the biggest real board, so truncation means something", () => {
    // Profile Send Off is ~2,600 items = 6 pages at 500.
    expect(PAGE_SIZE).toBe(500);
    expect(MAX_PAGES).toBeGreaterThan(10);
  });

  it("covers every board the SPA's registry does", () => {
    // ⚠️ The board list is a MIRROR of the SPA's BOARDS registry, so a board
    // added there and not here goes silently unnamed. This pins the count and
    // ids; the SPA-side test asserts the two agree field by field.
    const registry = readFileSync(resolve(process.cwd(), "src/lib/systemMgmt/mondayApi.ts"), "utf8");
    for (const b of DIRECTORY_BOARDS) {
      expect(registry).toContain(String(b.boardId));
      expect(registry).toContain(b.phoneColId);
    }
    expect(DIRECTORY_BOARDS).toHaveLength(7);
  });
});
