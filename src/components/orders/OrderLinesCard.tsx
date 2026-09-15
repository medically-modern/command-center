/**
 * What was ordered, line by line, each joined to the Cardinal SKU it is —
 * with the tracker's own verdict on whether Cardinal can ship it today
 * (`infusionStock.stockVerdict`: status decides, the count only explains).
 */
import { Card } from "@/components/ui/card";
import { stockKey, stockVerdict } from "@/lib/welcomeCall/infusionStock";
import type { SkuTrackerRow } from "@/lib/orders/skuTrackerApi";
import { FAMILY_LABEL, orderLines, skuRowForLine } from "@/lib/orders/skuJoin";
import { fmtMoney, type Order } from "@/lib/orders/workflow";
import { etToday } from "@/lib/masheke/etDate";
import { StockPill } from "./pills";
import { Field, SectionTitle } from "./Field";

export function OrderLinesCard({ order, skuRows }: { order: Order; skuRows: SkuTrackerRow[] | null }) {
  const lines = orderLines(order);
  const today = etToday();
  return (
    <Card className="p-4">
      <SectionTitle aside={order.shipMethod ? <span className="text-xs text-muted-foreground">{order.shipMethod}</span> : undefined}>
        What was ordered
      </SectionTitle>
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No product has a quantity on this order.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left font-semibold pb-1.5">Product</th>
                <th className="text-right font-semibold pb-1.5 pr-3">Qty</th>
                <th className="text-left font-semibold pb-1.5">Cardinal SKU</th>
                <th className="text-left font-semibold pb-1.5">Stock today</th>
                <th className="text-left font-semibold pb-1.5">Auth ID</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const row = skuRows ? skuRowForLine(l, skuRows) : null;
                const verdict = row
                  ? stockVerdict(l.product, new Map([[stockKey(l.product), row]]), today)
                  : null;
                return (
                  <tr key={i} className="border-t border-border/60">
                    <td className="py-2 pr-3">
                      <p className="font-medium">{row?.name && l.family === "cgmReceivers" ? row.name.split("→")[1]?.trim() || l.product : l.product}</p>
                      <p className="text-[11px] text-muted-foreground">{FAMILY_LABEL[l.family]}</p>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold">{l.quantity}</td>
                    <td className="py-2 pr-3">
                      {row ? (
                        <span className="font-mono text-xs">{row.sku || "—"}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{skuRows ? "Not on the SKU tracker" : "Tracker not loaded"}</span>
                      )}
                      {row?.oopPrice != null && <p className="text-[11px] text-muted-foreground">OOP {fmtMoney(String(row.oopPrice))}</p>}
                    </td>
                    <td className="py-2 pr-3">{verdict ? <StockPill verdict={verdict} /> : <span className="text-xs text-muted-foreground">—</span>}</td>
                    <td className="py-2 font-mono text-xs">{l.authId || <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Backordered and the swap request live in `SubstitutionCard` — one
          subject, one card. What stays here is the other availability fact,
          which has no swap path: Cardinal will not sell it at all. */}
      {order.inactiveProducts && (
        <div className="mt-3 pt-3 border-t">
          <Field label="Not for sale at Cardinal" value={order.inactiveProducts} valueClassName="text-rose-700" />
        </div>
      )}

      {order.lineItemDetail && (
        <details className="mt-3 pt-3 border-t">
          <summary className="cursor-pointer text-xs font-semibold text-muted-foreground hover:text-foreground">Cardinal's line item detail</summary>
          <pre className="mt-2 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed">{order.lineItemDetail}</pre>
        </details>
      )}
    </Card>
  );
}
