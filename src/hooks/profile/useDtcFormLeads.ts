import { useEffect, useState } from "react";
import { fetchDtcFormLeads, hasToken } from "@/lib/profile/mondayApi";
import type { DtcFormLead } from "@/lib/profile/dtcFormFlag";

/** The flag is slow-moving advisory data — no need to ride the queue's 15s
 *  cadence, and the form groups only grow. */
const POLL_MS = 60_000;

/**
 * The two DTC form groups, slimmed to identity fields, for the Already In
 * System page's "patient has filled out a DTC form" flag (dtcFormFlag.ts).
 *
 * Deliberately NOT folded into useMondayPatients: form items must never enter
 * a queue list — `profileReferralRole` would route a flag-"Yes" form row into
 * the Already In System sidebar while useRoleCounts still counts it as
 * Unverified, the §5.8 sidebar-vs-burndown drift. Advisory display only, so a
 * failed fetch degrades to "no flag" (with a console error) rather than
 * blocking the page.
 */
export function useDtcFormLeads(enabled: boolean): DtcFormLead[] {
  const [leads, setLeads] = useState<DtcFormLead[]>([]);

  useEffect(() => {
    if (!enabled || !hasToken()) return;
    let alive = true;
    const load = () =>
      fetchDtcFormLeads()
        .then((l) => {
          if (alive) setLeads(l);
        })
        .catch((e) => console.error("[useDtcFormLeads] fetch failed", e));
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [enabled]);

  return leads;
}
