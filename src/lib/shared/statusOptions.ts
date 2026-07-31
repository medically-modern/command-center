// Live status-column options, read from the board instead of hardcoded in the app.
//
// WHY THIS EXISTS (July 2026 infusion-set dedup):
// Role slices used to carry hardcoded `{ index, label }[]` tables and write the
// index with `writeStatusIndex`. The index is the ONLY binding — the label string
// is display-only — so when the Subscription board's duplicate infusion-set labels
// were deleted, 17 of 49 dropdown options started pointing at indexes that no
// longer existed. Nothing surfaced it: the dropdown still rendered, the rep still
// picked, and the subscription send has no read-back verification (audit H6), so
// confetti fired anyway. Ten of those options were worse than dead — the product
// appeared TWICE with identical text and only one entry worked.
//
// The two patient-facing Railway backends (`reorder-patient-form`,
// `mm-subscriber-portal`) never had this problem because they resolve label →
// index from the live board at request time. This is that pattern for the SPA.
//
// RULE: never write a status index you did not just read from the board. If the
// options can't be loaded, the caller must disable the control rather than fall
// back to a hardcoded list — a stale index writes "successfully" and lands blank.

import {
  MONDAY_API_URL,
  mondayAuthHeaders,
  mondayIdentityHeaders,
} from "./mondayEndpoint";

const MONDAY_API_VERSION = "2024-10";

export type StatusOption = { index: number; label: string };

/**
 * Cache lifetime. Board labels are edited rarely but they ARE edited, and the
 * failure mode of a stale entry is a silent blank on a patient's order — so this
 * expires rather than living for the tab's lifetime. A rep leaves a tab open all
 * day; a process-lifetime cache is the same bug the backends had.
 */
export const STATUS_OPTIONS_TTL_MS = 5 * 60 * 1000;

type Entry = { options: StatusOption[]; fetchedAt: number };
const cache = new Map<string, Entry>();
/** In-flight fetches, so N components mounting at once make one request. */
const inflight = new Map<string, Promise<void>>();

const key = (boardId: number | string, columnId: string) => `${boardId}:${columnId}`;

/** Drop cached options — call after the app itself changes a column's labels. */
export function invalidateStatusOptions(): void {
  cache.clear();
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  // BOTH header sets are required, and the split is easy to get wrong:
  // mondayAuthHeaders() carries `Authorization` (the bundled token, which the
  // gateway ignores), while mondayIdentityHeaders() carries only the caller's
  // Google identity for the audit log — and returns {} outright when the
  // gateway is not configured. Sending identity alone means NO Authorization
  // header in direct mode, so every request 401s and the dropdowns sit disabled
  // forever. Every other gql() in this app sets Authorization explicitly; this
  // one must too.
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
 * Parse one column's `settings_str` into ordered options.
 *
 * Drops Monday's reserved blank label (the "unset" sentinel, not a product) and
 * any deactivated label, and honours `labels_positions_v2` so the dropdown matches
 * the board's own ordering rather than numeric index order — index order is
 * meaningless to a rep, and after a dedup the surviving indexes are scattered.
 */
export function parseStatusSettings(settingsStr: string): StatusOption[] {
  let parsed: {
    labels?: Record<string, string>;
    labels_positions_v2?: Record<string, number>;
    deactivated_labels?: (string | number)[];
  } = {};
  try {
    parsed = JSON.parse(settingsStr || "{}");
  } catch {
    return [];
  }
  const dead = new Set((parsed.deactivated_labels ?? []).map(String));
  const positions = parsed.labels_positions_v2 ?? {};
  return Object.entries(parsed.labels ?? {})
    .filter(([idx, label]) => !!label && !dead.has(idx))
    .map(([idx, label]) => ({ index: Number(idx), label }))
    .filter((o) => !Number.isNaN(o.index))
    .sort((a, b) => {
      const pa = positions[String(a.index)] ?? a.index;
      const pb = positions[String(b.index)] ?? b.index;
      return pa - pb;
    });
}

/**
 * Fetch live options for one or more status columns on a board.
 * Returns a map keyed by column id. Columns that came back empty map to `[]`.
 */
export async function fetchStatusOptions(
  boardId: number | string,
  columnIds: string[],
): Promise<Record<string, StatusOption[]>> {
  const now = Date.now();
  const stale = columnIds.filter((id) => {
    const hit = cache.get(key(boardId, id));
    return !hit || now - hit.fetchedAt >= STATUS_OPTIONS_TTL_MS;
  });

  if (stale.length > 0) {
    const batchKey = key(boardId, stale.slice().sort().join(","));
    let pending = inflight.get(batchKey);
    if (!pending) {
      const query = `
        query ($boardId: [ID!], $cols: [String!]) {
          boards(ids: $boardId) { columns(ids: $cols) { id settings_str } }
        }
      `;
      pending = gql<{ boards: { columns: { id: string; settings_str: string }[] }[] }>(query, {
        boardId: [String(boardId)],
        cols: stale,
      })
        .then((data) => {
          const at = Date.now();
          for (const col of data.boards?.[0]?.columns ?? []) {
            cache.set(key(boardId, col.id), {
              options: parseStatusSettings(col.settings_str),
              fetchedAt: at,
            });
          }
        })
        .finally(() => {
          inflight.delete(batchKey);
        });
      inflight.set(batchKey, pending);
    }
    await pending;
  }

  const out: Record<string, StatusOption[]> = {};
  for (const id of columnIds) out[id] = cache.get(key(boardId, id))?.options ?? [];
  return out;
}

/**
 * Resolve a label to its live index. Returns null when the label is not on the
 * board — callers must treat that as a failure, never as "write anyway".
 * Whitespace is collapsed for the comparison because board labels have carried
 * doubled and non-breaking spaces; casing is NOT folded, since Monday's own
 * matching is case-sensitive and two casings are a genuine mismatch.
 */
export function indexForLabel(options: StatusOption[], label: string): number | null {
  // U+00A0 (non-breaking space) and U+202F (narrow no-break space) both occur
  // in real board labels; written as escapes so they are visible in review and
  // don't trip the no-irregular-whitespace lint.
  const norm = (s: string) =>
    String(s ?? "")
      .replace(/[\u00A0\u202F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const want = norm(label);
  if (!want) return null;
  // Always prefer the HIGHEST matching index, for exact and whitespace-folded
  // matches alike. Two reasons this must be uniform: a column can carry the SAME
  // string on two indexes (Subscription Set 1 held 'AutoSoft XC 6 mm 23"' on both
  // 6 and 107), and after a dedup the clean, single-spaced label is generally the
  // later-created one — which is the spelling the downstream board copy expects.
  // This is the same rule the two patient-facing backends get implicitly, by
  // letting later keys overwrite earlier ones as they build their lookup map.
  const highest = (matches: StatusOption[]) =>
    matches.length > 0 ? matches.reduce((a, b) => (b.index > a.index ? b : a)).index : null;
  return (
    highest(options.filter((o) => o.label === label)) ??
    highest(options.filter((o) => norm(o.label) === want))
  );
}
