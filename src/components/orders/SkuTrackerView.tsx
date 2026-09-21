/**
 * Inventory — the Cardinal SKU Tracker, in Brandon's redesign layout (§5.39h).
 *
 * Josh, 2026-09-19: *"re-write the cardinal stock page to look much more like
 * his."* His `viewInventoryList` is ONE page — title, search, Refresh, a row
 * of category chips and a single fixed-width sortable table — where this was
 * five separate family cards each with their own little table. Same data, same
 * reads, same joins; the family is a chip and a sub-line now instead of a
 * card heading.
 *
 * ⚠️ **Everything this view could tell a rep, it still tells them.** His table
 * has five columns; ours keeps a sixth, **Open orders**, because that is real
 * function this build has and his sample data could not (his rows carry an
 * `open` field he never renders). Same for the last-run line, the staleness
 * warning, the read error and the poll history — none of those exist in a
 * mockup with hardcoded rows, and all four are how a rep knows whether to
 * trust the numbers.
 *
 * ⚠️ **OOP price is the BOARD's column (`numeric_mm5bs4hd`), never a
 * derivation.** The mockup computes it as `unit cost × 1.25` because its rows
 * have no such field; porting that arithmetic would put an invented price in
 * front of somebody quoting a patient.
 *
 * ⚠️ **Sorting by Status sorts by the VERDICT, not by the raw column.** The
 * chip is what is on screen, and it already folds the status, the quantity and
 * the staleness together (`stockVerdict`) — "Backordered" and "Out of stock"
 * are both red and both mean the same thing to a rep, while an `Available` row
 * whose count is three days old is grey. Sorting the raw label would order the
 * table by something nobody can see.
 *
 * This view edits nothing.
 */
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { STOCK_STALE_DAYS, stockKey, stockVerdict, type StockTone, type StockVerdict } from "@/lib/welcomeCall/infusionStock";
import { etToday } from "@/lib/masheke/etDate";
import { isRunLogRow, type SkuTrackerRow } from "@/lib/orders/skuTrackerApi";
import { FAMILY_LABEL, FAMILY_ORDER, familyOfRow, openOrdersBySku } from "@/lib/orders/skuJoin";
import { fmtMoney, isOpenStage, orderStage, type Order } from "@/lib/orders/workflow";
import { StockPill } from "./pills";

interface Props {
  rows: SkuTrackerRow[] | null;
  loading: boolean;
  error: string | null;
  lastRun: string;
  orders: Order[];
  onRefresh: () => void;
}

type SortKey = "product" | "status" | "qty" | "cost" | "oop" | "open";

/** Rows whose group is none of the five families — the board has none today,
 *  but a new group would otherwise vanish from every chip AND from "All". */
const OTHER = "__other__";

/** "Last run: 2026-09-15 09:05 ET (cron) — 31 changed" → days since, or null. */
function runAgeDays(lastRun: string, today: string): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(lastRun);
  if (!m) return null;
  const [y, mo, d] = today.split("-").map(Number);
  const ms = Date.UTC(y, mo - 1, d) - Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Math.round(ms / 86_400_000);
}

/**
 * `2026-09-09 09:05 ET` → `9/9 9:05 ET`, the short stamp his rows wear.
 * ⚠️ Anything that does not match comes back VERBATIM: the column is scraped
 * text, and a formatter that guesses at an unfamiliar shape prints a wrong
 * date rather than an ugly one.
 */
export function shortStamp(raw: string): string {
  const s = (raw ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ]?(\d{2}):(\d{2})(?:\s*(\S+))?/.exec(s);
  if (!m) return s;
  const hh = Number(m[4]);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${Number(m[2])}/${Number(m[3])} ${h12}:${m[5]}${hh >= 12 ? " PM" : " AM"}${m[6] ? ` ${m[6]}` : ""}`;
}

/** Worst first on an ascending sort — red · amber · grey · green. */
const TONE_RANK: Record<StockTone, number> = { red: 0, amber: 1, grey: 2, green: 3 };

interface InvRow {
  row: SkuTrackerRow;
  verdict: StockVerdict;
  family: string;
  familyLabel: string;
  openOrders: number;
}

export function SkuTrackerView({ rows, loading, error, lastRun, orders, onRefresh }: Props) {
  const today = etToday();
  const [cat, setCat] = useState<string>("All");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortKey>("product");
  const [dir, setDir] = useState<"asc" | "desc">("asc");

  const age = runAgeDays(lastRun, today);
  const stale = age !== null && age > STOCK_STALE_DAYS;
  const runLog = rows?.find(isRunLogRow);

  const open = useMemo(() => orders.filter((o) => isOpenStage(orderStage(o))), [orders]);

  /* One pass over the board: the verdict, the family and the open-order count
     each row carries. The verdict index is per-row on purpose — `stockVerdict`
     takes a name-keyed map and every row is looked up by its own name. */
  const all: InvRow[] = useMemo(() => {
    if (!rows) return [];
    const openBySku = openOrdersBySku(open, rows);
    return rows
      .filter((r) => !isRunLogRow(r))
      .map((r) => {
        const fam = familyOfRow(r);
        return {
          row: r,
          verdict: stockVerdict(r.name, new Map([[stockKey(r.name), r]]), today),
          family: fam ?? OTHER,
          familyLabel: fam ? FAMILY_LABEL[fam] : "Other",
          openOrders: openBySku.get(r.id) ?? 0,
        };
      });
  }, [rows, open, today]);

  /** Chips: only the families the board actually has, in pipeline order. */
  const cats = useMemo(() => {
    const present = new Set(all.map((r) => r.family));
    const list = FAMILY_ORDER.filter((f) => present.has(f)).map((f) => ({ key: f as string, label: FAMILY_LABEL[f] }));
    if (present.has(OTHER)) list.push({ key: OTHER, label: "Other" });
    return list;
  }, [all]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => {
    const filtered = all.filter((r) => {
      if (cat !== "All" && r.family !== cat) return false;
      if (!needle) return true;
      const hay = `${r.row.name} ${r.row.sku} ${r.familyLabel} ${r.row.status} ${r.verdict.label} ${r.row.description} ${r.row.notes}`;
      return hay.toLowerCase().includes(needle);
    });
    const num = (n: number | null) => (n == null ? -1 : n);
    const byName = (a: InvRow, b: InvRow) =>
      a.row.name.localeCompare(b.row.name, undefined, { sensitivity: "base", numeric: true });
    const cmp: Record<SortKey, (a: InvRow, b: InvRow) => number> = {
      product: byName,
      status: (a, b) => TONE_RANK[a.verdict.tone] - TONE_RANK[b.verdict.tone] || byName(a, b),
      qty: (a, b) => num(a.row.qtyAvail) - num(b.row.qtyAvail) || byName(a, b),
      cost: (a, b) => num(a.row.unitCost) - num(b.row.unitCost) || byName(a, b),
      oop: (a, b) => num(a.row.oopPrice) - num(b.row.oopPrice) || byName(a, b),
      open: (a, b) => a.openOrders - b.openOrders || byName(a, b),
    };
    const mul = dir === "desc" ? -1 : 1;
    return [...filtered].sort((a, b) => cmp[sort](a, b) * mul);
  }, [all, cat, needle, sort, dir]);

  const th = (k: SortKey, label: string, right = false) => {
    const on = sort === k;
    return (
      <th className={cn("pb-2 text-[10px] font-semibold uppercase tracking-wider", right ? "text-right" : "text-left", on ? "text-foreground" : "text-muted-foreground")}>
        <button
          type="button"
          onClick={() => {
            if (on) setDir(dir === "asc" ? "desc" : "asc");
            else { setSort(k); setDir("asc"); }
          }}
          title={`Sort by ${label.toLowerCase()}`}
          className={cn("inline-flex items-center gap-1 hover:text-foreground", right && "w-full justify-end")}
        >
          {label}
          <span className={cn("text-[9px]", on ? "text-primary" : "opacity-45")}>{on ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
        </button>
      </th>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-3.5">
      {/* ── Title · search · Refresh ─────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <h1 className="text-[22px] font-bold tracking-tight">Inventory</h1>
        <div className="flex items-center gap-2">
          <div className="relative w-[260px] max-w-full">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search product, SKU, status…"
              aria-label="Search inventory"
              autoComplete="off"
              className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </div>

      {/* ⚠️ Kept from the old view: a rep reading a number has to be able to
          tell a fresh scrape from a three-day-old one, and a failed refresh
          from an empty board. A mockup with hardcoded rows needs none of it. */}
      <div className="-mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {lastRun && <span>{lastRun}</span>}
        {stale && (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            <AlertTriangle className="h-3.5 w-3.5" /> Last checked {age} days ago — may be out of date.
          </span>
        )}
        {error && (
          <span className="text-rose-700 dark:text-rose-300">
            Couldn't refresh: {error}{rows ? " — showing the last good read." : ""}
          </span>
        )}
      </div>

      {/* ── Category chips ───────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {[{ key: "All", label: "All" }, ...cats].map((c) => {
          const on = cat === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => setCat(c.key)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                on ? "border-primary/40 bg-primary/10 font-semibold text-primary" : "border-border text-muted-foreground hover:bg-muted/40",
              )}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* ── The table ────────────────────────────────────────── */}
      {!rows ? (
        <Card className="p-6 text-sm text-muted-foreground">{loading ? "Loading the tracker…" : "The tracker hasn't loaded."}</Card>
      ) : (
        <Card className="overflow-x-auto p-4">
          {/* ⚠️ `table-fixed` + an explicit colgroup, straight from his `.invt`:
              the filters swap ROWS and never move the columns, so a rep
              scanning a number does not have to re-find the column each time
              they type a letter. */}
          <table className="w-full min-w-[760px] table-fixed text-sm">
            <colgroup>
              <col className="w-[38%]" />
              <col className="w-[20%]" />
              <col className="w-[10.5%]" />
              <col className="w-[10.5%]" />
              <col className="w-[10.5%]" />
              <col className="w-[10.5%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-border">
                {th("product", "Product")}
                {th("status", "Status")}
                {th("qty", "Available", true)}
                {th("cost", "Unit cost", true)}
                {th("oop", "OOP price", true)}
                {th("open", "Open orders", true)}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-sm text-muted-foreground">
                    {needle
                      ? `Nothing matches “${q.trim()}”${cat !== "All" ? ` in ${cats.find((c) => c.key === cat)?.label ?? cat}` : ""}.`
                      : "Nothing in this category."}
                  </td>
                </tr>
              ) : (
                shown.map(({ row: r, verdict: v, familyLabel, openOrders: n }) => (
                  <tr key={r.id} className={cn("border-t border-border/60 align-top", v.tone === "red" && "bg-rose-50/40 dark:bg-rose-950/20")}>
                    <td className="py-2 pr-3 [overflow-wrap:anywhere]">
                      <p className="font-medium">{r.name}</p>
                      {r.notes && <p className="text-[11px] text-muted-foreground">{r.notes}</p>}
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {familyLabel}{r.sku ? ` · SKU ${r.sku}` : ""}
                      </p>
                    </td>
                    <td className="py-2 pr-3">
                      <StockPill verdict={v} />
                      {r.lastChanged && <p className="mt-0.5 text-[10px] text-muted-foreground">last updated {shortStamp(r.lastChanged)}</p>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.qtyAvail == null ? "—" : r.qtyAvail.toLocaleString("en-US")}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.unitCost == null ? "—" : fmtMoney(String(r.unitCost))}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.oopPrice == null ? "—" : fmtMoney(String(r.oopPrice))}</td>
                    <td className={cn("py-2 text-right tabular-nums", n > 0 && v.tone === "red" ? "font-bold text-rose-700 dark:text-rose-300" : n === 0 ? "text-muted-foreground" : "")}>
                      {n}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </Card>
      )}

      {runLog?.runHistory && (
        <Card className="p-4">
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">Poll history</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed">{runLog.runHistory}</pre>
          </details>
        </Card>
      )}
    </div>
  );
}
