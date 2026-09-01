/**
 * Ships a client-path advancer no-op to the gateway so it lands in Railway.
 *
 * The gateway's own /send path detects this server-side, but the transaction
 * that actually bit us ran on the CLIENT path — `advanceToMedicalNecessity`'s
 * advancer task carries no raw `value`, so the gateway fast path never engages
 * (see verifiedWrite's `tasks.every((t) => t.value !== undefined)` gate). A
 * browser console.error is invisible to everyone who isn't the rep, so without
 * this the one case we know happens in production would still be unloggable.
 *
 * ⚠️ Best-effort by construction: never throws, never blocks a save, and is not
 * awaited by its caller. A telemetry line is worth strictly less than the write
 * it reports on — the same reasoning `recordEvent` uses for `call_events`.
 *
 * ⚠️ Metadata only — item id, column id, the label and the status value. No
 * patient fields, matching the gateway's LOG_PAYLOAD=false posture (§8).
 */
import { MONDAY_VIA_GATEWAY, mondayIdentityHeaders } from "./mondayEndpoint";

const GATEWAY = (import.meta.env.VITE_MONDAY_GATEWAY_URL ?? "").replace(/\/+$/, "");

export interface AdvancerNoopReport {
  itemId: string;
  columnId: string;
  label: string;
  value: string;
}

export async function reportAdvancerNoop(r: AdvancerNoopReport): Promise<void> {
  if (!MONDAY_VIA_GATEWAY || !GATEWAY) return;
  try {
    await fetch(`${GATEWAY}/telemetry/advancer-noop`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...mondayIdentityHeaders() },
      body: JSON.stringify(r),
      keepalive: true,
    });
  } catch {
    /* telemetry only — a failed report must never surface to the rep */
  }
}
