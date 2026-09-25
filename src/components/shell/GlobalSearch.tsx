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
 *
 * **The search is WIDE here (§5.52)** — Josh, 2026-09-24: *"wider header search
 * - yes i want it"*. `fields: true` asks every board's member ids, doctor,
 * clinic, doctor phone and insurance in the same request, and the row's right
 * edge says which field matched (`searchHit`), exactly as Brandon draws it.
 * The placeholder now promises only what the box does — the reason it used to
 * be narrower is that a placeholder is a contract (§5.39f).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { useLiveSearch } from "@/hooks/systemMgmt/useLiveSearch";
import { searchBucket } from "@/lib/systemMgmt/searchBuckets";
import { looseSearchTerms } from "@/lib/systemMgmt/mondayApi";
import { foldRedundantOrders, groupSearchHits, hitCaption } from "@/lib/shell/searchPeople";
import { searchHit } from "@/lib/shell/searchHit";
import {
  MAX_ROWS,
  SEARCH_PLACEHOLDER,
  SEARCH_SCOPE,
  chipTone,
  countLine,
  hitDob,
} from "@/lib/shell/searchRow";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";

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

  const { results, searching, tooShort, error } = useLiveSearch(open ? query : "", {
    fields: true,
  });

  /**
   * ⚠️ **GROUPED, THEN ORDERS FOLDED AWAY, THEN CAPPED** — the cap has to fall
   * on people, or the eight slots are spent on one patient's six board records
   * and everybody else who matched is trimmed off the end (§5.42). The
   * measured case was exactly that: a name that returned six rows for one
   * person, and later one that returned a Subscription row plus three of that
   * patient's orders (§5.46b's `foldRedundantOrders`).
   */
  const people = useMemo(() => foldRedundantOrders(groupSearchHits(results)), [results]);
  const rows = useMemo(() => people.slice(0, MAX_ROWS), [people]);

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

  const trimmed = query.trim();
  const typed = trimmed.length > 0;

  /** "No exact match … showing anyone matching X or Y", when the loose pass
   *  answered. Derived from the query rather than threaded through the hook. */
  const looseNote = useMemo(() => {
    if (!results.some((r) => r.matchedBy === "partial")) return "";
    const terms = looseSearchTerms(query);
    if (!terms) return "";
    return `No exact match — showing anyone matching ${terms.join(" or ")}.`;
  }, [results, query]);

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
        placeholder={SEARCH_PLACEHOLDER}
        aria-label="Search patients"
        aria-expanded={open && typed}
        autoComplete="off"
      />
      {!typed && <span className="kbd">/</span>}

      {open && typed && (
        <div className="gs-drop" role="listbox">
          {/* ⚠️ A loose answer must SAY it is loose (§5.44). These rows matched
              ONE of the typed words, so without this line a row whose name
              does not contain what the rep typed reads as the search
              misfiring — the same rule the same-number pass follows. */}
          {looseNote && <div className="gs-note">{looseNote}</div>}
          {rows.map((hit, i) => {
            const found = searchHit(hit.rows, trimmed);
            const dob = hitDob(hit);
            const tone = chipTone(hit);
            return (
              <button
                key={hit.key}
                className={`gs-row${i === hi ? " hi" : ""}`}
                role="option"
                aria-selected={i === hi}
                onMouseEnter={() => setHi(i)}
                onClick={() => go(hit.lead)}
              >
                <span className="who">
                  <span className="nm">{hit.name || "(no name)"}</span>
                  {dob && <span className="dob"> · DOB {dob}</span>}
                </span>
                <span className={`st${tone ? ` ${tone}` : ""}`}>
                  {hit.lead.subtitle || hitCaption(hit)}
                </span>
                {/* ⚠️ WHICH field matched — empty on a name match, because the
                    name IS the row (Brandon's own rule). */}
                <span className="hit">
                  {found && (
                    <>
                      {found.label} <b>{found.value}</b>
                    </>
                  )}
                </span>
              </button>
            );
          })}

          {/* ⚠️ Every non-result state says which one it is. "Nothing found",
              "still looking" and "the search failed" are three different
              answers, and collapsing them is how a rep concludes a patient is
              not in the system when Monday simply 503'd (§9). */}
          {/* ⚠️ Rows can be on screen WHILE the search is still running — the
              name pass paints first and the loose and same-number passes land
              after it (§5.46b). So "still looking" is a footer here, not the
              empty state: without it a rep reads a partial answer as the whole
              one and concludes a record is missing. */}
          {!!rows.length && searching && <div className="gs-note">Still looking…</div>}
          {/* Brandon's count line. Counts PEOPLE, and says when the eight on
              screen are not all of them. */}
          {!!rows.length && !searching && (
            <div className="gs-foot">
              {countLine(people.length, rows.length)} · Enter opens the first · {SEARCH_SCOPE}
            </div>
          )}
          {!rows.length && searching && <div className="gs-note">Searching…</div>}
          {!rows.length && !searching && tooShort && (
            <div className="gs-foot">
              Keep typing — a name, DOB, phone, member ID, order or tracking number, or a doctor.
            </div>
          )}
          {!rows.length && !searching && !tooShort && error && (
            <div className="gs-note">Couldn't reach Monday — {error}</div>
          )}
          {!rows.length && !searching && !tooShort && !error && (
            <div className="gs-foot">
              No patient matches “{trimmed}”. Try the phone number or DOB.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
