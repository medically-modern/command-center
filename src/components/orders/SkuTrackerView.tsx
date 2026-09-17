/**
 * The Cardinal SKU Tracker as a table — every SKU we order, by family, with
 * what a rep asks of it: can Cardinal ship it, how many, what it costs, and
 * how many open orders are riding on it. The board's description says which
 * columns are machine-written; the only hand-edited one is Notes, shown
 * under the product name when somebody wrote one. This view edits nothing.
 */
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { STOCK_STALE_DAYS, stockKey, stockVerdict } from "@/lib/welcomeCall/infusionStock";
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

/** "Last run: 2026-09-15 09:05 ET (cron) — 31 changed" → days since, or null. */
function runAgeDays(lastRun: string, today: string): number | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(lastRun);
  if (!m) return null;
  const [y, mo, d] = today.split("-").map(Number);
  const ms = Date.UTC(y, mo - 1, d) - Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Math.round(ms / 86_400_000);
}

export function SkuTrackerView({ rows, loading, error, lastRun, orders, onRefresh }: Props) {
  const today = etToday();
  const open = orders.filter((o) => isOpenStage(orderStage(o)));
  const openBySku = rows ? openOrdersBySku(open, rows) : new Map<string, number>();
  const age = runAgeDays(lastRun, today);
  const stale = age !== null && age > STOCK_STALE_DAYS;
  const runLog = rows?.find(isRunLogRow);

  return (
    <div className="space-y-4">
      <Card className="p-5 rounded-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-2xl font-black">Cardinal stock</h2>
            {lastRun && <p className="text-sm text-muted-foreground mt-1">{lastRun}</p>}
            {stale && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                <AlertTriangle className="h-3.5 w-3.5" /> Last checked {age} days ago — may be out of date.
              </p>
            )}
            {error && <p className="mt-2 text-xs text-rose-700">Couldn't refresh: {error}{rows ? " — showing the last good read." : ""}</p>}
          </div>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading} className="gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </Card>

      {!rows ? (
        <Card className="p-6 text-sm text-muted-foreground">{loading ? "Loading the tracker…" : "The tracker hasn't loaded."}</Card>
      ) : (
        FAMILY_ORDER.map((fam) => {
          const list = rows.filter((r) => familyOfRow(r) === fam);
          if (list.length === 0) return null;
          return (
            <Card key={fam} className="p-4 overflow-x-auto">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">{FAMILY_LABEL[fam]} ({list.length})</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left font-semibold pb-1.5">Product</th>
                    <th className="text-left font-semibold pb-1.5">Stock</th>
                    <th className="text-right font-semibold pb-1.5 pr-3">Available</th>
                    <th className="text-left font-semibold pb-1.5">SKU</th>
                    <th className="text-right font-semibold pb-1.5 pr-3">Unit cost</th>
                    <th className="text-right font-semibold pb-1.5">Open orders</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => {
                    const v = stockVerdict(r.name, new Map([[stockKey(r.name), r]]), today);
                    const n = openBySku.get(r.id) ?? 0;
                    return (
                      <tr key={r.id} className={cn("border-t border-border/60", v.tone === "red" && "bg-rose-50/40 dark:bg-rose-950/20")}>
                        <td className="py-2 pr-3">
                          <p className="font-medium">{r.name}</p>
                          {r.notes && <p className="text-[11px] text-muted-foreground">{r.notes}</p>}
                        </td>
                        <td className="py-2 pr-3"><StockPill verdict={v} /></td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.qtyAvail == null ? "—" : r.qtyAvail.toLocaleString("en-US")}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{r.sku || "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.unitCost == null ? "—" : fmtMoney(String(r.unitCost))}</td>
                        <td className={cn("py-2 text-right tabular-nums", n > 0 && v.tone === "red" ? "font-bold text-rose-700" : n === 0 ? "text-muted-foreground" : "")}>{n}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          );
        })
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
