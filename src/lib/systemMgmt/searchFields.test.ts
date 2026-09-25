/**
 * The header search's WIDER pass (§5.52) — member ids, doctor, clinic, doctor
 * phone, insurance — the second `query_params` alias each board is asked.
 *
 * ⚠️ Everything here fails SILENTLY when it regresses: a board that stops
 * declaring a field, or declares a column it does not fetch, returns 200 with
 * fewer rows and no caption, which reads exactly like "that patient is not in
 * the system".
 */
import { describe, expect, it } from "vitest";
import {
  BOARDS,
  FIELD_MIN_MEMBER_DIGITS,
  LIVE_SEARCH_BOARDS,
  fieldsLiteral,
  liveSearchRules,
  searchColumnIds,
  searchFieldColumnIds,
  searchFieldValues,
  type BoardDef,
  type LiveSearchRules,
} from "./mondayApi";
import { ORDERS_SEARCH_BOARD } from "./ordersSearch";

const board = (id: number): BoardDef => {
  const b = BOARDS.find((x) => x.boardId === id);
  if (!b) throw new Error(`board ${id} missing from BOARDS`);
  return b;
};
const PROFILE = board(18406352652);
const rules = (q: string): LiveSearchRules => {
  const r = liveSearchRules(q);
  if (!r) throw new Error(`no rules for ${JSON.stringify(q)}`);
  return r;
};

describe("every patient board declares what the header search can match", () => {
  it("member id, doctor, doctor phone and insurance on all seven", () => {
    for (const b of BOARDS) {
      const f = b.searchFields;
      expect(f, b.boardName).toBeDefined();
      expect(f?.memberId?.length, `${b.boardName} member id`).toBeGreaterThan(0);
      expect(f?.doctor?.length, `${b.boardName} doctor`).toBeGreaterThan(0);
      expect(f?.doctorPhone?.length, `${b.boardName} doctor phone`).toBeGreaterThan(0);
      expect(f?.insurance?.length, `${b.boardName} insurance`).toBeGreaterThan(0);
    }
  });

  it("a clinic column on the five boards that carry one", () => {
    // Subscription and Secondary Claims have no clinic column (read live
    // 2026-09-24); the other five do.
    const withClinic = BOARDS.filter((b) => b.searchFields?.clinic?.length).map((b) => b.boardId).sort();
    expect(withClinic).toEqual([18392794310, 18406060017, 18406352652, 18410601299, 18410804557].sort());
  });

  it("⚠️ every searched field is also READ, once, so the caption can name it", () => {
    for (const b of LIVE_SEARCH_BOARDS) {
      const read = searchColumnIds(b);
      for (const id of searchFieldColumnIds(b.searchFields)) expect(read, `${b.boardName} ${id}`).toContain(id);
      expect(new Set(read).size, `${b.boardName} duplicates`).toBe(read.length);
    }
  });

  it("the order board declares only its identifiers — an order is not a patient record", () => {
    const f = ORDERS_SEARCH_BOARD.searchFields;
    expect(f?.orderNumber?.length).toBe(1);
    expect(f?.poNumber?.length).toBe(1);
    expect(f?.tracking?.length).toBe(5);
    expect(f?.memberId).toBeUndefined();
    expect(f?.doctor).toBeUndefined();
    expect(f?.insurance).toBeUndefined();
  });
});

describe("fieldsLiteral — the second alias", () => {
  it("asks a NAME query as one phrase, ORed over the text fields, contains_text", () => {
    const lit = fieldsLiteral(PROFILE, rules("health plans"))!;
    expect(lit).toMatch(/operator: or\}$/);
    expect(lit).toContain('compare_value: ["health plans"]');
    expect(lit).not.toContain('["health"]');
    expect(lit).toMatch(/operator: contains_text/);
    const f = PROFILE.searchFields!;
    for (const c of [...f.memberId!, ...f.doctor!, ...f.clinic!, ...f.insurance!]) expect(lit).toContain(c);
    // A phone-shaped field cannot hold words.
    for (const c of f.doctorPhone!) expect(lit).not.toContain(c);
  });

  it("asks a DIGITS query of the phone-shaped fields, both needles", () => {
    const lit = fieldsLiteral(PROFILE, rules("+1 (555) 555-0100"))!;
    const f = PROFILE.searchFields!;
    for (const c of [...f.doctorPhone!, ...f.memberId!]) expect(lit).toContain(c);
    for (const c of [...f.doctor!, ...f.clinic!, ...f.insurance!]) expect(lit).not.toContain(c);
    expect(lit).toContain('["15555550100"]');
    expect(lit).toContain('["5555550100"]');
  });

  it(`⚠️ needs ${FIELD_MIN_MEMBER_DIGITS} digits before a member id counts — three is noise inside most ids`, () => {
    const three = fieldsLiteral(PROFILE, rules("555"))!;
    const f = PROFILE.searchFields!;
    for (const c of f.memberId!) expect(three).not.toContain(c);
    for (const c of f.doctorPhone!) expect(three).toContain(c);
    const four = fieldsLiteral(PROFILE, rules("5550"))!;
    for (const c of f.memberId!) expect(four).toContain(c);
  });

  it("asks nothing for a DOB — that is one column, on the first alias", () => {
    expect(fieldsLiteral(PROFILE, rules("03/14/1958"))).toBeNull();
  });

  it("⚠️ asks the ORDER board nothing — its identifiers ride the first alias", () => {
    expect(fieldsLiteral(ORDERS_SEARCH_BOARD, rules("1120085378"))).toBeNull();
    expect(fieldsLiteral(ORDERS_SEARCH_BOARD, rules("smith"))).toBeNull();
  });

  it("asks nothing of a board that declares no fields", () => {
    const bare: BoardDef = { ...PROFILE, searchFields: undefined };
    expect(fieldsLiteral(bare, rules("smith"))).toBeNull();
  });

  it("strings are JSON-escaped, so a quote in the query cannot break the literal", () => {
    const lit = fieldsLiteral(PROFILE, rules('o"brien'))!;
    expect(lit).toContain('["o\\"brien"]');
  });
});

describe("searchFieldValues", () => {
  it("reads every declared column, trimmed, blanks dropped", () => {
    const vals: Record<string, string> = {
      text_mm1x2qk2: " W123 ",
      text_mm1xaccx: "",
      text_mm1x46et: "DR SMITH",
      dropdown_mm1xbvas: "Endo Assoc",
      phone_mm1xz8c0: "5555550101",
      color_mm1xg10n: "Humana",
    };
    const v = searchFieldValues(PROFILE.searchFields, (id) => vals[id] ?? "")!;
    expect(v.memberIds).toEqual(["W123"]);
    expect(v.doctors).toEqual(["DR SMITH"]);
    expect(v.clinics).toEqual(["Endo Assoc"]);
    expect(v.doctorPhones).toEqual(["5555550101"]);
    expect(v.insurances).toEqual(["Humana"]);
    expect(v.orderNumbers).toEqual([]);
  });

  it("is undefined on a board with no fields", () => {
    expect(searchFieldValues(undefined, () => "x")).toBeUndefined();
  });

  it("names each column once even when two fields share it", () => {
    expect(searchFieldColumnIds({ memberId: ["a", "b"], doctor: ["b"], tracking: ["c", "a"] })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});
