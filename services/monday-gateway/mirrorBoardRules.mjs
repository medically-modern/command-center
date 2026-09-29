/**
 * The Supabase board view's pure rules: what to read from `monday_mirror`,
 * and how those rows become the payload the Monday-style board page draws.
 * No I/O here — `mirrorBoard.mjs` does the reading, inside a READ ONLY
 * transaction (docs/claude/5.55).
 *
 * ⚠️ The payload is PHI (patient names and every column). It goes only to a
 * signed-in employee, and nothing here or in the route logs it.
 */

/** A monday board id: digits only, so it is safe to bind and never echoes junk. */
export function validBoardId(raw) {
  const s = String(raw ?? "").trim();
  return /^\d{6,15}$/.test(s) ? s : null;
}

/**
 * The five reads, all bound to one board. Groups, columns and labels are the
 * ones the mirror saw in its latest shape passes: the mirror upserts and never
 * deletes, so a column deleted on monday lingers with an old `seen_at` — it
 * drops out of the page an hour after monday stopped listing it.
 */
export const BOARD_SQL = {
  board: `SELECT board_id, name, items_count, shape_synced_at, last_full_sync_at, last_incremental_sync_at
            FROM monday_mirror.boards WHERE board_id = $1`,
  groups: `SELECT group_id, title, color, position FROM monday_mirror.groups g
            WHERE board_id = $1 AND NOT archived AND NOT deleted
              AND seen_at > (SELECT max(seen_at) FROM monday_mirror.groups WHERE board_id = $1) - interval '1 hour'`,
  columns: `SELECT column_id, title, type, position FROM monday_mirror.columns
            WHERE board_id = $1 AND NOT archived
              AND seen_at > (SELECT max(seen_at) FROM monday_mirror.columns WHERE board_id = $1) - interval '1 hour'
            ORDER BY position NULLS LAST, column_id`,
  labels: `SELECT column_id, label_id, label, hex FROM monday_mirror.labels
            WHERE board_id = $1
              AND seen_at > (SELECT max(seen_at) FROM monday_mirror.labels WHERE board_id = $1) - interval '1 hour'`,
  items: `SELECT item_id, name, group_id, monday_created_at, monday_updated_at, column_values
            FROM monday_mirror.items WHERE board_id = $1 AND state = 'active'
            ORDER BY monday_created_at DESC NULLS LAST LIMIT $2`,
};

/** A generous ceiling: the board holds ~2,800 items; the mirror starts empty. */
export const ITEM_LIMIT = 5000;

/** monday's group `position` is a decimal string ("65536.0"); order numerically. */
function positionOf(p) {
  const n = parseFloat(p);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

const iso = (d) => (d == null ? null : d instanceof Date ? d.toISOString() : String(d));

/**
 * One cell, compacted for the wire: omitted when blank; `t` is monday's own
 * display text. Status cells add the label id `i` (the colour lookup), dropdowns
 * their label ids, files a count (never the names or URLs — a file column's
 * text is a login-walled URL, §5.30f, useless in a browser anyway).
 */
export function compactCell(type, cell) {
  if (!cell) return null;
  const text = cell.text == null ? "" : String(cell.text);
  const v = cell.value && typeof cell.value === "object" ? cell.value : null;
  if (type === "file") {
    const n = Array.isArray(v?.files) ? v.files.length : 0;
    return n ? { n } : null;
  }
  if (type === "status") {
    const i = Number.isInteger(v?.index) ? v.index : null;
    if (!text && i == null) return null;
    return i == null ? { t: text } : { t: text, i };
  }
  if (type === "dropdown") {
    const ids = Array.isArray(v?.ids) ? v.ids.map(Number).filter(Number.isFinite) : [];
    if (!text && !ids.length) return null;
    return ids.length ? { t: text, ids } : { t: text };
  }
  return text ? { t: text } : null;
}

/** Rows from BOARD_SQL → the page's payload. */
export function shapeBoard({ board, groups, columns, labels, items }) {
  const cols = (columns ?? [])
    .filter((c) => c.type !== "name") // the item name is drawn as the row title
    .map((c) => ({ id: c.column_id, title: c.title, type: c.type }));
  const typeOf = new Map(cols.map((c) => [c.id, c.type]));

  const labelMap = {};
  for (const l of labels ?? []) {
    (labelMap[l.column_id] ??= {})[l.label_id] = { label: l.label, hex: l.hex ?? null };
  }

  const shapedItems = (items ?? []).map((it) => {
    const cells = {};
    const cv = it.column_values && typeof it.column_values === "object" ? it.column_values : {};
    for (const [id, type] of typeOf) {
      const c = compactCell(type, cv[id]);
      if (c) cells[id] = c;
    }
    return {
      id: String(it.item_id),
      name: it.name ?? "",
      groupId: it.group_id ?? "",
      createdAt: iso(it.monday_created_at),
      updatedAt: iso(it.monday_updated_at),
      cells,
    };
  });

  return {
    ok: true,
    board: {
      id: String(board.board_id),
      name: board.name,
      itemsOnMonday: board.items_count ?? null,
      syncedAt: iso(board.last_incremental_sync_at ?? board.last_full_sync_at ?? board.shape_synced_at),
    },
    groups: [...(groups ?? [])]
      .sort((a, b) => positionOf(a.position) - positionOf(b.position))
      .map((g) => ({ id: g.group_id, title: g.title, color: g.color ?? null })),
    columns: cols,
    labels: labelMap,
    items: shapedItems,
  };
}
