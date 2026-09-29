/**
 * The Supabase copy of Profile Send Off, drawn the way monday draws a board
 * (docs/claude/5.55 *The board page*) — Josh, 2026-09-29: *"can we change how
 * this looks so its a little less blocky and more like monday? ive grown very
 * accustomed to their ui"*.
 *
 * Supabase's own Table Editor cannot be restyled; this page is the monday-
 * looking screen over the same rows, and the first read the app makes of the
 * copy. ⚠️ READ ONLY: nothing on this page writes anywhere. Changes still
 * happen on monday or in the stage pages; the copy follows within two minutes.
 *
 * Reads go through the gateway (`/mirror/board`), which checks the signed-in
 * employee and reads Supabase inside a READ ONLY transaction.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, Database, Loader2, Paperclip, RotateCcw, Search } from "lucide-react";
import {
  PROFILE_SEND_OFF_BOARD_ID,
  fetchMirrorBoard,
  type MirrorBoard,
  type MirrorCell,
  type MirrorItem,
} from "@/lib/supabaseBoard/boardApi";
import {
  batterySegments,
  columnWidth,
  columnsWithData,
  formatMondayDate,
  formatPhone,
  matchesSearch,
  relativeTime,
  statusHex,
} from "@/lib/supabaseBoard/cells";
import { etTodayYmd } from "@/lib/shared/monitorSale";
import "./supabaseBoard.css";

/** The copy moves every two minutes (the mirror's pass); reading faster shows nothing new. */
const REFRESH_MS = 120_000;
/** Rows drawn per group before "Show more" — every row is ~160 cells wide. */
const ROWS_PER_GROUP = 50;
const NAME_WIDTH = 320;

type Load = { data: MirrorBoard | null; error: string | null; loading: boolean };

export default function SupabaseBoardPage() {
  const [load, setLoad] = useState<Load>({ data: null, error: null, loading: true });
  const [query, setQuery] = useState("");
  const [showEmptyColumns, setShowEmptyColumns] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [, setTick] = useState(0);
  const inFlight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return; // one read at a time
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    setLoad((l) => ({ ...l, loading: true }));
    try {
      const r = await fetchMirrorBoard(PROFILE_SEND_OFF_BOARD_ID, ctrl.signal);
      // A failed read keeps the last good copy on screen AND says so.
      setLoad((l) => (r.ok ? { data: r.data, error: null, loading: false } : { data: l.data, error: r.error, loading: false }));
    } catch {
      /* aborted on unmount */
    } finally {
      if (inFlight.current === ctrl) inFlight.current = null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      setTick((t) => t + 1); // keeps "synced N min ago" honest
      if (document.visibilityState === "visible") void refresh();
    }, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [refresh]);

  const data = load.data;
  const today = etTodayYmd();

  const visibleItems = useMemo(() => (data ? data.items.filter((it) => matchesSearch(it, query)) : []), [data, query]);
  const withData = useMemo(() => columnsWithData(data?.items ?? []), [data]);
  const columns = useMemo(
    () => (data ? (showEmptyColumns ? data.columns : data.columns.filter((c) => withData.has(c.id))) : []),
    [data, showEmptyColumns, withData],
  );
  const byGroup = useMemo(() => {
    const m = new Map<string, MirrorItem[]>();
    for (const it of visibleItems) {
      const list = m.get(it.groupId) ?? [];
      list.push(it);
      m.set(it.groupId, list);
    }
    return m;
  }, [visibleItems]);

  const tableWidth = NAME_WIDTH + columns.reduce((s, c) => s + columnWidth(c.type), 0);

  return (
    <div className="sbd-root">
      <header className="sbd-head">
        <div className="sbd-title-row">
          <h1>{data?.board.name ?? "Profile Send Off"}</h1>
          <span className="sbd-pill" title="A read-only copy kept in Supabase. Nothing on this page changes monday.">
            <Database size={13} /> Supabase copy · read-only
          </span>
        </div>
        <p className="sbd-sub">
          Patients who entered the board since the copy went live, refreshed from monday every 2 minutes. Make changes
          on monday or in the Command Center — never here.
        </p>
        <div className="sbd-tabs" role="tablist">
          <span className="sbd-tab active" role="tab" aria-selected="true">Main table</span>
        </div>
        <div className="sbd-toolbar">
          <label className="sbd-search">
            <Search size={15} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              aria-label="Search the board"
            />
          </label>
          <button
            type="button"
            className={`sbd-tbtn${showEmptyColumns ? " on" : ""}`}
            onClick={() => setShowEmptyColumns((v) => !v)}
            title="Columns with no value on any item are hidden until you show them"
          >
            {showEmptyColumns ? `All ${data?.columns.length ?? 0} columns` : `${columns.length} columns with data`}
          </button>
          <span className="sbd-meta" data-testid="sbd-count">
            {data ? `${visibleItems.length} of ${data.items.length} items` : ""}
          </span>
          <span className="sbd-spacer" />
          <span className="sbd-meta" title={data?.board.syncedAt ?? ""}>
            Synced {relativeTime(data?.board.syncedAt ?? null)}
          </span>
          <button type="button" className="sbd-tbtn" onClick={() => void refresh()} disabled={load.loading}>
            {load.loading ? <Loader2 size={14} className="sbd-spin" /> : <RotateCcw size={14} />} Refresh
          </button>
        </div>
      </header>

      {load.error && (
        <div className="sbd-error" role="alert">
          {data ? "Couldn't refresh the Supabase copy — showing the last one read. " : "Couldn't read the Supabase copy. "}
          {load.error}
        </div>
      )}

      {!data && load.loading && (
        <div className="sbd-empty">
          <Loader2 size={16} className="sbd-spin" /> Reading the Supabase copy…
        </div>
      )}

      {data && (
        <div className="sbd-scroll">
          {data.groups.map((g) => {
            const items = byGroup.get(g.id) ?? [];
            const isCollapsed = collapsed[g.id] ?? items.length === 0;
            const shown = expanded[g.id] ? items : items.slice(0, ROWS_PER_GROUP);
            return (
              <section
                key={g.id}
                className="sbd-group"
                style={{ ["--g" as string]: g.color || "#579bfc", width: tableWidth }}
                data-testid={`sbd-group-${g.id}`}
              >
                <div className="sbd-group-head">
                  <button
                    type="button"
                    className="sbd-chev"
                    onClick={() => setCollapsed((c) => ({ ...c, [g.id]: !isCollapsed }))}
                    aria-expanded={!isCollapsed}
                    aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${g.title}`}
                  >
                    {isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
                  </button>
                  <span className="sbd-group-title">{g.title}</span>
                  <span className="sbd-group-count">
                    {items.length === 0 ? "No items" : `${items.length} item${items.length === 1 ? "" : "s"}`}
                  </span>
                </div>

                {!isCollapsed && items.length > 0 && (
                  <table className="sbd-table" style={{ width: tableWidth }}>
                    <colgroup>
                      <col style={{ width: NAME_WIDTH }} />
                      {columns.map((c) => (
                        <col key={c.id} style={{ width: columnWidth(c.type) }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        <th className="sbd-name">Name</th>
                        {columns.map((c) => (
                          <th key={c.id} title={c.title}>
                            {c.title}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((it) => (
                        <tr key={it.id}>
                          <td className="sbd-name">
                            <Link to={`/patient/${encodeURIComponent(it.id)}?board=${data.board.id}`} title="Open in the Command Center">
                              {it.name || "(no name)"}
                            </Link>
                          </td>
                          {columns.map((c) => (
                            <Cell key={c.id} type={c.type} columnId={c.id} cell={it.cells[c.id]} labels={data.labels} today={today} />
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="sbd-name sbd-foot-name">
                          {items.length > shown.length && (
                            <button type="button" className="sbd-more" onClick={() => setExpanded((e) => ({ ...e, [g.id]: true }))}>
                              Show {items.length - shown.length} more
                            </button>
                          )}
                        </td>
                        {columns.map((c) => (
                          <td key={c.id} className="sbd-foot">
                            {c.type === "status" && <Battery segments={batterySegments(data.labels, c.id, items)} total={items.length} />}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  </table>
                )}
              </section>
            );
          })}
          {data.items.length === 0 && (
            <div className="sbd-empty">No patients in the copy yet — the first one appears within 2 minutes of entering the board.</div>
          )}
        </div>
      )}
    </div>
  );
}

function Cell({
  type,
  columnId,
  cell,
  labels,
  today,
}: {
  type: string;
  columnId: string;
  cell: MirrorCell | undefined;
  labels: MirrorBoard["labels"];
  today: string;
}) {
  if (type === "status") {
    return (
      <td className="sbd-status" style={{ background: statusHex(labels, columnId, cell) }} title={cell?.t || ""}>
        {cell?.t ?? ""}
      </td>
    );
  }
  if (!cell) return <td />;
  if (type === "dropdown") {
    const names = cell.ids?.length
      ? cell.ids.map((id) => labels[columnId]?.[String(id)]?.label ?? String(id))
      : (cell.t ?? "").split(", ").filter(Boolean);
    return (
      <td className="sbd-chips" title={names.join(", ")}>
        {names.map((n, i) => (
          <span key={`${n}-${i}`} className="sbd-chip">
            {n}
          </span>
        ))}
      </td>
    );
  }
  if (type === "date") return <td className="sbd-center">{formatMondayDate(cell.t, today)}</td>;
  if (type === "phone") return <td className="sbd-center">{formatPhone(cell.t)}</td>;
  if (type === "numbers") return <td className="sbd-center">{cell.t}</td>;
  if (type === "file") {
    return (
      <td className="sbd-center" title={`${cell.n} file${cell.n === 1 ? "" : "s"} — open them on monday`}>
        <span className="sbd-file">
          <Paperclip size={13} /> {cell.n}
        </span>
      </td>
    );
  }
  return (
    <td className="sbd-text" title={cell.t}>
      {cell.t}
    </td>
  );
}

function Battery({ segments, total }: { segments: ReturnType<typeof batterySegments>; total: number }) {
  if (!total) return null;
  return (
    <div className="sbd-battery" title={segments.map((s) => `${s.label}: ${s.count}`).join("\n")}>
      {segments.map((s) => (
        <span key={s.key} style={{ background: s.hex, width: `${(s.count / total) * 100}%` }} />
      ))}
    </div>
  );
}
