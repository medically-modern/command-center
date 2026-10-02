/**
 * The top-right heads-up card for a booked call ten minutes out (Josh,
 * 2026-10-02) — who the call is with and when, beside the incoming-call cards.
 *
 * Drawn INSIDE `IncomingCallHost`'s top-right stack (outside the router, so
 * Open goes through `reminderStore.open`), under any ringing call,
 * so a call arriving while a reminder is up pushes it down rather than landing
 * on top of it. What goes in the store, and for whom, is `ScheduledCallHost`'s
 * call — this only draws it. The store is filled only for people who hold the
 * Care Coordinator role, so for everyone else this renders nothing.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { CalendarClock, ExternalLink, X } from "lucide-react";
import { reminderStore, untilLabel, type CallReminder } from "@/lib/scheduledCalls/reminders";
import { displayTime, nowMinutesEt } from "@/lib/scheduledCalls/workflow";
import { fmtPhone } from "@/lib/assignedPatients/format";

const KIND_LABEL: Record<CallReminder["kind"], string> = { intake: "Intake call", welcome: "Welcome call" };

export default function ReminderCards() {
  const reminders = useSyncExternalStore(reminderStore.subscribe, reminderStore.get, reminderStore.get);
  const [now, setNow] = useState(() => nowMinutesEt());
  useEffect(() => {
    if (!reminders.length) return;
    setNow(nowMinutesEt());
    const id = setInterval(() => setNow(nowMinutesEt()), 15_000);
    return () => clearInterval(id);
  }, [reminders.length]);

  return (
    <>
      {reminders.map((r) => (
        <ReminderCard key={r.key} reminder={r} nowMinutes={now} />
      ))}
    </>
  );
}

function ReminderCard({ reminder: r, nowMinutes }: { reminder: CallReminder; nowMinutes: number }) {
  const when = untilLabel(r.callTime, nowMinutes);
  return (
    <div
      className="w-80 overflow-hidden rounded-xl border border-violet-500/40 bg-card shadow-xl pointer-events-auto"
      role="alert"
      data-testid="call-reminder"
    >
      <div className="flex items-center gap-2.5 bg-gradient-navy px-4 py-3 text-white">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-500/25 text-violet-200">
          <CalendarClock className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{r.name || "Booked call"}</p>
          <p className="truncate text-[11px] opacity-80">
            {KIND_LABEL[r.kind]} · {displayTime(r.callTime)} · {when}
          </p>
        </div>
        <button
          type="button"
          onClick={() => reminderStore.dismiss(r.key)}
          title="Dismiss"
          aria-label="Dismiss reminder"
          className="shrink-0 rounded p-1 hover:bg-white/10"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2 p-3">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {r.phone ? fmtPhone(r.phone) : "No phone on file"}
        </p>
        <button
          type="button"
          onClick={() => reminderStore.open(r)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-700"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open
        </button>
      </div>
    </div>
  );
}
