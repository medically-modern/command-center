/**
 * "snapshot" data mode (Brandon CR-9): loads a read-only export of the real boards made by the spec repo's scout
 * (project/snapshot/real/, never committed) and replays it through the SAME parsers and model as live mode.
 * Served only by the dev-server middleware in vite.config.ts (OO_SNAPSHOT_DIR); a build never contains it.
 * Anything missing from the export is reported as a fetch error (shown honestly), never filled in.
 */
import type { AccessView, BoardKey, FetchError, ItemRow, RawEvent } from "../types";
import { parseItem } from "./fetchItems";
import { parseEvent, type ActivityRow } from "./parseEvent";
import { summarizeFax } from "./fetchFax";
import { OO_CONFIG } from "../config";
import { buildSnapshot, type FullSnapshot } from "../model/buildSnapshot";

export type ReadJson = (file: string) => Promise<unknown>;
export const browserReader: ReadJson = async (file) => {
  const r = await fetch(`/__oo_snapshot/${file}`);
  if (!r.ok) throw new Error(`${file}: ${r.status}`);
  return r.json();
};

export async function loadRealSnapshot(read: ReadJson = browserReader): Promise<FullSnapshot> {
  const manifest = (await read("manifest.json")) as { exportedAtMs: number; notes?: string[] };
  const at = manifest.exportedAtMs;
  const errors: FetchError[] = [];
  const tryRead = async <T,>(file: string, board: BoardKey | "COMMS", fallback: T): Promise<T> => {
    try { return (await read(file)) as T; } catch (e: unknown) { errors.push({ board, message: `not in export (${String((e as Error)?.message ?? e)})`, atMs: at }); return fallback; }
  };
  const items: ItemRow[] = []; const itemsAt: Partial<Record<BoardKey, number>> = {};
  for (const b of ["INT", "MN", "INS", "WC", "SUB"] as const) {
    const raw = await tryRead<Parameters<typeof parseItem>[1][]>(`items-${b}.json`, b, []);
    if (raw.length) itemsAt[b] = at;
    items.push(...raw.map((r) => parseItem(b, r)));
  }
  const events: RawEvent[] = []; const cursors: Partial<Record<BoardKey, number>> = {}; let drops = 0;
  for (const b of ["INT", "MN", "INS", "WC"] as const) {
    const cols = await tryRead<ActivityRow[] | null>(`activity-cols-${b}.json`, b, null);
    const groups = await tryRead<ActivityRow[] | null>(`activity-groups-${b}.json`, b, null);
    for (const r of [...(cols ?? []), ...(groups ?? [])]) {
      const row = { ...r, data: typeof r.data === "string" ? r.data : JSON.stringify(r.data) };
      const e = parseEvent(b, row); if (e) events.push(e); else drops++;
    }
    if (cols) cursors[b] = at;
  }
  // CR-12 evidence export (optional): columns that record our own actions. Merged into items and events; absent = not measured.
  const quiet = async <T,>(file: string, fallback: T): Promise<T> => { try { return (await read(file)) as T; } catch { return fallback; } };
  let evidenceLoaded = false;
  // CR-14 (v2): Medical Necessity Next Action Date history (optional file).
  for (const r of (await quiet<ActivityRow[] | null>("activity-nad-MN.json", null)) ?? []) { const e = parseEvent("MN", { ...r, id: r.id ?? `nad-${r.created_at}-${(r.data as { pulse_id?: unknown })?.pulse_id ?? ""}`, data: typeof r.data === "string" ? r.data : JSON.stringify(r.data) }); if (e) events.push(e); }
  for (const b of ["INT", "MN", "INS", "WC"] as const) {
    const ev = await quiet<ActivityRow[] | null>(`activity-evidence-${b}.json`, null); if (ev) evidenceLoaded = true;
    for (const r of ev ?? []) { const e = parseEvent(b, { ...r, data: typeof r.data === "string" ? r.data : JSON.stringify(r.data) }); if (e) events.push(e); }
    const its = await quiet<{ id: string; column_values: { id: string; type: string; text: string | null; value: string | null }[] }[] | null>(`items-evidence-${b}.json`, null);
    if (its) { const byId = new Map(items.filter((x) => x.boardKey === b).map((x) => [x.itemId, x]));
      for (const r of its) { const it = byId.get(String(r.id)); if (!it) continue; const parsed = parseItem(b, { id: r.id, created_at: new Date(it.createdAtMs).toISOString(), group: { id: it.groupId }, column_values: r.column_values });
        Object.assign(it.values, parsed.values); } }
  }
  // Without the evidence export, "whose move" can only use status changes (more patients read "on us"): recorded as a data note, not an error.
  if (!evidenceLoaded) errors.push({ board: "COMMS", message: "evidence of our actions not loaded (follow-up dates, call counts): whose-move uses status changes only", atMs: at });
  const excluded = await tryRead<{ total: number; escalated: number } | null>("int-excluded.json", "INT", null);
  const faxItems = await tryRead<{ created_at: string; group: { id: string } }[] | null>("fax-items.json", "FAX", null);
  const fax = faxItems ? await summarizeFax(faxItems, at, OO_CONFIG.boards.FAX) : null;
  const access = await tryRead<AccessView | null>("access.json", "INT", null);
  // The comms SLA report lives behind the gateway (Google sign-in) and is not in the export: shown as not connected.
  // Escalation type per escalated patient (Brandon "Two kinds of escalation"): Proposed Stuck vs Edge Case, classified
  // by the scout from the note stamp / attempts signal (ids and labels only; no note text). Absent = unclassified.
  const escClassFile = await quiet<{ items?: Record<string, { type?: string; evidence?: string }> } | null>("esc-class.json", null);
  // Brandon (A3, confirmed): auto-escalated Benefits = Proposed Stuck; Auth Denied = Edge Case (its own 30-day normal, applied in the model).
  // Pump hold and the no-signal ones stay Unclassified until he decides.
  const escClass: Record<string, string> = {};
  for (const [k, v] of Object.entries((escClassFile?.items ?? {}) as Record<string, { type?: string; evidence?: string }>)) {
    if (!v?.type) continue; const ev = v.evidence ?? "";
    escClass[k] = v.type !== "unclassified" ? v.type : /Auto-escalated stamp/.test(ev) ? "proposedStuck" : /Auth Denied group/.test(ev) ? "edgeCase" : "unclassified";
  }
  return Object.assign(buildSnapshot({ snapshotAt: at, items, events, access, commsSla: null, fax, excludedIntCounts: excluded, cursors, fetchErrors: errors, mode: "snapshot",
    groupHistoryStartMs: at - OO_CONFIG.groupMoves.lookbackDays * 86400000, parseDropsTotal: drops, itemsAt }), { escClass });
}
