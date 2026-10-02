/**
 * Existing CC gateway report GET /comms/sla (read-only; Google-authenticated). BUILD-SPEC B-02, D-22.
 * Covers ALL inbound comms, not only onboarding; the UI says so.
 */
import { MONDAY_GATEWAY_BASE, MONDAY_VIA_GATEWAY, mondayIdentityHeaders } from "@/lib/shared/mondayEndpoint";
import type { CommsSla } from "../types";

export async function fetchCommsSla(days: number): Promise<CommsSla | null> {
  if (!MONDAY_VIA_GATEWAY) return null; // direct-monday dev mode: "Not connected"
  const res = await fetch(`${MONDAY_GATEWAY_BASE}/comms/sla?days=${days}`, { headers: { ...mondayIdentityHeaders() } });
  if (!res.ok) throw new Error(`/comms/sla failed (${res.status})`);
  const j = await res.json();
  return { open: j.open ?? 0, over: j.over ?? 0, resolved: j.resolved ?? 0, within: j.within ?? 0, withinPct: j.withinPct ?? null,
    medianMs: j.medianMs ?? null, byHow: j.byHow ?? {}, reps: Array.isArray(j.reps) ? j.reps : [] };
}
