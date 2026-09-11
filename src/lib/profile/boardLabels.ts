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
import { MONDAY_API_URL, mondayAuthHeaders, mondayIdentityHeaders } from "../shared/mondayEndpoint";
import { BOARD_ID, COL } from "./mondayApi";

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

/**
 * Cache lifetime.
 *
 * This used to be a single session-lifetime promise, which was wrong twice.
 *
 *  1. **It ignored `columnIds`.** The first caller's column set won for the
 *     rest of the session, so a second call site asking for different columns
 *     silently got `{}` and fell back to its hardcoded map for ever — the
 *     usual shape here: no error, just a dropdown quietly missing a label.
 *     The cache is per COLUMN now, and a call fetches only what it is missing.
 *  2. **It never expired.** Reps hold these pages open all day, which is
 *     exactly the window in which somebody adds a payer on Monday. A
 *     session-lifetime cache meant "added on the board" reached them on their
 *     next full reload, not on their next patient. Same reasoning, and the
 *     same five minutes, as `shared/statusOptions.ts`.
 */
export const BOARD_LABELS_TTL_MS = 5 * 60 * 1000;

interface Entry { labels: LiveLabels; fetchedAt: number }

const cache = new Map<string, Entry>();
/** In-flight fetches, so N components mounting at once make one request. */
const inflight = new Map<string, Promise<void>>();

/** Fetch settings_str for the given status columns. Never throws: a failure
 *  resolves to whatever is already cached (usually `{}`), so callers fall back
 *  to their hardcoded maps rather than rendering an empty select. */
export function fetchBoardLabels(columnIds: string[]): Promise<Record<string, LiveLabels>> {
  const now = Date.now();
  const stale = columnIds.filter((id) => {
    const hit = cache.get(id);
    return !hit || now - hit.fetchedAt >= BOARD_LABELS_TTL_MS;
  });

  const done = stale.length === 0 ? Promise.resolve() : (() => {
    const batchKey = stale.slice().sort().join(",");
    let pending = inflight.get(batchKey);
    if (!pending) {
      pending = loadColumns(stale).finally(() => { inflight.delete(batchKey); });
      inflight.set(batchKey, pending);
    }
    return pending;
  })();

  return done.then(() => {
    const out: Record<string, LiveLabels> = {};
    for (const id of columnIds) {
      const hit = cache.get(id);
      // A column the fetch could not parse is OMITTED rather than mapped to an
      // empty LiveLabels: `productOptions` keys off absence to choose the
      // hardcoded fallback, and an empty-but-present entry would render a
      // dropdown with no options in it.
      if (hit) out[id] = hit.labels;
    }
    return out;
  });
}

async function loadColumns(columnIds: string[]): Promise<void> {
  const query = `
    query ($boardId: ID!, $ids: [String!]) {
      boards(ids: [$boardId]) { columns(ids: $ids) { id settings_str } }
    }
  `;
  try {
    const res = await fetch(MONDAY_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "API-Version": MONDAY_API_VERSION,
        // BOTH header sets, for the reason `shared/statusOptions.ts` spells
        // out: mondayIdentityHeaders() carries only the caller's Google
        // identity for the audit log and returns {} outright when the gateway
        // is not configured. Identity alone means NO Authorization header in
        // direct mode, so every request 401s and every dropdown silently sits
        // on its hardcoded fallback for ever.
        ...mondayAuthHeaders(),
        ...mondayIdentityHeaders(),
      },
      body: JSON.stringify({ query, variables: { boardId: String(BOARD_ID), ids: columnIds } }),
    });
    const json = await res.json();
    const cols: { id: string; settings_str: string }[] = json?.data?.boards?.[0]?.columns ?? [];
    const at = Date.now();
    for (const c of cols) {
      const parsed = parseSettings(c.settings_str);
      if (parsed) cache.set(c.id, { labels: parsed, fetchedAt: at });
    }
  } catch (e) {
    // Deliberately not rethrown and deliberately NOT cached as a failure: the
    // next call retries, and until it succeeds the caller keeps the hardcoded
    // maps it already had.
    console.warn("[boardLabels] settings fetch failed — using hardcoded maps", e);
  }
}

/** Test seam: drop the cache. */
export function resetBoardLabelCache(): void {
  cache.clear();
  inflight.clear();
}

// ── The insurance pair ───────────────────────────────────────────────────────

/**
 * Primary Insurance and General Insurance read their labels from the board, so
 * a payer added on Monday shows up in the Command Center on its own (Josh,
 * 2026-09-11, adding "Health Plans Inc (PHCS)").
 *
 * ⚠️ **The picker and the write have to move together.** Offering a label the
 * write path cannot resolve is worse than not offering it: `statusWriteTask`
 * and `mapped()` both SKIP an index they can't find, so the rep picks the new
 * payer, Save goes green, and the column silently keeps its old value. That is
 * why every writer of these two columns takes a live index, not just the two
 * pages that draw the dropdowns.
 *
 * The hardcoded maps in `mondayMapping.ts` stay as the fallback — checked
 * against the live board 2026-09-11 and correct for every label except the new
 * one — so a Monday blip degrades this to exactly today's behaviour rather than
 * to an empty select or a blocked intake. That is the posture this page's four
 * product dropdowns already take, and it is deliberately NOT the stricter
 * disable-the-control rule in `shared/statusOptions.ts`: that one exists for
 * columns whose indexes were RENUMBERED by a dedup, where a stale map writes a
 * blank. These two have never been renumbered, and a disabled payer picker
 * blocks intake outright.
 */
export const INSURANCE_LABEL_COLUMN_IDS: string[] = [COL.generalInsurance, COL.primaryInsurance];

/** The write half of a `fetchBoardLabels` result: label → index, per column. */
export function toLiveIndex(
  live: Record<string, LiveLabels>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [id, l] of Object.entries(live)) out[id] = l.index;
  return out;
}

/**
 * Live label → index for the two insurance columns, for write paths that have
 * no React state to read it from. Cached, so this is a hit in the normal case;
 * resolves to `{}` if the board can't be reached, which sends every caller to
 * its hardcoded map.
 */
export async function fetchInsuranceLabelIndex(): Promise<Record<string, Record<string, number>>> {
  return toLiveIndex(await fetchBoardLabels(INSURANCE_LABEL_COLUMN_IDS));
}

/**
 * Labels that live on an insurance column but are not payers a rep may pick.
 *
 * Only one today: **"Stedi"** on General Insurance, removed from this picker on
 * 2026-08-13 (Katie via Josh) because it is our ELIGIBILITY VENDOR and was
 * being offered to reps as if it were a health plan. That decision predates
 * these options coming from the board, and reading the column live would have
 * silently put it back.
 *
 * ⚠️ Keep this list AS SHORT AS THE EVIDENCE. It is a hide-list, and §5.2's
 * standing rule is that the board's labels are the picker's labels — "Not
 * Serving" was hidden from a product dropdown once and the cost was a rep who
 * could read a value on a patient but never set or correct one. An entry here
 * needs a decision behind it, not a hunch that a label looks odd. "Cash Pay"
 * is deliberately NOT here: it is a real answer, nothing has ever ruled it out,
 * and it was missing from the picker only because nobody added it to the
 * hardcoded map.
 *
 * Primary Insurance has no entry: "Stedi" is on that column too and has always
 * been pickable there, so hiding it now would be a new decision, not this one.
 */
export const NON_PAYER_LABELS: Record<string, readonly string[]> = {
  [COL.generalInsurance]: ["Stedi"],
};

/** Board options for an insurance picker, minus the non-payer labels above. */
export function payerOptions(columnId: string, options: string[]): string[] {
  const hidden = NON_PAYER_LABELS[columnId];
  if (!hidden?.length) return options;
  return options.filter((l) => !hidden.includes(l));
}
