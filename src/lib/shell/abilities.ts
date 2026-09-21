/**
 * Who can do what, and which screen they land on (§5.39c) — the abilities model
 * from Brandon's 2026-09-18 mockup.
 *
 * ⚠️⚠️ **EVERY ABILITY DEFAULTS TO ON, AND THAT IS THE WHOLE SAFETY PROPERTY**
 * (Josh, 2026-09-18, asked directly). Every `access.json` in existence was
 * written before `perms` existed, so a strict read — "no perms key, no
 * abilities" — would fail the entire company closed on one deploy, on a page
 * nobody could open to fix it because `admins` is empty too. Same reasoning as
 * `isBootstrapMode` (§5.3): the safe default while a config is unset is the
 * permissive one, because the restrictive one has no escape hatch.
 *
 * So the rule is **only an explicit `false` takes something away**. A missing
 * `perms` object, a missing key inside one, an unrecognised value — all ON.
 *
 * ⚠️ **Abilities unlock BUTTONS; they never hide INFORMATION** — Brandon's own
 * wording, and the reason there is no "can see patients" ability. A person
 * without `editProfile` reads the Subscription profile and cannot save it; they
 * are never told the patient does not exist.
 *
 * ⚠️ **A manager has every ability, whatever `perms` says.** Managers see the
 * whole app today (§5.3), and quietly taking something away from them on the
 * deploy that introduces the model is a change nobody asked for. Narrowing a
 * manager is a decision, and it needs its own conversation.
 *
 * ⚠️⚠️ **TWO CARVE-OUTS RUN THE OTHER WAY — `OPT_IN_ABILITIES` is OFF until
 * granted.** An opt-in ability needs an explicit `perms.<a> === true` and is
 * NOT covered by the manager blanket above, so a manager does not get it for
 * being a manager; somebody ticks the box.
 *
 *   · **`viewOthers`** (Josh, 2026-09-18 — "that's something that should ONLY
 *     be applied to me and brandon as users").
 *   · **`stageManager`** (Josh, 2026-09-21 — "make stage manager opt-in like
 *     viewothers"), because that screen WRITES the Stage Advancer, which is
 *     what every board automation fires on (§6). It is the one ability whose
 *     screen MOVES a patient.
 *
 * The carve-out does not contradict the default-ON rule, it is the same
 * argument applied honestly. Default-ON exists because a config written before
 * `perms` existed must not TAKE AWAY something people already have. Neither of
 * these existed before the config did — `viewOthers` shipped 2026-09-18 and
 * `stageManager` 2026-09-21 — so absent configuration is not a person being
 * silently narrowed, it is a person who was never given it.
 *
 * ⚠️ **A THIRD entry needs the same two facts to be true of it**, and both are
 * load-bearing:
 *   1. **NEW** — nobody can be silently narrowed out of something they had.
 *      An opt-in flag on an existing ability takes it from the whole company on
 *      one deploy, which is the failure default-ON exists to prevent.
 *   2. **NOT A WAY OUT OF ANYWHERE** — a person without it must still have a
 *      screen to work from, or the flag is the dead end §5.10 · §5.20 · §5.31c
 *      · §5.39d each record reversing. Without `viewOthers` you land on your
 *      own home view; without `stageManager` you keep every other tab. A
 *      hypothetical opt-in `comms` would fail this test, because the
 *      Communications page is where a rep works.
 * Everything else stays ON.
 */
import type { Ability, AccessConfig, HomeView, ProcessorProfile } from "@/lib/accessStore";

const norm = (e: string) => (e || "").trim().toLowerCase();

/**
 * Abilities that are OFF until explicitly granted — see the header. A manager
 * does not get these for being a manager; somebody has to tick the box.
 *
 * ⚠️ This list is the ONE declaration. `hasAbility` reads it, `AbilitiesEditor`
 * keeps its chips clickable for a manager because of it, and the footer
 * sentence on that page is BUILT from it — so a third entry needs no copy
 * change anywhere, which is what stops the page describing a rule it no longer
 * implements.
 */
export const OPT_IN_ABILITIES: readonly Ability[] = ["viewOthers", "stageManager"] as const;

export function isOptInAbility(a: Ability): boolean {
  return OPT_IN_ABILITIES.includes(a);
}

/**
 * ⚠️ **Deliberately a LOCAL copy of `resolveAccess`'s shape, and the import above
 * is TYPE-ONLY.** `accessStore` calls the `with*` writers below, so importing its
 * runtime back would be a cycle — which ES modules tolerate right up until one
 * side reads the other at module-init time and gets `undefined`. The rule is
 * five lines and its two branches are pinned by tests, so the copy is cheaper
 * than the cycle. It must stay in step with `resolveAccess`: bootstrap first,
 * then managers, then processors.
 */
type Kind = "manager" | "processor" | "none";
function kindOf(email: string, cfg: AccessConfig): { kind: Kind; profile: ProcessorProfile | null } {
  const e = norm(email);
  // Bootstrap — while no manager is configured, everyone is one (§5.3).
  if (!(cfg.managers || []).length) return { kind: "manager", profile: null };
  if ((cfg.managers || []).some((m) => norm(m) === e)) return { kind: "manager", profile: null };
  const key = Object.keys(cfg.processors || {}).find((k) => norm(k) === e);
  return key ? { kind: "processor", profile: cfg.processors[key] } : { kind: "none", profile: null };
}

/** The profile for an email, or null for a manager / unknown. */
function profileOf(email: string, cfg: AccessConfig): ProcessorProfile | null {
  return kindOf(email, cfg).profile;
}

/**
 * The stored `processors` entry for an email, whatever else this person is.
 *
 * ⚠️⚠️ **NOT `profileOf`, and the difference is the whole opt-in grant.**
 * `kindOf` answers "manager or processor", so it returns `profile: null` for
 * anybody in `managers[]` without ever looking them up — and the two people who
 * hold `viewOthers` are in BOTH lists (the config's "dual" people, which
 * `processorPeople` badges with a shield). Reading the grant through `kindOf`
 * therefore finds nothing for exactly the users it was written for: ticked on
 * the page, stored in the file, invisible to the app. Caught by a test.
 */
function storedProfile(email: string, cfg: AccessConfig): ProcessorProfile | null {
  const e = norm(email);
  const key = Object.keys(cfg.processors || {}).find((k) => norm(k) === e);
  return key ? cfg.processors[key] ?? null : null;
}

/**
 * Does this person have this ability?
 *
 * ⚠️ Returns TRUE for anyone the config does not explicitly restrict — managers,
 * people in bootstrap mode, and every processor whose `perms` has no opinion.
 * ⚠️ EXCEPT an `OPT_IN_ABILITIES` entry, which is the exact inverse: FALSE for
 * everyone the config does not explicitly grant, managers included.
 */
export function hasAbility(email: string, cfg: AccessConfig, ability: Ability): boolean {
  const { kind, profile } = kindOf(email, cfg);
  // ⚠️ The opt-in carve-out is checked FIRST, above the manager blanket — that
  // blanket is exactly what it has to escape, or every manager gets it.
  // ⚠️ And it reads `storedProfile`, NOT the `profile` beside it: a dual
  // manager+processor is `{kind: "manager", profile: null}`, which is both
  // people who hold this today. See `storedProfile`.
  // Only a stored `true` grants it, so no processor entry (a pure manager like
  // Corey) is a no, and so is bootstrap mode.
  if (isOptInAbility(ability)) return storedProfile(email, cfg)?.perms?.[ability] === true;
  /* ⚠⚠ **A MANAGER KEEPS THE BLANKET, BUT AN EXPLICIT `false` STILL WINS**
     (§5.39h). Josh, 2026-09-19: *"i want everthing on this list functional. ie
     if i dont assign myself communications the tab should be removed from the
     top bar for me"* — and he is a manager, so under a flat `return true` the
     checkbox he was pointing at could never do anything. Measured in a browser
     before the fix: Katie, a manager with `comms: false`, kept the
     Communications tab AND walked straight through its page gate.
     ⚠️ The distinction is ABSENCE vs a DECISION, which is the same argument
     the default-ON rule rests on. Absent stays ON, so the deploy that
     introduced `perms` narrowed nobody; an explicit `false` is somebody
     looking at the switch and turning it off, and honouring that is the whole
     point of having the switch. A manager is never stranded by it either —
     `AbilityGate` names the ability and links an admin straight to Users. */
  if (kind === "manager") return storedProfile(email, cfg)?.perms?.[ability] !== false;
  // Somebody with no access at all is gated by AuthGate long before this; an
  // ability question about them is not this module's to answer, and TRUE keeps
  // it from becoming a second, quieter access check.
  if (kind === "none" || !profile) return true;
  return profile.perms?.[ability] !== false;
}

/**
 * Is this person a manager (bootstrap included)?
 *
 * ⚠️ Exported so the header can answer for a BORROWED identity (§5.39g) —
 * `useAccessContext().access` only ever describes the signed-in person, so a
 * manager viewing a processor's screen would keep their own Manage menu and the
 * borrow would not be "exactly what they see".
 */
export function isManagerOf(email: string, cfg: AccessConfig): boolean {
  return kindOf(email, cfg).kind === "manager";
}

/**
 * May this person open User management?
 *
 * ⚠️ **An empty `admins` list means every MANAGER is an admin**, not that nobody
 * is. The first deploy reads a config with no `admins` key, and a strict read
 * would lock every manager out of the one page that can set it.
 */
export function isAdmin(email: string, cfg: AccessConfig): boolean {
  const list = cfg.admins ?? [];
  if (list.length === 0) return kindOf(email, cfg).kind === "manager";
  return list.some((a) => norm(a) === norm(email));
}

/**
 * Which home view(s) this person gets.
 *
 * ⚠️ **Missing or empty is `["bars"]`** — today's role bars, which is what
 * everybody has right now. A person whose own view has not been designed yet
 * lands exactly where they land today, which is what makes the model additive.
 */
export function homeViewsOf(email: string, cfg: AccessConfig): HomeView[] {
  // ⚠️⚠️ **`storedProfile`, NOT `profileOf` — the same trap the opt-in grant
  // hit.** `kindOf` answers "manager or processor" and hands back
  // `profile: null` for anybody in `managers[]` without looking them up, so a
  // dual manager+processor — Josh, Brandon, Katie, every "dual" person in the
  // config — could be given a custom home view on `/access`, have it stored in
  // the file, and never see it: `homeViewsOf` read null and returned `["bars"]`
  // for ever. A home view is about which SCREEN somebody lands on, which is a
  // property of the person and not of their access level.
  const p = storedProfile(email, cfg);
  const raw = p?.homeView;
  if (!Array.isArray(raw) || raw.length === 0) return ["bars"];
  // An unrecognised value is dropped rather than rendered as a fourth tab.
  const clean = raw.filter((v): v is HomeView => v === "bars" || v === "coordinator" || v === "oversight");
  return clean.length ? clean : ["bars"];
}

/**
 * The processor key for an email, creating an empty entry when there is none.
 *
 * ⚠️⚠️ **WITHOUT THIS, EVERY TOGGLE ON A PURE MANAGER IS A SILENT NO-OP.** Both
 * writers below used to bail out when a person had no `processors` entry — and
 * somebody added with "Add as Manager" has none — so an admin could tick
 * "View others' views" or pick a home view for Corey, see the chip light up on
 * the optimistic state, and have the next 10s poll throw it away with nothing
 * erroring. The entry is what the config calls a PERSON; being a manager is a
 * separate flag beside it, and `resolveAccess` still reads `managers[]` first,
 * so adding one changes nobody's access.
 */
function withProcessorEntry(cfg: AccessConfig, email: string): { cfg: AccessConfig; key: string } | null {
  const e = norm(email);
  if (!e) return null;
  const key = Object.keys(cfg.processors || {}).find((k) => norm(k) === e);
  if (key) return { cfg, key };
  return {
    cfg: { ...cfg, processors: { ...cfg.processors, [e]: { name: e.split("@")[0], roles: [] } } },
    key: e,
  };
}

/** Set a person's home views, keeping at least one. */
export function withHomeView(
  base: AccessConfig,
  email: string,
  view: HomeView,
  on: boolean,
): AccessConfig | null {
  const made = withProcessorEntry(base, email);
  if (!made) return null;
  const { cfg, key } = made;
  const current = homeViewsOf(email, cfg);
  /* ⚠⚠ **TURNING A VIEW ON MAKES IT THE LANDING VIEW — it is PREPENDED, not
     appended** (§5.39h). `views[0]` is what the home opens on, and the default
     is `["bars"]`, so appending meant ticking "Manager oversight" for somebody
     left them landing on bars with a toggle they had to notice and press.
     Josh reported exactly that — *"i assigned madelins just manager oversight
     and it still shows bars when i look at her view"* — and the access.json
     history is the proof: 11:18:26 wrote `["bars","oversight"]`, and three
     toggles later he turned bars off to get the screen he had just asked for.
     Nothing was broken; the ORDER was, and an admin had no way to see it.
     ⚠️ Turning one OFF never reorders the rest: a removal is not a statement
     about where somebody should land. */
  const next = on ? [...new Set([view, ...current])] : current.filter((v) => v !== view);
  // ⚠️ Everyone needs at least one view, or the home page has nothing to render
  // and the person has no way back — the dead end §5.10 · §5.20 · §5.31c each
  // record reversing.
  if (next.length === 0) return null;
  return {
    ...cfg,
    processors: {
      ...cfg.processors,
      [key]: { ...cfg.processors[key], homeView: next },
    },
  };
}

/** Grant or revoke one ability. */
export function withAbility(
  base: AccessConfig,
  email: string,
  ability: Ability,
  on: boolean,
): AccessConfig | null {
  const made = withProcessorEntry(base, email);
  if (!made) return null;
  const { cfg, key } = made;
  const prev = cfg.processors[key];
  return {
    ...cfg,
    processors: {
      ...cfg.processors,
      // ⚠️ Stored as an explicit boolean either way rather than deleting the key
      // on `true`. A deleted key reads as ON, which is the same answer — but a
      // stored `true` is the record that somebody looked at it and said yes,
      // and that is what an admin page is for.
      [key]: { ...prev, perms: { ...(prev.perms ?? {}), [ability]: on } },
    },
  };
}

/** Add or remove an admin. */
export function withAdmin(cfg: AccessConfig, email: string, on: boolean): AccessConfig {
  const list = cfg.admins ?? [];
  const next = on
    ? [...new Set([...list, email.trim()])]
    : list.filter((a) => norm(a) !== norm(email));
  return { ...cfg, admins: next };
}

export const ABILITY_LABEL: Record<Ability, string> = {
  comms: "Patient communication",
  adjustOrders: "Adjust orders",
  viewOthers: "View others' views",
  reports: "Reports & Metrics",
  stageManager: "Stage Manager",
  inventory: "Inventory",
  editProfile: "Edit profile",
};

export const ABILITY_HINT: Record<Ability, string> = {
  comms:
    "Shows the Communications tab, and the Call / Text buttons on a patient. Without it this person can still read a patient — they just cannot start a message.",
  adjustOrders:
    "Can adjust an open order — the backorder substitution pick that emails Cardinal (§5.35).",
  viewOthers:
    "Off unless granted. Adds the “Viewing” dropdown on the home screen, which shows anyone else’s home screen exactly as they see it.",
  reports: "Shows the Reports & Metrics tab in the header — the daily operations screen.",
  stageManager:
    "Off unless granted. Shows the Stage Manager tab in the header. That screen MOVES a patient between stages by writing the Stage Advancer, which is what board automations fire on — so it is a write, not a view.",
  inventory: "Shows the Inventory tab in the header.",
  editProfile:
    "Can change the Subscription profile — order details, visit date, address and phone. Without it that page is read-only.",
};

export const HOME_VIEW_LABEL: Record<HomeView, string> = {
  bars: "Stages (bars)",
  coordinator: "Patient care coordinator",
  oversight: "Manager oversight",
};

/** The word on the home screen's own toggle — shorter than the admin label. */
export const HOME_VIEW_TAB: Record<HomeView, string> = {
  bars: "Stages",
  coordinator: "My Patients",
  oversight: "Oversight",
};

export const HOME_VIEW_HINT: Record<HomeView, string> = {
  bars: "This person's assigned role bars — what everyone has today.",
  coordinator: "“My Patients” — intake call-backs and welcome calls, with the day's schedule.",
  oversight: "Pipeline Oversight, with its manager columns.",
};
