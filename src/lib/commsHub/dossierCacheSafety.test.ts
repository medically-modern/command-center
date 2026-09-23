/**
 * What the dossier lookup is allowed to REMEMBER (2026-09-23 review).
 *
 * The lookup is memoised for the whole session, so whatever it caches is what
 * every later open shows — and what the Communications inbox's Monday copy
 * decides from. Four ways that went wrong, each pinned here against a fake
 * Monday (fake people, 555 numbers):
 *
 *   1. a board that failed was cached as a board with nobody on it;
 *   2. a failed by-id read read as a deleted record, and the empty answer was
 *      cached — "It may have been deleted on Monday" for the rest of the session,
 *      and a resolve note's Monday copy recorded as done with nowhere to go;
 *   3. a contact write patched ONE cached copy of the record, with "" for any
 *      phone or email value — a saved number vanished from the screen on save;
 *   4. two opens of one number at once ran two seven-board fan-outs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../shared/mondayEndpoint", async (orig) => ({
  ...(await orig<typeof import("../shared/mondayEndpoint")>()),
  hasMondayAuth: () => true,
  mondayIdentityHeaders: () => ({}),
}));

import {
  DossierIncompleteError,
  clearDossierCaches,
  fetchDossierItems,
  fetchDossierItemsForPick,
  peekDossierItems,
  renderedColumnText,
  updatePatientContact,
} from "./dossierApi";
import { BOARDS } from "../systemMgmt/mondayApi";

const WC = 18410804557;
const INS = 18410601299;
const SUB = 18407459988;
const board = (id: number) => BOARDS.find((b) => b.boardId === id)!;
const NUMBER = "+15550001111";

interface Raw {
  id: string;
  name: string;
  board: number;
  phone?: string;
  dob?: string;
  extra?: Record<string, string>;
}

/** The fake board: records by board, and which boards are "down". */
let records: Raw[] = [];
let down = new Set<number>();
let byIdDown = false;
let calls = 0;

function raw(r: Raw) {
  const b = board(r.board);
  const cols: Array<{ id: string; text: string; value: null }> = [];
  if (b.phoneColId) cols.push({ id: b.phoneColId, text: r.phone ?? "", value: null });
  if (b.dobColId) cols.push({ id: b.dobColId, text: r.dob ?? "", value: null });
  for (const [id, text] of Object.entries(r.extra ?? {})) cols.push({ id, text, value: null });
  return { id: r.id, name: r.name, created_at: null, board: { id: String(r.board) }, group: { id: "topics", title: "Live" }, column_values: cols };
}

const ok = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });

beforeEach(() => {
  clearDossierCaches();
  records = [];
  down = new Set();
  byIdDown = false;
  calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      calls++;
      const { query, variables } = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
      if (query.includes("change_multiple_column_values")) return ok({ change_multiple_column_values: { id: "1" } });
      if (query.includes("items (ids: $ids)")) {
        if (byIdDown) return new Response("oops", { status: 503 });
        const id = String((variables.ids as string[])[0]);
        const hit = records.find((r) => r.id === id);
        return ok({ items: hit ? [raw(hit)] : [] });
      }
      // The per-board contains_text search.
      const bid = Number((variables.board as string[])[0]);
      if (down.has(bid)) return new Response("oops", { status: 503 });
      const col = String(variables.col);
      const needle = String((variables.q as string[])[0]).toLowerCase();
      const b = board(bid);
      const items = records
        .filter((r) => r.board === bid)
        .filter((r) => (col === "name" ? r.name.toLowerCase().includes(needle) : col === b.phoneColId && (r.phone ?? "").includes(needle)))
        .map(raw);
      return ok({ boards: [{ items_page: { items } }] });
    }),
  );
});

describe("1 — a board that did not answer is not a board with nobody on it", () => {
  it("shows what answered, but remembers nothing, so the next open asks again", async () => {
    records = [{ id: "901", name: "Ada Sample", board: WC, phone: "5550001111", dob: "01/02/1960" }];
    down = new Set([INS]);
    const first = await fetchDossierItems(NUMBER);
    expect(first.map((i) => i.itemId)).toEqual(["901"]);
    expect(peekDossierItems(NUMBER)).toBeNull();

    down = new Set();
    const before = calls;
    await fetchDossierItems(NUMBER);
    expect(calls).toBeGreaterThan(before);
    // …and a COMPLETE answer is remembered.
    expect(peekDossierItems(NUMBER)?.map((i) => i.itemId)).toEqual(["901"]);
    const settled = calls;
    await fetchDossierItems(NUMBER);
    expect(calls).toBe(settled);
  });

  it("⚠️ strict: a caller that WRITES off the answer is refused, never handed a partial trail", async () => {
    records = [{ id: "901", name: "Ada Sample", board: WC, phone: "5550001111" }];
    down = new Set([INS]);
    await expect(fetchDossierItems(NUMBER, { strict: true })).rejects.toBeInstanceOf(DossierIncompleteError);
  });
});

describe("2 — a failed by-id read is an error, never a deleted record", () => {
  it("throws, caches nothing, and the next open finds the record", async () => {
    records = [{ id: "901", name: "Ada Sample", board: WC, phone: "5550001111" }];
    byIdDown = true;
    const pick = { itemId: "901", boardId: WC, name: "", phone: "" };
    await expect(fetchDossierItemsForPick(pick)).rejects.toThrow();
    byIdDown = false;
    const out = await fetchDossierItemsForPick(pick);
    expect(out.map((i) => i.itemId)).toContain("901");
  });

  it("a record that really is gone answers empty — and is not pinned for the session either", async () => {
    const pick = { itemId: "999", boardId: WC, name: "", phone: "" };
    expect(await fetchDossierItemsForPick(pick)).toEqual([]);
    records = [{ id: "999", name: "Late Arrival", board: WC, phone: "5550009999" }];
    expect((await fetchDossierItemsForPick(pick)).map((i) => i.itemId)).toContain("999");
  });

  it("strict: a pick whose trail is missing a board is refused", async () => {
    records = [{ id: "901", name: "Ada Sample", board: WC, phone: "5550001111" }];
    down = new Set([SUB]);
    await expect(
      fetchDossierItemsForPick({ itemId: "901", boardId: WC, name: "", phone: "" }, { strict: true }),
    ).rejects.toBeInstanceOf(DossierIncompleteError);
  });
});

describe("3 — a contact write updates EVERY cached copy, in rendered text", () => {
  it("renders a phone, an email and a clear the way Monday will", () => {
    expect(renderedColumnText({ phone: "5550002222", countryShortName: "US" })).toBe("5550002222");
    expect(renderedColumnText({ email: "ada@example.com", text: "ada@example.com" })).toBe("ada@example.com");
    expect(renderedColumnText({ label: "Yes" })).toBe("Yes");
    expect(renderedColumnText("plain")).toBe("plain");
    expect(renderedColumnText({})).toBe("");
  });

  it("⚠️ the record cached under its number AND under a pick of it both show the new value", async () => {
    const alt = board(WC).altPhoneColIds?.[0] ?? "phone_mm7265hp";
    // 902 carries the number; 901 is the same patient's record with a blank
    // phone, found by the name pass — and opened by id, so a pick holds its own copy.
    records = [
      { id: "902", name: "Ada Sample", board: SUB, phone: "5550001111", dob: "01/02/1960" },
      { id: "901", name: "Ada Sample", board: WC, phone: "", dob: "01/02/1960", extra: { [alt]: "" } },
    ];
    const byNumber = await fetchDossierItems(NUMBER);
    const viaPick = await fetchDossierItemsForPick({ itemId: "901", boardId: WC, name: "", phone: "" });
    const a = byNumber.find((i) => i.itemId === "901")!;
    const b = viaPick.find((i) => i.itemId === "901")!;
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b); // two copies — the case that used to be missed

    await updatePatientContact({
      boardId: WC,
      itemId: "901",
      values: { [alt]: { phone: "5550002222", countryShortName: "US" } },
      phone: NUMBER,
    });
    expect(a.cols[alt]).toBe("5550002222");
    expect(b.cols[alt]).toBe("5550002222");
  });

  it("a NEW primary number is asked again on the next open — whatever was remembered for it", async () => {
    records = [{ id: "901", name: "Ada Sample", board: WC, phone: "5550001111" }];
    await fetchDossierItems("+15550003333"); // nobody, before the number was on the record
    expect(peekDossierItems("+15550003333")).toEqual([]);
    await fetchDossierItems(NUMBER);
    await updatePatientContact({
      boardId: WC,
      itemId: "901",
      values: { [board(WC).phoneColId]: { phone: "5550003333", countryShortName: "US" } },
      phone: NUMBER,
      nextPhone: "+15550003333",
    });
    expect(peekDossierItems("+15550003333")).toBeNull();
    expect(peekDossierItems(NUMBER)).toBeNull();
  });
});

describe("4 — one lookup per number at a time", () => {
  it("two opens at once share one fan-out", async () => {
    records = [{ id: "901", name: "Ada Sample", board: WC, phone: "5550001111" }];
    await fetchDossierItems(NUMBER);
    const one = calls;
    clearDossierCaches();
    calls = 0;
    const [x, y] = await Promise.all([fetchDossierItems(NUMBER), fetchDossierItems(NUMBER)]);
    expect(calls).toBe(one);
    expect(x).toBe(y);
  });
});
