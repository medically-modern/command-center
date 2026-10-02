/**
 * Snapshot cache in IndexedDB (BUILD-SPEC §5.1/§5.2). The key includes the schema version and a hash
 * of the tracked columns, so changing what we track forces a cold reload (history is backfilled).
 * Any storage failure falls back to memory: the dashboard must work in private windows.
 */
import type { Dict } from "../types";
import { OO_CONFIG } from "../config";

export interface KV { get(k: string): Promise<Dict>; set(k: string, v: Dict): Promise<void>; del(k: string): Promise<void> }

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
export function cacheKey(cfg = OO_CONFIG): string {
  return `oo-cache:${cfg.schemaVersion}:${hash(JSON.stringify([cfg.activityColumns, cfg.groupMoveSourceGroups, cfg.groupMoves, cfg.historyStart]))}`;
}

const mem = new Map<string, unknown>();
export const memoryKV: KV = { async get(k) { return mem.get(k); }, async set(k, v) { mem.set(k, v); }, async del(k) { mem.delete(k); } };

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("onboarding-oversight", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export const idbKV: KV = {
  async get(k) { const db = await idb(); return new Promise((r, j) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => r(q.result); q.onerror = () => j(q.error); }); },
  async set(k, v) { const db = await idb(); return new Promise((r, j) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => r(); t.onerror = () => j(t.error); }); },
  async del(k) { const db = await idb(); return new Promise((r, j) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").delete(k); t.oncomplete = () => r(); t.onerror = () => j(t.error); }); },
};

/** Wraps a store so failures degrade to memory instead of throwing. */
export function safeKV(primary: KV): KV {
  return {
    async get(k) { try { return await primary.get(k); } catch { return memoryKV.get(k); } },
    async set(k, v) { try { await primary.set(k, v); } catch { await memoryKV.set(k, v); } },
    async del(k) { try { await primary.del(k); } catch { await memoryKV.del(k); } },
  };
}
export const defaultKV: KV = safeKV(typeof indexedDB !== "undefined" ? idbKV : memoryKV);
