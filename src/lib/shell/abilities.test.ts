/**
 * The abilities model (§5.39c), and the one property that makes it safe to add
 * to a live access config: **absent means ON**.
 */
import { describe, expect, it } from "vitest";
import type { AccessConfig } from "@/lib/accessStore";
import { resolveAccess } from "@/lib/accessStore";
import {
  hasAbility,
  homeViewsOf,
  isAdmin,
  withAbility,
  withAdmin,
  withHomeView,
} from "./abilities";

/** An access.json exactly as it exists TODAY — no `perms`, no `admins`, no
 *  `homeView`. Every test below is really asking "what happens on the first
 *  deploy", because this is what that deploy reads. */
const TODAY: AccessConfig = {
  managers: ["josh@medicallymodern.com"],
  processors: {
    "masani@medicallymodern.com": { name: "Masani", roles: ["unverifiedReferrals"] },
  },
  callAnswerers: [],
};

describe("⚠️ the first deploy reads a config with none of this in it", () => {
  it("gives every processor every ability", () => {
    // A strict read would fail the whole company closed, on a page nobody could
    // open to fix it — the `isBootstrapMode` reasoning (§5.3).
    for (const a of ["comms", "adjustOrders", "viewOthers", "reports", "inventory", "editProfile"] as const) {
      expect(hasAbility("masani@medicallymodern.com", TODAY, a), a).toBe(true);
    }
  });

  it("makes every MANAGER an admin while `admins` is empty", () => {
    expect(isAdmin("josh@medicallymodern.com", TODAY)).toBe(true);
    expect(isAdmin("masani@medicallymodern.com", TODAY)).toBe(false);
  });

  it("lands everybody on the bars — exactly where they land today", () => {
    expect(homeViewsOf("masani@medicallymodern.com", TODAY)).toEqual(["bars"]);
    expect(homeViewsOf("nobody@medicallymodern.com", TODAY)).toEqual(["bars"]);
  });
});

describe("hasAbility", () => {
  it("⚠️ only an explicit false takes something away", () => {
    const cfg = withAbility(TODAY, "masani@medicallymodern.com", "reports", false)!;
    expect(hasAbility("masani@medicallymodern.com", cfg, "reports")).toBe(false);
    // Everything else it has no opinion about is still on.
    expect(hasAbility("masani@medicallymodern.com", cfg, "comms")).toBe(true);
  });

  it("⚠️ a MANAGER keeps every ability, whatever perms says", () => {
    // Managers see the whole app today; quietly narrowing them on the deploy
    // that introduces the model is a change nobody asked for.
    const cfg: AccessConfig = {
      ...TODAY,
      processors: {
        ...TODAY.processors,
        "josh@medicallymodern.com": { name: "Josh", roles: [], perms: { reports: false } },
      },
    };
    expect(hasAbility("josh@medicallymodern.com", cfg, "reports")).toBe(true);
  });

  it("is true in bootstrap mode, where everyone is a manager", () => {
    const boot: AccessConfig = { managers: [], processors: {}, callAnswerers: [] };
    expect(hasAbility("anyone@medicallymodern.com", boot, "editProfile")).toBe(true);
  });
});

describe("isAdmin", () => {
  it("uses the list once it is non-empty, and a manager is NOT automatically on it", () => {
    const cfg = withAdmin(TODAY, "brandon@medicallymodern.com", true);
    expect(isAdmin("brandon@medicallymodern.com", cfg)).toBe(true);
    expect(isAdmin("josh@medicallymodern.com", cfg)).toBe(false);
  });

  it("matches case-insensitively, like every other email rule here", () => {
    const cfg = withAdmin(TODAY, "Brandon@MedicallyModern.com", true);
    expect(isAdmin("brandon@medicallymodern.com", cfg)).toBe(true);
  });

  it("falls back to managers again when the last admin is removed", () => {
    let cfg = withAdmin(TODAY, "brandon@medicallymodern.com", true);
    cfg = withAdmin(cfg, "brandon@medicallymodern.com", false);
    expect(isAdmin("josh@medicallymodern.com", cfg)).toBe(true);
  });
});

describe("homeViewsOf / withHomeView", () => {
  it("⚠️ refuses to remove somebody's LAST view", () => {
    // A home screen with nothing to render is a dead end with no way back —
    // §5.10 · §5.20 · §5.31c each record reversing exactly that.
    expect(withHomeView(TODAY, "masani@medicallymodern.com", "bars", false)).toBeNull();
  });

  it("adds a second view without dropping the first", () => {
    const cfg = withHomeView(TODAY, "masani@medicallymodern.com", "coordinator", true)!;
    expect(homeViewsOf("masani@medicallymodern.com", cfg)).toEqual(["bars", "coordinator"]);
  });

  it("drops an unrecognised view rather than rendering a fourth tab", () => {
    const cfg: AccessConfig = {
      ...TODAY,
      processors: {
        "masani@medicallymodern.com": {
          name: "Masani",
          roles: [],
          homeView: ["nonsense" as never, "oversight"],
        },
      },
    };
    expect(homeViewsOf("masani@medicallymodern.com", cfg)).toEqual(["oversight"]);
  });

  it("returns null for somebody who is not a processor", () => {
    expect(withHomeView(TODAY, "josh@medicallymodern.com", "oversight", true)).toBeNull();
    expect(withAbility(TODAY, "nobody@medicallymodern.com", "comms", false)).toBeNull();
  });

  it("never mutates the config it was handed", () => {
    const before = JSON.stringify(TODAY);
    withHomeView(TODAY, "masani@medicallymodern.com", "coordinator", true);
    withAbility(TODAY, "masani@medicallymodern.com", "comms", false);
    withAdmin(TODAY, "x@medicallymodern.com", true);
    expect(JSON.stringify(TODAY)).toBe(before);
  });
});

describe("⚠️ the local kindOf copy agrees with resolveAccess", () => {
  // `abilities.ts` imports accessStore TYPE-ONLY, because accessStore calls its
  // writers and the runtime import back would be a cycle. That makes the
  // manager/processor rule a hand-synced copy — the §5.7 hazard — so it is
  // pinned here against the real thing rather than trusted.
  const cases: [string, AccessConfig][] = [
    ["bootstrap", { managers: [], processors: {}, callAnswerers: [] }],
    ["manager", TODAY],
    [
      "processor with perms",
      {
        managers: ["josh@medicallymodern.com"],
        processors: { "m@medicallymodern.com": { name: "M", roles: [], perms: { comms: false } } },
        callAnswerers: [],
      },
    ],
  ];

  for (const [label, cfg] of cases) {
    it(`matches on ${label}`, () => {
      for (const who of ["josh@medicallymodern.com", "m@medicallymodern.com", "stranger@medicallymodern.com"]) {
        const real = resolveAccess(who, cfg);
        // A manager, or anyone accessStore does not know, keeps every ability.
        // Only a processor carrying an explicit false loses one.
        const expected =
          real.type === "processor" ? real.profile.perms?.comms !== false : true;
        expect(hasAbility(who, cfg, "comms"), `${label}/${who}`).toBe(expected);
      }
    });
  }
});
