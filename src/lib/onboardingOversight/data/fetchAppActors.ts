/**
 * GET /oversight/app-actors (gateway, READ-ONLY): who made each Command Center write, so the
 * dashboard can name the person behind a shared-token event (model/appAttribution.ts).
 * Needs the gateway and a sign-in; without either, or on any failure, returns null and the
 * dashboard stays exactly as before (those events read "Shared Command Center account").
 */
import { getIdToken } from "@/lib/shared/auth";
import type { AppActorRow } from "../model/appAttribution";

const GATEWAY = ((import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined) ?? "").replace(/\/+$/, "");

export interface AppActors { rows: AppActorRow[]; truncated: boolean; clamped: boolean }

export async function fetchAppActors(sinceMs: number): Promise<AppActors | null> {
  const token = getIdToken();
  if (!GATEWAY || !token) return null;
  try {
    const res = await fetch(`${GATEWAY}/oversight/app-actors?since=${encodeURIComponent(new Date(sinceMs).toISOString())}`, { headers: { "X-MM-Auth": token } });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; rows?: AppActorRow[]; truncated?: boolean; clamped?: boolean };
    return body.ok && Array.isArray(body.rows) ? { rows: body.rows, truncated: !!body.truncated, clamped: !!body.clamped } : null;
  } catch {
    return null;
  }
}
