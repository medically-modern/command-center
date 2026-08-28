/**
 * Search's cross-board patient cache — IndexedDB, not localStorage.
 *
 * ⚠️ **localStorage cannot hold this dataset, and failed silently when it
 * stopped fitting.** Search reads every group on all seven boards; that is
 * 5,657 patients today, which serialises to **5.52 MB** (measured 2026-08-28).
 * The old cache wrote that to localStorage and, on the `QuotaExceededError`,
 * retried with notes trimmed to 400 chars — still 3.80 MB, and since browsers
 * store strings as UTF-16 the real cost is ~7.6 MB against a ~5 MB quota. Both
 * writes threw, and both `catch` blocks were empty.
 *
 * Two failures came out of that, and the second is the one that reached a rep:
 *  1. Every visit was a cold ~15–20s load (Profile Send Off alone is six
 *     sequential 500-item pages), because the cache never got written.
 *  2. **A failed `setItem` leaves the previous value in place.** So the last
 *     snapshot small enough to fit — written before New Form — Partial Leads
 *     grew to 1,733 items — became permanent: it could never be overwritten,
 *     and it was still non-empty, so the page skipped its loading state and
 *     searched the old data. Patients added since read as "No patients found
 *     matching …" for the ~15s until the live fetch landed, then silently
 *     started working. That is how Jose Delgado and Eddie Smith were reported
 *     missing from system-wide search while sitting on Profile Send Off.
 *
 * Trimming the shape does not save it: dropping `notes` AND `escalationNotes`
 * still measures 2.44 MB (~4.9 MB UTF-16), i.e. at the quota with the boards
 * at today's size. IndexedDB has no comparable limit, so the full objects are
 * stored and the shape stays honest.
 *
 * ⚠️ Everything here is best-effort and **must never reject** — a browser with
 * storage disabled (private windows, locked-down profiles) has to fall through
 * to a plain cold load, not break Search.
 */
import type { SystemPatient } from "./mondayApi";

const DB_NAME = "mm-command-center";
const DB_VERSION = 1;
const STORE = "sysmgmt";
const RECORD_KEY = "patients";

/**
 * Bumped whenever `SystemPatient` changes shape. A cache written by an older
 * build is discarded rather than rendered — a row missing a field it now needs
 * shows as blank, which is the silent-wrong-answer this file exists to end.
 */
const SCHEMA_VERSION = 1;

/**
 * Beyond this the snapshot is ignored and Search cold-loads instead.
 *
 * The cache exists to fill the ~15s before the live fetch lands, not to answer
 * questions on its own. A day-old snapshot answering "no such patient" is worse
 * than a spinner, and it is exactly the failure above in slower motion.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** The key the localStorage cache used, evicted on first load — see below. */
const LEGACY_LS_KEY = "sysmgmt-patients-cache";

interface CacheRecord {
  version: number;
  savedAt: number;
  patients: SystemPatient[];
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null); // storage disabled entirely
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    // Another tab holding an old version open blocks the upgrade forever;
    // resolving null just means this tab cold-loads.
    req.onblocked = () => resolve(null);
  });
}

/**
 * Drop the old localStorage cache.
 *
 * Not tidiness: every browser that used the previous build still holds that
 * stale, unwritable ~5 MB snapshot. Left alone it keeps occupying the origin's
 * localStorage quota indefinitely, and any future `getItem` on the key would
 * resurrect a snapshot from before the board grew.
 */
export function evictLegacyPatientCache(): void {
  try {
    localStorage.removeItem(LEGACY_LS_KEY);
  } catch { /* storage disabled — nothing to evict */ }
}

/** Cached patients, or `[]` when there is no usable snapshot. Never rejects. */
export async function loadCachedPatients(): Promise<SystemPatient[]> {
  evictLegacyPatientCache();
  const db = await openDb();
  if (!db) return [];
  try {
    const rec = await new Promise<CacheRecord | null>((resolve) => {
      try {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(RECORD_KEY);
        req.onsuccess = () => resolve((req.result as CacheRecord) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (!rec || rec.version !== SCHEMA_VERSION) return [];
    if (!Array.isArray(rec.patients)) return [];
    if (Date.now() - rec.savedAt > MAX_AGE_MS) return [];
    return rec.patients;
  } finally {
    db.close();
  }
}

/** Store the snapshot. Never rejects — a lost cache is only a slower load. */
export async function persistPatientCache(patients: SystemPatient[]): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(
          { version: SCHEMA_VERSION, savedAt: Date.now(), patients } satisfies CacheRecord,
          RECORD_KEY,
        );
        tx.oncomplete = () => resolve();
        // A quota or serialisation failure must leave NO record rather than an
        // older one — IndexedDB aborts the whole transaction, so the previous
        // value survives; clear it so a stale snapshot can never be served.
        tx.onerror = () => { void clearCachedPatients(); resolve(); };
        tx.onabort = () => { void clearCachedPatients(); resolve(); };
      } catch {
        resolve();
      }
    });
  } finally {
    db.close();
  }
}

/** Remove the snapshot. Never rejects. */
export async function clearCachedPatients(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(RECORD_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  } finally {
    db.close();
  }
}
