/**
 * "We called N · They called M" for the patient screen's Calls tab — the
 * patient's all-time call counts, from the SAME Postgres route the Care
 * Coordinator cards read (`POST /messaging/contact-totals`, §5.30i), so the two
 * screens can never show one patient two different numbers.
 *
 * Josh, 2026-09-24: *"i want to read this info from our post gres, see how many
 * times total ever weve called and theyve called us"*. The route counts out of
 * the call archive (§5.47) with FAXES left out, and touches RingCentral not at
 * all.
 *
 * This file only MERGES the per-number answers into one per patient: the
 * primary number and the Contacts block's alternate. The counting rule is the
 * gateway's (`contactTotalsRules.mjs`) and is never re-derived here.
 */
import type { ContactTotals } from "@/lib/assignedPatients/messagingApi";

/** The last ten digits — the key `useContactTotals` files every answer under.
 *  A number with fewer is one the gateway cannot hash, so it is never asked. */
export function callTotalsKey(raw: unknown): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

export interface PatientCallTotals {
  /** Our calls to the patient's numbers. */
  weCalled: number;
  /** Their calls to us. */
  theyCalled: number;
  total: number;
  /** One of OUR calls connected — somebody picked up (the route's own rule). */
  reached: boolean;
  /** Calls with the ALTERNATE number alone — already inside `total`. */
  altTotal: number;
}

export type CallTotalsState =
  /** Nothing to ask: no gateway in this build, or no usable number. */
  | { kind: "none" }
  /** At least one of the patient's numbers has not answered yet. */
  | { kind: "waiting" }
  /** The gateway answered but its call archive is not running — "we cannot
   *  say", which must never be drawn as zero. */
  | { kind: "off" }
  | { kind: "ready"; totals: PatientCallTotals };

/**
 * ⚠️ **All or nothing across the patient's numbers.** With a primary and an
 * alternate, the totals appear only once BOTH have answered — a total drawn
 * from one of two numbers under-reports, and an under-report reads as a fact.
 * ⚠️ A `null` count is the archive being off, never zero.
 */
export function patientCallTotals(
  byNumber: ReadonlyMap<string, ContactTotals>,
  primary: string,
  alternate: string,
  available: boolean,
): CallTotalsState {
  const pk = callTotalsKey(primary);
  let ak = callTotalsKey(alternate);
  if (ak === pk) ak = ""; // one number twice is one number
  if (!available || !pk) return { kind: "none" };
  const keys = ak ? [pk, ak] : [pk];
  const answers = keys.map((k) => byNumber.get(k));
  if (answers.some((a) => !a)) return { kind: "waiting" };
  const got = answers as ContactTotals[];
  if (got.some((a) => a.callsOut === null || a.callsIn === null)) return { kind: "off" };
  const weCalled = got.reduce((n, a) => n + (a.callsOut ?? 0), 0);
  const theyCalled = got.reduce((n, a) => n + (a.callsIn ?? 0), 0);
  const alt = ak ? byNumber.get(ak)! : null;
  return {
    kind: "ready",
    totals: {
      weCalled,
      theyCalled,
      total: weCalled + theyCalled,
      reached: got.some((a) => a.reachedByCall),
      altTotal: alt ? (alt.callsOut ?? 0) + (alt.callsIn ?? 0) : 0,
    },
  };
}

/** "Jun 18, 2026", in Eastern — every other date on these boards is Eastern
 *  wall clock (§5.15), and a UTC rendering moves an evening timestamp a day. */
export function formatSinceDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
