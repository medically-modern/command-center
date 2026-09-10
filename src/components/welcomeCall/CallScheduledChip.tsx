/**
 * "Call scheduled — Thu, Sep 12 · 2:00 PM ET", with a link to the booking.
 *
 * Brandon's 2026-09-09 ask, finally buildable. It was built once and REVERTED
 * (CLAUDE.md §5.31b) because the only booking data reachable then was the
 * INTAKE call's mirror on Profile Send Off, and rendering that under "Call
 * scheduled" on this page reads as the welcome call — a different appointment,
 * silently wrong. This reads the welcome call itself, out of Calendly.
 *
 * ⚠️ **THREE STATES, NOT TWO.** Booked, genuinely-not-booked, and
 * could-not-check are different answers:
 *   · booked            → the chip
 *   · not booked        → nothing at all
 *   · could not check   → a muted note saying so
 * A failed lookup rendered as silence is indistinguishable from "no
 * appointment", and "you're not booked in" is the one wrong answer a rep acts
 * on — the same rule `StaleDataNotice` and `fetchCalendlyDay` exist for.
 *
 * ⚠️ A patient with **no email on the board** renders nothing, deliberately,
 * and that is a judgement rather than an oversight. Email is the only join
 * Calendly gives us (`calendlyPatientRules.normalizeEmail` says why a name
 * cannot be one), so those patients are strictly unanswerable — but measured on
 * 2026-09-10, every row that has ever reached the booking flow carried an email
 * (6 of 6, the one real booking included), because the flow is only reachable
 * through an address we already hold. Printing "no email on file" on the ~5 in 6
 * live patients who have neither an address nor an appointment would be noise
 * on almost every header, to flag a case the data says does not arise. The hook
 * still reports `noEmail` for any surface that wants to.
 */
import { CalendarClock, ExternalLink } from "lucide-react";

import { formatBookingWhen } from "@/lib/welcomeCall/calendlyBooking";
import { useWelcomeCallBooking } from "@/hooks/welcomeCall/useWelcomeCallBooking";

export function CallScheduledChip({ email }: { email: string | undefined | null }) {
  const { booking, error, loading, available } = useWelcomeCallBooking(email);

  // No gateway in this build: there is no question we could have asked, so
  // there is nothing honest to report either way.
  if (!available) return null;

  if (error) {
    return (
      <span
        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        title={error}
      >
        <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
        Couldn&rsquo;t check Calendly
      </span>
    );
  }

  // Silent while loading rather than showing a skeleton: the chip is absent for
  // most patients anyway, so a placeholder flashing on every header would read
  // as something appearing and then being taken away.
  if (loading || !booking) return null;

  const when = formatBookingWhen(booking.startTime);

  const label = (
    <>
      <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="normal-case">
        Call scheduled &middot; {when}
      </span>
    </>
  );

  const chip =
    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider " +
    "bg-emerald-100 text-emerald-800 border-emerald-300 " +
    "dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800";

  // ⚠️ `rescheduleUrl` is the ONLY browser-openable link Calendly hands us.
  // `eventUri` is an API URL that answers 401 JSON to a person, which is why
  // §5.31b records the mockup's "View Calendly booking" link as unbuildable —
  // it is buildable, just not out of that field.
  if (!booking.rescheduleUrl) {
    return <span className={chip}>{label}</span>;
  }

  return (
    <a
      href={booking.rescheduleUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`${chip} hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2`}
      title={`Open ${booking.name || "this patient"}'s booking in Calendly`}
    >
      {label}
      <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden="true" />
    </a>
  );
}
