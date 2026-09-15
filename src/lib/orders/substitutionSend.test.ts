import { describe, it, expect, vi, beforeEach } from "vitest";

const api = vi.hoisted(() => ({
  readColumnText: vi.fn(),
  writeStatusIndex: vi.fn(),
  clearStatus: vi.fn(),
  calls: [] as string[],
}));
vi.mock("./mondayApi", async () => {
  const actual = await vi.importActual<typeof import("./mondayApi")>("./mondayApi");
  return {
    ...actual,
    readColumnText: api.readColumnText,
    writeStatusIndex: (...a: unknown[]) => { api.calls.push("write"); return api.writeStatusIndex(...a); },
    clearStatus: (...a: unknown[]) => { api.calls.push("clear"); return api.clearStatus(...a); },
  };
});

import { COL } from "./mondayApi";
import { requestSubstitution } from "./mondayWrite";

/**
 * The swap request is the ONE real write this role makes, and its whole
 * mechanic is invisible on screen: a write that fires no webhook still shows a
 * green toast (§9's advancer no-op, one column over). This test is the only
 * thing that would catch a regression.
 */
describe("requestSubstitution", () => {
  beforeEach(() => {
    api.readColumnText.mockReset();
    api.writeStatusIndex.mockReset().mockResolvedValue(undefined);
    api.clearStatus.mockReset().mockResolvedValue(undefined);
    api.calls.length = 0;
  });

  it("a NEW set is one write, to Substitute Infusion Set, by live label index", async () => {
    api.readColumnText.mockResolvedValue('AutoSoft 90 6 mm 23"');
    const r = await requestSubstitution("42", 'TruSteel 6 mm 23"', 0);
    expect(r.kind).toBe("send");
    expect(api.calls).toEqual(["write"]);
    expect(api.writeStatusIndex).toHaveBeenCalledWith("42", COL.substituteInfusionSet, 0);
    expect(api.clearStatus).not.toHaveBeenCalled();
  });

  it("⚠️ the SAME set CLEARS first, then writes — or the webhook never fires", async () => {
    api.readColumnText.mockResolvedValue('TruSteel 6 mm 23"');
    const r = await requestSubstitution("42", 'TruSteel 6 mm 23"', 0);
    expect(r.kind).toBe("resend");
    expect(api.calls).toEqual(["clear", "write"]);
  });

  it("reads the column FIRST — the value on screen may be a minute old", async () => {
    // The card thinks the board is blank; it now holds the set being picked, so
    // this is a resend even though nothing on screen said so.
    api.readColumnText.mockResolvedValue('TruSteel 6 mm 23"');
    await requestSubstitution("42", 'TruSteel 6 mm 23"', 0);
    expect(api.readColumnText).toHaveBeenCalledWith("42", COL.substituteInfusionSet);
    expect(api.calls).toEqual(["clear", "write"]);
  });
});
