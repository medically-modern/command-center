/**
 * Per-email access control, persisted to the repo (public/data/access.json)
 * via the GitHub Contents API — same pattern as assignmentsStore, so it syncs
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
import { dataRepo } from "./shared/dataRepo";

const REPO = dataRepo(); // per-deployment: test→test repo, prod→prod repo (sync-safe)
const FILE_PATH = "public/data/access.json";
const BRANCH = "main";
const PAT = import.meta.env.VITE_GITHUB_PAT as string | undefined;
const API_BASE = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;
const POLL_INTERVAL = 10_000;

export interface ProcessorProfile {
  name: string;
  roles: string[];
}
export interface AccessConfig {
  managers: string[];
  processors: Record<string, ProcessorProfile>;
}
export type Access =
  | { type: "manager" }
  | { type: "processor"; profile: ProcessorProfile }
  | { type: "none" };

export const EMPTY_ACCESS: AccessConfig = { managers: [], processors: {} };

function norm(e: string): string {
  return (e || "").trim().toLowerCase();
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

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (PAT) h.Authorization = `token ${PAT}`;
  return h;
}

let cachedSha: string | null = null;

async function fetchAccess(): Promise<{ data: AccessConfig; sha: string | null }> {
  const res = await fetch(`${API_BASE}?ref=${BRANCH}&t=${Date.now()}`, {
    headers: ghHeaders(),
    cache: "no-store",
  });
  if (res.status === 404) {
    cachedSha = null;
    return { data: { ...EMPTY_ACCESS }, sha: null };
  }
  if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status}`);
  const json = await res.json();
  cachedSha = json.sha;
  const parsed = JSON.parse(atob(json.content));
  return {
    data: { managers: parsed.managers ?? [], processors: parsed.processors ?? {} },
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
  let res = await fetch(API_BASE, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body(cachedSha)) });
  if (res.status === 409 || res.status === 422) {
    const latest = await fetchAccess();
    cachedSha = latest.sha;
    res = await fetch(API_BASE, { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body(cachedSha)) });
  }
  if (!res.ok) throw new Error(`GitHub save failed: ${res.status}`);
  const json = await res.json();
  cachedSha = json.content?.sha ?? cachedSha;
}

export function useAccess() {
  const [config, setConfig] = useState<AccessConfig>({ ...EMPTY_ACCESS });
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const { data } = await fetchAccess();
        if (mounted) setConfig(data);
      } catch (e) {
        console.error("Failed to load access config:", e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await fetchAccess();
        if (mounted) setConfig(data);
      } catch {
        /* silent */
      }
    }, POLL_INTERVAL);
    return () => {
      mounted = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const mutate = useCallback((fn: (prev: AccessConfig) => AccessConfig) => {
    setConfig((prev) => {
      const next = fn(prev);
      saveAccess(next).catch((e) => console.error("Failed to save access:", e));
      return next;
    });
  }, []);

  const addManager = useCallback((email: string) => {
    const e = norm(email);
    if (!e) return;
    mutate((prev) => {
      const processors = { ...prev.processors };
      delete processors[Object.keys(processors).find((k) => norm(k) === e) || ""];
      const managers = prev.managers.some((m) => norm(m) === e) ? prev.managers : [...prev.managers, e];
      return { managers, processors };
    });
  }, [mutate]);

  const removeEmail = useCallback((email: string) => {
    const e = norm(email);
    mutate((prev) => {
      const processors = { ...prev.processors };
      const pk = Object.keys(processors).find((k) => norm(k) === e);
      if (pk) delete processors[pk];
      return { managers: prev.managers.filter((m) => norm(m) !== e), processors };
    });
  }, [mutate]);

  const addProcessor = useCallback((email: string, name: string) => {
    const e = norm(email);
    if (!e) return;
    mutate((prev) => {
      const managers = prev.managers.filter((m) => norm(m) !== e);
      const pk = Object.keys(prev.processors).find((k) => norm(k) === e) || e;
      return {
        managers,
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

  const toggleProcessorRole = useCallback((email: string, roleId: string) => {
    const e = norm(email);
    mutate((prev) => {
      const pk = Object.keys(prev.processors).find((k) => norm(k) === e);
      if (!pk) return prev;
      const cur = prev.processors[pk];
      const roles = cur.roles.includes(roleId)
        ? cur.roles.filter((r) => r !== roleId)
        : [...cur.roles, roleId];
      return { ...prev, processors: { ...prev.processors, [pk]: { ...cur, roles } } };
    });
  }, [mutate]);

  return {
    config,
    loading,
    addManager,
    removeEmail,
    addProcessor,
    setProcessorName,
    toggleProcessorRole,
  };
}
