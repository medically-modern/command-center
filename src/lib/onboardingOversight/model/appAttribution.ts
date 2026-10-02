/**
 * Attribution rule 2 (BUILD-SPEC §3.10.1, "Phase 7"): who made a Command Center write.
 *
 * Every write the Command Center makes reaches monday through the gateway on ONE shared token, so
 * monday's activity log gives them all the same user id and the dashboard could only call them
 * "Shared Command Center account". The gateway records the signed-in person behind each write
 * (gql_log). GET /oversight/app-actors returns item, board, person, time and the column ids written
 * — never a value — and this matches each shared-token event to its row: same item, same board, the
 * event's column among the columns written, within `attributionMatchSeconds`, nearest first.
 *
 * Pure. Applied in memory after load, never written into the history cache, so a gateway that is
 * down or unconfigured leaves everything exactly as it was (rule 3: "unattributed").
 *
 * ⚠️ SYSTEM WRITES (Josh, 2026-10-02). The shared token is not the Command Center's alone: the intake
 * web form (Last Form Activity, Drop-off Step, the doctor and insurance fields — around the clock),
 * Stedi and the DVS services write to monday with it directly, never through the gateway. Measured on
 * Profile Send Off, Sep 14 – Oct 2: 6,057 shared-token changes, 56% of them Command Center writes.
 * Counted as "human", the rest made a patient filling in the form look worked by staff. So a
 * shared-token event with NO matching gateway write, inside the period the log covers, is marked
 * `system` and treated like automation. Only when the log is complete for that period: a truncated
 * answer marks nothing, and events older than its first row are left as they were.
 */
import type { RawEvent } from "../types";
import { OO_CONFIG } from "../config";

type Cfg = typeof OO_CONFIG;
/** [itemId, boardId, actor email, ms, column ids, startMs?] — the gateway's wire shape. `ms` is when the gateway
 *  logged the write; `startMs` (durable /send jobs only) when the job was queued. A send logs when it FINISHES, and
 *  an attempt whose read-back timed out has already changed monday, so the change can sit minutes before `ms`. */
export type AppActorRow = [string, string, string, number, string[], number?];
/** Distance from an event to a write's span [start, ms]: 0 inside it. */
const spanDist = (atMs: number, ms: number, startMs?: number) => { const s = startMs ?? ms; return atMs < s ? s - atMs : atMs > ms ? atMs - ms : 0; };

/** "katie@medicallymodern.com" → "katie", when that is a person in config; else null. */
export function personKeyForEmail(email: string, cfg: Cfg = OO_CONFIG): string | null {
  const local = String(email ?? "").toLowerCase().split("@")[0];
  if (!local) return null;
  const p = cfg.people.find((x) => x.key === local || (x.accessKey ?? "").toLowerCase() === local);
  return p && !(p as { sharedToken?: boolean }).sharedToken ? p.key : null;
}

const sharedIds = (cfg: Cfg) => new Set(cfg.people.filter((p) => (p as { sharedToken?: boolean }).sharedToken).flatMap((p) => [...p.mondayUserIds] as number[]));

/**
 * Events with `actorKey` set where a gateway row matches. Only shared-token events are touched: a
 * direct monday edit already names its person (rule 1), and automation stays automation.
 */
export function attachAppActors(
  events: RawEvent[], rows: AppActorRow[] | null | undefined, cfg: Cfg = OO_CONFIG,
  coverage: { truncated?: boolean } = {},
): RawEvent[] {
  if (!rows?.length) return events;
  // The log covers from its first row (the gateway's window, or when it began recording columns, whichever is later).
  const fromMs = coverage.truncated ? Infinity : rows.reduce((lo, r) => (r[3] < lo ? r[3] : lo), Infinity) - cfg.attributionMatchSeconds * 1000;
  const shared = sharedIds(cfg);
  const boardKeyById = new Map(Object.entries(cfg.boards as Record<string, string>).map(([k, id]) => [String(id), k]));
  const byItem = new Map<string, { ms: number; startMs?: number; cols: Set<string>; person: string }[]>();
  for (const [itemId, boardId, actor, ms, cols, startMs] of rows) {
    const board = boardKeyById.get(String(boardId)); const person = personKeyForEmail(actor, cfg);
    if (!board || !person) continue;
    const k = `${board}:${itemId}`;
    (byItem.get(k) ?? byItem.set(k, []).get(k)!).push({ ms, startMs, cols: new Set(cols), person });
  }
  const lag = cfg.attributionMatchSeconds * 1000;
  // A gateway write by someone config does not know (a script's actor, a new hire) still means the Command
  // Center wrote it — not a system — so it is left unnamed rather than marked system.
  const anyRow = new Map<string, [number, number | undefined][]>();
  for (const [itemId, boardId, , ms, cols, startMs] of rows) { const board = boardKeyById.get(String(boardId)); if (!board) continue; for (const c of cols) { const k = `${board}:${itemId}:${c}`; (anyRow.get(k) ?? anyRow.set(k, []).get(k)!).push([ms, startMs]); } }
  const anyActor = (e: RawEvent) => (anyRow.get(`${e.boardKey}:${e.itemId}:${e.columnId}`) ?? []).some(([ms, st]) => spanDist(e.atMs, ms, st) <= lag);
  return events.map((e) => {
    if (!shared.has(e.userId) || e.columnId === "__group__") return e;
    let best: { d: number; person: string } | null = null;
    for (const r of byItem.get(`${e.boardKey}:${e.itemId}`) ?? []) {
      if (!r.cols.has(e.columnId)) continue;
      const d = spanDist(e.atMs, r.ms, r.startMs);
      if (d <= lag && (!best || d < best.d)) best = { d, person: r.person };
    }
    if (best) return { ...e, actorKey: best.person };
    // No Command Center write behind it, in a period the log fully covers: another system on the same token.
    // ⚠️ File columns never: staff uploads (clinicals, insurance cards) go to monday through the Cloudflare
    // worker's /v2/file proxy, not the gateway, so they have no gateway row — they stay staff work, unnamed.
    if (e.columnId.startsWith("file_")) return e;
    return !e.bulk && e.atMs >= fromMs && !anyActor(e) ? { ...e, system: true } : e;
  });
}

/** Shared-token events by outcome: named staff, system (form/Stedi/DVS), and neither (older than the log, or an unknown actor). */
export function appAttributionCoverage(events: RawEvent[], cfg: Cfg = OO_CONFIG): { shared: number; matched: number; system: number } {
  const shared = sharedIds(cfg);
  let n = 0, m = 0, s = 0;
  for (const e of events) if (shared.has(e.userId) && e.columnId !== "__group__" && !e.bulk) { n++; if (e.actorKey) m++; else if (e.system) s++; }
  return { shared: n, matched: m, system: s };
}
