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
 */
import type { Ability, AccessConfig, HomeView, ProcessorProfile } from "@/lib/accessStore";

const norm = (e: string) => (e || "").trim().toLowerCase();

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
 * Does this person have this ability?
 *
 * ⚠️ Returns TRUE for anyone the config does not explicitly restrict — managers,
 * people in bootstrap mode, and every processor whose `perms` has no opinion.
 */
export function hasAbility(email: string, cfg: AccessConfig, ability: Ability): boolean {
  const { kind, profile } = kindOf(email, cfg);
  // A manager, or bootstrap mode where everyone is one.
  if (kind === "manager") return true;
  // Somebody with no access at all is gated by AuthGate long before this; an
  // ability question about them is not this module's to answer, and TRUE keeps
  // it from becoming a second, quieter access check.
  if (kind === "none" || !profile) return true;
  return profile.perms?.[ability] !== false;
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
  const p = profileOf(email, cfg);
  const raw = p?.homeView;
  if (!Array.isArray(raw) || raw.length === 0) return ["bars"];
  // An unrecognised value is dropped rather than rendered as a fourth tab.
  const clean = raw.filter((v): v is HomeView => v === "bars" || v === "coordinator" || v === "oversight");
  return clean.length ? clean : ["bars"];
}

/** Set a person's home views, keeping at least one. */
export function withHomeView(
  cfg: AccessConfig,
  email: string,
  view: HomeView,
  on: boolean,
): AccessConfig | null {
  const key = Object.keys(cfg.processors || {}).find((k) => norm(k) === norm(email));
  if (!key) return null;
  const current = homeViewsOf(email, cfg);
  const next = on ? [...new Set([...current, view])] : current.filter((v) => v !== view);
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
  cfg: AccessConfig,
  email: string,
  ability: Ability,
  on: boolean,
): AccessConfig | null {
  const key = Object.keys(cfg.processors || {}).find((k) => norm(k) === norm(email));
  if (!key) return null;
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
  inventory: "Inventory",
  editProfile: "Edit profile",
};

export const ABILITY_HINT: Record<Ability, string> = {
  comms: "Can text and call patients from the patient screen.",
  adjustOrders: "Can adjust an open order — the backorder substitution pick.",
  viewOthers: "Gets the “Viewing” dropdown on the home screen, to look at anyone else's view.",
  reports: "Can open Reports & Metrics.",
  inventory: "Shows the Inventory tab in the header.",
  editProfile: "Can change the Subscription profile. Without it, that page is read-only.",
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
