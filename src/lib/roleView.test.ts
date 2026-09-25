import { describe, it, expect } from "vitest";
import {
  mayWorkRoute,
  orderedRoleIds,
  roleFilterFor,
  roleOrderNumber,
  rolesForRoute,
  viewFilterFromParams,
  filterQuery,
} from "./roleView";
import type { Access, ProcessorProfile } from "./accessStore";

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

describe("⚠️⚠️ mayWorkRoute — the patient screen's Open link follows role assignment (Josh, 2026-09-25)", () => {
  const processor = (roles: string[]): Access => ({
    type: "processor",
    profile: { name: "Rep", roles },
  });

  it("a manager may work every route — §5.3's model, and the bootstrap window resolves everyone as one", () => {
    expect(mayWorkRoute({ type: "manager" }, "/final-confirm")).toBe(true);
    expect(mayWorkRoute({ type: "manager" }, "/evaluate")).toBe(true);
  });

  it("a processor may work exactly the routes of the roles on their profile", () => {
    const rep = processor(["finalConfirm", "welcomeCall"]);
    expect(mayWorkRoute(rep, "/final-confirm")).toBe(true);
    expect(mayWorkRoute(rep, "/welcome-call")).toBe(true);
    expect(mayWorkRoute(rep, "/confirm-receipt")).toBe(false);
    expect(mayWorkRoute(rep, "/benefits")).toBe(false);
  });

  it("somebody the config does not know gets no door", () => {
    expect(mayWorkRoute({ type: "none" }, "/final-confirm")).toBe(false);
  });

  it("a querystring on the href does not defeat the gate", () => {
    const rep = processor(["finalConfirm"]);
    expect(mayWorkRoute(rep, "/final-confirm?patientId=1&completedStage=2&from=patient")).toBe(true);
    expect(mayWorkRoute(rep, "/evaluate?patientId=1")).toBe(false);
  });

  it("an empty route is never workable — the caller renders 'No page' instead", () => {
    expect(mayWorkRoute({ type: "manager" }, "")).toBe(false);
  });

  it("⚠️ the CHASE PAIR maps both ways — the split is by delivery method, not by job (§5.9)", () => {
    // The patient screen's Chase Clinicals step routes to /chase-fax, but a
    // rep assigned only chaseParachute works chase too.
    expect(rolesForRoute("/chase-fax").sort()).toEqual(["chaseFax", "chaseParachute"]);
    expect(rolesForRoute("/chase-parachute").sort()).toEqual(["chaseFax", "chaseParachute"]);
    expect(mayWorkRoute(processor(["chaseParachute"]), "/chase-fax")).toBe(true);
    expect(mayWorkRoute(processor(["chaseFax"]), "/chase-parachute")).toBe(true);
  });

  it("rolesForRoute answers from the role registry, not a hand-kept list", () => {
    expect(rolesForRoute("/final-confirm")).toEqual(["finalConfirm"]);
    expect(rolesForRoute("/welcome-call")).toEqual(["welcomeCall"]);
    expect(rolesForRoute("/no-such-page")).toEqual([]);
    expect(rolesForRoute("")).toEqual([]);
  });
});
