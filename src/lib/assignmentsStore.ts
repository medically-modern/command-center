import { useState, useCallback } from "react";
import { DEFAULT_ASSIGNMENTS, type RoleAssignments, type UserName } from "./config";

const STORAGE_KEY = "cc_role_assignments";

function load(): RoleAssignments {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { ...DEFAULT_ASSIGNMENTS };
}

function save(a: RoleAssignments) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(a));
}

export function useAssignments() {
  const [assignments, setAssignments] = useState<RoleAssignments>(load);

  const toggle = useCallback((roleId: string, user: UserName) => {
    setAssignments((prev) => {
      const list = prev[roleId] ?? [];
      const next = list.includes(user)
        ? list.filter((u) => u !== user)
        : [...list, user];
      const updated = { ...prev, [roleId]: next };
      save(updated);
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

  return { assignments, toggle, getRolesForUser };
}
