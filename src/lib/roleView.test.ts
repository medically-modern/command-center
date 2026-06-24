import { describe, it, expect } from "vitest";
import {
  orderedRoleIds,
  roleFilterFor,
  roleOrderNumber,
  viewFilterFromParams,
  filterQuery,
} from "./roleView";
import type { ProcessorProfile } from "./accessStore";

describe("roleView helpers (per-role filter + SOP order)", () => {
  it("roleFilterFor defaults to nonEscalated, else the set value", () => {
    expect(roleFilterFor(null, "evaluate")).toBe("nonEscalated");
    expect(roleFilterFor({ roleFilters: undefined }, "evaluate")).toBe("nonEscalated");
    expect(roleFilterFor({ roleFilters: { evaluate: "escalated" } }, "evaluate")).toBe("escalated");
    expect(roleFilterFor({ roleFilters: { evaluate: "all" } }, "evaluate")).toBe("all");
  });

  it("orderedRoleIds sorts numbered roles first (by number), then config order", () => {
    const profile: Pick<ProcessorProfile, "roles" | "roleOrder"> = {
      roles: ["chaseFax", "evaluate", "sendRequest"],
      roleOrder: { sendRequest: 1, chaseFax: 2 },
    };
    expect(orderedRoleIds(profile)).toEqual(["sendRequest", "chaseFax", "evaluate"]);
  });

  it("orderedRoleIds falls back to config order when nothing is numbered", () => {
    // config.ts order has evaluate before sendRequest
    expect(orderedRoleIds({ roles: ["sendRequest", "evaluate"], roleOrder: {} })).toEqual([
      "evaluate",
      "sendRequest",
    ]);
  });

  it("roleOrderNumber returns the number or null", () => {
    expect(roleOrderNumber({ roleOrder: { evaluate: 3 } }, "evaluate")).toBe(3);
    expect(roleOrderNumber({ roleOrder: {} }, "evaluate")).toBeNull();
    expect(roleOrderNumber(null, "evaluate")).toBeNull();
  });

  it("viewFilterFromParams reads ?filter= (new) and ?manager=1 (legacy)", () => {
    expect(viewFilterFromParams(new URLSearchParams(""))).toBe("nonEscalated");
    expect(viewFilterFromParams(new URLSearchParams("manager=1"))).toBe("escalated");
    expect(viewFilterFromParams(new URLSearchParams("filter=all"))).toBe("all");
    expect(viewFilterFromParams(new URLSearchParams("filter=escalated"))).toBe("escalated");
    expect(viewFilterFromParams(new URLSearchParams("filter=nonEscalated"))).toBe("nonEscalated");
  });

  it("filterQuery round-trips through viewFilterFromParams", () => {
    expect(filterQuery("nonEscalated")).toBe("");
    expect(filterQuery("escalated")).toBe("?manager=1");
    expect(filterQuery("all")).toBe("?filter=all");
    const rt = (f: "all" | "escalated") =>
      viewFilterFromParams(new URLSearchParams(filterQuery(f).replace(/^\?/, "")));
    expect(rt("escalated")).toBe("escalated");
    expect(rt("all")).toBe("all");
  });
});
