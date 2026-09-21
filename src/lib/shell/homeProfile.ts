/**
 * Whose bars the home screen draws (§5.39g).
 *
 * Josh, 2026-09-19: *"the home screen should be the assigned view / bars for
 * that person, ie for me josh logging in it should show my view by default"*.
 *
 * ⚠️⚠️ **A MANAGER'S HOME WAS THE TEAM ROSTER, NOT THEIR OWN WORK.** `Index`
 * branches on `access.type`, and a manager — even one carrying a full processor
 * profile, which Josh does (24 roles) — got the manager dashboard and never
 * their own queues. Brandon's model is the other way round: *"EVERY person gets
 * a custom view; 'bars' is the placeholder view for people whose own view isn't
 * designed yet"*, and the roster's job moved to the Viewing dropdown. So the
 * home is the signed-in person's own view, manager or not.
 *
 * ⚠️ **A manager with NO processor entry gets every bar**, which is what
 * `people.ts` has always said a manager is ("managers → in dashboards they get
 * ALL role bars"). The alternative — an empty screen reading "no queues
 * assigned" — would strand exactly the people who can fix it, and the whole
 * point of this rule is that nobody lands on a blank page (§5.39e).
 *
 * ⚠️ **The synthetic profile carries NO `roleFilters` and NO `roleOrder`**, so a
 * manager's bars are unfiltered and in registry order. Inventing an escalation
 * filter for somebody who has never been given one would quietly hide work.
 */
import type { AccessConfig, ProcessorProfile } from "@/lib/accessStore";
import { ALL_ROLE_IDS } from "@/lib/people";

const norm = (e: string) => (e || "").trim().toLowerCase();

/** The stored `processors` entry for an email, whatever else this person is. */
function storedProfile(email: string, cfg: AccessConfig): ProcessorProfile | null {
  const e = norm(email);
  const key = Object.keys(cfg.processors || {}).find((k) => norm(k) === e);
  return key ? cfg.processors[key] ?? null : null;
}

function isManager(email: string, cfg: AccessConfig): boolean {
  // Bootstrap — while no manager is configured, everyone is one (§5.3).
  if (!(cfg.managers || []).length) return true;
  return (cfg.managers || []).some((m) => norm(m) === norm(email));
}

/**
 * The profile whose bars this person's home screen draws, or null when the
 * config has never heard of them (AuthGate stops those long before here).
 *
 * ⚠️ The STORED profile wins even for a manager: a dual manager+processor has
 * been given a specific set of bars and an SOP order, and that is their screen.
 * The all-roles fallback is only for somebody with no entry at all.
 */
export function homeProfileFor(email: string, cfg: AccessConfig): ProcessorProfile | null {
  const stored = storedProfile(email, cfg);
  if (stored) return stored;
  if (!isManager(email, cfg)) return null;
  return { name: norm(email).split("@")[0], roles: [...ALL_ROLE_IDS] };
}

/** Is this an all-roles stand-in rather than an assigned set of bars? */
export function isSyntheticHomeProfile(email: string, cfg: AccessConfig): boolean {
  return !storedProfile(email, cfg) && isManager(email, cfg);
}
