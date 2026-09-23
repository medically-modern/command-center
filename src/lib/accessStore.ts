import { withAbility, withAdmin, withHomeView } from "@/lib/shell/abilities";
/**
 * Per-email access control, persisted to the repo (public/data/access.json)
 * via the GitHub Contents API (same cross-device sync pattern as the rest), so it syncs
 * across devices.
 *
 * Model:
 *   managers   — emails that see the FULL Command Center (current UI).
 *   processors — email → { name, roles[] }: a tailored "profile". On sign-in
 *                they see ONLY those role bars, no side column.
 *   anyone NOT listed → NO ACCESS until a manager assigns them.
 *
 * Bootstrap: while access.json is empty (no managers, no processors) EVERYONE
 * is treated as a manager, so the first admin can sign in and configure it.
 * The Access admin page refuses to save a config that would lock the current
 * user out.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { dataRepoName } from "./shared/dataRepo";
import { FILE_PROXY_URL } from "./shared/mondayAssets";

// Access config is read/written through the monday-file-proxy worker's /gh-state
// endpoint, which holds the GitHub token SERVER-SIDE — the browser no longer
// ships one. The worker allowlists repo + file, so this can only ever touch
// public/data/access.json in the two Command Center repos.
const BRANCH = "main";
const ACCESS_URL = `${FILE_PROXY_URL}/gh-state?repo=${dataRepoName()}&file=access`;
const POLL_INTERVAL = 10_000;

/** Per-role escalation scope a processor sees for a given role.
 *  "nonEscalated" = today's processor view (escalated hidden);
 *  "escalated"    = only escalated (today's manager view);
 *  "all"          = both. */
export type EscalationFilter = "all" | "nonEscalated" | "escalated";

/**
 * Per-role CROSS-SELL scope — Welcome Call only (Katie + Brandon, 2026-09-21:
 * Corey takes the cross-sell calls, somebody else takes the rest).
 *
 * ⚠️ This is a FILTER over the one queue, never an assignment. Per-patient
 * ownership was built once and removed in Aug 2026 (§5.13), and §5.30 records
 * the standing rule for a second person on a queue: "a FILTER over these same
 * lists — never routing". Concretely: a cross-sell patient is still sitting in
 * the ordinary Welcome Call queue for anyone else holding the role, so Corey
 * being out does not strand them in a bucket nobody looks at — and the role
 * count, the burndown, Oversight and both baseline generators stay whole, so
 * there is no §5.8 counting-contract change.
 *
 * ⚠️ These COMPOSE WITH the escalation scope rather than replacing it.
 * `viewFilterFromParams` recognises only the three escalation values, so both
 * of these fall through to "nonEscalated" there — which means an escalated
 * cross-sell patient is the manager's, exactly as any other escalated patient
 * is (§5.34), and every slice that does not know about cross-sell is untouched
 * by construction.
 */
export type CrossSellScope = "crossSell" | "nonCrossSell";

/** What `/access` stores per (person, role). */
export type RoleFilter = EscalationFilter | CrossSellScope;

export interface ProcessorProfile {
  name: string;
  roles: string[];
  /** Per-role filter. A role missing here defaults to "nonEscalated". */
  roleFilters?: Record<string, RoleFilter>;
  /** Per-role SOP order number (1,2,3…). Missing → falls back to config order. */
  roleOrder?: Record<string, number>;
  /**
   * Direct number RingCentral rings to reach this person on a click-to-call
   * (RingOut's `from` leg — desk line or cell).
   *
   * ⚠️ This is NOT the number the patient sees. Patients always see the MM
   * number, which RingOut sends as `callerId`. Left blank, click-to-call falls
   * back to the MM main number — calls still work, but the main line rings and
   * whoever picks up there gets bridged instead of this person.
   */
  phoneNumber?: string;
  /**
   * Which abilities this person has (§5.39c). ⚠️ **ABSENT MEANS ON**, and an
   * individual key absent means on too — see `abilities.ts`. Only an explicit
   * `false` takes something away, because every access.json written before this
   * shipped has no `perms` at all and reading that as "no abilities" would fail
   * the whole company closed on one deploy.
   */
  perms?: Partial<Record<Ability, boolean>>;
  /**
   * Which home view(s) this person gets (§5.39c). Missing or empty → `["bars"]`,
   * today's role bars, which is what everybody has now. Two or more puts a
   * toggle on top of the home screen.
   */
  homeView?: HomeView[];
}

/**
 * The abilities a person can be given (§5.39c), from Brandon's 2026-09-18
 * mockup. ⚠️ **They unlock buttons; they never hide information** — his own
 * wording, and the reason there is no "can see patients" ability here.
 */
export type Ability =
  /** Text and call patients from the patient screen. */
  | "comms"
  /** Adjust an open order — the backorder substitution pick (§5.35). */
  | "adjustOrders"
  /** The "Viewing: <person>" dropdown on the home screen. */
  | "viewOthers"
  /** Open Reports & Metrics. */
  | "reports"
  /** Open Stage Manager — move a patient between stages by hand. */
  | "stageManager"
  /** Open Inventory — the Cardinal SKU tracker. */
  | "inventory"
  /** Change the Subscription profile; without it that page is read-only. */
  | "editProfile";

export const ABILITIES: readonly Ability[] = [
  "comms",
  "adjustOrders",
  "viewOthers",
  "reports",
  "stageManager",
  "inventory",
  "editProfile",
] as const;

/** Which screen a person lands on (§5.39c). */
export type HomeView = "bars" | "coordinator" | "oversight";
export const HOME_VIEWS: readonly HomeView[] = ["bars", "coordinator", "oversight"] as const;

export interface AccessConfig {
  managers: string[];
  processors: Record<string, ProcessorProfile>;
  /**
   * Who answers the main line IN THE BROWSER (§5.13b) — and, since 2026-09-14,
   * the only people who are shown an incoming call at all. Assigned by a
   * manager, never self-service, and capped at MAX_CALL_ANSWERERS because
   * every browser here registers as the SAME RingCentral extension, which
   * allows five devices. Managers and processors alike; a manager is not
   * exempt from the cap.
   */
  callAnswerers: string[];
  /**
   * Who may open User management and change anyone else's bars, abilities and
   * home view (§5.39c).
   *
   * ⚠️ **EMPTY MEANS EVERY MANAGER IS AN ADMIN**, deliberately — the same
   * bootstrap reasoning as `noManagers` above. The first deploy reads an
   * access.json with no `admins` key at all, and a strict read would lock every
   * manager out of the page that sets it.
   */
  admins?: string[];
}

/**
 * RingCentral's per-extension SIP registration limit. A sixth device is
 * refused with `603 Too Many Contacts`. Five people is the most that can be
 * promised a ring; each browser a person opens takes a slot of its own, so the
 * admin page says so beside the count.
 */
export const MAX_CALL_ANSWERERS = 5;
export type Access =
  | { type: "manager" }
  | { type: "processor"; profile: ProcessorProfile }
  | { type: "none" };

export const EMPTY_ACCESS: AccessConfig = { managers: [], processors: {}, callAnswerers: [] };

function norm(e: string): string {
  return (e || "").trim().toLowerCase();
}

/** Is this person set up to answer (and be shown) incoming calls? */
export function canAnswerCalls(email: string, cfg: AccessConfig): boolean {
  const e = norm(email);
  return !!e && (cfg.callAnswerers || []).some((a) => norm(a) === e);
}

/**
 * The config with `email` added to / removed from the call answerers — or
 * `null` when adding would exceed the cap. Pure, so the cap is testable; the
 * hook's setter and the admin page both go through it, and RingCentral's own
 * refusal (§5.13b) stays the backstop for the cases this cannot see, such as
 * one person opening the app on three machines.
 */
export function withCallAnswerer(cfg: AccessConfig, email: string, on: boolean): AccessConfig | null {
  const e = norm(email);
  if (!e) return cfg;
  const cur = (cfg.callAnswerers || []).map(norm);
  const has = cur.includes(e);
  if (on === has) return cfg;
  if (on) {
    if (cur.length >= MAX_CALL_ANSWERERS) return null;
    return { ...cfg, callAnswerers: [...cur, e] };
  }
  return { ...cfg, callAnswerers: cur.filter((a) => a !== e) };
}

/** The config with every trace of `email` removed — manager flag, processor
 *  profile AND the call-answerer slot, so removing a person frees their slot. */
export function configWithoutEmail(cfg: AccessConfig, email: string): AccessConfig {
  const e = norm(email);
  const processors = { ...cfg.processors };
  const pk = Object.keys(processors).find((k) => norm(k) === e);
  if (pk) delete processors[pk];
  // ⚠️ Spread first: this used to rebuild the config from three keys and so
  // dropped `admins` for EVERYONE whenever anybody was removed.
  return {
    ...cfg,
    managers: cfg.managers.filter((m) => norm(m) !== e),
    processors,
    callAnswerers: (cfg.callAnswerers || []).filter((a) => norm(a) !== e),
    ...(cfg.admins ? { admins: cfg.admins.filter((a) => norm(a) !== e) } : {}),
  };
}

/** Bootstrap window: until at least one MANAGER exists, everyone is treated as
 *  a manager — so the first admin can sign in and configure, and adding
 *  processors alone can never lock the admin out. */
function noManagers(cfg: AccessConfig): boolean {
  return !cfg.managers || cfg.managers.length === 0;
}

/** Resolve what a given email is allowed to see. */
export function resolveAccess(email: string, cfg: AccessConfig): Access {
  const e = norm(email);
  if (noManagers(cfg)) return { type: "manager" }; // bootstrap — first admin sets things up
  if ((cfg.managers || []).some((m) => norm(m) === e)) return { type: "manager" };
  const procKey = Object.keys(cfg.processors || {}).find((k) => norm(k) === e);
  if (procKey) return { type: "processor", profile: cfg.processors[procKey] };
  return { type: "none" };
}

let cachedSha: string | null = null;

/**
 * ⚠️ Does NOT touch `cachedSha` — the caller decides whether this read is one
 * to believe. GitHub's contents API can answer a GET with the PREVIOUS version
 * for several seconds after a PUT; a poll that stored that stale sha made the
 * next save 409, and the edit silently failed (§5.39j).
 */
async function fetchAccess(): Promise<{ data: AccessConfig; sha: string | null }> {
  const res = await fetch(`${ACCESS_URL}&t=${Date.now()}`, {
    cache: "no-store",
  });
  if (res.status === 404) {
    return { data: { ...EMPTY_ACCESS }, sha: null };
  }
  if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status}`);
  const json = await res.json();
  const parsed = JSON.parse(atob(json.content));
  return {
    data: {
      managers: parsed.managers ?? [],
      processors: parsed.processors ?? {},
      // Absent on a file written before 2026-09-14 (and on prod until its own
      // admin sets one): nobody is assigned, nobody is rung. Never inferred.
      callAnswerers: Array.isArray(parsed.callAnswerers) ? parsed.callAnswerers : [],
      // ⚠️⚠️ **THIS READ IS A WHITELIST, so a key missing from it is written by
      // `saveAccess` and then THROWN AWAY by the next 10s poll.** `admins` was
      // exactly that when it shipped (2026-09-18): the toggle wrote the file
      // correctly and the list vanished a few seconds later, with nothing
      // erroring — a setting that will not stick and does not say why.
      // `perms` and `homeView` are safe only because they ride INSIDE
      // `processors`. Anything new at the TOP level has to be added here too.
      admins: Array.isArray(parsed.admins) ? parsed.admins.filter((a: unknown) => typeof a === "string") : undefined,
    },
    sha: json.sha,
  };
}

async function saveAccess(data: AccessConfig): Promise<void> {
  const body = (sha: string | null) => ({
    message: "Update access config",
    content: btoa(JSON.stringify(data, null, 2)),
    ...(sha ? { sha } : {}),
    branch: BRANCH,
  });
  const put = (sha: string | null) =>
    fetch(ACCESS_URL, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body(sha)) });
  let res = await put(cachedSha);
  // ⚠️ A conflict means our sha is behind. Re-read it and retry — a few times,
  // because the re-read itself can come back stale for a moment after a PUT.
  for (let attempt = 0; attempt < 3 && (res.status === 409 || res.status === 422); attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500 * attempt));
    const latest = await fetchAccess();
    cachedSha = latest.sha;
    res = await put(cachedSha);
  }
  if (!res.ok) throw new Error(`Access save failed: ${res.status}`);
  const json = await res.json();
  cachedSha = json.content?.sha ?? cachedSha;
}

/**
 * How long after our own last save a poll result is ignored. GitHub can serve
 * the previous version of the file for a while after a write, and applying it
 * put a just-ticked chip back to how it was — the "click it, it flips back,
 * click it again" report (Josh, 2026-09-23).
 */
const WRITE_QUIET_MS = 30_000;

export function useAccess() {
  const [config, setConfig] = useState<AccessConfig>({ ...EMPTY_ACCESS });
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval>>();
  /* ⚠️⚠️ **LOCAL EDITS MUST WIN OVER THE POLL** (§5.39j). The 10s poll used to
     `setConfig` whatever GitHub answered, so a poll that had STARTED before a
     click — or that read the file before GitHub served the new version —
     overwrote the click. The chip lit up, went back, and the admin clicked it
     again. Three guards: a poll is dropped if any edit happened while it was in
     flight (`editGen`), while a save is still pending (`pendingSaves`), or
     inside `WRITE_QUIET_MS` of our own last save (`lastWriteAt`). */
  const configRef = useRef<AccessConfig>(config);
  const editGen = useRef(0);
  const pendingSaves = useRef(0);
  const lastWriteAt = useRef(0);
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let mounted = true;
    const load = async (initial: boolean) => {
      const gen = editGen.current;
      try {
        const { data, sha } = await fetchAccess();
        if (!mounted) return;
        const stale =
          !initial &&
          (gen !== editGen.current ||
            pendingSaves.current > 0 ||
            Date.now() - lastWriteAt.current < WRITE_QUIET_MS);
        if (stale) return;
        cachedSha = sha;
        configRef.current = data;
        setConfig(data);
      } catch (e) {
        if (initial) console.error("Failed to load access config:", e);
      } finally {
        if (initial && mounted) setLoading(false);
      }
    };
    void load(true);
    pollRef.current = setInterval(() => void load(false), POLL_INTERVAL);
    return () => {
      mounted = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  /* ⚠️ The save is a SIDE EFFECT and lives outside the state updater — React
     may run an updater twice (StrictMode), which sent every change twice.
     Saves are SERIALISED and each writes the LATEST config, so two quick clicks
     can never land out of order and have the older one overwrite the newer. */
  const mutate = useCallback((fn: (prev: AccessConfig) => AccessConfig) => {
    const prev = configRef.current;
    const next = fn(prev);
    if (next === prev) return;
    configRef.current = next;
    editGen.current += 1;
    lastWriteAt.current = Date.now();
    setConfig(next);
    pendingSaves.current += 1;
    saveChain.current = saveChain.current
      .then(() => saveAccess(configRef.current))
      .catch((e) => {
        console.error("Failed to save access:", e);
        toast.error("Couldn't save that access change. Refresh the page and try again.");
      })
      .finally(() => {
        pendingSaves.current -= 1;
        lastWriteAt.current = Date.now();
      });
  }, []);

  /** Add to managers WITHOUT touching any processor profile — a person can be
   *  both (manager view on login, still listed/assigned as a processor). */
  const addManager = useCallback((email: string) => {
    const e = norm(email);
    if (!e) return;
    mutate((prev) => {
      const managers = prev.managers.some((m) => norm(m) === e) ? prev.managers : [...prev.managers, e];
      return { ...prev, managers };
    });
  }, [mutate]);

  /**
   * Toggle the manager flag on/off without disturbing the processor profile.
   *
   * ⚠️⚠️ **DEMOTING SOMEBODY WITH NO PROCESSOR ENTRY USED TO DELETE THEM**
   * (Josh, 2026-09-19: *"i removed corey as a manager and his profile
   * disappeared"*). The People list on `/access` is the UNION of `managers[]`
   * and `processors{}`, so a pure manager — somebody added with "Add as
   * Manager" and never given bars — existed in that one array and nowhere
   * else. Unticking Manager dropped the only record of them: their card
   * vanished, `resolveAccess` returned `{type:"none"}`, and they were signed
   * out of the whole app by a checkbox that says nothing about access.
   *
   * So a demotion now leaves a processor entry behind (no roles, no abilities
   * touched). That is what "not a manager" means here — an ordinary person with
   * nothing assigned yet — and it keeps them on the page, editable, one click
   * from being given bars. **Removing somebody is the Remove button**, which
   * still wipes every trace (`configWithoutEmail`); a demotion is not a delete.
   */
  const setManager = useCallback((email: string, isManager: boolean) => {
    const e = norm(email);
    if (!e) return;
    mutate((prev) => {
      const has = prev.managers.some((m) => norm(m) === e);
      let managers = prev.managers;
      if (isManager && !has) managers = [...prev.managers, e];
      else if (!isManager && has) managers = prev.managers.filter((m) => norm(m) !== e);
      if (isManager) return { ...prev, managers };
      // ⚠️ Fill the gap the demotion would leave, and ONLY that gap: somebody
      // who already has a processor entry keeps it exactly as it is.
      const hasProfile = Object.keys(prev.processors || {}).some((k) => norm(k) === e);
      if (hasProfile) return { ...prev, managers };
      return {
        ...prev,
        managers,
        processors: { ...prev.processors, [e]: { name: e.split("@")[0], roles: [] } },
      };
    });
  }, [mutate]);

  const removeEmail = useCallback((email: string) => {
    mutate((prev) => configWithoutEmail(prev, email));
  }, [mutate]);

  /**
   * Give (or take back) a person's browser-answering slot. Returns false —
   * and writes nothing — when the five are already taken. Checked against the
   * config on screen for the answer, and again against the latest state on
   * write, so two managers editing at once cannot land a sixth between them.
   */
  const setCallAnswerer = useCallback((email: string, on: boolean): boolean => {
    if (!withCallAnswerer(configRef.current, email, on)) return false;
    mutate((prev) => withCallAnswerer(prev, email, on) ?? prev);
    return true;
  }, [mutate]);

  /** Add a processor profile WITHOUT removing a manager flag — supports dual. */
  const addProcessor = useCallback((email: string, name: string) => {
    const e = norm(email);
    if (!e) return;
    mutate((prev) => {
      const pk = Object.keys(prev.processors).find((k) => norm(k) === e) || e;
      return {
        ...prev,
        processors: { ...prev.processors, [pk]: prev.processors[pk] ?? { name: name || e, roles: [] } },
      };
    });
  }, [mutate]);

  const setProcessorName = useCallback((email: string, name: string) => {
    const e = norm(email);
    mutate((prev) => {
      const pk = Object.keys(prev.processors).find((k) => norm(k) === e);
      if (!pk) return prev;
      return { ...prev, processors: { ...prev.processors, [pk]: { ...prev.processors[pk], name } } };
    });
  }, [mutate]);

  /** Toggle a role on/off. Creates the processor profile if missing (so a pure
   *  manager can be given roles and become dual). Removing a role also prunes
   *  its filter/order so stale settings don't linger. */
  const toggleProcessorRole = useCallback((email: string, roleId: string) => {
    const e = norm(email);
    if (!e) return;
    mutate((prev) => {
      const pk = Object.keys(prev.processors).find((k) => norm(k) === e) || e;
      const cur = prev.processors[pk] ?? { name: e.split("@")[0], roles: [] };
      const had = cur.roles.includes(roleId);
      const roles = had ? cur.roles.filter((r) => r !== roleId) : [...cur.roles, roleId];
      const next: ProcessorProfile = { ...cur, roles };
      if (had) {
        if (cur.roleFilters) { const rf = { ...cur.roleFilters }; delete rf[roleId]; next.roleFilters = rf; }
        if (cur.roleOrder) { const ro = { ...cur.roleOrder }; delete ro[roleId]; next.roleOrder = ro; }
      }
      return { ...prev, processors: { ...prev.processors, [pk]: next } };
    });
  }, [mutate]);

  /** Set (or clear, when blank) the number RingCentral rings to reach this
   *  person on a click-to-call. See ProcessorProfile.phoneNumber. */
  const setProcessorPhone = useCallback((email: string, phone: string) => {
    const e = norm(email);
    mutate((prev) => {
      const pk = Object.keys(prev.processors).find((k) => norm(k) === e);
      if (!pk) return prev;
      const cur = prev.processors[pk];
      const next: ProcessorProfile = { ...cur };
      const trimmed = (phone || "").trim();
      if (trimmed) next.phoneNumber = trimmed;
      else delete next.phoneNumber;
      return { ...prev, processors: { ...prev.processors, [pk]: next } };
    });
  }, [mutate]);

  /** Set the escalation filter for one of a processor's roles. */
  const setRoleFilter = useCallback((email: string, roleId: string, filter: RoleFilter) => {
    const e = norm(email);
    mutate((prev) => {
      const pk = Object.keys(prev.processors).find((k) => norm(k) === e);
      if (!pk) return prev;
      const cur = prev.processors[pk];
      const roleFilters = { ...(cur.roleFilters ?? {}), [roleId]: filter };
      return { ...prev, processors: { ...prev.processors, [pk]: { ...cur, roleFilters } } };
    });
  }, [mutate]);

  /** Set (or clear, when null/NaN) the SOP order number for one role. */
  const setRoleOrder = useCallback((email: string, roleId: string, order: number | null) => {
    const e = norm(email);
    mutate((prev) => {
      const pk = Object.keys(prev.processors).find((k) => norm(k) === e);
      if (!pk) return prev;
      const cur = prev.processors[pk];
      const roleOrder = { ...(cur.roleOrder ?? {}) };
      if (order == null || Number.isNaN(order)) delete roleOrder[roleId];
      else roleOrder[roleId] = order;
      return { ...prev, processors: { ...prev.processors, [pk]: { ...cur, roleOrder } } };
    });
  }, [mutate]);

  /* ── Brandon's abilities model (§5.39c) ─────────────────────────────────
     All three write through the pure helpers in `lib/shell/abilities`, which
     own the defaults-ON rule and the "everyone keeps at least one view" refusal.
     ⚠️ A helper returning null means the change was REFUSED (no such processor,
     or it would have removed somebody's last home view) — the caller must not
     write `prev` back as though it succeeded. */
  const setAbility = useCallback((email: string, ability: Ability, on: boolean) => {
    mutate((prev) => withAbility(prev, email, ability, on) ?? prev);
  }, [mutate]);

  const setHomeView = useCallback((email: string, view: HomeView, on: boolean) => {
    mutate((prev) => withHomeView(prev, email, view, on) ?? prev);
  }, [mutate]);

  const setAdmin = useCallback((email: string, on: boolean) => {
    mutate((prev) => withAdmin(prev, email, on));
  }, [mutate]);

  return {
    config,
    loading,
    addManager,
    setManager,
    removeEmail,
    addProcessor,
    setProcessorName,
    setProcessorPhone,
    toggleProcessorRole,
    setRoleFilter,
    setRoleOrder,
    setCallAnswerer,
    setAbility,
    setHomeView,
    setAdmin,
  };
}
