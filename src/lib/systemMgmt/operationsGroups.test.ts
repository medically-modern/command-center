import { describe, it, expect } from "vitest";
import { ROLES } from "@/lib/config";
import {
  ROLE_GROUPS,
  FALLBACK_GROUP,
  groupRoleRows,
  type RoleGroup,
} from "./operationsGroups";

const row = (id: string) => ({ role: { id } });
const idsOf = (groups: { bars: { role: { id: string } }[] }[]) =>
  groups.flatMap((g) => g.bars.map((b) => b.role.id));

describe("ROLE_GROUPS vs the live role registry", () => {
  it("names no role that does not exist (no dead ids)", () => {
    const real = new Set(ROLES.map((r) => r.id));
    const dead = ROLE_GROUPS.flatMap((g) => g.roleIds).filter((id) => !real.has(id));
    expect(dead).toEqual([]);
  });

  it("places every registered role — nothing is invisible", () => {
    const placed = new Set(ROLE_GROUPS.flatMap((g) => g.roleIds));
    const missing = ROLES.map((r) => r.id).filter((id) => !placed.has(id));
    expect(missing).toEqual([]);
  });

  it("places each role in exactly ONE group", () => {
    const seen = new Map<string, string[]>();
    for (const g of ROLE_GROUPS) {
      for (const id of g.roleIds) {
        seen.set(id, [...(seen.get(id) ?? []), g.title]);
      }
    }
    const dupes = [...seen].filter(([, titles]) => titles.length > 1);
    expect(dupes).toEqual([]);
  });

  it("carries a fallback group, so an unlisted role has somewhere to land", () => {
    expect(ROLE_GROUPS.map((g) => g.title)).toContain(FALLBACK_GROUP);
  });

  it("covers every role the registry has today", () => {
    // Guards the count as well as the set: a role added to ROLES and to a
    // group is fine, but one added to ROLES alone fails the test above.
    expect(ROLE_GROUPS.flatMap((g) => g.roleIds).length).toBe(ROLES.length);
  });
});

describe("groupRoleRows", () => {
  it("renders every registered role when given the whole registry", () => {
    const grouped = groupRoleRows(ROLES.map((r) => row(r.id)));
    expect(idsOf(grouped).sort()).toEqual(ROLES.map((r) => r.id).sort());
  });

  it("orders rows by the table, not by the order they arrive in", () => {
    const shuffled = [...ROLES].reverse().map((r) => row(r.id));
    const grouped = groupRoleRows(shuffled);
    const intake = grouped.find((g) => g.title === "Intake")!;
    expect(intake.bars.map((b) => b.role.id)).toEqual([
      "profile", "unverifiedReferrals", "scheduledCalls", "intakeCleanup",
    ]);
  });

  it("sends an UNLISTED role to the fallback group rather than dropping it", () => {
    // The regression this whole module is shaped around: a role added to the
    // registry and forgotten here must still be visible on the tab.
    const grouped = groupRoleRows([row("evaluate"), row("brandNewRole")]);
    const fallback = grouped.find((g) => g.title === FALLBACK_GROUP);
    expect(fallback?.bars.map((b) => b.role.id)).toContain("brandNewRole");
    expect(idsOf(grouped)).toContain("brandNewRole");
  });

  it("numbers bars flatly across groups so the cascade does not restart", () => {
    const grouped = groupRoleRows(ROLES.map((r) => row(r.id)));
    const indices = grouped.flatMap((g) => g.bars.map((b) => b.i));
    expect(indices).toEqual(indices.map((_, n) => n));
  });

  it("drops empty groups instead of printing a bare heading", () => {
    const grouped = groupRoleRows([row("benefits")]);
    expect(grouped.map((g) => g.title)).toEqual(["Insurance"]);
  });

  it("keeps a zero-count row — an empty queue is not a missing role", () => {
    // The tab used to filter these out, which is why roles kept "going
    // missing": nobody-waiting and not-wired-up looked identical.
    const grouped = groupRoleRows([{ role: { id: "dvs" }, current: 0, baseline: 0 }]);
    expect(idsOf(grouped)).toEqual(["dvs"]);
  });

  it("is a pure read of its input — no row is invented or lost", () => {
    const rows = ROLES.slice(0, 6).map((r) => row(r.id));
    const grouped = groupRoleRows(rows);
    expect(idsOf(grouped).length).toBe(rows.length);
  });
});

describe("the groups a manager reads", () => {
  const titles = () => ROLE_GROUPS.map((g) => g.title);

  it("runs in pipeline order, Intake first and Other last", () => {
    expect(titles()).toEqual([
      "Intake", "Medical Evaluation", "Insurance", "Welcome Call", "Other",
    ]);
  });

  it("keeps the two count-only roles visible", () => {
    // `fax` and `authDenied` have no working page (CLAUDE.md §4 / §7), which
    // is exactly why they have to appear here — the board is where that work
    // happens, and this tab is how a manager knows it exists.
    const placed = new Set(ROLE_GROUPS.flatMap((g: RoleGroup) => g.roleIds));
    expect(placed.has("fax")).toBe(true);
    expect(placed.has("authDenied")).toBe(true);
  });
});
