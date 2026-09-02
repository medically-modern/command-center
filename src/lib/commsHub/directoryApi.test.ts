/**
 * The directory client, and the property the whole design rests on: a MISS is
 * not an answer.
 *
 * The Postgres copy is at most a day old, so a patient created this morning is
 * genuinely absent from it — and so is everybody if the reconcile has never
 * run. The Monday fallback is what turns that from a correctness bug into a
 * performance one, and these cases pin it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const fetchDirectoryNames = vi.fn();
vi.mock("./dossierApi", () => ({
  fetchDirectoryNames: (...a: unknown[]) => fetchDirectoryNames(...a),
}));
vi.mock("../shared/mondayEndpoint", () => ({
  MONDAY_GATEWAY_BASE: "https://gw.test",
  mondayIdentityHeaders: () => ({}),
}));

import { lookupDirectory, resolveNames } from "./directoryApi";

const TONASILA = "8155237259";
const NEW_PATIENT = "9287500069";

/** A gateway response, in the shape the route returns. */
const gwOk = (names: Record<string, unknown>) =>
  Promise.resolve({ ok: true, json: async () => ({ names }) } as Response);

beforeEach(() => {
  fetchDirectoryNames.mockReset();
  fetchDirectoryNames.mockResolvedValue({ ok: true, names: new Map() });
});
afterEach(() => vi.unstubAllGlobals());

describe("lookupDirectory", () => {
  it("asks the gateway in E.164 and keys the answer by last-10 digits", async () => {
    const f = vi.fn((_url: string, init?: RequestInit) =>
      gwOk({ "+18155237259": { name: "Tonasila Gray", itemId: "1", boardId: 18410804557, boardName: "Welcome Call" } }),
    );
    vi.stubGlobal("fetch", f);
    const out = await lookupDirectory([TONASILA]);
    // ⚠️ E.164 on the wire: the gateway hashes what it is sent, so a different
    // shape would hash differently and match nothing.
    expect(JSON.parse(String(f.mock.calls[0][1]?.body)).numbers).toEqual(["+18155237259"]);
    expect(out.hits.get(TONASILA)).toMatchObject({ name: "Tonasila Gray", boardName: "Welcome Call" });
    expect(out.ok).toBe(true);
  });

  it("reports a FAILED request rather than an empty answer", async () => {
    // The caller caches misses; a 500 recorded as "on no board" would freeze
    // those rows at a bare number for the session.
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, status: 500 } as Response)));
    expect(await lookupDirectory([TONASILA])).toMatchObject({ ok: false });
  });

  it("never throws at the caller when the gateway is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("network"))));
    const out = await lookupDirectory([TONASILA]);
    expect(out).toMatchObject({ ok: false });
    expect(out.hits.size).toBe(0);
  });

  it("drops a hit with no name rather than rendering a blank row", async () => {
    vi.stubGlobal("fetch", vi.fn(() => gwOk({ "+18155237259": { name: "   ", itemId: "1" } })));
    expect((await lookupDirectory([TONASILA])).hits.size).toBe(0);
  });

  it("makes no request at all for nothing askable", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await lookupDirectory(["911", ""])).toMatchObject({ ok: true });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("resolveNames — directory first, Monday for the rest", () => {
  it("does not touch Monday when the directory knew everything", async () => {
    vi.stubGlobal("fetch", vi.fn(() => gwOk({ "+18155237259": { name: "Tonasila Gray" } })));
    const out = await resolveNames([TONASILA]);
    expect(out.names.get(TONASILA)).toBe("Tonasila Gray");
    expect(fetchDirectoryNames).not.toHaveBeenCalled();
  });

  it("falls back to Monday for ONLY the numbers the directory missed", async () => {
    // The case this exists for: a patient added since the last reconcile.
    vi.stubGlobal("fetch", vi.fn(() => gwOk({ "+18155237259": { name: "Tonasila Gray" } })));
    fetchDirectoryNames.mockResolvedValue({ ok: true, names: new Map([[NEW_PATIENT, "Eddie Quintero"]]) });
    const out = await resolveNames([TONASILA, NEW_PATIENT]);
    expect(fetchDirectoryNames).toHaveBeenCalledWith([NEW_PATIENT]);
    expect(out.names.get(TONASILA)).toBe("Tonasila Gray");
    expect(out.names.get(NEW_PATIENT)).toBe("Eddie Quintero");
    expect(out.ok).toBe(true);
  });

  it("still resolves everything when the directory is down", async () => {
    // A dead or never-run directory must cost speed, never names.
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("down"))));
    fetchDirectoryNames.mockResolvedValue({ ok: true, names: new Map([[TONASILA, "Tonasila Gray"]]) });
    const out = await resolveNames([TONASILA]);
    expect(out.names.get(TONASILA)).toBe("Tonasila Gray");
    // ⚠️ but NOT ok — the directory half failed, so a miss here is unproven.
    expect(out.ok).toBe(false);
  });

  it("is not ok when the Monday fallback fails either", async () => {
    vi.stubGlobal("fetch", vi.fn(() => gwOk({})));
    fetchDirectoryNames.mockResolvedValue({ ok: false, names: new Map() });
    expect(await resolveNames([TONASILA])).toMatchObject({ ok: false });
  });

  it("is ok, with no answers, for a number genuinely on no board", async () => {
    // Both halves ran and agreed. THIS is the miss a caller may cache.
    vi.stubGlobal("fetch", vi.fn(() => gwOk({})));
    const out = await resolveNames(["8583666900"]);
    expect(out).toMatchObject({ ok: true });
    expect(out.names.size).toBe(0);
  });
});
