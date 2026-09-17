/**
 * Everything else on the order, folded. A rep on a phone call needs the
 * header and the lines; the ordering desk sometimes needs the PO number, the
 * invoice, the raw Cardinal message or the doctor's fax. All of it is here,
 * one click down, at its full width — nothing is dropped, and nothing here
 * competes with the answer above it.
 */
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { Order } from "@/lib/orders/workflow";
import { CardinalCard } from "./CardinalCard";
import { ShippingCard } from "./ShippingCard";
import { PatientCoverageCard } from "./PatientCoverageCard";
import { Field, SectionTitle } from "./Field";

export function OrderDetails({ order }: { order: Order }) {
  return (
    <details className="group">
      <summary className="flex cursor-pointer select-none items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm font-semibold hover:bg-muted/40 transition-colors list-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-open:rotate-90" />
        Full order details
        <span className="text-xs font-normal text-muted-foreground">Cardinal · invoice · shipping · patient & coverage · doctor</span>
      </summary>
      <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-4">
        <CardinalCard order={order} />
        <ShippingCard order={order} />
        <PatientCoverageCard order={order} />
        <PreCheckCard order={order} />
      </div>
    </details>
  );
}

/** The advisory pre-check and Cardinal's line-item breakdown — both machine
 *  prose, both read only when something upstream went wrong. */
function PreCheckCard({ order }: { order: Order }) {
  if (!order.preCheck && !order.preCheckDetail && !order.lineItemDetail) return null;
  return (
    <Card className="p-4">
      <SectionTitle>Pre-check & line items</SectionTitle>
      <Field label="Pre-check" value={order.preCheck} valueClassName={/^good to go/i.test(order.preCheck) ? "text-emerald-700" : "text-amber-700"} />
      {order.preCheckDetail && (
        <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed">{order.preCheckDetail}</pre>
      )}
      {order.lineItemDetail && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Cardinal's line item detail</p>
          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed">{order.lineItemDetail}</pre>
        </div>
      )}
    </Card>
  );
}
