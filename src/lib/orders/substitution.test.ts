import { describe, it, expect } from "vitest";
import { mkOrder } from "./fixtures";
import {
  backorderedEntries, backorderedSetOnOrder, hasSubstitutionStory, normalizeSetName,
  substitutionAnswered, substitutionBlockers, substitutionOptions, substitutionSendKind,
  substitutionSendRefusal, substitutionVerdict, SUBSTITUTION_FIX,
} from "./substitution";

/**
 * The live Substitution Status labels, read from the board's `settings_str` on
 * 2026-09-15. The email service writes these strings verbatim, so this list IS
 * the contract between the two repos — if the service grows a label, it lands
 * here (and in SUBSTITUTION_FIX) or the card has no fix to offer for it.
 */
const BOARD_LABELS = [
  "Sent",
  "Error: No SKU On Board",
  "Error: No CAH Order Number",
  "Error: Which Set Is Unclear",
  "Error: No Qty Infusion Set 1",
  "Error: Same Set Picked",
  "Error: No Set On Order",
  "Error: Set Not On SKU Board",
  "Error: SKU Board Unreadable",
];

describe("substitutionVerdict", () => {
  it("every live board label is understood, and only Sent reads as success", () => {
    for (const label of BOARD_LABELS) {
      const v = substitutionVerdict(label);
      expect(v.state, label).toBe(label === "Sent" ? "sent" : "error");
      if (v.state === "error") expect(v.fix, label).not.toBe("");
    }
    expect(Object.keys(SUBSTITUTION_FIX)).toHaveLength(BOARD_LABELS.length - 1);
  });

  it("blank is nothing to say", () => {
    expect(substitutionVerdict("").state).toBe("none");
    expect(substitutionVerdict("   ").state).toBe("none");
  });

  it("an UNRECOGNISED error label still reports as an error", () => {
    // A label added to the column after this file was written must never come
    // out as success — the whole point of the column is that it complains.
    const v = substitutionVerdict("Error: Something New");
    expect(v.state).toBe("error");
    expect(v.fix).toMatch(/re-pick/);
  });
});

describe("backorderedSetOnOrder", () => {
  it("prefers the set that is BOTH on the order and on back order, in the order's short words", () => {
    const o = mkOrder({
      infusionSet1: 'AutoSoft 90 6 mm 23"',
      infusionSet2: "",
      backordered: 'AutoSoft 90 6mm 23" infusion sets',
    });
    expect(backorderedSetOnOrder(o)).toEqual({ name: 'AutoSoft 90 6 mm 23"' });
  });

  it("two sets, both backordered, is AMBIGUOUS — one replacement cannot stand in for both", () => {
    const o = mkOrder({
      infusionSet1: 'AutoSoft 90 6 mm 23"',
      infusionSet2: 'TruSteel 6 mm 23"',
      backordered: 'AutoSoft 90 6mm 23" infusion sets, TruSteel 6mm 23" infusion sets',
    });
    expect(backorderedSetOnOrder(o)?.ambiguous).toEqual(['AutoSoft 90 6 mm 23"', 'TruSteel 6 mm 23"']);
  });

  it("two sets and nothing singling one out is ambiguous too", () => {
    const o = mkOrder({ infusionSet1: 'AutoSoft 90 6 mm 23"', infusionSet2: 'TruSteel 6 mm 23"' });
    expect(backorderedSetOnOrder(o)?.ambiguous).toHaveLength(2);
  });

  it("one set on the order is the answer even when nothing is flagged backordered", () => {
    expect(backorderedSetOnOrder(mkOrder({ infusionSet1: 'TruSteel 6 mm 23"' }))).toEqual({ name: 'TruSteel 6 mm 23"' });
  });

  it("'Not Serving' is not a set, and no set at all is null", () => {
    expect(backorderedSetOnOrder(mkOrder({ infusionSet1: "Not Serving" }))).toBeNull();
    expect(backorderedSetOnOrder(mkOrder())).toBeNull();
  });
});

describe("normalizeSetName joins the three spellings of one set", () => {
  it("the tracker's short name, Cardinal's description and the Backordered label agree", () => {
    const short = normalizeSetName('AutoSoft 90 6 mm 23"');
    expect(normalizeSetName('AutoSoft 90 6mm 23" infusion sets')).toBe(short);
    expect(
      normalizeSetName('AutoSoft 90 Infusion Set · 6 mm Cannula · 23" Tubing · t:lock Connector · Grey - REPLACES TN1002817'),
    ).not.toBe(""); // the description carries extra words; it is not expected to collapse to the short name
    expect(normalizeSetName('Mio Advance Clear 9mm 23"')).toBe(normalizeSetName('Mio Advance Clear 9 mm 23"'));
  });
});

describe("backorderedEntries", () => {
  it("splits the dropdown on ', ' — its own labels carry '·', never a comma", () => {
    expect(backorderedEntries('AutoSoft 90 6mm 23" infusion sets, Dexcom G6 sensors')).toEqual([
      'AutoSoft 90 6mm 23" infusion sets',
      "Dexcom G6 sensors",
    ]);
    expect(
      backorderedEntries('AutoSoft 90 Infusion Set · 6 mm Cannula · 23" Tubing · t:lock Connector · Grey'),
    ).toHaveLength(1);
    expect(backorderedEntries("")).toEqual([]);
  });
});

describe("substitutionBlockers name what would bounce, before a rep picks", () => {
  it("a complete order blocks on nothing", () => {
    const o = mkOrder({ cahOrderNumber: "1120960884", qtyInfusionSet1: "3", infusionSet1: 'TruSteel 6 mm 23"' });
    expect(substitutionBlockers(o)).toEqual([]);
  });

  it("the three refusals the service makes: no order number, no quantity, no set", () => {
    expect(substitutionBlockers(mkOrder({ qtyInfusionSet1: "3", infusionSet1: 'TruSteel 6 mm 23"' }))[0]).toMatch(/CAH Order Number/);
    expect(substitutionBlockers(mkOrder({ cahOrderNumber: "1", infusionSet1: 'TruSteel 6 mm 23"' }))[0]).toMatch(/Qty: Infusion Set 1/);
    expect(substitutionBlockers(mkOrder({ cahOrderNumber: "1", qtyInfusionSet1: "3" }))[0]).toMatch(/no infusion set/);
  });

  it("a zero or unreadable quantity is not a quantity", () => {
    const base = { cahOrderNumber: "1", infusionSet1: 'TruSteel 6 mm 23"' };
    expect(substitutionBlockers(mkOrder({ ...base, qtyInfusionSet1: "0" }))).toHaveLength(1);
    expect(substitutionBlockers(mkOrder({ ...base, qtyInfusionSet1: "n/a" }))).toHaveLength(1);
  });
});

describe("hasSubstitutionStory", () => {
  it("is false for an ordinary order and true once any of the four fields is set", () => {
    expect(hasSubstitutionStory(mkOrder())).toBe(false);
    expect(hasSubstitutionStory(mkOrder({ backordered: "Dexcom G6 sensors" }))).toBe(true);
    expect(hasSubstitutionStory(mkOrder({ substituteInfusionSet: 'TruSteel 6 mm 23"' }))).toBe(true);
    expect(hasSubstitutionStory(mkOrder({ substitutionStatus: "Sent" }))).toBe(true);
    expect(hasSubstitutionStory(mkOrder({ substitutionCahNumber: "1120960999" }))).toBe(true);
  });
});

/** The live Substitute Infusion Set labels, read 2026-09-15 (a sample). */
const SET_LABELS = [
  'TruSteel 6 mm 23"', 'AutoSoft 90 6 mm 23"', 'VariSoft 13 mm 23"', 'AutoSoft XC 6 mm 23"',
  'Mio Advance Clear 9mm 23"',
];

describe("substitutionSendRefusal — every refusal names something a rep can do", () => {
  const ok = { cahOrderNumber: "1120960884", qtyInfusionSet1: "3", infusionSet1: 'AutoSoft 90 6 mm 23"' };

  it("lets a complete order through", () => {
    expect(substitutionSendRefusal(mkOrder(ok), 'TruSteel 6 mm 23"')).toBe("");
  });

  it("nothing picked", () => {
    expect(substitutionSendRefusal(mkOrder(ok), "")).toMatch(/Pick the replacement/);
  });

  it("the service's own refusals, quoted back before the email goes", () => {
    expect(substitutionSendRefusal(mkOrder({ ...ok, cahOrderNumber: "" }), 'TruSteel 6 mm 23"')).toMatch(/CAH Order Number/);
    expect(substitutionSendRefusal(mkOrder({ ...ok, qtyInfusionSet1: "" }), 'TruSteel 6 mm 23"')).toMatch(/Qty: Infusion Set 1/);
  });

  it("picking the backordered set itself is refused HERE, not by the email", () => {
    const o = mkOrder({ ...ok, backordered: 'AutoSoft 90 6mm 23" infusion sets' });
    expect(substitutionSendRefusal(o, 'AutoSoft 90 6 mm 23"')).toMatch(/on back order/);
    expect(substitutionSendRefusal(o, 'TruSteel 6 mm 23"')).toBe("");
  });
});

describe("substitutionSendKind — a repeat pick has to clear first", () => {
  it("a different set is an ordinary send", () => {
    expect(substitutionSendKind('AutoSoft 90 6 mm 23"', 'TruSteel 6 mm 23"')).toBe("send");
  });

  it("the SAME set is a resend — writing it again fires no webhook", () => {
    expect(substitutionSendKind('TruSteel 6 mm 23"', 'TruSteel 6 mm 23"')).toBe("resend");
    // Spelling differences that normalise to one set still count as the same.
    expect(substitutionSendKind('Mio Advance Clear 9 mm 23"', 'Mio Advance Clear 9mm 23"')).toBe("resend");
  });

  it("an empty board value is a first send", () => {
    expect(substitutionSendKind("", 'TruSteel 6 mm 23"')).toBe("send");
  });
});

describe("substitutionOptions", () => {
  it("drops the set being switched away from — the service refuses it", () => {
    const o = mkOrder({ infusionSet1: 'AutoSoft 90 6 mm 23"', backordered: 'AutoSoft 90 6mm 23" infusion sets' });
    expect(substitutionOptions(SET_LABELS, o)).not.toContain('AutoSoft 90 6 mm 23"');
    expect(substitutionOptions(SET_LABELS, o)).toContain('TruSteel 6 mm 23"');
  });

  it("drops NOTHING when which set to replace is ambiguous", () => {
    const o = mkOrder({ infusionSet1: 'AutoSoft 90 6 mm 23"', infusionSet2: 'TruSteel 6 mm 23"' });
    expect(substitutionOptions(SET_LABELS, o)).toHaveLength(SET_LABELS.length);
  });

  it("and nothing when the order names no set at all", () => {
    expect(substitutionOptions(SET_LABELS, mkOrder())).toHaveLength(SET_LABELS.length);
  });
});

describe("substitutionAnswered — the post-send watcher's stop condition", () => {
  const before = { status: "Sent", notes: "…prior history" };

  it("a changed status is an answer", () => {
    expect(substitutionAnswered(before, { ...before, status: "Error: No SKU On Board" })).toBe(true);
  });

  it("⚠️ a RE-SEND writes the same 'Sent' — the Notes receipt is what moves", () => {
    expect(substitutionAnswered(before, before)).toBe(false);
    expect(substitutionAnswered(before, { ...before, notes: before.notes + "\n[Sep 15] Auto-email…" })).toBe(true);
  });
});
