/**
 * One patient's welcome-call booking, through the gateway.
 *
 * A welcome call exists in Calendly and NOWHERE ELSE — the Welcome Call board
 * carries no booking column, and the intake mirror on Profile Send Off is the
 * INTAKE call's alone (CLAUDE.md §5.15, §5.26, §5.30b). That is exactly why the
 * chip was built once and reverted: rendering the intake mirror under "Call
 * scheduled" reads as the welcome call, which is a different appointment.
 *
 * ⚠️ It does not go to Calendly from the browser, and must not be "simplified"
 * to. Calendly needs a Personal Access Token; bundling one would put a live
 * credential in a public JS file (§10). The chain is the one §5.30b built:
 *
 *     browser --(Google identity)--> gateway --(service token)--> dtc-mm-form-api --> Calendly
 *
 * The gateway (`services/monday-gateway/calendlyPatient.mjs`) verifies the
 * employee, assembles a short forward window ONCE, and answers every patient
 * from that shared index.
 */
import { MONDAY_GATEWAY_BASE, mondayIdentityHeaders } from "@/lib/shared/mondayEndpoint";

export interface WelcomeCallBooking {
  eventUri: string;
  eventName: string;
  /** UTC ISO 8601. Render through `etPartsOf` — never raw (§5.15). */
  startTime: string;
  endTime: string;
  name: string;
  email: string;
  timezone: string;
  /** Calendly's own per-invitee page. ⚠️ The only browser-openable link there
   *  is — `eventUri` is an API URL that answers 401 JSON to a person (§5.31b),
   *  so never build a `calendly.com/...` link out of it. */
  rescheduleUrl: string;
}

export interface BookingLookup {
  /** False when we could not CHECK. Never render this as "not booked". */
  ok: boolean;
  booking: WelcomeCallBooking | null;
  error: string | null;
  /** The last day actually looked at, so the caller can say "through the 30th"
   *  rather than implying we checked forever. */
  through: string | null;
}

/** Is there a gateway to ask at all? False in a direct (no-gateway) build. */
export function welcomeCallBookingAvailable(): boolean {
  return MONDAY_GATEWAY_BASE.length > 0;
}

/**
 * The patient's welcome call, if they have one in the window.
 *
 * ⚠️ **THREE ANSWERS, NOT TWO**, and the caller has to keep them apart:
 *   · `{ok: true, booking}`        — booked, here it is
 *   · `{ok: true, booking: null}`  — genuinely nothing in the window
 *   · `{ok: false, error}`         — we could not check
 * Collapsing the third into the second tells a rep "not booked in" about a
 * patient who is, which is the one wrong answer that gets acted on. Same
 * contract `directoryApi.lookupDirectory` and `fetchCalendlyDay` carry.
 *
 * A patient with no email on file never gets here — see `useWelcomeCallBooking`.
 */
export async function fetchWelcomeCallBooking(email: string): Promise<BookingLookup> {
  if (!welcomeCallBookingAvailable()) {
    return { ok: false, booking: null, error: "No gateway is configured in this build.", through: null };
  }
  const addr = (email ?? "").trim();
  if (!addr) {
    return { ok: false, booking: null, error: "No email on file for this patient.", through: null };
  }

  try {
    const url = `${MONDAY_GATEWAY_BASE}/calendly/patient?email=${encodeURIComponent(addr)}`;
    const res = await fetch(url, { headers: { ...mondayIdentityHeaders() } });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      booking?: WelcomeCallBooking | null;
      through?: string;
      error?: string;
    } | null;

    if (!res.ok || !json?.ok) {
      return {
        ok: false,
        booking: null,
        error: json?.error || `Calendly lookup failed (HTTP ${res.status}).`,
        through: null,
      };
    }
    return { ok: true, booking: json.booking ?? null, error: null, through: json.through ?? null };
  } catch (e) {
    return { ok: false, booking: null, error: e instanceof Error ? e.message : String(e), through: null };
  }
}

export interface BookingsLookup {
  /** False when we could not CHECK — the map is then empty and MUST NOT be
   *  read as "nobody is booked". */
  ok: boolean;
  /** Normalised email → booking, or null for nothing booked in the window. */
  bookings: Map<string, WelcomeCallBooking | null>;
  error: string | null;
  through: string | null;
}

/**
 * Many patients' welcome calls in ONE request — the Care Coordinator
 * dashboard's read (§5.30). `POST /calendly/patients` answers every address
 * from the gateway's shared window index, so a column of forty patients costs
 * one round trip and no extra Calendly reads. Blank addresses are dropped
 * before sending: they can never be answered.
 */
export async function fetchWelcomeCallBookings(emails: string[]): Promise<BookingsLookup> {
  const empty = new Map<string, WelcomeCallBooking | null>();
  if (!welcomeCallBookingAvailable()) {
    return { ok: false, bookings: empty, error: "No gateway is configured in this build.", through: null };
  }
  const list = Array.from(new Set(emails.map((e) => (e ?? "").trim().toLowerCase()).filter((e) => e.includes("@"))));
  if (!list.length) return { ok: true, bookings: empty, error: null, through: null };

  try {
    const res = await fetch(`${MONDAY_GATEWAY_BASE}/calendly/patients`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...mondayIdentityHeaders() },
      body: JSON.stringify({ emails: list }),
    });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      bookings?: Record<string, WelcomeCallBooking | null>;
      through?: string;
      error?: string;
    } | null;
    if (!res.ok || !json?.ok) {
      return { ok: false, bookings: empty, error: json?.error || `Calendly lookup failed (HTTP ${res.status}).`, through: null };
    }
    const map = new Map<string, WelcomeCallBooking | null>();
    for (const [k, v] of Object.entries(json.bookings ?? {})) map.set(k, v ?? null);
    return { ok: true, bookings: map, error: null, through: json.through ?? null };
  } catch (e) {
    return { ok: false, bookings: empty, error: e instanceof Error ? e.message : String(e), through: null };
  }
}

/* ─── Rendering the time ─── */

/** Eastern `YYYY-MM-DD` for a real UTC instant. */
function etDay(at: Date): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

/**
 * "Thu, Sep 12 · 2:00 PM ET", or "Today · 2:00 PM ET" when it lands today.
 *
 * ⚠️ Always rendered in **Eastern**, never the browser's zone. Every other time
 * on these boards is Eastern wall clock (§5.15), so a rep reading "11:00 AM"
 * has to be able to compare it with a Next Action Date without doing timezone
 * arithmetic — and a rep travelling would otherwise see a different time for
 * the same appointment than the coordinator who booked it. The `ET` suffix is
 * there so the answer is unambiguous rather than merely correct.
 *
 * Unlike a monday date column, a Calendly `start_time` IS a real UTC instant,
 * so parsing it with `new Date` is right here — the trap §5.15 warns about is
 * parsing a NAIVE board string, which this is not.
 */
export function formatBookingWhen(startTime: string, now: Date = new Date()): string {
  const at = new Date(startTime);
  if (!startTime || Number.isNaN(at.getTime())) return "";

  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(at);

  const day = etDay(at);
  const today = etDay(now);
  // Tomorrow, as a LABEL: step the date parts in UTC so a DST boundary can't
  // shift it (the same reasoning `calendlyPatientRules.windowDates` carries).
  const [y, m, d] = today.split("-").map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);

  if (day === today) return `Today · ${time} ET`;
  if (day === tomorrow) return `Tomorrow · ${time} ET`;

  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", month: "short", day: "numeric",
  }).format(at);
  return `${when} · ${time} ET`;
}
