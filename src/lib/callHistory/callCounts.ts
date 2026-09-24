/**
 * How many times we have called a patient, and how many times they have called
 * us — read from OUR call archive in Postgres, never from RingCentral.
 *
 * Josh, 2026-09-24: *"i want to read this info from our post gres, see how many
 * times total ever weve called and theyve called us"*. The gateway's call
 * archive (§5.47) keeps a row for EVERY call on the line, recorded or not, so
 * the counts are one indexed query per number through the route that already
 * exists for other services — `POST /calls/archive/query`. **No gateway change.**
 *
 * ⚠️⚠️ **"EVER" MEANS "SINCE OUR RECORDS BEGIN".** The archive's first run was
 * 2026-09-21 and it reached back its 95-day window, so the oldest call it holds
 * is mid-June 2026; everything before that was RingCentral's alone and is gone
 * (§5.16). The screen says so, with the date read from `/calls/archive-health`
 * rather than written here — a hardcoded date would be right today and quietly
 * wrong the day somebody widens the window.
 *
 * ⚠️ **The verdict is the SPA's own `callConnected`**, fed the archive's raw leg
 * results. The gateway deliberately stores the legs and computes no verdict
 * (`callArchiveRules.toCallRow` says why), so "answered" here and "Missed" in
 * the call list are one rule, not two.
 *
 * ⚠️ **What it cannot see, and says nowhere on screen because it would be
 * noise on every patient** (recorded in CLAUDE.md instead): a call a rep made
 * from their own phone (it never touched this line), and a FAX to or from the
 * number — the archive keeps faxes too, and this route does not return the
 * type. Patients' own numbers do not fax in practice; that is not measured.
 */

import { archiveAvailable, archiveFetch } from "./archivedRecordings";
import { callConnected, isVoicemail } from "./callHistory";

/** One row of `POST /calls/archive/query` — the fields this module reads. */
export interface ArchivedCallRow {
  callId: string;
  /** "Inbound" | "Outbound" — normalised by the gateway (`toCallRow`). */
  direction: string;
  result: string | null;
  legResults: string[];
  durationSec: number;
  startedAt: string | null;
}

export interface CallCounts {
  /** Outbound calls to the number. */
  weCalled: number;
  /** …of which somebody picked up. */
  weReached: number;
  /** Inbound calls from the number. */
  theyCalled: number;
  /** …of which nobody here picked up (a voicemail left is still missed). */
  theyMissed: number;
  /** …of which they left a voicemail. A subset of `theyMissed`. */
  theyVoicemail: number;
  total: number;
  /** The route returned every row it was allowed to — each number is a FLOOR. */
  capped: boolean;
}

/** The most rows the route will return (`limit` is clamped to 1..1000). */
export const ARCHIVE_QUERY_LIMIT = 1000;
/** Ten years — the route's own ceiling, i.e. "everything we hold". */
export const ARCHIVE_QUERY_DAYS = 3650;

export const EMPTY_COUNTS: CallCounts = {
  weCalled: 0,
  weReached: 0,
  theyCalled: 0,
  theyMissed: 0,
  theyVoicemail: 0,
  total: 0,
  capped: false,
};

/** The last ten digits — how the rest of the app keys a US number. Anything
 *  shorter is not a number the gateway can hash (`toE164` refuses it), so it
 *  yields "" and is never asked about. */
export function callNumberKey(phone: string): string {
  const d = String(phone ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

/** Count one number's calls, or several numbers' calls merged — a call is
 *  counted once however many lists it appears in. */
export function countArchivedCalls(
  rows: readonly ArchivedCallRow[],
  opts: { capped?: boolean } = {},
): CallCounts {
  const seen = new Set<string>();
  const out: CallCounts = { ...EMPTY_COUNTS, capped: !!opts.capped };
  for (const r of rows) {
    if (!r?.callId || seen.has(r.callId)) continue;
    seen.add(r.callId);
    const record = {
      result: r.result ?? undefined,
      duration: r.durationSec,
      legs: (r.legResults ?? []).map((result) => ({ result })),
    };
    const connected = callConnected(record);
    out.total += 1;
    if (r.direction === "Inbound") {
      out.theyCalled += 1;
      if (!connected) out.theyMissed += 1;
      if (isVoicemail(record)) out.theyVoicemail += 1;
    } else {
      out.weCalled += 1;
      if (connected) out.weReached += 1;
    }
  }
  return out;
}

/** "12" or, when the list was cut off, "1000+". */
export function countLabel(n: number, capped: boolean): string {
  return capped ? `${n}+` : String(n);
}

/**
 * Every call the archive holds for one number.
 *
 * ⚠️ Throws on ANY failure, never returns an empty list for one: `[]` means
 * "no calls", which a screen shows as 0 — so a 502 from a dead database read as
 * "nobody has ever called this patient" is §5.27's silence one table over.
 */
export async function fetchArchivedCalls(
  phone: string,
): Promise<{ rows: ArchivedCallRow[]; capped: boolean }> {
  if (!archiveAvailable()) throw new Error("No call archive is configured for this build.");
  const res = await archiveFetch("/calls/archive/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phones: [phone], sinceDays: ARCHIVE_QUERY_DAYS, limit: ARCHIVE_QUERY_LIMIT }),
  });
  if (!res.ok) throw new Error(`The call archive answered ${res.status}.`);
  const json = (await res.json()) as { ok?: boolean; limit?: number; calls?: ArchivedCallRow[] };
  if (!json.ok || !Array.isArray(json.calls)) throw new Error("The call archive gave no answer.");
  const limit = Number(json.limit) || ARCHIVE_QUERY_LIMIT;
  return { rows: json.calls, capped: json.calls.length >= limit };
}

/**
 * When our records begin — the oldest call the archive holds, from the
 * unauthenticated health route. `null` when it cannot say, and the screen then
 * names no date rather than guessing one.
 */
export async function fetchArchiveOldest(): Promise<string | null> {
  if (!archiveAvailable()) return null;
  try {
    const res = await archiveFetch("/calls/archive-health");
    if (!res.ok) return null;
    const json = (await res.json()) as { enabled?: boolean; oldest?: string | null };
    if (json.enabled === false) return null;
    return typeof json.oldest === "string" && json.oldest ? json.oldest : null;
  } catch {
    return null;
  }
}

/** "Jun 18, 2026", in Eastern — every other date on these boards is Eastern
 *  wall clock (§5.15), and a UTC rendering moves an evening call a day. */
export function formatSinceDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
