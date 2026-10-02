/**
 * The ten-minute warning before a booked call — intake (the monday mirror) and,
 * since 2026-10-02, welcome (Calendly through the gateway).
 *
 * Josh, 2026-10-02: a distinctly different ring, twice, ten minutes out, and a
 * card in the upper right saying who the call is with and when, in place of
 * the silent top-centre toast it used to raise. The sound is `lib/scheduledCalls/reminderChime`, the card `ReminderCards` (drawn
 * in the incoming-call stack), the rules `lib/scheduledCalls/reminders`.
 *
 * Mounted app-wide next to IncomingCallHost, not on the Care Coordinator page,
 * for the same reason: a rep is working somewhere else when the call comes due,
 * and a reminder that only fires on the page you're already looking at is a
 * reminder nobody needs.
 *
 * ⚠️ Gated to people who actually hold the role. Everyone else — managers
 * included — is doing something different, and an alert about a call you are
 * not making is noise that teaches people to ignore the alert that matters.
 * Managers get the queue on the page, not the interruption.
 */
import { intakeProfileHref } from "@/lib/profile/intakeLink";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAccessContext } from "@/components/AccessProvider";
import { fetchScheduledCalls } from "@/lib/scheduledCalls/mondayApi";
import { calendlyDayAvailable, fetchCalendlyDay } from "@/lib/careCoordinator/calendlyDay";
import {
  callsOn, dueForReminder, minutesOfDay, nowMinutesEt,
  type ScheduledCall,
} from "@/lib/scheduledCalls/workflow";
import { claimChime, reminderStore, welcomeSlot, type CallReminder } from "@/lib/scheduledCalls/reminders";
import { playReminderChime, primeReminderChime } from "@/lib/scheduledCalls/reminderChime";
import { etToday } from "@/lib/masheke/etDate";

/** The Care Coordinator role. The id predates the rename (config.ts) and is
 *  what access.json assigns, so it is the right thing to gate on. */
const ROLE_ID = "scheduledCalls";

/**
 * How often the bookings are re-read.
 *
 * Bookings move in real time — a patient can book a 3pm slot at 11am, or cancel
 * an hour beforehand — so a stale view either misses a call or sends a rep to
 * ring somebody who called off. Two minutes is well inside the ten-minute lead,
 * which means a cancellation always lands before the reminder it should
 * suppress. (The welcome half is cached a minute at the gateway, so every
 * open tab polling it costs Calendly at most one read a minute.)
 */
const POLL_MS = 120_000;

/** Re-evaluate the lead window often enough that a reminder is never late. */
const TICK_MS = 30_000;

/** A welcome booking as the host needs it. */
type WelcomeSlot = ReturnType<typeof welcomeSlot>;

export default function ScheduledCallHost() {
  const { access } = useAccessContext();
  const navigate = useNavigate();

  const holdsRole =
    access.type === "processor" && access.profile.roles.includes(ROLE_ID);

  const [calls, setCalls] = useState<ScheduledCall[]>([]);
  const [welcome, setWelcome] = useState<WelcomeSlot[]>([]);
  const [nowMinutes, setNowMinutes] = useState(() => nowMinutesEt());
  const announced = useRef<Set<string>>(new Set());
  const day = useRef(etToday());

  // The cards draw outside the router; Open navigates through this.
  useEffect(() => {
    reminderStore.setNavigator(navigate);
    return () => reminderStore.setNavigator(null);
  }, [navigate]);

  // A browser keeps audio suspended until the page has seen a gesture, so the
  // chime's path is readied on the first click or key — long before a call.
  useEffect(() => {
    if (!holdsRole) return;
    const prime = () => primeReminderChime();
    window.addEventListener("pointerdown", prime, { once: true });
    window.addEventListener("keydown", prime, { once: true });
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, [holdsRole]);

  // Not a role holder (or no longer one): no cards from here.
  useEffect(() => {
    if (!holdsRole) reminderStore.clear();
  }, [holdsRole]);

  // Poll the bookings. Intake from monday — the mirror the Calendly webhook
  // keeps current; welcome from Calendly through the gateway, never from the
  // browser directly (that would need the Calendly token here).
  useEffect(() => {
    if (!holdsRole) return;
    let alive = true;

    const read = async () => {
      try {
        const rows = await fetchScheduledCalls();
        if (alive) setCalls(rows);
      } catch {
        // Silent by design: a failed poll is retried in two minutes, and a
        // notice about it would fire on every laptop that closed its lid.
      }
      if (calendlyDayAvailable()) {
        const res = await fetchCalendlyDay(etToday(), ["welcome"]);
        // A failed read keeps the last good list rather than emptying it — an
        // outage must not cancel reminders already known about.
        if (alive && res.ok) setWelcome(res.bookings.map(welcomeSlot));
      }
    };

    void read();
    const id = setInterval(read, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [holdsRole]);

  useEffect(() => {
    if (!holdsRole) return;
    const id = setInterval(() => {
      const n = nowMinutesEt();
      setNowMinutes(n);
      reminderStore.expire(n, minutesOfDay);
      // A tab left open overnight must not carry yesterday's announcements
      // into today, or the first call of the morning goes unannounced.
      const t = etToday();
      if (t !== day.current) {
        day.current = t;
        announced.current = new Set();
        reminderStore.clear();
      }
    }, TICK_MS);
    return () => clearInterval(id);
  }, [holdsRole]);

  useEffect(() => {
    if (!holdsRole) return;
    const due: CallReminder[] = [];
    for (const c of callsOn(calls, day.current)) {
      const key = `i:${c.id}`;
      if (announced.current.has(key) || !dueForReminder(c, nowMinutes)) continue;
      due.push({
        key, kind: "intake", name: c.name, phone: c.phone, callTime: c.callTime,
        // Routed by the row's group (intakeLink.ts) — a Partial Leads booking
        // must not open under the Completed selector (2026-09-25).
        href: intakeProfileHref(c.id, c.groupId, "from=care-coordinator"),
      });
    }
    for (const w of callsOn(welcome, day.current)) {
      if (announced.current.has(w.key) || !dueForReminder(w, nowMinutes)) continue;
      // A welcome booking is matched to its chart on the dashboard (§5.30l),
      // not here — Open goes to the dashboard, where its card is.
      due.push({ key: w.key, kind: "welcome", name: w.name, phone: w.phone, callTime: w.callTime, href: "/care-coordinator" });
    }
    if (!due.length) return;
    for (const r of due) {
      announced.current.add(r.key);
      reminderStore.add(r);
    }
    // One ring for the batch, and only from the first tab to claim it. Every
    // key is claimed (map, not some) — a short-circuit would leave the second
    // key for another tab to claim and ring for again.
    const claimed = due.map((r) => claimChime(`${day.current}|${r.key}`));
    if (claimed.includes(true)) void playReminderChime();
  }, [calls, welcome, nowMinutes, holdsRole]);

  return null;
}
