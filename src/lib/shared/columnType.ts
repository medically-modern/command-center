// Live column TYPE lookup — the one fact the 2000-character guard needs.
//
// WHY THIS EXISTS (2026-09-03). Monday's `long_text` column truncates SILENTLY
// at 2,000 characters; its plain `text` column has no fixed limit (~64KB per
// item — developer.monday.com/api-reference/reference/text; sandbox-verified:
// 4,782 chars stored intact in a text column, the same body cut to 2,000 in a
// long_text one). The notes columns are being converted long_text → text in the
// Monday UI (CLAUDE.md §10). Two things about that conversion shape this module:
//
//   1. The conversion may KEEP the column id, so an id's prefix (`long_text_…`)
//      can no longer be trusted to name its type. Never infer type from the id.
//   2. It happens in the Monday UI, board by board, on no deploy schedule — and
//      prod shares these boards with test but lags it by a sync. So the app
//      cannot carry a hard-coded type table; it asks the board, and caches.
//
// The WRITE path does not need this: a bare string through
// `change_multiple_column_values` is accepted for BOTH types (sandbox-verified),
// which is why every notes writer now sends one. Only the GUARD needs the type —
// whether a >2000 body must be refused — and the safe answer when it is unknown
// (first paint, a Monday 503, a column id that no longer exists) is "capped":
// over-refusing costs the rep a shorter note; under-refusing loses it silently.
//
// Same request shape and header rule as lib/shared/statusOptions.ts.
import { MONDAY_API_URL, mondayAuthHeaders, mondayIdentityHeaders } from "./mondayEndpoint";

const MONDAY_API_VERSION = "2024-10";

/**
 * Cache lifetime. A column's type changes exactly once (the conversion), but a
 * rep leaves a tab open all day — after a flip the guard should stop refusing
 * within minutes, not on the next reload.
 */
export const COLUMN_TYPE_TTL_MS = 5 * 60 * 1000;

type Entry = { type: string | undefined; fetchedAt: number };
const cache = new Map<string, Entry>();
/** In-flight fetches, so N callers at once make one request. */
const inflight = new Map<string, Promise<void>>();

const key = (boardId: number | string, columnId: string) => `${boardId}:${columnId}`;

/** Drop everything cached — tests, or right after a column is converted. */
export function invalidateColumnTypes(): void {
  cache.clear();
}

/** Synchronous peek at what is cached (undefined = never fetched / not on the board). */
export function columnTypeCached(boardId: number | string, columnId: string): string | undefined {
  return cache.get(key(boardId, columnId))?.type;
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "API-Version": MONDAY_API_VERSION,
      ...mondayAuthHeaders(),
      ...mondayIdentityHeaders(),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Monday ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }
  return json.data as T;
}

/**
 * Resolve the live Monday type of one or more columns on a board.
 * A column the board does not have maps to `undefined`. Throws on transport /
 * GraphQL failure — callers that need a safe default use `isCappedColumn`.
 */
export async function fetchColumnTypes(
  boardId: number | string,
  columnIds: string[],
): Promise<Record<string, string | undefined>> {
  const now = Date.now();
  const stale = columnIds.filter((id) => {
    const hit = cache.get(key(boardId, id));
    return !hit || now - hit.fetchedAt >= COLUMN_TYPE_TTL_MS;
  });

  if (stale.length > 0) {
    const batchKey = key(boardId, stale.slice().sort().join(","));
    let pending = inflight.get(batchKey);
    if (!pending) {
      const query = `
        query ($boardId: [ID!], $cols: [String!]) {
          boards(ids: $boardId) { columns(ids: $cols) { id type } }
        }
      `;
      pending = gql<{ boards: { columns: { id: string; type: string }[] }[] }>(query, {
        boardId: [String(boardId)],
        cols: stale,
      })
        .then((data) => {
          const at = Date.now();
          const seen = new Set<string>();
          for (const col of data.boards?.[0]?.columns ?? []) {
            cache.set(key(boardId, col.id), { type: col.type, fetchedAt: at });
            seen.add(col.id);
          }
          // Asked for, not returned: the column is not on this board. Cache that
          // too, or every guard call re-asks about a deleted/replaced id.
          for (const id of stale) if (!seen.has(id)) cache.set(key(boardId, id), { type: undefined, fetchedAt: at });
        })
        .finally(() => {
          inflight.delete(batchKey);
        });
      inflight.set(batchKey, pending);
    }
    await pending;
  }

  const out: Record<string, string | undefined> = {};
  for (const id of columnIds) out[id] = cache.get(key(boardId, id))?.type;
  return out;
}

/**
 * Does Monday's 2,000-character long_text cap apply to this column?
 *
 * `false` ONLY for a column the board reports as plain `text`. Everything else —
 * long_text, an unknown id, a failed lookup — is `true`: the guard stays on.
 * Never throws.
 */
export async function isCappedColumn(boardId: number | string, columnId: string): Promise<boolean> {
  try {
    const type = (await fetchColumnTypes(boardId, [columnId]))[columnId];
    return type !== "text";
  } catch {
    return true;
  }
}
