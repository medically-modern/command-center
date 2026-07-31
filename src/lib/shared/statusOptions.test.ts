// Guards the live status-option reader against the failure modes that made the
// July 2026 infusion-set dedup dangerous. The fixtures are trimmed from real
// `settings_str` payloads on the Subscription board (18407459988).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  parseStatusSettings,
  indexForLabel,
  fetchStatusOptions,
  invalidateStatusOptions,
} from "./statusOptions";

// Subscription / Infusion Set 1 (color_mkxm50f9) as it stood BEFORE the dedup:
// duplicate labels, doubled spaces, and Monday's reserved blank at index 5.
const SUB1_BEFORE = JSON.stringify({
  labels: {
    "0": 'AutoSoft XC 9 mm  23"', // doubled space
    "5": "", // reserved blank — not a product
    "6": 'AutoSoft XC 6 mm 23"',
    "104": "Not Serving",
    "107": 'AutoSoft XC 6 mm 23"', // exact duplicate of index 6
    "153": 'AutoSoft XC 9 mm 23"', // clean twin of index 0
  },
  labels_positions_v2: { "0": 0, "5": 18, "6": 5, "104": 22, "107": 26, "153": 32 },
});

// The same column AFTER the dedup — the doubled-space twins are gone.
const SUB1_AFTER = JSON.stringify({
  labels: {
    "5": "",
    "6": 'AutoSoft XC 6 mm 23"',
    "104": "Not Serving",
    "153": 'AutoSoft XC 9 mm 23"',
  },
  labels_positions_v2: { "5": 18, "6": 0, "104": 22, "153": 4 },
});

describe("parseStatusSettings", () => {
  it("drops Monday's reserved blank label", () => {
    const opts = parseStatusSettings(SUB1_BEFORE);
    expect(opts.some((o) => o.label === "")).toBe(false);
    expect(opts.some((o) => o.index === 5)).toBe(false);
  });

  it("orders by the board's own display order, not numeric index", () => {
    // labels_positions_v2 puts index 6 at position 0 and index 153 at 4, so the
    // clean AutoSoft XC 6mm comes first even though 153 > 6.
    const opts = parseStatusSettings(SUB1_AFTER);
    expect(opts.map((o) => o.index)).toEqual([6, 153, 104]);
  });

  it("drops deactivated labels", () => {
    const withDead = JSON.stringify({
      labels: { "0": "Live", "1": "Retired" },
      deactivated_labels: [1],
    });
    expect(parseStatusSettings(withDead).map((o) => o.label)).toEqual(["Live"]);
  });

  it("returns [] on malformed settings rather than throwing", () => {
    expect(parseStatusSettings("not json")).toEqual([]);
    expect(parseStatusSettings("")).toEqual([]);
  });

  it("surfaces every live label — a deleted index simply is not present", () => {
    const before = parseStatusSettings(SUB1_BEFORE).map((o) => o.index);
    const after = parseStatusSettings(SUB1_AFTER).map((o) => o.index);
    // 0 and 107 were deleted by the dedup. The old hardcoded tables still listed
    // them, which is exactly the bug: the dropdown offered an index the board no
    // longer had, and writeStatusIndex wrote it without erroring.
    expect(before).toContain(0);
    expect(before).toContain(107);
    expect(after).not.toContain(0);
    expect(after).not.toContain(107);
  });
});

describe("indexForLabel", () => {
  const after = parseStatusSettings(SUB1_AFTER);

  it("resolves an exact label", () => {
    expect(indexForLabel(after, 'AutoSoft XC 6 mm 23"')).toBe(6);
    expect(indexForLabel(after, "Not Serving")).toBe(104);
  });

  it("returns null for a label the board does not have", () => {
    // The pre-dedup spelling the SPA used to hardcode. Callers must treat null
    // as a failure — never fall through to writing some other index.
    expect(indexForLabel(after, 'AutoSoft XC 6mm 23"')).toBeNull();
    expect(indexForLabel(after, 'QuickSet 18"')).toBeNull();
  });

  it("folds doubled and non-breaking spaces when matching", () => {
    expect(indexForLabel(after, 'AutoSoft XC 6 mm  23"')).toBe(6);
    expect(indexForLabel(after, 'AutoSoft XC 6 mm 23"')).toBe(6);
  });

  it("does NOT fold case — Monday's own matching is case-sensitive", () => {
    expect(indexForLabel(after, 'autosoft xc 6 mm 23"')).toBeNull();
  });

  it("prefers the highest index when several labels collapse to one product", () => {
    // Mirrors how the two patient-facing backends resolve: the later-created,
    // single-spaced label is the one the downstream board copy expects.
    const before = parseStatusSettings(SUB1_BEFORE);
    expect(indexForLabel(before, 'AutoSoft XC 9 mm 23"')).toBe(153);
    expect(indexForLabel(before, 'AutoSoft XC 6 mm 23"')).toBe(107);
  });

  it("returns null for empty input", () => {
    expect(indexForLabel(after, "")).toBeNull();
    expect(indexForLabel([], "Not Serving")).toBeNull();
  });
});

// ── fetchStatusOptions: the request itself ────────────────────────────────
// These exist because a header bug shipped past typecheck, lint, a clean
// production build and 604 unit tests: the first version of this module sent
// only mondayIdentityHeaders(), which returns {} when the gateway is not
// configured. No Authorization header => every request 401s => the infusion
// dropdowns sit disabled forever. Nothing that does not make a real call can
// catch that, so this asserts the wire format directly.
describe("fetchStatusOptions request", () => {
  const COL_A = "color_test_a";

  function mockFetch(payload: unknown) {
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  beforeEach(() => {
    invalidateStatusOptions();
    vi.stubEnv("VITE_MONDAY_API_TOKEN", "test-token-123");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("sends an Authorization header", async () => {
    const spy = mockFetch({
      data: { boards: [{ columns: [{ id: COL_A, settings_str: SUB1_AFTER }] }] },
    });
    await fetchStatusOptions(123, [COL_A]);
    expect(spy).toHaveBeenCalledTimes(1);
    const headers = spy.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("test-token-123");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("returns parsed options keyed by column id", async () => {
    mockFetch({
      data: { boards: [{ columns: [{ id: COL_A, settings_str: SUB1_AFTER }] }] },
    });
    const out = await fetchStatusOptions(123, [COL_A]);
    expect(out[COL_A].map((o) => o.label)).toEqual([
      'AutoSoft XC 6 mm 23"',
      'AutoSoft XC 9 mm 23"',
      "Not Serving",
    ]);
  });

  it("serves the second call from cache instead of refetching", async () => {
    const spy = mockFetch({
      data: { boards: [{ columns: [{ id: COL_A, settings_str: SUB1_AFTER }] }] },
    });
    await fetchStatusOptions(123, [COL_A]);
    await fetchStatusOptions(123, [COL_A]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("propagates a GraphQL error instead of resolving to an empty list", async () => {
    // A silent [] would disable the dropdown with no explanation; the caller
    // needs the error so it can show a retry.
    mockFetch({ errors: [{ message: "Invalid column id" }] });
    await expect(fetchStatusOptions(123, [COL_A])).rejects.toThrow("Invalid column id");
  });

  it("propagates a non-200 instead of resolving to an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(fetchStatusOptions(123, [COL_A])).rejects.toThrow("401");
  });
});
