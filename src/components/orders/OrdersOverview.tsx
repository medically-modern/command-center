/**
 * The page's landing — today's ordering picture, before a rep opens anything:
 * how many orders sit at each stage, which open orders need a person, and
 * which Cardinal SKUs are backordered or gone with open orders riding on them.
 * Every number here is computed from the slim list the sidebar already holds
 * and the SKU tracker read the page already shares — no extra request.
 */
import { Card } from "@/components/ui/card";
import { AlertTriangle, ChevronRight, Info, PackageSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { stockKey, stockVerdict } from "@/lib/welcomeCall/infusionStock";
import { etToday } from "@/lib/masheke/etDate";
import type { SkuTrackerRow } from "@/lib/orders/skuTrackerApi";
import { isRunLogRow } from "@/lib/orders/skuTrackerApi";
import { openOrdersBySku, familyOfRow, FAMILY_LABEL } from "@/lib/orders/skuJoin";
import { sidebarSections } from "@/lib/orders/sidebarList";
import { fmtDateShort, isOpenStage, orderFlags, orderStage, type Order } from "@/lib/orders/workflow";
import { Pill } from "./pills";
import { rowSummary } from "@/lib/orders/rowSummary";

interface Props {
  orders: Order[];
  skuRows: SkuTrackerRow[] | null;
  skuLastRun: string;
  onSelect: (id: string) => void;
  onShowStock: () => void;
  loading: boolean;
}

function Tile({ label, value, tone, hint }: { label: string; value: number; tone: string; hint?: string }) {
  return (
    <div className={cn("rounded-xl border p-3", tone)}>
      <p className="text-[10px] uppercase tracking-wider font-semibold opacity-80">{label}</p>
      <p className="text-2xl font-black tabular-nums leading-tight">{value.toLocaleString("en-US")}</p>
      {hint && <p className="text-[11px] opacity-80">{hint}</p>}
    </div>
  );
}

/** YYYY-MM-DD of `days` ago in ET, for "this week" tiles. */
function etDaysAgo(days: number): string {
  const [y, m, d] = etToday().split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - days));
  return dt.toISOString().slice(0, 10);
}

export function OrdersOverview({ orders, skuRows, skuLastRun, onSelect, onShowStock, loading }: Props) {
  const s = sidebarSections(orders, { showAllDelivered: true });
  const weekAgo = etDaysAgo(7);
  const deliveredThisWeek = s.delivered.filter((o) => o.deliveryDate && o.deliveryDate >= weekAgo).length;
  const shippedThisWeek = [...s.shipped, ...s.delivered].filter((o) => o.shipDate && o.shipDate >= weekAgo).length;

  const open = orders.filter((o) => isOpenStage(orderStage(o)));
  const attention = open
    .map((o) => ({ o, flags: orderFlags(o).filter((f) => f.tone !== "sky") }))
    .filter((x) => x.flags.length > 0)
    .sort((a, b) => Number(b.flags.some((f) => f.tone === "rose")) - Number(a.flags.some((f) => f.tone === "rose")));

  const today = etToday();
  const skuAlerts = (skuRows ?? [])
    .filter((r) => !isRunLogRow(r))
    .map((r) => ({ row: r, verdict: stockVerdict(r.name, new Map([[stockKey(r.name), r]]), today) }))
    .filter((x) => x.verdict.tone === "red" || x.verdict.tone === "amber");
  const openBySku = skuRows ? openOrdersBySku(open, skuRows) : new Map<string, number>();

  return (
    <div className="space-y-4">
      <Card className="p-5 rounded-2xl">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm uppercase tracking-wide text-muted-foreground font-semibold">Orders · today</p>
            <h2 className="text-2xl font-black">The ordering picture</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Search a patient in the sidebar to see where their order is, or open one from the list. {loading && "Refreshing…"}
            </p>
          </div>
          <PackageSearch className="h-10 w-10 text-muted-foreground/40" />
        </div>
        <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Tile label="To place" value={s.toPlace.length} tone="border-[color:var(--mm-mint-ring)] bg-[color:var(--mm-mint)] text-[color:var(--mm-teal)]" hint="waiting on the board" />
          <Tile label="On hold" value={s.onHold.length} tone="border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100" hint="snoozed to a date" />
          <Tile label="In progress" value={s.inProgress.length} tone="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100" hint="placed, not shipped" />
          <Tile label="Shipped" value={s.shipped.length} tone="border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100" hint="not yet delivered" />
          <Tile label="Shipped this week" value={shippedThisWeek} tone="border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100" />
          <Tile label="Delivered this week" value={deliveredThisWeek} tone="border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100" />
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="p-4">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            Needs a person ({attention.length})
          </p>
          {attention.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open order is held, errored, backordered or flagged.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {attention.slice(0, 40).map(({ o, flags }) => (
                <li key={o.id}>
                  <button onClick={() => onSelect(o.id)} className="w-full text-left py-2 flex items-start gap-2 hover:bg-muted/40 rounded-md px-1 transition-colors">
                    <AlertTriangle className={cn("h-4 w-4 mt-0.5 shrink-0", flags.some((f) => f.tone === "rose") ? "text-rose-500" : "text-amber-500")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium truncate">{o.name}</p>
                        <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">{o.orderDate ? fmtDateShort(o.orderDate) : ""}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{rowSummary(o)}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {flags.map((f) => (
                          <Pill key={f.id} tone={f.tone === "rose" ? "rose" : "amber"} size="sm" title={f.detail}>{f.label}</Pill>
                        ))}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
              {attention.length > 40 && <li className="py-2 text-xs text-muted-foreground">…and {attention.length - 40} more — search the sidebar.</li>}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Cardinal stock alerts ({skuAlerts.length})</p>
            <button onClick={onShowStock} className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1">
              Full stock table <ChevronRight className="h-3 w-3" />
            </button>
          </div>
          {!skuRows ? (
            <p className="text-sm text-muted-foreground">The Cardinal SKU Tracker hasn't loaded.</p>
          ) : skuAlerts.length === 0 ? (
            <p className="text-sm text-muted-foreground">Every tracked SKU is available.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {skuAlerts.map(({ row, verdict }) => {
                const n = openBySku.get(row.id) ?? 0;
                const fam = familyOfRow(row);
                return (
                  <li key={row.id} className="py-2 flex items-start gap-2">
                    <Info className={cn("h-4 w-4 mt-0.5 shrink-0", verdict.tone === "red" ? "text-rose-500" : "text-amber-500")} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-sm font-medium truncate">{row.name}</p>
                        <Pill tone={verdict.tone === "red" ? "rose" : "amber"} size="sm" title={verdict.detail}>{verdict.label}</Pill>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {[fam ? FAMILY_LABEL[fam] : "", row.sku, n > 0 ? `${n} open order${n === 1 ? "" : "s"} on it` : "no open order on it"].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {skuLastRun && <p className="mt-3 text-[11px] text-muted-foreground">{skuLastRun}</p>}
        </Card>
      </div>
    </div>
  );
}
