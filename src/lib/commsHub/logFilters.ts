/**
 * The three logs' filters, once the Inbox is switched on (COMMS_INBOX_PLAN.md
 * §1.2, Josh's D4, 2026-09-23: *"that makes sense"*).
 *
 *   Texts  — All · Received · Sent
 *   Calls  — All · Inbound · Outbound · Missed
 *   VMs    — no filter
 *
 * ⚠️ These REPLACE the *Unread* and *Unheard* filters, and only those. The
 * Inbox's *Unresolved* list is the "needs attention" view now; the read flag
 * itself stays, because it is RingCentral's own and the RingCentral desktop app
 * shows it too (§5.28) — opening still marks read, the right-click still flips
 * it, and the rows still wear it. Fax keeps its Unread view (faxes never open an
 * item).
 */

export type TextLogFilter = "all" | "in" | "out";

export const TEXT_LOG_FILTERS: { id: TextLogFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "in", label: "Received" },
  { id: "out", label: "Sent" },
];

/**
 * A conversation is *Received* when the patient has texted us in the window
 * and *Sent* when we have texted them — either, not "last" (the mockup's own
 * rule, `ibLogList`). A thread with both appears under both.
 */
export function textLogMatches(c: { hasInbound: boolean; hasOutbound: boolean }, f: TextLogFilter): boolean {
  if (f === "in") return c.hasInbound;
  if (f === "out") return c.hasOutbound;
  return true;
}

export type CallLogFilter = "all" | "in" | "out" | "missed";

export const CALL_LOG_FILTERS: { id: CallLogFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "in", label: "Inbound" },
  { id: "out", label: "Outbound" },
  { id: "missed", label: "Missed" },
];

/**
 * ⚠️ *Missed* is an INBOUND call nobody answered — §5.28's rule, and the one the
 * Phone tab's Missed filter has always used: an outbound call that went
 * unanswered is not missed, nobody was trying to reach us. *Inbound* includes
 * the missed ones (the mockup's rule), and "answered" reads the LEGS through
 * `connected`, so a call a rep took by forwarding is not missed (§5.13).
 */
export function callLogMatches(r: { inbound: boolean; connected: boolean }, f: CallLogFilter): boolean {
  if (f === "in") return r.inbound;
  if (f === "out") return !r.inbound;
  if (f === "missed") return r.inbound && !r.connected;
  return true;
}
