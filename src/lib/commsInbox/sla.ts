/**
 * The Communications SLA card's display rules (COMMS_INBOX_PLAN.md §1.2, Josh's
 * D8: *"4A"*). Every NUMBER comes from the gateway's `slaReport` — the one
 * `countedWaitMs` clock the Inbox itself shows (plan §4.4) — so nothing here
 * computes a wait, a median or a percentage. This file only decides how the
 * gateway's answer is worded.
 *
 * ⚠️ There is deliberately no second copy of the report in the browser. A
 * median or a within-24h share recomputed here would be a mirror of
 * `commsInboxRules.slaReport`, and the §5.7 hazard: two screens disagreeing
 * about the same log, with nothing erroring.
 */
import type { AccessConfig } from "@/lib/accessStore";
import type { SlaReport } from "@/lib/commsInbox/api";
import { HOW_LABEL, formatWait, type ResolveHow } from "@/lib/commsInbox/rules";
import { managerPeople, prettyName, processorPeople } from "@/lib/people";

/** The card's window. The gateway clamps whatever is asked to 1–365 days. */
export const SLA_DAYS = 30;

/**
 * The three ways an item is RESOLVED, in the order the resolve bar draws them.
 * ⚠️ *Left voicemail* is not one of them and never joins this list: it is an
 * attempt that keeps the item open with its clock running (Josh's D6), so the
 * card shows it beside the resolutions, never among them.
 */
export const RESOLVING_HOWS: readonly ResolveHow[] = ["called", "texted", "no_action"];

/** "Called 12 · No action needed 3" — the resolving hows that happened, in
 *  the bar's order. An unknown how the gateway grows later is listed after
 *  them under its own name rather than dropped. */
export function howBreakdown(byHow: SlaReport["byHow"]): { how: string; label: string; n: number }[] {
  const out: { how: string; label: string; n: number }[] = [];
  const seen = new Set<string>();
  for (const how of RESOLVING_HOWS) {
    seen.add(how);
    const n = Number(byHow?.[how]) || 0;
    if (n > 0) out.push({ how, label: HOW_LABEL[how], n });
  }
  for (const [how, raw] of Object.entries(byHow ?? {})) {
    if (seen.has(how) || how === "left_vm") continue;
    const n = Number(raw) || 0;
    if (n > 0) out.push({ how, label: HOW_LABEL[how as ResolveHow] ?? how, n });
  }
  return out;
}

/** A rep's hows as labels, in the bar's order, never *Left voicemail*. */
export function howLabels(hows: readonly string[]): string {
  const order = (h: string) => {
    const i = RESOLVING_HOWS.indexOf(h as ResolveHow);
    return i < 0 ? RESOLVING_HOWS.length : i;
  };
  return [...new Set(hows)]
    .filter((h) => h !== "left_vm")
    .sort((a, b) => order(a) - order(b))
    .map((h) => HOW_LABEL[h as ResolveHow] ?? h)
    .join(", ");
}

/**
 * Who resolved it, by name. The access list names most people; anybody it does
 * not — somebody who has since left, whose resolutions are still history — is
 * named from their email rather than shown as a bare address.
 */
export function repNames(config: AccessConfig | null | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!config) return map;
  // Processors first: their profile carries the name somebody typed.
  for (const p of processorPeople(config)) map.set(p.email, p.name);
  for (const p of managerPeople(config)) if (!map.has(p.email)) map.set(p.email, p.name);
  return map;
}

export function repName(email: string, names: Map<string, string>): string {
  const key = String(email || "").trim().toLowerCase();
  if (!key) return "Unknown";
  return names.get(key) || prettyName(key);
}

/** "92%" · "—" when nothing was resolved: a share of nothing is not 0%. */
export function pct(p: number | null | undefined): string {
  return p == null || !Number.isFinite(p) ? "—" : `${p}%`;
}

/** The counted median, or "—" — never "0m" for an empty window. */
export function medianLabel(ms: number | null | undefined): string {
  return ms == null || !Number.isFinite(ms) ? "—" : formatWait(ms);
}
