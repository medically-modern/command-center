/**
 * The header's global patient search (§5.39) — Brandon's `.gsearch` + `.gs-drop`.
 *
 * ⚠️ **This is the redesign's single biggest functional change, and it is a
 * REACH change rather than a new capability.** The search itself already exists
 * and is already live per keystroke (§7): what moves is where it lives. Today
 * it is System Management → Search — two clicks from home, manager-only in
 * practice, and Brandon's own feature audit calls it out: *"the only cross-board
 * search in the app, and it is two clicks from home"*. Here it is on every page.
 *
 * ⚠️ **Rows open the PATIENT SCREEN, not the stage page.** That is the whole
 * point of the redesign — one record, every stage on it, comms beside it. The
 * stage page is still one click further in, from the step card. `?board=` rides
 * along because a Monday item id alone does not say which board it is on.
 *
 * ⚠️ **No new fetching.** `useLiveSearch` is the existing hook with its existing
 * debounce, abort and latest-wins guards; mounting it with an empty query asks
 * Monday nothing, so a header on every page costs nothing until somebody types.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useLiveSearch } from "@/hooks/systemMgmt/useLiveSearch";
import { searchBucket } from "@/lib/systemMgmt/searchBuckets";
import { groupSearchHits, hitCaption } from "@/lib/shell/searchPeople";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";

/** People, not board items — a patient with six records is ONE row (§5.42). */
const MAX_ROWS = 8;

/** Where a header hit goes. Orders keep their own page — an order is not a
 *  patient record, and the patient screen has nothing to say about one. */
function hitHref(row: SystemPatient): string {
  if (searchBucket(row) === "orders") {
    return `/orders?orderId=${encodeURIComponent(row.id)}&from=search`;
  }
  return `/patient/${encodeURIComponent(row.id)}?board=${row.boardId}&from=search`;
}

export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const navigate = useNavigate();
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const { results, searching, tooShort, error } = useLiveSearch(open ? query : "");

  /**
   * ⚠️ **GROUPED FIRST, THEN CAPPED** — the cap has to fall on people, or the
   * eight slots are spent on one patient's six board records and everybody else
   * who matched is trimmed off the end (§5.42). The measured case was exactly
   * that: a name that returned six rows for one person.
   */
  const rows = useMemo(() => groupSearchHits(results).slice(0, MAX_ROWS), [results]);

  // Reset the cursor whenever the list changes under it, or Enter fires on a
  // row that is no longer the one highlighted on screen.
  useEffect(() => setHi(0), [rows.length]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  /** "/" focuses the search from anywhere — Brandon draws the key hint in the
   *  field. Ignored while the caret is in another input, or typing a slash into
   *  a note would steal it. */
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (el instanceof HTMLElement && el.isContentEditable) return;
      e.preventDefault();
      setOpen(true);
      input.current?.focus();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const go = (row: SystemPatient) => {
    setOpen(false);
    setQuery("");
    navigate(hitHref(row));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && rows.length) {
      e.preventDefault();
      setHi((h) => (h + 1) % rows.length);
    } else if (e.key === "ArrowUp" && rows.length) {
      e.preventDefault();
      setHi((h) => (h - 1 + rows.length) % rows.length);
    } else if (e.key === "Enter" && rows[hi]) {
      e.preventDefault();
      go(rows[hi].lead);
    } else if (e.key === "Escape") {
      setOpen(false);
      input.current?.blur();
    }
  };

  const typed = query.trim().length > 0;

  return (
    <div className="gsearch" ref={box}>
      <Search className="mag" />
      <input
        ref={input}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
        placeholder="Search patient name, DOB, phone, member ID, order #, doctor…"
        aria-label="Search patients"
        aria-expanded={open && typed}
        autoComplete="off"
      />
      {!typed && <span className="kbd">/</span>}

      {open && typed && (
        <div className="gs-drop" role="listbox">
          {rows.map((hit, i) => (
            <button
              key={hit.key}
              className={`gs-row${i === hi ? " hi" : ""}`}
              role="option"
              aria-selected={i === hi}
              onMouseEnter={() => setHi(i)}
              onClick={() => go(hit.lead)}
            >
              <span className="min-w-0">
                <span className="nm block truncate">{hit.name || "(no name)"}</span>
                {/* ⚠️ The count is part of the line, not a badge: it is the only
                    thing saying that clicking opens ONE of several records and
                    that the rest are inside. Without it a folded row looks
                    exactly like a patient who has a single record. */}
                <span className="sub block truncate">
                  {hit.lead.subtitle || hitCaption(hit)}
                </span>
              </span>
              <span className="hit">
                <span className="st">{hit.lead.pipelineStage || hit.lead.boardName}</span>
              </span>
            </button>
          ))}

          {/* ⚠️ Every non-result state says which one it is. "Nothing found",
              "still looking" and "the search failed" are three different
              answers, and collapsing them is how a rep concludes a patient is
              not in the system when Monday simply 503'd (§9). */}
          {!rows.length && searching && <div className="gs-note">Searching…</div>}
          {!rows.length && !searching && tooShort && (
            <div className="gs-note">Keep typing — two characters at least.</div>
          )}
          {!rows.length && !searching && !tooShort && error && (
            <div className="gs-note">Couldn't reach Monday — {error}</div>
          )}
          {!rows.length && !searching && !tooShort && !error && (
            <div className="gs-note">No patient matches that.</div>
          )}
        </div>
      )}
    </div>
  );
}
