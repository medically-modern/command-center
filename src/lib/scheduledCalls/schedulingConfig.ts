/**
 * What the form backend says about the two Calendly event types — the live
 * intake link, and where each type takes a prefilled phone (§5.15, §5.30l).
 *
 * One source, read by two callers: `BookingLinkDialog` and the Care
 * Coordinator's "Copy booking link" button under the text box (Brandon,
 * 2026-10-02). Both must hand out the SAME link — the prefill on it is what
 * lets a booking find its way back to the patient's row (`bookingLink.ts`) —
 * so the read lives here and neither caller builds a link of its own.
 *
 * Cached for a few minutes, because a rep copying links down a column should
 * not ask the backend once per click. A failed read is NOT cached: the
 * fallback is used for that click and the next one asks again.
 */
import { bookingLinkFor, BOOKING_URLS, type BookingKind } from "./bookingLink";

export const SCHEDULING_ENDPOINT = "https://dtc-mm-form-api-production.up.railway.app/api/intake/scheduling";

export interface SchedulingConfig {
  /** The intake link as the backend reports it; BOOKING_URLS.intake when it can't be read. */
  intakeUrl: string;
  /** Per kind: "location" when that event type's only location is Calendly's
   *  "Phone call", else "" — see `bookingLinkFor`. */
  phoneParam: Record<BookingKind, string>;
}

export const FALLBACK_CONFIG: SchedulingConfig = {
  intakeUrl: BOOKING_URLS.intake,
  phoneParam: { intake: "", welcome: "" },
};

const TTL_MS = 5 * 60_000;
let cached: { at: number; value: Promise<SchedulingConfig> } | null = null;

/** Parse the endpoint's body. Anything missing falls back field by field. */
export function parseScheduling(d: unknown): SchedulingConfig {
  const o = (d ?? {}) as { enabled?: boolean; url?: unknown; phone_prefill?: unknown; welcome?: { phone_prefill?: unknown } };
  return {
    intakeUrl: o.enabled && typeof o.url === "string" && o.url ? o.url : BOOKING_URLS.intake,
    phoneParam: {
      intake: typeof o.phone_prefill === "string" ? o.phone_prefill : "",
      welcome: typeof o.welcome?.phone_prefill === "string" ? o.welcome.phone_prefill : "",
    },
  };
}

/** The config, from cache when fresh. Never rejects — the fallback is the answer to a failure. */
export function fetchSchedulingConfig(now = Date.now()): Promise<SchedulingConfig> {
  if (cached && now - cached.at < TTL_MS) return cached.value;
  const value = fetch(SCHEDULING_ENDPOINT)
    .then((r) => r.json())
    .then(parseScheduling)
    .catch(() => {
      cached = null;
      return FALLBACK_CONFIG;
    });
  cached = { at: now, value };
  return value;
}

/** For tests. */
export function resetSchedulingCache(): void {
  cached = null;
}

/**
 * The link a card's booking dialog would send this patient, with the same
 * prefill — what "Copy booking link" puts on the clipboard.
 */
export async function patientBookingLink(
  kind: BookingKind,
  patient: { name?: string; email?: string; phone?: string },
): Promise<string> {
  const cfg = await fetchSchedulingConfig();
  const url = kind === "intake" ? cfg.intakeUrl : BOOKING_URLS.welcome;
  return bookingLinkFor(url, patient, cfg.phoneParam[kind]);
}
