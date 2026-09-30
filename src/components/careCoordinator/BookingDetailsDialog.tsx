/**
 * What a block on the day strip says when you click it.
 *
 * Brandon, 2026-09-17: *"If click the calendar item, popup box with the
 * following info: Time of call · Name · Patient Phone number · Email · Button
 * to take to profile (Grayed out if no profile)."*
 *
 * It replaces a straight navigation. A 10-minute block is ~60px wide and
 * carries a time and a stacked name with both lines usually truncated, so the
 * strip could show WHEN and roughly WHO and nothing else — and clicking it
 * committed the coordinator to leaving the page to find out the rest. The
 * popup is the cheap version of that question.
 *
 * ⚠️ **"Grayed out if no profile" IS THE EXISTING JOIN, not a new rule.** A
 * booking is resolved to a board item by its Calendly event URI or the
 * invitee's email, and a booking made under an address the board does not hold
 * matches neither (§5.15 — the same single join the monday mirror depends on).
 * `scheduleEntries` already reports that as `href: null`, and it is deliberately
 * NOT guessed: linking the wrong chart on a live call is worse than not
 * linking. The phone comes from the same match, so the two are blank together —
 * which is why the disabled button says WHY rather than just being dead.
 */
import { useState } from "react";
import { CalendarClock, ExternalLink, Mail, NotebookPen, Phone, User } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { displayTime } from "@/lib/scheduledCalls/workflow";
import type { ScheduleEntry } from "@/lib/careCoordinator/scheduleEntries";
import { formatPhoneNice } from "@/lib/shared/phoneDisplay";
import { DialPatientDialog } from "@/components/shared/DialPatientDialog";
import { cn } from "@/lib/utils";

/** "Thu, Sep 17" — the day, for a popup that can be opened on any day. */
function dayLabel(ymd: string): string {
  if (!ymd) return "";
  return new Date(`${ymd}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short", month: "short", day: "numeric",
  });
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden>{icon}</span>
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">{label}</div>
        <div className="break-words text-sm font-medium">{children}</div>
      </div>
    </div>
  );
}

/** A value we do not have. Said in words, never left as an empty line. */
const Missing = ({ children }: { children: React.ReactNode }) => (
  <span className="font-normal text-muted-foreground">{children}</span>
);

export function BookingDetailsDialog({
  entry, onOpenChange, onOpenProfile, onLogAttempt,
}: {
  /** The clicked block, or null when the popup is closed. */
  entry: ScheduleEntry | null;
  onOpenChange: (open: boolean) => void;
  onOpenProfile: (href: string) => void;
  /**
   * Open the page's attempt form for this booking's patient — during the call
   * (the dial popup's button) and after it (the button under Open profile).
   * A scheduled call is the one the coordinator makes MOST, and until
   * 2026-09-25 this popup could dial and then offered nowhere to say what
   * happened (Josh: *"make sure log call attempt here is wired up to work
   * post and during call"*). Only offered when the booking resolved to a
   * board item — there is no patient to write against otherwise, the same
   * reason Open profile grays out.
   */
  onLogAttempt?: (entry: ScheduleEntry) => void;
}) {
  const kindLabel = entry?.kind === "welcome" ? "Welcome call" : "Intake call";
  /** The number being dialled from this popup, or null. Rendered INSIDE the
   *  popup's content (Radix's nested-dialog pattern), so closing the booking
   *  closes the dial popup with it — the call itself carries on in the
   *  app-wide overlay. */
  const [dialing, setDialing] = useState<string | null>(null);
  return (
    <Dialog open={entry !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        {entry && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base">
                <CalendarClock className="h-4 w-4 shrink-0 text-[color:var(--mm-teal)]" aria-hidden />
                {kindLabel}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3.5 pt-1">
              <Row icon={<CalendarClock className="h-4 w-4" />} label="Time of call">
                {entry.callTime
                  ? <>{displayTime(entry.callTime)} <span className="font-normal text-muted-foreground">ET · {dayLabel(entry.callDate)}</span></>
                  : <Missing>Booked this day, no time on file</Missing>}
              </Row>

              <Row icon={<User className="h-4 w-4" />} label="Name">{entry.name}</Row>

              {/* ⚠️ Both of these are blank for exactly the same reason — the
                  booking matched no board row — so they say so in their own
                  words rather than rendering an empty line the coordinator has
                  to interpret. */}
              <Row icon={<Phone className="h-4 w-4" />} label="Patient phone">
                {/* ⚠️ A button that dials in the Command Center, never a
                    `tel:` link — that handed the call to the RingCentral app,
                    or to nothing at all on a machine without it (§5.50). */}
                {entry.phone
                  ? (
                    <button
                      type="button"
                      className="text-[color:var(--mm-teal)] hover:underline"
                      title={`Call ${formatPhoneNice(entry.phone)} from the Command Center`}
                      onClick={() => setDialing(entry.phone)}
                    >
                      {formatPhoneNice(entry.phone)}
                    </button>
                  )
                  : entry.bookedPhone
                    /* Matched nobody, but the booking page collected a number
                       (§5.30l): shown so the coordinator has it, not dialled
                       from here — there is no chart to log the call against. */
                    ? <span>{formatPhoneNice(entry.bookedPhone)} <Missing>(given on the booking)</Missing></span>
                    : <Missing>Not on file</Missing>}
              </Row>

              <Row icon={<Mail className="h-4 w-4" />} label="Email">
                {entry.email
                  ? <a className="break-all text-[color:var(--mm-teal)] hover:underline" href={`mailto:${entry.email}`}>{entry.email}</a>
                  : <Missing>Not on the booking</Missing>}
              </Row>
            </div>

            <button
              type="button"
              disabled={!entry.href}
              onClick={() => { if (entry.href) onOpenProfile(entry.href); }}
              className={cn(
                "mt-4 flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                entry.href
                  ? "bg-[color:var(--mm-teal)] text-white hover:opacity-90"
                  : "cursor-not-allowed border bg-muted text-muted-foreground",
              )}
            >
              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
              {entry.href ? "Open profile" : "No profile to open"}
            </button>
            {onLogAttempt && entry.itemId && (
              <button
                type="button"
                onClick={() => onLogAttempt(entry)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700"
              >
                <NotebookPen className="h-4 w-4 shrink-0" aria-hidden />
                Log call attempt
              </button>
            )}
            {/* ⚠️ A NAME match is offered to CHECK, never taken as the match:
                no phone, no Log call attempt, and it says why (Brandon,
                2026-09-29 — a patient who booked "with completely different
                info than we have"). */}
            {!entry.href && entry.suggested && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
                <p className="leading-snug">
                  <b>Possible match by name: {entry.suggested.name}</b> on the Welcome Call queue. Their
                  record doesn&apos;t have this booking&apos;s email, so confirm it&apos;s the same person
                  (date of birth, phone) before you call.
                </p>
                <button
                  type="button"
                  onClick={() => onOpenProfile(entry.suggested!.href)}
                  className="mt-1.5 inline-flex items-center gap-1.5 font-semibold underline hover:no-underline"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden /> Check {entry.suggested.name}&apos;s profile
                </button>
              </div>
            )}
            {!entry.href && (
              <p className="text-center text-[11px] leading-snug text-muted-foreground">
                {entry.suggested
                  ? "Not linked: the booking's email and phone aren't on any Welcome Call record."
                  : entry.kind === "welcome"
                    ? "No one on the Welcome Call queue has this booking's email, phone or name — they may have booked with details we don't hold (a caregiver's email or number, a different name). Search for them by name."
                    : "This booking isn't matched to a patient on the board — usually because it was made under an email address and phone number we don't hold for them."}
              </p>
            )}
            {dialing && (
              <DialPatientDialog
                open
                phone={dialing}
                name={entry.name}
                onClose={() => setDialing(null)}
                /* The during-call half: the dial popup's own Log call attempt
                   button (DialPatientDialog renders one only when this is
                   passed). It closes the dial popup — the call carries on in
                   the app-wide overlay — and opens the attempt form. */
                onLogAttempt={entry.itemId && onLogAttempt ? () => { setDialing(null); onLogAttempt(entry); } : undefined}
              />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default BookingDetailsDialog;
