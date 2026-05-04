import { useState, useCallback, useEffect, useRef } from "react";
import { DEFAULT_ASSIGNMENTS, type RoleAssignments, type UserName } from "./config";

const REPO = "medically-modern/command-center-test";
const FILE_PATH = "public/data/assignments.json";
const BRANCH = "main";
const PAT = import.meta.env.VITE_GITHUB_PAT as string | undefined;

const API_BASE = `https://api.github.com/repos/${REPO}/contents/${FILE_PATH}`;

// Poll every 10 seconds so everyone sees changes quickly
const POLL_INTERVAL = 10_000;

let cachedSha: string | null = null;

async function headers() {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
  };
  if (PAT) h.Authorization = `token ${PAT}`;
  return h;
}

async function fetchAssignments(): Promise<{ data: RoleAssignments; sha: string }> {
  const res = await fetch(`${API_BASE}?ref=${BRANCH}&t=${Date.now()}`, {
    headers: await headers(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub fetch failed: ${res.status}`);
  const json = await res.json();
  cachedSha = json.sha;
  const content = JSON.parse(atob(json.content));
  return { data: content, sha: json.sha };
}

async function saveAssignments(data: RoleAssignments): Promise<void> {
  // Get latest SHA first to avoid conflicts
  if (!cachedSha) {
    const latest = await fetchAssignments();
    cachedSha = latest.sha;
  }

  const res = await fetch(API_BASE, {
    method: "PUT",
    headers: await headers(),
    body: JSON.stringify({
      message: "Update role assignments",
      content: btoa(JSON.stringify(data, null, 2)),
      sha: cachedSha,
      branch: BRANCH,
    }),
  });

  if (res.status === 409) {
    // SHA conflict — re-fetch and retry once
    const latest = await fetchAssignments();
    cachedSha = latest.sha;
    const retry = await fetch(API_BASE, {
      method: "PUT",
      headers: await headers(),
      body: JSON.stringify({
        message: "Update role assignments",
        content: btoa(JSON.stringify(data, null, 2)),
        sha: cachedSha,
        branch: BRANCH,
      }),
    });
    if (!retry.ok) throw new Error(`GitHub save retry failed: ${retry.status}`);
    const retryJson = await retry.json();
    cachedSha = retryJson.content.sha;
    return;
  }

  if (!res.ok) throw new Error(`GitHub save failed: ${res.status}`);
  const json = await res.json();
  cachedSha = json.content.sha;
}

export function useAssignments() {
  const [assignments, setAssignments] = useState<RoleAssignments>({ ...DEFAULT_ASSIGNMENTS });
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval>>();

  // Initial load + polling
  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const { data } = await fetchAssignments();
        if (mounted) {
          setAssignments(data);
          setLoading(false);
        }
      } catch (e) {
        console.error("Failed to load assignments:", e);
        if (mounted) setLoading(false);
      }
    }

    load();

    pollRef.current = setInterval(async () => {
      try {
        const { data } = await fetchAssignments();
        if (mounted) setAssignments(data);
      } catch { /* silent poll failure */ }
    }, POLL_INTERVAL);

    return () => {
      mounted = false;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const toggle = useCallback((roleId: string, user: UserName) => {
    setAssignments((prev) => {
      const list = prev[roleId] ?? [];
      const next = list.includes(user)
        ? list.filter((u) => u !== user)
        : [...list, user];
      const updated = { ...prev, [roleId]: next };

      // Fire and forget save
      saveAssignments(updated).catch((e) =>
        console.error("Failed to save assignments:", e)
      );

      return updated;
    });
  }, []);

  const getRolesForUser = useCallback(
    (user: UserName): string[] =>
      Object.entries(assignments)
        .filter(([, users]) => users.includes(user))
        .map(([roleId]) => roleId),
    [assignments],
  );

  return { assignments, toggle, getRolesForUser, loading };
}
