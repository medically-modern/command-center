/**
 * Turning a failed Monday READ into something a rep can act on.
 *
 * Every `gql()` wrapper throws on failure, and the caller's hook catches it into
 * an `error` string. Most pages then render that string only in the sidebar or
 * in `EmptyPatientPane` — i.e. only when the list is EMPTY. So the common case
 * is invisible: a rep is looking at a patient, a background poll fails, and the
 * screen keeps showing the values it already had with nothing to say they are
 * stale. That is the shape of 2026-09-01, when Monday 500'd eight reads at 12:07
 * and 503'd two more at 13:55; nobody using the app saw anything at all.
 *
 * ⚠️ WHAT CAN AND CANNOT BE PINPOINTED. Monday's GraphQL errors *may* carry a
 * `path` naming the field that failed, and `fieldsFromGraphQLErrors` reads it
 * when present. In practice it usually is not: every one of the ten real
 * failures that day was either a bare HTTP 503 (no GraphQL body exists at all)
 * or `{"message":"Internal Server Error","extensions":{"code":...}}` with NO
 * path. So field-level naming is opportunistic, and the honest unit is the
 * SCOPE — which fetch failed, and therefore which part of the screen is stale.
 * The two-tier intake read (§5.25) makes that genuinely useful: the queue list
 * and the open patient's detail are separate requests that fail independently,
 * so "the patient list is stale" and "this patient's details didn't load" are
 * different, true, and actionable sentences.
 *
 * ⚠️ Never claim more than the error supports. Saying "these 3 fields failed"
 * when Monday named none would send a rep hunting for a specific problem that
 * the payload never described — the same harm as the advancer's false green.
 */

export type ReadFailureKind = "outage" | "throttled" | "offline" | "rejected" | "unknown";

export interface ReadFailure {
  kind: ReadFailureKind;
  /** Why it failed, in the rep's words. No status codes, no GraphQL jargon. */
  reason: string;
  /** True when the next poll may well fix it on its own — which changes the
   *  advice from "reload" to "it will retry". */
  transient: boolean;
  /** Field paths Monday named, when it named any. Usually empty; see above. */
  fields: string[];
}

/** Monday reports a path as an array of segments (`["boards", 0, "items_page"]`).
 *  Numeric segments are list indices and mean nothing to a rep, so they are
 *  dropped and the rest joined. */
export function fieldsFromGraphQLErrors(errors: unknown): string[] {
  if (!Array.isArray(errors)) return [];
  const out: string[] = [];
  for (const e of errors) {
    const path = (e as { path?: unknown })?.path;
    if (!Array.isArray(path)) continue;
    const named = path.filter((p): p is string => typeof p === "string");
    if (named.length === 0) continue;
    const label = named.join(".");
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/** HTTP status carried in the message the shared `gql()` wrappers throw
 *  (`Monday request failed (503)`). Parsing it is what lets every one of the
 *  thirteen wrappers classify correctly with no change to any of them. */
export function statusFromMessage(message: string): number | null {
  const m = /Monday request failed \((\d{3})\)/.exec(message);
  return m ? Number(m[1]) : null;
}

export function describeReadFailure(err: unknown, opts: { errors?: unknown } = {}): ReadFailure {
  const message = err instanceof Error ? err.message : String(err ?? "");
  const fields = fieldsFromGraphQLErrors(opts.errors);
  const status = statusFromMessage(message);

  // A browser fetch that never reached Monday throws a TypeError whose message
  // is browser-specific ("Failed to fetch" / "NetworkError ..." / "Load
  // failed"), so match the shapes rather than one string.
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return { kind: "offline", reason: "your connection dropped", transient: true, fields };
  }
  if (status === 429 || /complexity|rate limit|too many requests/i.test(message)) {
    return { kind: "throttled", reason: "Monday is rate-limiting us", transient: true, fields };
  }
  if ((status !== null && status >= 500) || /internal server error|service unavailable|bad gateway/i.test(message)) {
    return { kind: "outage", reason: "Monday didn't respond", transient: true, fields };
  }
  if (status !== null && status >= 400) {
    return { kind: "rejected", reason: "Monday rejected the request", transient: false, fields };
  }
  return { kind: "unknown", reason: "Monday couldn't be read", transient: false, fields };
}

/**
 * The one line the header shows. `scope` names the part of the screen that is
 * stale ("The patient list", "This patient's details") and is always supplied
 * by the caller, because only the caller knows which fetch it was.
 */
export function staleNoticeText(scope: string, f: ReadFailure): string {
  const what = f.fields.length > 0 ? ` (${f.fields.join(", ")})` : "";
  const advice = f.transient
    ? "It will retry automatically — reload the page if it doesn't come back."
    : "Reload the page.";
  return `${scope} may be out of date${what} — ${f.reason}. ${advice}`;
}
