/**
 * The ten-minute warning before a booked intake call.
 *
 * Mounted app-wide next to IncomingCallHost, not on the Scheduled Calls page,
 * for the same reason: a rep is working somewhere else when the call comes due,
 * and a reminder that only fires on the page you're already looking at is a
 * reminder nobody needs.
 *
 * ⚠️ Gated to people who actually hold the role. Everyone else — managers
 * included — is doing something different, and an alert about a call you are
 * not making is noise that teaches people to ignore the toast that matters.
 * Managers get the queue on the page, not the interruption.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Phone } from "lucide-react";
import { toast } from "sonner";

import { useAccessContext } from "@/components/AccessProvider";
import { fetchScheduledCalls } from "@/lib/scheduledCalls/mondayApi";
import {
  callsOn, dueForReminder, displayTime, minutesUntil, nowMinutesEt,
  type ScheduledCall,
} from "@/lib/scheduledCalls/workflow";
import { etToday } from "@/lib/masheke/etDate";

const ROLE_ID = "scheduledCalls";

/**
 * How often the board is re-read.
 *
 * Bookings move in real time — a patient can book a 3pm slot at 11am, or cancel
 * an hour beforehand — so a stale view either misses a call or sends a rep to
 * ring somebody who called off. Two minutes is well inside the ten-minute lead,
 * which means a cancellation always lands before the reminder it should
 * suppress.
 */
const POLL_MS = 120_000;

/** Re-evaluate the lead window often enough that a reminder is never late. */
const TICK_MS = 30_000;

export default function ScheduledCallHost() {
  const { access } = useAccessContext();
  const navigate = useNavigate();

  const holdsRole =
    access.type === "processor" && access.profile.roles.includes(ROLE_ID);

  const [calls, setCalls] = useState<ScheduledCall[]>([]);
  const [nowMinutes, setNowMinutes] = useState(() => nowMinutesEt());
  const announced = useRef<Set<string>>(new Set());
  const day = useRef(etToday());

  // Poll the board. Monday is the mirror the Calendly webhook keeps current,
  // so this reads one source rather than reaching for Calendly from a browser
  // that must never hold that token.
  useEffect(() => {
    if (!holdsRole) return;
    let alive = true;

    const read = async () => {
      try {
        const rows = await fetchScheduledCalls();
        if (alive) setCalls(rows);
      } catch {
        // Silent by design: a failed poll is retried in two minutes, and a
        // toast about it would fire on every laptop that closed its lid.
      }
    };

    void read();
    const id = setInterval(read, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [holdsRole]);

  useEffect(() => {
    if (!holdsRole) return;
    const id = setInterval(() => {
      setNowMinutes(nowMinutesEt());
      // A tab left open overnight must not carry yesterday's announcements
      // into today, or the first call of the morning goes unannounced.
      const t = etToday();
      if (t !== day.current) {
        day.current = t;
        announced.current = new Set();
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [holdsRole]);

  const open = useCallback((c: ScheduledCall) => {
    navigate(`/unverified-referrals?patientId=${encodeURIComponent(c.id)}&from=scheduled-calls`);
  }, [navigate]);

  useEffect(() => {
    if (!holdsRole) return;
    for (const c of callsOn(calls, day.current)) {
      if (announced.current.has(c.id)) continue;
      if (!dueForReminder(c, nowMinutes)) continue;
      announced.current.add(c.id);

      const mins = minutesUntil(c, nowMinutes) ?? 0;
      toast(`Call ${c.name} ${mins <= 0 ? "now" : `in ${mins} min`}`, {
        description: `${displayTime(c.callTime)} · ${c.phone || "no phone on file"}`,
        duration: 60_000,
        icon: <Phone className="h-4 w-4" />,
        action: { label: "Open", onClick: () => open(c) },
      });
    }
  }, [calls, nowMinutes, holdsRole, open]);

  return null;
}
