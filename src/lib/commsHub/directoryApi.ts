/**
 * The patient name directory — one Postgres lookup instead of seven board
 * queries.
 *
 * The gateway keeps a daily-refreshed copy of number → name across every
 * patient board (`services/monday-gateway/patientDirectory.mjs`). This is the
 * browser side of it.
 *
 * ⚠️ **A MISS IS NOT AN ANSWER.** The directory is at most a day old, so a
 * patient created this morning is genuinely absent from it — and so is every
 * patient if the reconcile has never run, or if the gateway is down. Callers
 * must fall back to the live Monday lookup for the numbers it did not answer,
 * which is what makes a stale or empty directory a performance regression
 * rather than a correctness one. `resolveNames` below does that fallback; use
 * it rather than calling `lookupDirectory` directly.
 *
 * ⚠️ It returns `{ok}` for the same reason `fetchDirectoryNames` does: a failed
 * request and a batch of genuine misses are indistinguishable in the data, and
 * the caller CACHES misses. Reporting a failure as "these people are on no
 * board" freezes them at a bare phone number for the rest of the session.
 */
import { MONDAY_GATEWAY_BASE, mondayIdentityHeaders } from "../shared/mondayEndpoint";
import { fetchDirectoryNames } from "./dossierApi";

/** Is the Postgres directory reachable at all? False in a direct (no-gateway)
 *  build, where every lookup goes straight to Monday as it always did. */
export function directoryServiceAvailable(): boolean {
  return MONDAY_GATEWAY_BASE.length > 0;
}

export interface DirectoryHit {
  name: string;
  itemId: string;
  boardId: number | null;
  boardName: string;
}

export interface DirectoryLookupResult {
  /** False when the request failed. The caller must not record misses. */
  ok: boolean;
  /** Keyed by last-10 digits, matching every other map in the hub. */
  hits: Map<string, DirectoryHit>;
}

const key = (v: string) => String(v ?? "").replace(/\D/g, "").slice(-10);

/**
 * Ask the gateway about a batch of numbers.
 *
 * Sends E.164, because that is what the gateway hashes; keys the answer by the
 * last ten digits, because that is what every caller here holds.
 */
export async function lookupDirectory(keys: string[]): Promise<DirectoryLookupResult> {
  const hits = new Map<string, DirectoryHit>();
  const wanted = [...new Set(keys.map(key).filter((k) => k.length === 10))];
  if (!wanted.length) return { ok: true, hits };
  // No gateway means no directory — an honest "no answers", not a failure:
  // there is nothing to retry and the Monday fallback is the whole path.
  if (!directoryServiceAvailable()) return { ok: true, hits };

  try {
    const res = await fetch(`${MONDAY_GATEWAY_BASE}/directory/lookup`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...mondayIdentityHeaders() },
      body: JSON.stringify({ numbers: wanted.map((k) => `+1${k}`) }),
    });
    if (!res.ok) return { ok: false, hits };
    const json = (await res.json()) as {
      names?: Record<string, { name?: string; itemId?: string; boardId?: number | null; boardName?: string }>;
    };
    for (const [num, hit] of Object.entries(json.names ?? {})) {
      const k = key(num);
      const name = String(hit?.name ?? "").trim();
      if (!k || !name) continue;
      hits.set(k, {
        name,
        itemId: String(hit?.itemId ?? ""),
        boardId: hit?.boardId ?? null,
        boardName: String(hit?.boardName ?? ""),
      });
    }
    return { ok: true, hits };
  } catch {
    // Never throws at a caller: a list a rep is reading must not break because
    // the directory is unreachable — the Monday fallback still runs.
    return { ok: false, hits };
  }
}

/**
 * Names for a batch, directory first and Monday for whatever it didn't know.
 *
 * This is the function callers want. The split matters:
 *
 *  · The directory answers instantly and costs Monday nothing, so it covers the
 *    overwhelming majority — every patient who existed yesterday.
 *  · The Monday `any_of` fallback covers the rest, and it is what keeps a
 *    patient added this morning from reading as a bare number. It runs ONLY on
 *    the leftovers, so on a warm directory it is usually not called at all.
 *
 * ⚠️ `ok` is false if EITHER side failed, so the caller doesn't cache a miss it
 * has not actually established.
 */
export async function resolveNames(keys: string[]): Promise<{ ok: boolean; names: Map<string, string> }> {
  const wanted = [...new Set(keys.map(key).filter((k) => k.length === 10))];
  const names = new Map<string, string>();
  if (!wanted.length) return { ok: true, names };

  const fromDb = await lookupDirectory(wanted);
  for (const [k, hit] of fromDb.hits) names.set(k, hit.name);

  const missing = wanted.filter((k) => !names.has(k));
  if (!missing.length) return { ok: fromDb.ok, names };

  const fromMonday = await fetchDirectoryNames(missing);
  for (const [k, name] of fromMonday.names) names.set(k, name);
  return { ok: fromDb.ok && fromMonday.ok, names };
}
