/**
 * Final Confirm READS the SoS Last Bill columns — and must never write one back
 * into the legacy column beside it.
 *
 * Brandon, 2026-09-10: the Last Bill Dates block was blank for patients we had
 * billed, because it read only the legacy `lastBillDate*` columns, which
 * Benefits clears whenever Same-or-Similar comes back Clear (§5.32).
 *
 * The fix is a CAPTION under the box, not a value inside it, and this file is
 * why. The legacy column's date-PRESENCE is load-bearing twice on this stage:
 *   - `mondayMapping` derives `sosMonitor`/`sosSensors`/… = "Not Clear" from it
 *   - `checkPack.authExpiryMoot` silences C18's auth-expiry warning on it
 * so a send that copied a Clear product's date into the legacy column would
 * relabel the product AND hide a lapsed auth, both silently. These fail if a
 * later change pours the SoS date into the editable field.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { COL } from "./mondayApi";
import { runFinalChecks } from "./checkPack";
import { basePatient } from "./checkPack.test";
import type { Patient } from "./workflow";

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

/** A patient whose sensors SoS came back CLEAR: real date, legacy blank —
 *  Tommy Cole (12854165138) as the live board held him, 2026-09-10. */
const clearSensors: Partial<Patient> = {
  lastBillDateSensors: "",
  sosLastBillSensors: "2025-03-14",
};

describe("Final Confirm — the SoS last bill date is read, never written back", () => {
  it("leaves the legacy Sensors column empty when only the SoS column has a date", async () => {
    // The whole point: a send must not turn a Clear product into Not Clear.
    expect((await send(clearSensors)).get(COL.lastBillDate.sensors)).toEqual({});
  });

  it("never writes the SoS columns themselves — Benefits owns them", async () => {
    await send(clearSensors);
    const written = new Set(captured[0].map((t) => t.columnId));
    for (const id of [
      COL.sosLastBillMonitor, COL.sosLastBillSensors, COL.sosLastBillIp,
      COL.sosLastBillInfusionSet, COL.sosLastBillCartridge,
    ]) {
      expect(written.has(id), `${id} must not be written by this stage`).toBe(false);
    }
  });

  it("still writes a legacy date the rep actually entered", async () => {
    // Editing the box stays a deliberate act, unchanged — that is the path that
    // legitimately marks a product Not Clear.
    const v = await send({ ...clearSensors, lastBillDateSensors: "2026-01-09" });
    expect(v.get(COL.lastBillDate.sensors)).toEqual({ date: "2026-01-09" });
  });

  it("still CLEARS a legacy date the rep blanked", async () => {
    // The caption must never make the box un-clearable — the no-passing-move
    // dead end §5.10/§5.20 each record reversing.
    const v = await send({ lastBillDateSensors: "", sosLastBillSensors: "" });
    expect(v.get(COL.lastBillDate.sensors)).toEqual({});
  });
});

describe("checkPack still reads the LEGACY column, deliberately", () => {
  it("a Clear product does not silence the auth-expiry warning", () => {
    // Widening `authExpiryMoot` to the SoS family would hide genuinely lapsed
    // auths on Medicaid patients — the dangerous direction (§5.17). Left for
    // Brandon to decide; pinned here so it cannot drift by accident.
    const ids = runFinalChecks({
      ...basePatient(),
      serving: "CGM",
      cgmType: "Dexcom G7",
      primaryInsurance: "Fidelis Medicaid",
      sensorsAuthResult: "Auth Valid",
      sensorsAuthId: "A1",
      sensorsAuthEnd: "2025-01-01", // long lapsed
      ...clearSensors,
    }).map((f) => f.id);
    expect(ids).toContain("C18_AUTH_EXPIRED");
  });
});
