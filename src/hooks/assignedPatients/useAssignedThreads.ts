/**
 * The Assigned Patients inbox: RingCentral's SMS threads on the MM number,
 * narrowed to the numbers assigned to one rep, with patient names resolved from
 * Monday and per-rep unread computed locally.
 *
 * Three sources have to agree, and each owns exactly one thing:
 *   RingCentral — the conversations and their messages
 *   the gateway — which numbers belong to this rep, and when they last read one
 *   Monday      — the patient's name (the assignment store holds no PHI)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fetchInbox, type AssignedInboxThread, type InboxThread } from "@/lib/assignedPatients/assignmentsApi";
import { fetchPatientsByItemIds, type PatientRef } from "@/lib/assignedPatients/patientLookup";

const POLL_INTERVAL = 20_000;

export interface AssignedThread extends AssignedInboxThread {
  patient: PatientRef | null;
  /** Newest inbound message is newer than this rep's last-read stamp. */
  unread: boolean;
}

/** A thread is unread when the patient has said something since the rep last
 *  opened it. An OUTBOUND message never marks a thread unread — otherwise a rep
 *  would un-read their own reply the moment they sent it. */
export function isUnread(lastInboundTime: string, lastReadAt: string | null): boolean {
  if (!lastInboundTime) return false;
  if (!lastReadAt) return true;
  return lastInboundTime > lastReadAt;
}

export interface UseAssignedThreadsResult {
  threads: AssignedThread[];
  /** Conversations on the MM number that belong to nobody yet. The SERVER
   *  returns these for managers only — a processor never receives them. */
  unassigned: InboxThread[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Clear the unread dot locally so the sidebar reacts before the next poll. */
  markReadLocally: (phone: string) => void;
}

export function useAssignedThreads(repEmail: string): UseAssignedThreadsResult {
  const [threads, setThreads] = useState<AssignedThread[]>([]);
  const [unassigned, setUnassigned] = useState<InboxThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  // Poll callbacks close over the latest rep without restarting the interval.
  const repRef = useRef(repEmail);
  repRef.current = repEmail;

  const load = useCallback(async () => {
    const rep = repRef.current;
    if (!rep) {
      if (mounted.current) {
        setThreads([]);
        setUnassigned([]);
        setLoading(false);
      }
      return;
    }
    try {
      // Already filtered to this rep by the gateway — the shared inbox never
      // reaches the browser, so there is nothing to narrow here.
      const inbox = await fetchInbox(rep);
      const patients = await fetchPatientsByItemIds(inbox.threads.map((t) => t.assignment.mondayItemId));
      const byItemId = new Map(patients.map((p) => [p.itemId, p]));

      if (!mounted.current) return;
      setThreads(
        inbox.threads.map((t) => ({
          ...t,
          patient: byItemId.get(t.assignment.mondayItemId) ?? null,
          unread: isUnread(t.lastInboundTime, t.assignment.lastReadAt),
        })),
      );
      setUnassigned(inbox.unassigned ?? []);
      setError(null);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    setLoading(true);
    void load();
    const id = setInterval(() => void load(), POLL_INTERVAL);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
  }, [load, repEmail]);

  const markReadLocally = useCallback((phone: string) => {
    setThreads((prev) => prev.map((t) => (t.phone === phone ? { ...t, unread: false } : t)));
  }, []);

  return { threads, unassigned, loading, error, refresh: load, markReadLocally };
}
