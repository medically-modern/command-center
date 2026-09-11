import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseSettings, fetchBoardLabels, resetBoardLabelCache, toLiveIndex,
  INSURANCE_LABEL_COLUMN_IDS, payerOptions, NON_PAYER_LABELS,
} from "./boardLabels";
import { GENERAL_INSURANCE_INDEX, PRIMARY_INSURANCE_INDEX } from "./mondayMapping";
import { COL } from "./mondayApi";

/** Shaped like a real Monday status column's settings_str. */
const settings = (labels: Record<string, string>, pos?: Record<string, number>) =>
  JSON.stringify({ labels, ...(pos ? { labels_positions_v2: pos } : {}) });

describe("parseSettings", () => {
  it("builds label → index from the board", () => {
    const r = parseSettings(settings({ "0": "iLet", "1": "Mobi", "2": "t:slim" }));
    expect(r?.index).toEqual({ iLet: 0, Mobi: 1, "t:slim": 2 });
  });

  it("orders options by labels_positions_v2, not by index", () => {
    // Index order and display order are different things; the picker must use
    // the board's display order.
    const r = parseSettings(
      settings({ "0": "iLet", "1": "Mobi", "4": "Minimed 780G" }, { "0": 2, "1": 0, "4": 1 }),
    );
    expect(r?.options).toEqual(["Mobi", "Minimed 780G", "iLet"]);
  });

  it("falls back to index order when positions are absent", () => {
    const r = parseSettings(settings({ "4": "Minimed 780G", "0": "iLet", "1": "Mobi" }));
    expect(r?.options).toEqual(["iLet", "Mobi", "Minimed 780G"]);
  });

  it("offers every label the column has — nothing is hidden from the rep", () => {
    // Josh, 2026-08-20. "Not Serving" was filtered out of the options here,
    // which left a rep able to READ it on a patient and never set or correct
    // one. The board's set is the picker's set now.
    const r = parseSettings(settings({
      "0": "Insulin", "1": "Hypoglycemia", "2": "Not Serving", "3": "Neither Applies",
    }));
    expect(r?.options).toEqual(["Insulin", "Hypoglycemia", "Not Serving", "Neither Applies"]);
    expect(r?.index["Not Serving"]).toBe(2);
  });

  it("drops empty label slots Monday leaves behind", () => {
    const r = parseSettings(settings({ "0": "Insulin", "1": "", "2": "Hypoglycemia", "3": "   " }));
    expect(r?.options).toEqual(["Insulin", "Hypoglycemia"]);
    expect(Object.keys(r?.index ?? {})).toEqual(["Insulin", "Hypoglycemia"]);
  });

  it("returns null on anything unusable, so the caller falls back", () => {
    expect(parseSettings(null)).toBeNull();
    expect(parseSettings("")).toBeNull();
    expect(parseSettings("not json")).toBeNull();
    expect(parseSettings(settings({}))).toBeNull();
    expect(parseSettings(settings({ "0": "", "1": "  " }))).toBeNull();
  });
});

// ── The insurance pair, and the cache that serves it ─────────────────────────

describe("INSURANCE_LABEL_COLUMN_IDS", () => {
  it("names the two Profile Send Off columns a payer has to appear on", () => {
    // General Insurance is what the Stedi check runs against; Primary Insurance
    // is what advances to Medical Necessity. Both are drawn from the board.
    expect(INSURANCE_LABEL_COLUMN_IDS).toEqual([COL.generalInsurance, COL.primaryInsurance]);
    expect(COL.generalInsurance).toBe("color_mm24ap4j");
    expect(COL.primaryInsurance).toBe("color_mm1xg10n");
  });
});

describe("toLiveIndex", () => {
  it("keeps the write half (label → index) and drops the display order", () => {
    expect(toLiveIndex({
      c1: { index: { Aetna: 1, "Health Plans Inc (PHCS)": 159 }, options: ["Aetna"] },
    })).toEqual({ c1: { Aetna: 1, "Health Plans Inc (PHCS)": 159 } });
  });
});

describe("fetchBoardLabels caching", () => {
  const settingsFor = (id: string) => ({
    id,
    settings_str: JSON.stringify({ labels: { "0": "Aetna", "159": "Health Plans Inc (PHCS)" } }),
  });
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetBoardLabelCache();
    fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const ids: string[] = JSON.parse(String(init.body)).variables.ids;
      return {
        json: async () => ({ data: { boards: [{ columns: ids.map(settingsFor) }] } }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetBoardLabelCache();
  });

  it("serves a repeat request for the same column from cache", async () => {
    await fetchBoardLabels([COL.cgmType]);
    await fetchBoardLabels([COL.cgmType]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fetches a column the first caller did not ask for", async () => {
    // The regression. The cache used to be ONE promise keyed on nothing, so the
    // first caller's column set won for the whole session: a second call site
    // asking for different columns silently got {} and sat on its hardcoded map
    // for ever. Adding the insurance pair to this page is exactly that case.
    await fetchBoardLabels([COL.cgmType]);
    const second = await fetchBoardLabels(INSURANCE_LABEL_COLUMN_IDS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(second[COL.generalInsurance]?.index["Health Plans Inc (PHCS)"]).toBe(159);
    expect(second[COL.primaryInsurance]?.index["Health Plans Inc (PHCS)"]).toBe(159);
  });

  it("asks only for the columns it is missing", async () => {
    await fetchBoardLabels([COL.cgmType]);
    await fetchBoardLabels([COL.cgmType, COL.generalInsurance]);
    const asked = JSON.parse(String(fetchMock.mock.calls[1][1].body)).variables.ids;
    expect(asked).toEqual([COL.generalInsurance]);
  });

  it("coalesces concurrent callers into one request", async () => {
    await Promise.all([
      fetchBoardLabels(INSURANCE_LABEL_COLUMN_IDS),
      fetchBoardLabels(INSURANCE_LABEL_COLUMN_IDS),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves to {} on a failure instead of throwing, so callers keep their hardcoded maps", async () => {
    resetBoardLabelCache();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    await expect(fetchBoardLabels(INSURANCE_LABEL_COLUMN_IDS)).resolves.toEqual({});
  });

  it("does not cache a failure — the next call retries", async () => {
    resetBoardLabelCache();
    const flaky = vi.fn()
      .mockImplementationOnce(async () => { throw new Error("network"); })
      .mockImplementationOnce(async () => ({
        json: async () => ({ data: { boards: [{ columns: [settingsFor(COL.generalInsurance)] }] } }),
      }));
    vi.stubGlobal("fetch", flaky);
    expect(await fetchBoardLabels([COL.generalInsurance])).toEqual({});
    const second = await fetchBoardLabels([COL.generalInsurance]);
    expect(second[COL.generalInsurance]?.index["Health Plans Inc (PHCS)"]).toBe(159);
  });

  it("omits a column it could not parse rather than mapping it to an empty set", async () => {
    // `productOptions` keys off ABSENCE to choose the hardcoded fallback; a
    // present-but-empty entry would render a dropdown with nothing in it.
    resetBoardLabelCache();
    vi.stubGlobal("fetch", vi.fn(async () => ({
      json: async () => ({ data: { boards: [{ columns: [{ id: COL.generalInsurance, settings_str: "not json" }] }] } }),
    })));
    expect(await fetchBoardLabels([COL.generalInsurance])).toEqual({});
  });
});

describe("payerOptions", () => {
  it("hides Stedi from General Insurance — it is our eligibility vendor, not a payer", () => {
    // Katie via Josh, 2026-08-13. The label IS on the column, so reading the
    // options live would have put it back in front of reps.
    expect(payerOptions(COL.generalInsurance, ["Aetna", "Stedi", "Cash Pay"]))
      .toEqual(["Aetna", "Cash Pay"]);
  });

  it("hides nothing from Primary Insurance", () => {
    // "Stedi" is on that column too and has always been pickable there; hiding
    // it would be a NEW decision, not the 2026-08-13 one.
    expect(payerOptions(COL.primaryInsurance, ["Aetna Commercial", "Stedi"]))
      .toEqual(["Aetna Commercial", "Stedi"]);
  });

  it("passes any other column through untouched", () => {
    expect(payerOptions(COL.cgmType, ["Dexcom G7", "Libre 3"])).toEqual(["Dexcom G7", "Libre 3"]);
  });

  it("stays a one-entry hide-list", () => {
    // §5.2: the board's labels are the picker's labels. Every entry here needs
    // a recorded decision behind it — if this fails, make sure yours has one.
    expect(Object.keys(NON_PAYER_LABELS)).toEqual([COL.generalInsurance]);
  });
});

/**
 * What moving these two pickers from the hardcoded maps to the board actually
 * CHANGES on screen. Pinned deliberately: the point of the change is one new
 * payer, and anything else that appears or disappears is a UI change nobody
 * asked for. Board label sets read live on 2026-09-11.
 */
describe("the picker delta from reading the board", () => {
  const BOARD_GENERAL = [
    "Aetna", "Anthem / BCBS", "Cigna", "Fidelis", "Medicare A&B", "Medicaid",
    "NYSHIP Empire", "UMR", "Wellcare", "United Healthcare", "Humana",
    "MagnaCare", "Midlands Choice", "Stedi", "Cash Pay", "Other",
    "Health Plans Inc (PHCS)",
  ];
  const BOARD_PRIMARY = [
    "Fidelis Medicaid", "Fidelis Low-Cost", "Medicare A&B", "NYSHIP",
    "United Commercial", "United Medicare", "United Medicaid", "Aetna Commercial",
    "Aetna Medicare", "Wellcare", "Humana", "Cigna", "Medicaid", "Midlands Choice",
    "Horizon BCBS", "BCBS TN", "BCBS FL", "BCBS WY", "Magnacare", "Oregon Care",
    "UMR", "Anthem BCBS Medicaid (JLJ)", "Fidelis Commercial",
    "Anthem BCBS Commercial", "Anthem BCBS Medicare", "Stedi",
    "Anthem BCBS Low-Cost (JLJ)", "United Low-Cost", "Fidelis Medicare",
    "Health Plans Inc (PHCS)",
  ];
  const delta = (board: string[], hardcoded: string[], columnId: string) => {
    const shown = payerOptions(columnId, board);
    return {
      appears: shown.filter((l) => !hardcoded.includes(l)),
      disappears: hardcoded.filter((l) => !shown.includes(l)),
    };
  };

  it("General Insurance gains the new payer and Cash Pay, and loses nothing", () => {
    expect(delta(BOARD_GENERAL, Object.keys(GENERAL_INSURANCE_INDEX), COL.generalInsurance))
      .toEqual({ appears: ["Cash Pay", "Health Plans Inc (PHCS)"], disappears: [] });
  });

  it("Primary Insurance gains the new payer, and re-spells Magnacare as the board does", () => {
    // The board stores "Magnacare"; the hardcoded map said "MagnaCare". Writes
    // are by INDEX, so the board value was already "Magnacare" — this only
    // makes the picker agree with it, and stops a Magnacare patient's select
    // from matching no option.
    expect(delta(BOARD_PRIMARY, Object.keys(PRIMARY_INSURANCE_INDEX), COL.primaryInsurance))
      .toEqual({ appears: ["Magnacare", "Health Plans Inc (PHCS)"], disappears: ["MagnaCare"] });
  });
});
