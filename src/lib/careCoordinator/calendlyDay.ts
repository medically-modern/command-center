/**
 * One Eastern day's Calendly bookings, through the gateway.
 *
 * Welcome-call bookings exist in Calendly and NOWHERE ELSE — the Welcome Call
 * board carries no booking column, and the intake mirror on Profile Send Off is
 * the intake call's alone (CLAUDE.md §5.15, §5.26). So unlike every other read
 * on the Care Coordinator page, this one does not go to monday.
 *
 * ⚠️ It does not go to Calendly from the browser either, and must not be
 * "simplified" to. Calendly needs a Personal Access Token; bundling one would
 * put a live credential in a public JS file, which is the §10 problem the
 * gateway exists to undo rather than repeat. The chain is:
 *
 *     browser --(Google identity)--> gateway --(service token)--> dtc-mm-form-api --> Calendly
 *
 * The gateway (`services/monday-gateway/calendlyDay.mjs`) verifies the employee
 * and caches each day briefly; the form service owns the Calendly credential.
 */
import { MONDAY_GATEWAY_BASE, mondayIdentityHeaders } from "@/lib/shared/mondayEndpoint";

export interface CalendlyBooking {
  kind: "intake" | "welcome";
  eventUri: string;
  eventName: string;
  /** UTC ISO 8601. Convert with `scheduleEntries.etPartsOf` — never render raw. */
  startTime: string;
  endTime: string;
  name: string;
  email: string;
  timezone: string;
  rescheduleUrl: string;
}

export interface CalendlyDayResult {
  /** False when the read failed. Callers must not render an empty day as "no
   *  bookings" — see below. */
  ok: boolean;
  bookings: CalendlyBooking[];
  /** Set when `ok` is false, or when a requested kind could not be resolved. */
  error: string | null;
}

/** Is there a gateway to ask at all? False in a direct (no-gateway) build. */
export function calendlyDayAvailable(): boolean {
  return MONDAY_GATEWAY_BASE.length > 0;
}

/**
 * Bookings for one Eastern day.
 *
 * ⚠️ **AN EMPTY DAY AND A FAILED READ ARE DIFFERENT ANSWERS**, and the caller
 * has to be able to tell them apart. "No welcome calls today" is something a
 * coordinator acts on by not calling anybody; a Calendly outage rendered as an
 * empty day is that same inaction on a day full of appointments, with nothing
 * on screen saying so. Hence `{ok, error}` rather than a bare array — the same
 * contract `directoryApi.lookupDirectory` carries, for the same reason.
 */
export async function fetchCalendlyDay(
  date: string,
  kinds: ("intake" | "welcome")[] = ["welcome"],
): Promise<CalendlyDayResult> {
  if (!calendlyDayAvailable()) {
    return { ok: false, bookings: [], error: "No gateway is configured in this build." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !kinds.length) {
    return { ok: false, bookings: [], error: "Bad request." };
  }

  try {
    const url = `${MONDAY_GATEWAY_BASE}/calendly/day?date=${encodeURIComponent(date)}`
      + `&kinds=${encodeURIComponent(kinds.join(","))}`;
    const res = await fetch(url, { headers: { ...mondayIdentityHeaders() } });
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      bookings?: CalendlyBooking[];
      unresolved?: { kind: string; error: string }[];
      error?: string;
    } | null;

    if (!res.ok || !json?.ok) {
      return {
        ok: false,
        bookings: [],
        error: json?.error || `Calendly read failed (HTTP ${res.status}).`,
      };
    }

    // A kind that could not be resolved contributes no bookings, so without
    // this the day would read as genuinely empty for that half.
    const unresolved = json.unresolved ?? [];
    return {
      ok: true,
      bookings: json.bookings ?? [],
      error: unresolved.length
        ? `Calendly could not resolve: ${unresolved.map((u) => `${u.kind} (${u.error})`).join("; ")}`
        : null,
    };
  } catch (e) {
    return { ok: false, bookings: [], error: e instanceof Error ? e.message : String(e) };
  }
}
