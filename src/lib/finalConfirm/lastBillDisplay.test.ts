/**
 * Final Confirm's Last Bill Dates are the "<product> SoS Last Bill" columns —
 * read from them, written back to them, and NEVER to the retired legacy family.
 *
 * History, because the previous version of this file pinned the opposite.
 * Until 2026-09-15 the five boxes edited the legacy "<product> Last Bill Date"
 * columns (`date_mm33…`), whose date-PRESENCE Benefits maintained as a Not-Clear
 * flag, while a caption showed the SoS date beside them (§5.32). The audit that
 * day found the flag fed a derived `sos*` quintet nothing read, and that its one
 * live consumer — `checkPack.authExpiryMoot` — changed verdict for ZERO patients
 * when pointed at the SoS family (of 324 Medicaid × Auth Valid × has-end-date
 * product-rows on the live board, none carried a date in either column). So the
 * pair was collapsed: one field, one column. These fail if the `lastBillDate`
 * map drifts off the SoS ids, or if a send names a legacy id again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { COL } from "./mondayApi";
import { runFinalChecks } from "./checkPack";
import { basePatient } from "./checkPack.test";
import type { Patient } from "./workflow";

/** The retired Welcome Call legacy ids. Nothing in this slice may name them. */
const LEGACY_WC_IDS = ["date_mm33vqa0", "date_mm33jsyt", "date_mm33kmz4", "date_mm33mw14", "date_mm33rd8n"];

/** Every string leaf in a nested column-id map. */
function allIds(v: unknown): string[] {
  if (typeof v === "string") return [v];
  if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).flatMap(allIds);
  return [];
}

interface Task { label: string; columnId: string; value?: unknown }
const captured: Task[][] = [];

vi.mock("../shared/verifiedWrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared/verifiedWrite")>();
  return {
    ...actual,
    executeWritesWithVerification: async (opts: { tasks: Task[] }) => {
      captured.push(opts.tasks);
      return [] as string[];
    },
  };
});

beforeEach(() => {
  captured.length = 0;
  vi.stubEnv("VITE_MONDAY_API_TOKEN", "test-token");
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    const call = JSON.parse(init.body) as { query: string; variables?: Record<string, unknown> };
    // The notes guard asks the board for a column's live type before building
    // its tasks — answer the query, don't record it.
    if (/^\s*query\b/.test(call.query)) {
      const cols = ((call.variables?.cols as string[] | undefined) ?? []).map((id) => ({ id, type: "long_text" }));
      return { ok: true, status: 200, json: async () => ({ data: { boards: [{ columns: cols }] } }), text: async () => "{}" };
    }
    return { ok: true, status: 200, json: async () => ({ data: {} }), text: async () => "{}" };
  }) as unknown as typeof fetch;
});

/** Run a send and index the tasks it built by column id. */
async function send(p: Partial<Patient>) {
  const { sendPatientToMonday } = await import("./mondayWrite");
  await sendPatientToMonday({ ...basePatient(), id: "1", ...p } as never);
  expect(captured.length).toBe(1);
  const byCol = new Map<string, unknown>();
  for (const t of captured[0]) byCol.set(t.columnId, t.value);
  return byCol;
}

describe("COL.lastBillDate is the SoS family", () => {
  it("names the five SoS Last Bill columns", () => {
    expect(COL.lastBillDate).toEqual({
      monitor: "date_mm599gk8",
      sensors: "date_mm59n1x1",
      insulin_pump: "date_mm593ghh",
      infusion_set: "date_mm59jcf5",
      cartridge: "date_mm59mw5n",
    });
  });

  it("no column id anywhere in this slice is a retired legacy id", () => {
    for (const id of allIds(COL)) {
      expect(LEGACY_WC_IDS, `${id} is a retired legacy Last Bill Date column`).not.toContain(id);
    }
  });
});

describe("Final Confirm — the Last Bill Dates card writes the SoS columns", () => {
  it("writes the rep's sensors date to CGM Sensors SoS Last Bill", async () => {
    // Tammy Turpin (13016718558) as repaired 2026-09-15: A4239 last billed
    // 06/25/2026, a date that had sat only in the Benefits call notes.
    const v = await send({ lastBillDateSensors: "2026-06-25" });
    expect(v.get("date_mm59n1x1")).toEqual({ date: "2026-06-25" });
  });

  it("clears it when the rep blanks the box", async () => {
    // A blank must still be a clear — otherwise the box could never be un-set,
    // the no-passing-move dead end §5.10/§5.20 each record reversing.
    const v = await send({ lastBillDateSensors: "" });
    expect(v.get("date_mm59n1x1")).toEqual({});
  });

  it("never writes a retired legacy column", async () => {
    await send({ lastBillDateSensors: "2026-06-25", lastBillDateMonitor: "2023-06-22" });
    const written = new Set(captured[0].map((t) => t.columnId));
    for (const id of LEGACY_WC_IDS) expect(written.has(id), `${id} is retired`).toBe(false);
  });
});

describe("checkPack.authExpiryMoot reads the SoS last bill", () => {
  const lapsedSensors = (over: Partial<Patient>) =>
    runFinalChecks({
      ...basePatient(),
      serving: "CGM",
      cgmType: "Dexcom G7",
      sensorsAuthResult: "Auth Valid",
      sensorsAuthId: "A1",
      sensorsAuthEnd: "2025-01-01", // long lapsed
      ...over,
    }).map((f) => f.id);

  it("a Medicaid patient we HAVE billed does not get the expiry row", () => {
    // Brandon, 2026-09-02: on ePACES Medicaid a paid claim settles what the
    // expiry row was asking. The SoS date is that paid claim.
    expect(lapsedSensors({ primaryInsurance: "Fidelis Medicaid", lastBillDateSensors: "2025-03-14" }))
      .not.toContain("C18_AUTH_EXPIRED");
  });

  it("a Medicaid patient we have NEVER billed still does", () => {
    // The half that must survive: a stale auth is the only signal there is.
    expect(lapsedSensors({ primaryInsurance: "Fidelis Medicaid", lastBillDateSensors: "" }))
      .toContain("C18_AUTH_EXPIRED");
  });

  it("a commercial patient gets the row however well they have billed", () => {
    // The payer enforces the window; "we billed it in March" says nothing about September.
    expect(lapsedSensors({ primaryInsurance: "Cigna", lastBillDateSensors: "2025-03-14" }))
      .toContain("C18_AUTH_EXPIRED");
  });
});
