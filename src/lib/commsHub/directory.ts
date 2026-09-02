/**
 * Who is this number? — the name the Communications Hub lists show.
 *
 * Pure. The Monday read lives in `dossierApi.fetchDirectoryNames`; the batching
 * and caching live in `hooks/commsHub/useDirectoryNames`.
 *
 * Josh, 2026-09-02: *"rc has its contacts and we should rely on that but if
 * it's just a number we fall back to what's in our system"*. So the order is
 * RingCentral's own name → our boards → the formatted number.
 *
 * ⚠️ **This does NOT reintroduce a per-row Monday lookup** (CLAUDE.md §5.28 —
 * "resolving a name per row would be one cross-board query per conversation on
 * every poll, which is the shape INCIDENT_2026-08-20 was"). The lookup is
 * batched: `any_of` takes a whole page of numbers in ONE rule, and every board
 * rides in ONE aliased GraphQL request, so a 300-row list costs a handful of
 * requests for the session rather than 300 per poll. That is the only reason
 * the rule below is allowed to exist.
 */

/** US state abbreviations — the tail of a carrier CNAM like `LA JOLLA CA`. */
const STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM",
  "NY", "NC", "ND", "OH", "OK", "OR", "PA", "PR", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA",
  "WA", "WV", "WI", "WY",
]);

/**
 * Carrier placeholders. RingCentral hands these back in the same `name` field a
 * real contact uses, so without this list a conversation reads "WIRELESS
 * CALLER" while our boards know exactly who it is.
 */
const PLACEHOLDERS = new Set([
  "wireless caller",
  "unknown",
  "unknown caller",
  "unknown name",
  "unavailable",
  "name unavailable",
  "not available",
  "private",
  "private caller",
  "anonymous",
  "restricted",
  "blocked",
  "no name",
  "toll free",
  "toll-free",
  "tollfree",
  "conference",
  "spam",
  "spam risk",
  "spam?",
  "scam likely",
]);

/**
 * How much a RingCentral-supplied name is worth.
 *
 * - `strong` — a real contact. Beats anything our boards say: RingCentral is
 *   where reps keep the office and manufacturer contacts, and Josh asked for it
 *   to win.
 * - `weak` — a `CITY ST` carrier CNAM. It is not a lie, but it names a place
 *   rather than a person, so a patient name from our boards is strictly better.
 *   Still rendered when we have nothing else — "LA JOLLA CA" beats a bare
 *   number.
 * - `junk` — empty, a placeholder, or the number written back at us. Never
 *   rendered as a name.
 */
export type RcNameStrength = "strong" | "weak" | "junk";

export function rcNameStrength(rcName: string, phone = ""): RcNameStrength {
  const raw = String(rcName ?? "").trim();
  if (!raw) return "junk";
  const lower = raw.toLowerCase();
  if (PLACEHOLDERS.has(lower)) return "junk";

  // A name made only of digits/punctuation is the number, however it is
  // spaced — `(858) 366-6900`, `+18583666900`, `8583666900`. Rendering it as a
  // "name" beside the same number formatted differently reads as two facts.
  const bare = raw.replace(/[\d\s()+.\-–—]/g, "");
  if (!bare) return "junk";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 7 && phone && digits.slice(-10) === String(phone).replace(/\D/g, "").slice(-10)) {
    return "junk";
  }

  // `LA JOLLA CA` — all caps, last token a state. Checked against the state set
  // rather than "any two capitals" so a genuine contact ending in initials
  // ("MEDICALLY MODERN LP") is not demoted.
  const parts = raw.split(/\s+/);
  if (parts.length >= 2 && raw === raw.toUpperCase() && STATES.has(parts[parts.length - 1])) {
    return "weak";
  }
  return "strong";
}

/** Where the rendered label came from — drives the "· from the boards" hint and
 *  makes the rule testable without reading pixels. */
export type NameSource = "rc" | "directory" | "cnam" | "number";

export interface ResolvedName {
  /** What the row shows. Never empty — falls back to the formatted number. */
  label: string;
  source: NameSource;
}

/**
 * The one rule every hub list uses.
 *
 * `formatPhone` is injected rather than imported so this module stays pure and
 * the tests don't depend on the app's formatter.
 */
export function resolveDisplayName(
  opts: { rcName?: string; directoryName?: string; phone: string },
  formatPhone: (p: string) => string,
): ResolvedName {
  const directory = String(opts.directoryName ?? "").trim();
  const rc = String(opts.rcName ?? "").trim();
  const strength = rcNameStrength(rc, opts.phone);

  if (strength === "strong") return { label: rc, source: "rc" };
  if (directory) return { label: directory, source: "directory" };
  if (strength === "weak") return { label: rc, source: "cnam" };
  return { label: formatPhone(opts.phone) || opts.phone, source: "number" };
}

/**
 * The digit shapes a Monday **phone** column may hold for one 10-digit key.
 *
 * ⚠️ `any_of` is an EXACT match, and this account's boards hold both shapes:
 * `9739511857` and `16078737352` sit in the same column (verified on the
 * Welcome Call board, 2026-09-02). Asking for one shape silently misses every
 * row stored in the other — 200 OK, no rows, which reads as "not a patient".
 * The `+1` form is included because a hand-typed value can carry it.
 */
export function phoneMatchVariants(key: string): string[] {
  const d = String(key ?? "").replace(/\D/g, "").slice(-10);
  if (d.length !== 10) return [];
  return [d, `1${d}`, `+1${d}`];
}
