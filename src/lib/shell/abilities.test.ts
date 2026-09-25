/**
 * The abilities model (§5.39c), and the one property that makes it safe to add
 * to a live access config: **absent means ON**.
 */
import { describe, expect, it } from "vitest";
import type { AccessConfig } from "@/lib/accessStore";
import { resolveAccess } from "@/lib/accessStore";
import {
  OPT_IN_ABILITIES,
  hasAbility,
  homeViewsOf,
  isAdmin,
  isOptInAbility,
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
  it("gives every processor every ability — except the opt-in ones", () => {
    // A strict read would fail the whole company closed, on a page nobody could
    // open to fix it — the `isBootstrapMode` reasoning (§5.3).
    for (const a of ["comms", "adjustOrders", "reports", "inventory", "editProfile"] as const) {
      expect(hasAbility("masani@medicallymodern.com", TODAY, a), a).toBe(true);
    }
    // ⚠️ And the opt-in ones are OFF, which is the inverse and deliberate: they
    // are new, so absent config is "never given it", not "silently narrowed".
    for (const a of OPT_IN_ABILITIES) {
      expect(hasAbility("masani@medicallymodern.com", TODAY, a), a).toBe(false);
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

  it("⚠️ a MANAGER keeps every ability the config has no opinion about", () => {
    // Managers see the whole app today; quietly narrowing them on the deploy
    // that introduces the model is a change nobody asked for. ABSENCE stays on.
    const cfg: AccessConfig = {
      ...TODAY,
      processors: {
        ...TODAY.processors,
        "josh@medicallymodern.com": { name: "Josh", roles: [], perms: { reports: false } },
      },
    };
    expect(hasAbility("josh@medicallymodern.com", cfg, "comms")).toBe(true);
    expect(hasAbility("josh@medicallymodern.com", cfg, "inventory")).toBe(true);
  });

  it("⚠️⚠️ …but an EXPLICIT false is honoured for a manager too", () => {
    // §5.39h. Josh, 2026-09-19: *"if i dont assign myself communications the
    // tab should be removed from the top bar for me"* — and he is a manager,
    // so a flat blanket made the checkbox he was pointing at a no-op. An
    // explicit false is somebody looking at the switch; absence is not.
    const cfg: AccessConfig = {
      ...TODAY,
      processors: {
        ...TODAY.processors,
        "josh@medicallymodern.com": { name: "Josh", roles: [], perms: { reports: false } },
      },
    };
    expect(hasAbility("josh@medicallymodern.com", cfg, "reports")).toBe(false);
  });

  it("⚠️ a manager with NO processor entry still holds everything", () => {
    // The ordinary "Add as Manager" shape: no entry, so no opinion, so on.
    const cfg: AccessConfig = { managers: ["new@medicallymodern.com"], processors: {}, callAnswerers: [] };
    for (const a of ["comms", "reports", "inventory", "editProfile", "adjustOrders"] as const) {
      expect(hasAbility("new@medicallymodern.com", cfg, a), a).toBe(true);
    }
    // …except the opt-in one.
    expect(hasAbility("new@medicallymodern.com", cfg, "viewOthers")).toBe(false);
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

  it("⚠️ adds a second view AT THE FRONT — the new one is what they land on", () => {
    // §5.39h, Josh's Madeline report: appending left somebody landing on the
    // view they already had, behind a toggle nobody noticed, so ticking the
    // new one read as doing nothing. `views[0]` is the landing view.
    const cfg = withHomeView(TODAY, "masani@medicallymodern.com", "coordinator", true)!;
    expect(homeViewsOf("masani@medicallymodern.com", cfg)).toEqual(["coordinator", "bars"]);
    // ⚠️ …and removing one never reorders the rest: a removal is not a
    // statement about where somebody should land.
    const off = withHomeView(cfg, "masani@medicallymodern.com", "coordinator", false)!;
    expect(homeViewsOf("masani@medicallymodern.com", off)).toEqual(["bars"]);
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

  it("⚠️⚠️ CREATES the entry for somebody who has none — a pure manager", () => {
    // §5.39h: both writers used to bail out here, so ticking an ability or a
    // home view for anybody added with "Add as Manager" was a SILENT no-op —
    // the chip lit up on the optimistic state and the next 10s poll threw it
    // away with nothing erroring. The entry is what the config calls a PERSON;
    // being a manager is a separate flag beside it, and `resolveAccess` still
    // reads `managers[]` first, so adding one changes nobody's access.
    const a = withHomeView(TODAY, "josh@medicallymodern.com", "oversight", true)!;
    expect(a).not.toBeNull();
    expect(homeViewsOf("josh@medicallymodern.com", a)).toEqual(["oversight", "bars"]);
    expect(a.managers).toEqual(TODAY.managers);

    const b = withAbility(TODAY, "nobody@medicallymodern.com", "comms", false)!;
    expect(b).not.toBeNull();
    expect(hasAbility("nobody@medicallymodern.com", b, "comms")).toBe(false);
  });

  it("⚠️ still refuses to remove somebody's LAST view", () => {
    // A home screen with nothing to render is a dead end with no way back.
    expect(withHomeView(TODAY, "masani@medicallymodern.com", "bars", false)).toBeNull();
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


/**
 * ⚠️⚠️ **`viewOthers` runs BACKWARDS from every other ability** (Josh,
 * 2026-09-18 — "that's something that should ONLY be applied to me and brandon
 * as users"). It is off for everybody, including managers, until it is granted.
 * ⚠️ WHO may hold it widened on 2026-09-25 (Katie, granted on /access, Josh:
 * "katies fine") — the OPT-IN mechanics below are unchanged: a grant is still
 * an explicit tick, never the manager blanket.
 *
 * The fixture below is the real access.json shape: Josh and Brandon are in BOTH
 * `managers` and `processors`, and Corey is a manager with no processor entry at
 * all — which is why the manager blanket had to be escaped rather than tuned.
 */
describe("⚠️ viewOthers is opt-in, and only for the people granted it", () => {
  const REAL: AccessConfig = {
    managers: [
      "josh@medicallymodern.com",
      "brandon@medicallymodern.com",
      "corey@medicallymodern.com",
      "katie@medicallymodern.com",
    ],
    processors: {
      "josh@medicallymodern.com": { name: "josh", roles: [], perms: { viewOthers: true } },
      "brandon@medicallymodern.com": { name: "brandon", roles: [], perms: { viewOthers: true } },
      "katie@medicallymodern.com": { name: "katie", roles: ["profile"] },
      "masani@medicallymodern.com": { name: "Masani", roles: [] },
    },
    callAnswerers: [],
  };

  it("is declared opt-in", () => {
    expect(isOptInAbility("viewOthers")).toBe(true);
    expect(isOptInAbility("reports")).toBe(false);
  });

  it("grants it to exactly the people ticked (the fixture's Josh and Brandon)", () => {
    expect(hasAbility("josh@medicallymodern.com", REAL, "viewOthers")).toBe(true);
    expect(hasAbility("brandon@medicallymodern.com", REAL, "viewOthers")).toBe(true);
  });

  it("⚠️ a MANAGER does NOT get it for being a manager", () => {
    // Katie is a manager WITH a processor entry; Corey is a manager WITHOUT one.
    // Both are no, by different routes — a missing profile is a no as well.
    expect(hasAbility("katie@medicallymodern.com", REAL, "viewOthers")).toBe(false);
    expect(hasAbility("corey@medicallymodern.com", REAL, "viewOthers")).toBe(false);
  });

  it("is off for an ordinary processor, and for somebody unknown", () => {
    expect(hasAbility("masani@medicallymodern.com", REAL, "viewOthers")).toBe(false);
    expect(hasAbility("stranger@medicallymodern.com", REAL, "viewOthers")).toBe(false);
  });

  it("⚠️ is off in BOOTSTRAP mode too, where everyone is otherwise a manager", () => {
    // Nothing is stranded by that: there are no processors to look at yet, and
    // everybody still lands on their own home view.
    const boot: AccessConfig = { managers: [], processors: {}, callAnswerers: [] };
    expect(hasAbility("anyone@medicallymodern.com", boot, "viewOthers")).toBe(false);
    expect(hasAbility("anyone@medicallymodern.com", boot, "reports")).toBe(true);
  });

  it("leaves every OTHER ability exactly as it was", () => {
    for (const a of ["comms", "adjustOrders", "reports", "inventory", "editProfile"] as const) {
      expect(hasAbility("katie@medicallymodern.com", REAL, a), a).toBe(true);
      expect(hasAbility("masani@medicallymodern.com", REAL, a), a).toBe(true);
    }
  });

  it("can be revoked and re-granted through the ordinary writer", () => {
    const off = withAbility(REAL, "josh@medicallymodern.com", "viewOthers", false)!;
    expect(hasAbility("josh@medicallymodern.com", off, "viewOthers")).toBe(false);
    const on = withAbility(off, "josh@medicallymodern.com", "viewOthers", true)!;
    expect(hasAbility("josh@medicallymodern.com", on, "viewOthers")).toBe(true);
  });
});

/**
 * ⚠️ The shipped access.json is the thing the app actually reads, so the grant
 * rules are asserted against the FILE rather than against a fixture.
 */
describe("⚠️ the shipped access.json", () => {
  /* ⚠️ A SUBSET check, not an exact one (2026-09-23). access.json is edited
     LIVE from /access and committed straight to main, so pinning the exact
     grant list meant an admin revoking one on the page broke every deploy
     (Brandon's stageManager was turned off at 14:42 that day and CI went red).
     Revoking is always allowed; only the direction that WIDENS access is
     checked, and only where Josh has said who may hold the ability. */

  /**
   * ⚠️ Who may hold each opt-in ability, as Josh set it — one entry per ability,
   * because the two abilities have DIFFERENT rules:
   *
   *  · `viewOthers` — was Josh and Brandon ONLY (Josh, 2026-09-18: "that's
   *    something that should ONLY be applied to me and brandon as users") until
   *    2026-09-25, when he granted it to Katie on /access and confirmed the
   *    grant ("katies fine") after the pin had turned that one tick into a
   *    failed deploy for everybody — the exact failure the stageManager pin
   *    caused two days earlier. It takes the stageManager treatment now:
   *    granted on /access is granted.
   *  · `stageManager` — granted on /access to whoever needs it (§5.41: "Anyone
   *    else who needs it takes one tick on /access"). Janelle was given it at
   *    14:45 on 2026-09-23 and Josh confirmed that was deliberate. The old
   *    Josh-and-Brandon-only check turned that one tick into a failed deploy for
   *    everybody, for two hours, including an unrelated patient-data fix — a
   *    deploy gate is the wrong place to police a decision an admin makes on a
   *    page built for making it.
   *
   * ⚠️ The first test below fails for an opt-in ability with NO entry here, so a
   * third one cannot ship until somebody decides its rule. That is the drift the
   * old loop over `OPT_IN_ABILITIES` existed to catch (its `viewOthers`-only
   * predecessor passed unchanged when `stageManager` joined the list).
   */
  const GRANT_RULE: Record<string, readonly string[] | "grantedOnAccessPage"> = {
    viewOthers: "grantedOnAccessPage",
    stageManager: "grantedOnAccessPage",
  };

  const restricted = OPT_IN_ABILITIES.flatMap((a) => {
    const rule = GRANT_RULE[a];
    return Array.isArray(rule) ? [{ ability: a, allowed: new Set(rule) }] : [];
  });

  it("every opt-in ability has a grant rule — a new one cannot ship unclassified", () => {
    for (const a of OPT_IN_ABILITIES) {
      expect(GRANT_RULE[a], `opt-in ability "${a}" has no entry in GRANT_RULE`).toBeDefined();
    }
  });

  it("View others' views is granted on /access — the 2026-09-25 decision", () => {
    // The predecessor of this test pinned viewOthers to Josh and Brandon, and
    // guarded the classification so loosening it would be a visible decision.
    // It was: Katie's grant failed every deploy until Josh confirmed it, and he
    // chose the stageManager treatment. This pins the NEW classification the
    // same way, so tightening it back is a decision too, not a drive-by.
    expect(GRANT_RULE.viewOthers).toBe("grantedOnAccessPage");
  });

  for (const { ability, allowed } of restricted) {
    it(`grants ${ability} to nobody outside its list`, async () => {
      const cfg = (await import("../../../public/data/access.json")).default as unknown as AccessConfig;
      const granted = Object.entries(cfg.processors || {})
        .filter(([, p]) => p?.perms?.[ability] === true)
        .map(([e]) => e.trim().toLowerCase());
      expect(granted.filter((e) => !allowed.has(e))).toEqual([]);
    });
  }

  it("⚠️ nobody holds a RESTRICTED opt-in ability by accident", async () => {
    // An opt-in flag is the only `perms` value that grants rather than removes,
    // so a stray `true` on somebody's row is the one edit that widens access
    // without anybody choosing it — for the abilities whose holders Josh named.
    const cfg = (await import("../../../public/data/access.json")).default as unknown as AccessConfig;
    const strays = Object.entries(cfg.processors || {}).flatMap(([email, p]) =>
      restricted
        .filter(({ ability, allowed }) => p?.perms?.[ability] === true && !allowed.has(email.trim().toLowerCase()))
        .map(({ ability }) => `${email}:${ability}`),
    );
    expect(strays).toEqual([]);
  });
});

/**
 * ⚠️ The admin page's footer sentence names the exceptions, so it is BUILT from
 * `OPT_IN_ABILITIES` rather than typed. It read "except View others' views"
 * while `stageManager` was opt-in too — a page describing a rule it no longer
 * implements, which is worse than saying nothing.
 */
describe("⚠️ the admin page's exception sentence is derived, not typed", () => {
  it("AbilitiesEditor builds it from OPT_IN_ABILITIES", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(__dirname, "..", "..", "components", "shell", "AbilitiesEditor.tsx"),
      "utf8",
    );
    expect(src).toContain("OPT_IN_ABILITIES.map(");
    expect(src, "the footer names one ability by hand").not.toContain("ABILITY_LABEL.viewOthers");
    expect(src, "the footer names one ability by hand").not.toContain("ABILITY_LABEL.stageManager");
  });
});


/**
 * ⚠️ `fetchAccess` used to rebuild the config from a WHITELIST of keys, so a
 * top-level field it did not name was saved to the file and then dropped by the
 * next 10s poll — the setting reverted a few seconds after it was ticked, and
 * nothing errored. `admins` shipped that way. The read now carries every key
 * the file has, but the app still only sees a key it NORMALISES there, so this
 * scans the read for every top-level key the model has.
 */
describe("⚠️ every top-level access field survives the read-back", () => {
  it("fetchAccess carries admins, not just managers/processors/callAnswerers", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(__dirname, "..", "accessStore.ts"), "utf8");
    // ⚠️ Both ends must be FOUND: a missing end marker slices to the end of the
    // file, and the scan then passes on keys named anywhere below the read.
    const start = src.indexOf("async function fetchAccess");
    const end = src.indexOf("function putAccess", start);
    expect(start, "fetchAccess moved — point this scan at it").toBeGreaterThanOrEqual(0);
    expect(end, "the function after fetchAccess moved — point the scan's end at it").toBeGreaterThan(start);
    const read = src.slice(start, end);
    for (const key of ["managers", "processors", "callAnswerers", "admins"]) {
      expect(read, `fetchAccess drops \`${key}\``).toContain(`${key}:`);
    }
  });
});
