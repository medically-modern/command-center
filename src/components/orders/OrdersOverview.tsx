/**
 * The page's landing, before a rep opens anything. It asks the one question
 * the page exists for — "whose order?" — and answers it as they type. With
 * nothing typed it shows what needs a person and whether Cardinal is short of
 * anything, and no more: the stage counts are the sidebar's section headers,
 * and drawing them again here was six tiles saying what nine labels already
 * say. Every number here comes from the slim list the sidebar already holds
 * and the SKU tracker read the page already shares — no extra request.
 */
import { Card } from "@/components/ui/card";
import { AlertTriangle, ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { stockKey, stockVerdict } from "@/lib/welcomeCall/infusionStock";
import { etToday } from "@/lib/masheke/etDate";
import type { SkuTrackerRow } from "@/lib/orders/skuTrackerApi";
import { isRunLogRow } from "@/lib/orders/skuTrackerApi";
import { openOrdersBySku } from "@/lib/orders/skuJoin";
import { sidebarVisibleList } from "@/lib/orders/sidebarList";
import { fmtDateShort, isOpenStage, orderFlags, orderStage, type Order } from "@/lib/orders/workflow";
import { rowSummary } from "@/lib/orders/rowSummary";

interface Props {
  orders: Order[];
  skuRows: SkuTrackerRow[] | null;
  onSelect: (id: string) => void;
  onShowStock: () => void;
  loading: boolean;
  /** Shared with the sidebar: typing here filters both. */
  query: string;
  onQueryChange: (q: string) => void;
}

const MAX_RESULTS = 25;

export function OrdersOverview({ orders, skuRows, onSelect, onShowStock, loading, query, onQueryChange }: Props) {
  const q = query.trim();
  const matches = q ? sidebarVisibleList(orders, { query }) : [];

  const open = orders.filter((o) => isOpenStage(orderStage(o)));
  const attention = open
    .map((o) => ({ o, flags: orderFlags(o).filter((f) => f.tone !== "sky") }))
    .filter((x) => x.flags.length > 0)
    .sort((a, b) => Number(b.flags.some((f) => f.tone === "rose")) - Number(a.flags.some((f) => f.tone === "rose")));

  const today = etToday();
  const skuAlerts = (skuRows ?? [])
    .filter((r) => !isRunLogRow(r))
    .filter((r) => { const t = stockVerdict(r.name, new Map([[stockKey(r.name), r]]), today).tone; return t === "red" || t === "amber"; });
  const openBySku = skuRows ? openOrdersBySku(open, skuRows) : new Map<string, number>();
  const ordersOnShortSkus = skuAlerts.reduce((n, r) => n + (openBySku.get(r.id) ?? 0), 0);

  return (
    <div className="space-y-4">
      <Card className="p-6 rounded-2xl">
        <h2 className="text-2xl font-black">Where is a patient's order?</h2>
        <div className="relative mt-3">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Patient name, phone, Cardinal order # or tracking #"
            aria-label="Find an order"
            className="w-full h-12 pl-10 pr-10 rounded-xl border border-border bg-white dark:bg-card text-gray-900 dark:text-foreground text-base placeholder:text-gray-400 dark:placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[color:var(--mm-green)]"
          />
          {query && (
            <button onClick={() => onQueryChange("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" title="Clear">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {q && (
          matches.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">{loading ? "Still loading the board…" : "No order matches that."}</p>
          ) : (
            <ul className="mt-3 divide-y divide-border/60">
              {matches.slice(0, MAX_RESULTS).map((o) => <ResultRow key={o.id} order={o} onSelect={onSelect} />)}
              {matches.length > MAX_RESULTS && (
                <li className="py-2 text-xs text-muted-foreground">{matches.length - MAX_RESULTS} more — keep typing to narrow it down.</li>
              )}
            </ul>
          )
        )}
      </Card>

      {!q && (
        <>
          <Card className="p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              Needs a person ({attention.length})
            </p>
            {attention.length === 0 ? (
              <p className="text-sm text-muted-foreground">No open order is held, errored, backordered or flagged.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {attention.slice(0, 40).map(({ o, flags }) => {
                  const lead = flags.find((f) => f.tone === "rose") ?? flags[0];
                  return (
                    <li key={o.id}>
                      <button onClick={() => onSelect(o.id)} className="w-full text-left py-2 px-1 flex items-center gap-2.5 hover:bg-muted/40 rounded-md transition-colors">
                        <AlertTriangle className={cn("h-4 w-4 shrink-0", lead.tone === "rose" ? "text-rose-500" : "text-amber-500")} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{o.name}</p>
                          <p className={cn("text-[11px] truncate", lead.tone === "rose" ? "text-rose-600" : "text-amber-700")} title={lead.detail}>
                            {lead.label}{flags.length > 1 ? ` · +${flags.length - 1}` : ""}
                          </p>
                        </div>
                        <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">{o.orderDate ? fmtDateShort(o.orderDate) : ""}</span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  );
                })}
                {attention.length > 40 && <li className="py-2 text-xs text-muted-foreground">…and {attention.length - 40} more.</li>}
              </ul>
            )}
          </Card>

          <button
            onClick={onShowStock}
            className="w-full text-left rounded-xl border bg-card px-4 py-3 text-sm flex items-center justify-between gap-3 hover:bg-muted/40 transition-colors"
          >
            <span className="min-w-0">
              {!skuRows ? (
                <span className="text-muted-foreground">Cardinal stock hasn't loaded.</span>
              ) : skuAlerts.length === 0 ? (
                <span className="text-muted-foreground">Cardinal can ship every SKU we order.</span>
              ) : (
                <>
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    {skuAlerts.length} SKU{skuAlerts.length === 1 ? "" : "s"} Cardinal can't ship today
                  </span>
                  {ordersOnShortSkus > 0 && (
                    <span className="text-muted-foreground"> · {ordersOnShortSkus} open order{ordersOnShortSkus === 1 ? "" : "s"} on them</span>
                  )}
                </>
              )}
            </span>
            <span className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary">Cardinal stock <ChevronRight className="h-3.5 w-3.5" /></span>
          </button>
        </>
      )}
    </div>
  );
}

function ResultRow({ order: o, onSelect }: { order: Order; onSelect: (id: string) => void }) {
  const flag = orderFlags(o).find((f) => f.tone === "rose") ?? orderFlags(o).find((f) => f.tone === "amber");
  const date = o.deliveryDate || o.shipDate || o.orderDate;
  return (
    <li>
      <button onClick={() => onSelect(o.id)} className="w-full text-left py-2.5 px-1 flex items-center gap-3 hover:bg-muted/40 rounded-md transition-colors">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{o.name}</p>
          <p className={cn("text-xs truncate", flag?.tone === "rose" ? "text-rose-600" : flag ? "text-amber-700" : "text-muted-foreground")}>
            {flag ? flag.label : rowSummary(o)}
          </p>
        </div>
        {date && <span className="text-xs tabular-nums text-muted-foreground shrink-0">{fmtDateShort(date)}</span>}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}
