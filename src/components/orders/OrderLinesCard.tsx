/**
 * What was ordered — one line per product, the quantity, and a stock pill
 * ONLY when it says something a rep would act on (backordered, out, unknown)
 * on an order that is still open. A green "in stock" on a delivered order
 * is noise; the SKU and the auth ids live in the details drawer.
 */
import { Card } from "@/components/ui/card";
import { stockKey, stockVerdict } from "@/lib/welcomeCall/infusionStock";
import type { SkuTrackerRow } from "@/lib/orders/skuTrackerApi";
import { FAMILY_LABEL, orderLines, skuRowForLine } from "@/lib/orders/skuJoin";
import { isOpenStage, orderStage, type Order } from "@/lib/orders/workflow";
import { etToday } from "@/lib/masheke/etDate";
import { StockPill } from "./pills";
import { SectionTitle } from "./Field";

export function OrderLinesCard({ order, skuRows }: { order: Order; skuRows: SkuTrackerRow[] | null }) {
  const lines = orderLines(order);
  const open = isOpenStage(orderStage(order));
  const today = etToday();
  return (
    <Card className="p-4">
      <SectionTitle aside={order.shipMethod ? <span className="text-xs text-muted-foreground">{order.shipMethod}</span> : undefined}>
        What was ordered
      </SectionTitle>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No product has a quantity on this order.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {lines.map((l, i) => {
            const row = skuRows ? skuRowForLine(l, skuRows) : null;
            const verdict = open && row ? stockVerdict(l.product, new Map([[stockKey(l.product), row]]), today) : null;
            // A receiver is named by its sensor on the board; the tracker row
            // knows the receiver's own name.
            const name = row?.name && l.family === "cgmReceivers" ? row.name.split("→")[1]?.trim() || l.product : l.product;
            return (
              <li key={i} className="py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {FAMILY_LABEL[l.family]}
                    {row?.sku && <span className="font-mono"> · {row.sku}</span>}
                  </p>
                </div>
                {verdict && verdict.tone !== "green" && <StockPill verdict={verdict} />}
                <p className="text-sm tabular-nums shrink-0">
                  <span className="text-muted-foreground">Qty </span>
                  <span className="font-semibold">{l.quantity}</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {/* Backordered and the swap request live in `SubstitutionCard`. What
          stays here is the other availability fact, which has no swap path. */}
      {open && order.inactiveProducts && (
        <p className="mt-3 pt-3 border-t text-sm text-rose-700 dark:text-rose-400">
          <span className="font-semibold">Not for sale at Cardinal:</span> {order.inactiveProducts}
        </p>
      )}
    </Card>
  );
}
