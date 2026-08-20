/**
 * Live status labels, read from the board instead of a hardcoded map (§5.2).
 *
 * The four product dropdowns — CGM Type, Pump Type, CGM Coverage Path,
 * Insulin Pump Coverage Path — take their options from the column's own
 * `settings_str`, so adding or renaming a status on Monday flows straight
 * through with no code edit.
 *
 * §5.2's three rules, and why each one bites:
 *
 *  1. **Write by INDEX, never by label.** Once labels come from the board a
 *     rename breaks any label-based write — silently, because Monday drops a
 *     status write for an unknown label without erroring. The index survives
 *     renames.
 *  2. **The board's labels ARE the picker's labels.** There is no hide-list
 *     any more (Josh, 2026-08-20): "Not Serving" used to be filtered out of
 *     the options, which let a rep read that value on a patient but never set
 *     one or correct one the cross-sell derivation had written. Display and
 *     write are still returned as two separate things — an ordered list and
 *     the full label→index map — because a display rule must never be able to
 *     reach the write path.
 *  3. **Never render an empty dropdown.** A failed fetch falls back to the
 *     hardcoded maps, so the page degrades to today's behaviour rather than to
 *     a blank select.
 *
 * Empty label slots are dropped: Monday leaves a hole behind when a status is
 * deleted, and it would otherwise render as a nameless option.
 */
import { MONDAY_API_URL, mondayIdentityHeaders } from "../shared/mondayEndpoint";
import { BOARD_ID } from "./mondayApi";

const MONDAY_API_VERSION = "2024-10";

export interface LiveLabels {
  /** label → index, the FULL set including hidden ones. Writes use this. */
  index: Record<string, number>;
  /** Display order, sorted by the board's own label positions. Pickers use
   *  this — it holds every label the column has. */
  options: string[];
}

interface Settings {
  labels?: Record<string, string>;
  labels_positions_v2?: Record<string, number>;
}

/** Parse one column's settings_str into an index map + ordered option list. */
export function parseSettings(settingsStr: string | null | undefined): LiveLabels | null {
  if (!settingsStr) return null;
  let s: Settings;
  try {
    s = JSON.parse(settingsStr) as Settings;
  } catch {
    return null;
  }
  const labels = s.labels ?? {};
  const entries = Object.entries(labels)
    .map(([idx, label]) => ({ idx: Number(idx), label: (label ?? "").trim() }))
    .filter((e) => Number.isFinite(e.idx) && e.label !== "");
  if (!entries.length) return null;

  const index: Record<string, number> = {};
  for (const e of entries) index[e.label] = e.idx;

  const pos = s.labels_positions_v2 ?? {};
  const options = entries
    .sort((a, b) => (pos[String(a.idx)] ?? a.idx) - (pos[String(b.idx)] ?? b.idx))
    .map((e) => e.label);

  return { index, options };
}

/** Cached for the session — the settings only change when someone edits the
 *  board, and this runs on every patient selection otherwise. */
let cache: Promise<Record<string, LiveLabels>> | null = null;

/** Fetch settings_str for the given status columns. Never throws: a failure
 *  resolves to `{}` so callers fall back to their hardcoded maps. */
export function fetchBoardLabels(columnIds: string[]): Promise<Record<string, LiveLabels>> {
  if (cache) return cache;
  const query = `
    query ($boardId: ID!, $ids: [String!]) {
      boards(ids: [$boardId]) { columns(ids: $ids) { id settings_str } }
    }
  `;
  cache = (async () => {
    try {
      const res = await fetch(MONDAY_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "API-Version": MONDAY_API_VERSION,
          ...mondayIdentityHeaders(),
        },
        body: JSON.stringify({ query, variables: { boardId: String(BOARD_ID), ids: columnIds } }),
      });
      const json = await res.json();
      const cols: { id: string; settings_str: string }[] = json?.data?.boards?.[0]?.columns ?? [];
      const out: Record<string, LiveLabels> = {};
      for (const c of cols) {
        const parsed = parseSettings(c.settings_str);
        if (parsed) out[c.id] = parsed;
      }
      return out;
    } catch (e) {
      console.warn("[boardLabels] settings fetch failed — using hardcoded maps", e);
      return {};
    }
  })();
  return cache;
}

/** Test seam: drop the session cache. */
export function resetBoardLabelCache(): void {
  cache = null;
}
