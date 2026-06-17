/**
 * People shown in the Command Center are derived from the access list
 * (access.json) — NOT from a hardcoded USERS array. This is the single source
 * of truth after the email migration:
 *
 *   managers   → see the full app; in dashboards they get ALL role bars.
 *   processors → see only the role bars checked for them on Manage Access.
 *
 * Roles are edited per-person on the Manage Access page (AccessAdminPage).
 */
import { ROLES } from "./config";
import type { AccessConfig } from "./accessStore";

export const ALL_ROLE_IDS: string[] = ROLES.map((r) => r.id);

export interface Person {
  email: string;
  /** URL-safe selection key (email local part) — unique within one domain. */
  key: string;
  /** Display name. */
  name: string;
  /** Role bars this person sees (managers = all roles). */
  roleIds: string[];
  isManager: boolean;
}

function norm(e: string): string {
  return (e || "").trim().toLowerCase();
}

/** "jane.doe@x.com" → "Jane Doe"; "josh@x.com" → "Josh". */
function prettyName(email: string): string {
  const local = norm(email).split("@")[0].replace(/[._-]+/g, " ").trim();
  const pretty = local
    .split(" ")
    .filter(Boolean)
    .map((s) => s[0].toUpperCase() + s.slice(1))
    .join(" ");
  return pretty || norm(email);
}

export function managerPeople(cfg: AccessConfig): Person[] {
  return (cfg.managers || []).map((e) => ({
    email: norm(e),
    key: norm(e).split("@")[0],
    name: prettyName(e),
    roleIds: ALL_ROLE_IDS,
    isManager: true,
  }));
}

export function processorPeople(cfg: AccessConfig): Person[] {
  return Object.entries(cfg.processors || {}).map(([e, p]) => ({
    email: norm(e),
    key: norm(e).split("@")[0],
    name: (p?.name || "").trim() || prettyName(e),
    roleIds: p?.roles || [],
    isManager: false,
  }));
}
