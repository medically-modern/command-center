/**
 * H5 (DESIGN INTENT v2): calls per person per day from Command Center's communication logs, READ-ONLY.
 * Runs only inside Command Center with a signed-in user (the gateway needs the user's Google ID token, the same
 * X-MM-Auth header every Command Center screen sends). Two sources, both reads:
 *  1. RingCentral call log via the gateway's /rc proxy (GET .../account/~/call-log, view=Detailed): outbound calls
 *     carry the extension that placed them (from.name); inbound connected legs carry who answered.
 *  2. Fallback: the gateway call archive (POST /calls/archive/query is a SELECT-only query): answered inbound calls
 *     by answeredName. Outbound calls have no staff name there.
 * Counts only: no numbers, names of patients, recordings or transcripts are kept.
 */
import { getIdToken } from "@/lib/shared/auth";

const GATEWAY = ((import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined) ?? "").replace(/\/+$/, "");
export interface StaffCalls { status: "ok" | "unavailable"; source: "ringcentral" | "archive" | null; reason: string | null; /** first name (lower case) -> day (YYYY-MM-DD, ET) -> calls */ perDay: Record<string, Record<string, number>>; /** first names seen on more than one extension: their count would merge two people, so they show "—" */ ambiguous?: string[] }

const dayKey = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const first = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
function bump(m: StaffCalls["perDay"], who: string, day: string) { if (!who) return; (m[who] ??= {})[day] = (m[who][day] ?? 0) + 1; }
/** first name -> distinct extensions (id, else full name) seen under it */
function seen(ext: Map<string, Set<string>>, p: RcParty | undefined) { const f = first(p?.name); if (f) (ext.get(f) ?? ext.set(f, new Set()).get(f)!).add(p?.extensionId ?? (p?.name ?? "").trim().toLowerCase()); }
const RC_PAGES = 20, ARCHIVE_LIMIT = 1000;
async function get(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getIdToken(); const headers: Record<string, string> = { ...((init.headers as Record<string, string>) || {}) };
  if (token) headers["X-MM-Auth"] = token;
  return fetch(`${GATEWAY}${path}`, { ...init, headers });
}

interface RcParty { name?: string; extensionId?: string }
interface RcRecord { direction?: string; result?: string; startTime?: string; from?: RcParty; to?: RcParty; legs?: { result?: string; to?: RcParty; master?: boolean }[] }

export async function fetchStaffCalls(sinceDays = 28): Promise<StaffCalls> {
  if (!GATEWAY) return { status: "unavailable", source: null, reason: "No Command Center gateway configured (VITE_MONDAY_GATEWAY_URL).", perDay: {} };
  if (!getIdToken()) return { status: "unavailable", source: null, reason: "Call logs need a Command Center sign-in.", perDay: {} };
  const dateFrom = new Date(Date.now() - sinceDays * 864e5).toISOString();
  // 1. RingCentral call log (account level), paged.
  try {
    const perDay: StaffCalls["perDay"] = {}; const ext = new Map<string, Set<string>>(); let more = false;
    for (let page = 1; page <= RC_PAGES; page++) {
      const res = await get(`/rc/restapi/v1.0/account/~/call-log?view=Detailed&type=Voice&dateFrom=${encodeURIComponent(dateFrom)}&perPage=1000&page=${page}`);
      if (!res.ok) throw new Error(`RingCentral call log ${res.status}`);
      const body = (await res.json()) as { records?: RcRecord[]; navigation?: { nextPage?: unknown } };
      for (const r of body.records ?? []) {
        if (!r.startTime) continue; const day = dayKey(r.startTime);
        if (r.direction === "Outbound") { bump(perDay, first(r.from?.name), day); seen(ext, r.from); }
        else { const leg = (r.legs ?? []).find((l) => !l.master && (l.result ?? "").toLowerCase() === "call connected" && l.to?.name); if (leg) { bump(perDay, first(leg.to?.name), day); seen(ext, leg.to); } }
      }
      more = !!body.navigation?.nextPage; if (!more) break;
    }
    // Never show a silently short count (red-team r17 N2).
    if (more) return { status: "unavailable", source: null, reason: `Call logs truncated (more than ${RC_PAGES} pages); not shown.`, perDay: {} };
    if (Object.keys(perDay).length) return { status: "ok", source: "ringcentral", reason: null, perDay, ambiguous: [...ext].filter(([, v]) => v.size > 1).map(([k]) => k) };
  } catch { /* fall through to the archive */ }
  // 2. Gateway call archive (answered inbound only).
  try {
    const res = await get("/calls/archive/query", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sinceDays, limit: ARCHIVE_LIMIT }) });
    if (!res.ok) throw new Error(`call archive ${res.status}`);
    const body = (await res.json()) as { calls?: { startedAt?: string | null; answeredName?: string | null }[] };
    if ((body.calls?.length ?? 0) >= ARCHIVE_LIMIT) return { status: "unavailable", source: null, reason: `Call logs truncated (${ARCHIVE_LIMIT} or more archived calls); not shown.`, perDay: {} };
    const perDay: StaffCalls["perDay"] = {};
    for (const c of body.calls ?? []) if (c.startedAt && c.answeredName) bump(perDay, first(c.answeredName), dayKey(c.startedAt));
    return { status: "ok", source: "archive", reason: "Answered inbound calls only (the archive has no staff name on outbound calls).", perDay };
  } catch (e) {
    return { status: "unavailable", source: null, reason: `Call logs could not be read (${e instanceof Error ? e.message : String(e)}).`, perDay: {} };
  }
}
