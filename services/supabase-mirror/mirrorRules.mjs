/**
 * The mirror's pure rules — what to ask monday, and how a monday answer turns
 * into rows. No I/O here; `index.mjs` does the fetching and the writing, so
 * every rule below is testable without a network or a database.
 *
 * ⚠️ READ-ONLY ON MONDAY. Every document this file builds is a `query`.
 * `noMondayWrites.test.mjs` scans the whole service for the word `mutation`.
 */
import { createHash } from "node:crypto";

/** Pseudo-columns in item_changes for the parts of an item that are not cells. */
export const PSEUDO = { name: "__name__", group: "__group__", state: "__state__" };

// ── What to ask monday ────────────────────────────────────────────────────

/** The board's shape: groups, columns (with settings) and the item count. */
export function shapeQuery(boardId) {
  return {
    query: `query ($boardId: ID!) {
      complexity { query after }
      boards(ids: [$boardId]) {
        id name items_count
        groups { id title color position archived deleted }
        columns { id title type description settings_str archived }
      }
    }`,
    variables: { boardId: String(boardId) },
  };
}

/**
 * One page of items, every column. `cursor` continues the previous page.
 * ⚠️ Cost is items × columns (measured 2026-09-29: 25 items × 164 columns
 * = 4,595 complexity), so the page size is what bounds a single request.
 */
export function itemsPageQuery(boardId, { limit = 50, cursor = null, orderByUpdated = false } = {}) {
  const params = orderByUpdated
    ? `, query_params: { order_by: [{ column_id: "__last_updated__", direction: desc }] }`
    : "";
  if (cursor) {
    return {
      query: `query ($cursor: String!, $limit: Int!) {
        complexity { query after }
        next_items_page(cursor: $cursor, limit: $limit) {
          cursor
          items { id name created_at updated_at group { id } column_values { id type text value } }
        }
      }`,
      variables: { cursor, limit },
    };
  }
  return {
    query: `query ($boardId: ID!, $limit: Int!) {
      complexity { query after }
      boards(ids: [$boardId]) {
        items_page(limit: $limit${params}) {
          cursor
          items { id name created_at updated_at group { id } column_values { id type text value } }
        }
      }
    }`,
    variables: { boardId: String(boardId), limit },
  };
}

/** A cheap page: ids, group and updated_at only — the reconcile scan. */
export function idsPageQuery(boardId, { limit = 250, cursor = null } = {}) {
  if (cursor) {
    return {
      query: `query ($cursor: String!, $limit: Int!) {
        complexity { query after }
        next_items_page(cursor: $cursor, limit: $limit) { cursor items { id created_at updated_at group { id } } }
      }`,
      variables: { cursor, limit },
    };
  }
  return {
    query: `query ($boardId: ID!, $limit: Int!) {
      complexity { query after }
      boards(ids: [$boardId]) { items_page(limit: $limit) { cursor items { id created_at updated_at group { id } } } }
    }`,
    variables: { boardId: String(boardId), limit },
  };
}

/** Specific items in full, by id (≤ 100 per call). */
export function itemsByIdQuery(ids) {
  return {
    query: `query ($ids: [ID!]) {
      complexity { query after }
      items(ids: $ids) { id name created_at updated_at group { id } column_values { id type text value } }
    }`,
    variables: { ids: ids.map(String) },
  };
}

/** The page's items and cursor, whichever of the two shapes answered. */
export function pageOf(data) {
  const page = data?.next_items_page ?? data?.boards?.[0]?.items_page ?? null;
  return { items: page?.items ?? [], cursor: page?.cursor ?? null };
}

// ── Turning answers into rows ─────────────────────────────────────────────

/** settings_str → parsed settings, or {} when it is not JSON. */
export function parseSettings(settingsStr) {
  if (!settingsStr) return {};
  try {
    const v = JSON.parse(settingsStr);
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/**
 * The label rows a status or dropdown column defines.
 *  · status:   settings.labels is {"0": "Yes", "1": "No"} (an object keyed by id),
 *              with colours under labels_colors and done flags under done_colors;
 *              the MCP snapshot flattens it to [{id,label,hex,is_done,is_deactivated}].
 *  · dropdown: settings.labels is [{id, name}].
 * Both shapes are accepted, because the mirror reads settings_str live and the
 * seed reads the snapshot.
 */
export function labelsOf(column) {
  const s = column.settings && typeof column.settings === "object" ? column.settings : parseSettings(column.settings_str);
  const raw = s.labels;
  const out = [];
  if (Array.isArray(raw)) {
    for (const l of raw) {
      const id = l.id ?? l.index;
      const label = l.label ?? l.name;
      if (id == null || label == null) continue;
      out.push({ label_id: Number(id), label: String(label), hex: l.hex ?? null, is_done: l.is_done ?? null, is_deactivated: l.is_deactivated ?? null });
    }
  } else if (raw && typeof raw === "object") {
    // Measured on the live board (2026-09-29): labels_colors[id].color is the
    // hex, done_colors lists the label IDS that count as done.
    const colors = s.labels_colors || {};
    const done = new Set((s.done_colors || []).map(String));
    const deactivated = new Set((s.deactivated_labels || []).map(String));
    for (const [id, label] of Object.entries(raw)) {
      if (!/^\d+$/.test(id)) continue;
      out.push({
        label_id: Number(id),
        label: String(label),
        hex: colors[id]?.color ?? null,
        is_done: done.has(id) ? true : null,
        is_deactivated: deactivated.has(id) ? true : null,
      });
    }
  }
  return out.sort((a, b) => a.label_id - b.label_id);
}

/** A cell's JSON value, parsed; null for blank or unparseable. */
export function parseCellValue(raw) {
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** A stable hash of what the mirror stores, so an unchanged item is a no-op. */
export function hashValues(name, groupId, columnValues) {
  const ids = Object.keys(columnValues).sort();
  const h = createHash("sha1");
  h.update(String(name)).update("\u0000").update(String(groupId)).update("\u0000");
  for (const id of ids) {
    const c = columnValues[id];
    h.update(id).update("\u0001").update(c.text ?? "").update("\u0001").update(c.value == null ? "" : JSON.stringify(c.value)).update("\u0002");
  }
  return h.digest("hex");
}

/** A monday item → the row the mirror keeps. */
export function normalizeItem(raw, boardId) {
  const column_values = {};
  for (const c of raw.column_values ?? []) {
    column_values[c.id] = { text: c.text ?? null, value: parseCellValue(c.value) };
  }
  const group_id = raw.group?.id ?? "";
  return {
    item_id: Number(raw.id),
    board_id: Number(boardId),
    name: raw.name ?? "",
    group_id,
    monday_created_at: raw.created_at ?? null,
    monday_updated_at: raw.updated_at ?? null,
    column_values,
    values_hash: hashValues(raw.name ?? "", group_id, column_values),
  };
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * What changed between the row the mirror holds and the row just read — one
 * entry per differing column, plus name / group. `prev` null means a new
 * item, which records no changes (its first state is the row itself).
 */
export function diffItems(prev, next) {
  if (!prev) return [];
  const changes = [];
  if (prev.name !== next.name) changes.push({ column_id: PSEUDO.name, old_text: prev.name, new_text: next.name, old_value: null, new_value: null });
  if (prev.group_id !== next.group_id) changes.push({ column_id: PSEUDO.group, old_text: prev.group_id, new_text: next.group_id, old_value: null, new_value: null });
  if (prev.state && next.state && prev.state !== next.state) changes.push({ column_id: PSEUDO.state, old_text: prev.state, new_text: next.state, old_value: null, new_value: null });
  const ids = new Set([...Object.keys(prev.column_values ?? {}), ...Object.keys(next.column_values ?? {})]);
  for (const id of [...ids].sort()) {
    const a = prev.column_values?.[id] ?? { text: null, value: null };
    const b = next.column_values?.[id] ?? { text: null, value: null };
    if ((a.text ?? null) === (b.text ?? null) && sameJson(a.value, b.value)) continue;
    changes.push({ column_id: id, old_text: a.text ?? null, new_text: b.text ?? null, old_value: a.value ?? null, new_value: b.value ?? null });
  }
  return changes;
}

// ── Pacing ────────────────────────────────────────────────────────────────

/**
 * The watermark an incremental pass reads back to: the previous pass's start
 * minus an overlap, because monday's updated_at is set when the write lands
 * and a poll can read a page while a later write is still in flight.
 */
export function incrementalSince(lastRunStartedAt, overlapSeconds = 300) {
  if (!lastRunStartedAt) return null;
  const t = new Date(lastRunStartedAt).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t - overlapSeconds * 1000).toISOString();
}

/** Walk a page ordered newest-first: keep the items at/after `since`, and say whether to stop. */
export function takeUpdatedSince(items, sinceIso) {
  if (!sinceIso) return { items, done: false };
  const since = new Date(sinceIso).getTime();
  const kept = [];
  let done = false;
  for (const it of items) {
    const t = new Date(it.updated_at ?? 0).getTime();
    if (t >= since) kept.push(it);
    else {
      done = true;
      break;
    }
  }
  return { items: kept, done };
}

/**
 * The "start empty" scope (MIRROR_CREATED_SINCE): keep only items created
 * at/after `sinceIso`. Patients already on the board when the mirror went
 * live stay monday-only — even their later updates are ignored. Blank since
 * keeps everything. With a scope set, an item whose created_at is missing or
 * unreadable is dropped: it cannot be shown to be in scope.
 */
export function takeCreatedSince(items, sinceIso) {
  if (!sinceIso) return items;
  const since = new Date(sinceIso).getTime();
  return items.filter((it) => {
    const t = new Date(it.created_at ?? "").getTime();
    return Number.isFinite(t) && t >= since;
  });
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/**
 * Whether a reconcile pass is due: never run, or older than `everyHours`.
 * (Nightly by default — it is an ids-only scan of the whole board, ~2k
 * complexity per 100 items, so cheap, but there is no reason to run it often.)
 */
export function reconcileDue(lastReconcileAt, now = Date.now(), everyHours = 24) {
  if (!lastReconcileAt) return true;
  const t = new Date(lastReconcileAt).getTime();
  return !Number.isFinite(t) || now - t >= everyHours * 3600 * 1000;
}

/**
 * From a reconcile scan: which mirrored items monday no longer lists, and
 * which listed items the mirror holds a stale copy of (a different group or
 * updated_at — a move that did not touch updated_at shows up here).
 */
export function reconcilePlan(mirrorRows, scannedItems) {
  const seen = new Map(scannedItems.map((it) => [Number(it.id), it]));
  const missing = [];
  const stale = [];
  for (const row of mirrorRows) {
    const s = seen.get(Number(row.item_id));
    if (!s) {
      if (row.state !== "missing") missing.push(row.item_id);
      continue;
    }
    const sameUpdated = String(row.monday_updated_at ?? "") === String(s.updated_at ?? "") ||
      (row.monday_updated_at && s.updated_at && new Date(row.monday_updated_at).getTime() === new Date(s.updated_at).getTime());
    if (row.state === "missing" || row.group_id !== (s.group?.id ?? "") || !sameUpdated) stale.push(Number(s.id));
  }
  const known = new Set(mirrorRows.map((r) => Number(r.item_id)));
  const unknown = scannedItems.map((it) => Number(it.id)).filter((id) => !known.has(id));
  return { missing, stale: [...stale, ...unknown] };
}
