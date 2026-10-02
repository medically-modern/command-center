/**
 * Ownership (BUILD-SPEC §3.10): live owners from access.json roles (+ callAnswerers for 1.2.2),
 * documented owners from the taxonomy, and the attribution order for who made a change.
 * assignments.json is legacy and deliberately not read.
 */
import type { Dict } from "../types";
import type { AccessView } from "../types";
import { OO_CONFIG } from "../config";

type Cfg = typeof OO_CONFIG;
export type Tier = "processor" | "manager" | "leadership" | "engineering";
export const personByKey = (key: string, cfg: Cfg = OO_CONFIG) => cfg.people.find((p) => p.key === key || p.accessKey === key);

/** code -> person keys holding a role mapped to it (Josh excluded). */
export function liveOwners(access: AccessView | null, cfg: Cfg = OO_CONFIG): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!access) return out;
  const add = (code: string, key: string) => { (out[code] ??= []); if (!out[code].includes(key)) out[code].push(key); };
  for (const [accessKey, roles] of Object.entries(access.roles)) {
    const p = personByKey(accessKey, cfg);
    if (!p || (p as Dict).excludeFromOwnership) continue;
    for (const r of roles) for (const code of ((cfg.roleToCodes as Dict)[r] ?? []) as string[]) add(code, p.key);
  }
  for (const k of access.callAnswererKeys) {
    const p = personByKey(k, cfg);
    if (!p || (p as Dict).excludeFromOwnership) continue;
    for (const code of cfg.callAnswererCodes) add(code, p.key);
  }
  return out;
}

export const tierOf = (key: string, cfg: Cfg = OO_CONFIG): Tier => (personByKey(key, cfg)?.tier as Tier) ?? "processor";
export const hasProcessor = (keys: string[] | undefined, cfg: Cfg = OO_CONFIG) => (keys ?? []).some((k) => tierOf(k, cfg) === "processor");

/** §3.10.1 attribution: direct monday edit by a real person (rule 1), else the Command Center person matched from the
 *  gateway's write log (rule 2, `actorKey` — model/appAttribution.ts), else automation / unattributed (rule 3). */
export function attribute(userId: number | null, cfg: Cfg = OO_CONFIG, actorKey?: string): { kind: "person" | "automation" | "unattributed"; key?: string } {
  if (actorKey && personByKey(actorKey, cfg)) return { kind: "person", key: actorKey };
  if (userId == null) return { kind: "unattributed" };
  if (userId === cfg.automationUserId) return { kind: "automation" };
  const p = cfg.people.find((x) => (x.mondayUserIds as readonly number[]).includes(userId));
  if (!p || (p as Dict).sharedToken) return { kind: "unattributed" };
  return { kind: "person", key: p.key };
}

/** Builds the AccessView from CC's access.json shape (managers, processors{key:{roles}}, callAnswerers emails). */
export function accessViewFromConfig(cfg: { managers?: string[]; processors?: Record<string, { name?: string; roles?: string[] }>; callAnswerers?: string[] } | null): AccessView | null {
  if (!cfg) return null;
  const roles: Record<string, string[]> = {};
  const emailToKey = new Map<string, string>();
  for (const [email, prof] of Object.entries(cfg.processors ?? {})) {
    const key = (prof.name ?? email.split("@")[0]).toLowerCase();
    roles[key] = [...(prof.roles ?? [])];
    emailToKey.set(email.toLowerCase(), key);
  }
  const callAnswererKeys = (cfg.callAnswerers ?? []).map((e) => emailToKey.get(e.toLowerCase()) ?? e.split("@")[0].toLowerCase());
  return { managers: (cfg.managers ?? []).map((e) => emailToKey.get(e.toLowerCase()) ?? e.split("@")[0].toLowerCase()), roles, callAnswererKeys };
}
