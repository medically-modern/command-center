/**
 * Column-write extraction for the audit log.
 *
 * Pulled out of index.mjs so it can be unit-tested without booting the server.
 * Nothing here touches the proxy path — the result is written to gql_log and
 * read by nothing else.
 *
 * WHY THIS EXISTS IN THIS SHAPE
 * -----------------------------
 * The original extractor parsed only the mutation TEXT, on the assumption that
 * "the app builds inline mutations (value JSON inline, not variables)". That is
 * true for exactly one helper (writeDropdownLabels, which must inline because
 * create_labels_if_missing is a top-level mutation arg). Every other write —
 * writeText, writeStatusIndex, writeDate, writeNumber, writePhone, writeEmail,
 * writeLocation, writeDropdownIds — sends:
 *
 *     change_column_value(..., column_id: $columnId, value: $value)
 *
 * so `column_id: "X"` never matches and the write was logged with columns=NULL.
 * Measured over 2026-07-22..27: 2,320 of 2,633 mutations (88.1%) recorded
 * nothing at all, and a further 60 recorded {"name": null} — the column id
 * found inline but the value sitting in a variable.
 *
 * Cost of that gap: Catherine Raska (item 12624053600, 2026-07-24). Member ID 1
 * was overwritten with the prescriber's name and advanced to the next board.
 * The value was in the request the gateway forwarded, and was not stored.
 *
 * This version resolves $placeholders against the variables object, so the
 * audit log records what was actually written regardless of how the caller
 * chose to send it.
 */

/**
 * Monday column values arrive JSON-encoded more often than not:
 *   writeText          → '"LINDSAY GAETANI"'   (JSON string)
 *   writeStatusIndex   → '{"index":3}'          (JSON object)
 *   writeItemName      → 'Catherine Raska'      (raw — change_simple_column_value)
 * Decode when we can, keep the raw string when we can't. Never throws.
 */
export function coerceColumnValue(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** Read a GraphQL $placeholder out of the variables object. */
function fromVars(vars, name) {
  if (!vars || typeof vars !== "object") return undefined;
  return Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined;
}

/**
 * Extract the column writes a mutation performs, as { columnId: value }.
 *
 * Handles both forms for every field:
 *   inline    column_id: "text_mm1x2qk2", value: "{...}"
 *   variable  column_id: $columnId,       value: $value
 * and both single-column (change_column_value / change_simple_column_value)
 * and bulk (change_multiple_column_values) mutations.
 *
 * Returns null when the mutation writes no columns. NEVER throws — the caller
 * runs after the client response has already been sent, so an exception here
 * would be pointless noise at best.
 */
export function extractColumns(query, vars) {
  try {
    const q = String(query || "");
    const out = {};

    // ── change_multiple_column_values(column_values: …) ──
    // Inline literal first (a doubly-encoded JSON string), then $placeholder.
    const multiLit = q.match(/column_values:\s*("(?:[^"\\]|\\.)*")/);
    if (multiLit) {
      try {
        Object.assign(out, JSON.parse(JSON.parse(multiLit[1])));
      } catch {
        /* not valid JSON — skip rather than lose the whole record */
      }
    } else {
      const multiVar = q.match(/column_values:\s*\$([A-Za-z_][A-Za-z0-9_]*)/);
      if (multiVar) {
        const parsed = coerceColumnValue(fromVars(vars, multiVar[1]));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          Object.assign(out, parsed);
        }
      }
    }

    // ── change_column_value / change_simple_column_value ──
    let colId = null;
    const colLit = q.match(/column_id:\s*"([^"]+)"/);
    if (colLit) {
      colId = colLit[1];
    } else {
      const colVar = q.match(/column_id:\s*\$([A-Za-z_][A-Za-z0-9_]*)/);
      const resolved = colVar ? fromVars(vars, colVar[1]) : undefined;
      if (resolved != null) colId = String(resolved);
    }

    if (colId) {
      // `value:` is anchored to a delimiter so it can't match inside
      // `column_values:` or the `$value: JSON!` variable declaration.
      let val;
      const valLit = q.match(/[\s,(]value:\s*("(?:[^"\\]|\\.)*")/);
      if (valLit) {
        try {
          val = JSON.parse(JSON.parse(valLit[1])); // doubly-encoded
        } catch {
          try {
            val = JSON.parse(valLit[1]);
          } catch {
            val = valLit[1];
          }
        }
      } else {
        const valVar = q.match(/[\s,(]value:\s*\$([A-Za-z_][A-Za-z0-9_]*)/);
        if (valVar) val = coerceColumnValue(fromVars(vars, valVar[1]));
      }
      out[colId] = val === undefined ? null : val;
    }

    return Object.keys(out).length ? out : null;
  } catch {
    // Extraction must never be the reason a request errors, even post-response.
    return null;
  }
}
