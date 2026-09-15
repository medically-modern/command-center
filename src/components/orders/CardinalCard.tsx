/**
 * Cardinal's side of the order — who it is to them, their last word on it,
 * and the invoice.
 */
import { Card } from "@/components/ui/card";
import { cardinalStatus, fmtDate, fmtMoney, type Order } from "@/lib/orders/workflow";
import { CardinalPill } from "./pills";
import { Field, SectionTitle } from "./Field";

export function CardinalCard({ order }: { order: Order }) {
  const cs = cardinalStatus(order.apiStatus, order.holdReason, order.apiMessage);
  const placed = !!(order.cahOrderNumber || order.poNumber || order.lastCardinalSync || order.apiStatus);
  const billing = order.invoiceNumber || order.invoiceAmount || order.invoiceDate || order.superbillBatch;

  return (
    <Card className="p-4">
      <SectionTitle aside={<CardinalPill status={cs} size="sm" />}>Cardinal</SectionTitle>
      {!placed ? (
        <p className="text-sm text-muted-foreground">Not placed with Cardinal yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cardinal order #" value={order.cahOrderNumber} valueClassName="font-mono" />
          <Field label="PO number" value={order.poNumber} valueClassName="font-mono text-xs" />
          <Field label="Last sync" value={order.lastCardinalSync} />
          <Field label="API status (as written)" value={order.apiStatus} valueClassName="text-xs" />
          <Field label="Hold reason" value={order.holdReason} valueClassName="text-rose-700" />
          <Field label="Cardinal's message" value={order.apiMessage} className="col-span-2" valueClassName="text-xs" />
          <Field label="Order discrepancy" value={order.orderDiscrepancy} className="col-span-2" valueClassName="text-xs text-amber-700" />
        </div>
      )}

      {billing && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Invoice</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="Invoice #" value={order.invoiceNumber} valueClassName="font-mono" />
            <Field label="Invoice date" value={fmtDate(order.invoiceDate)} />
            <Field label="Due" value={fmtDate(order.invoiceDueDate)} />
            <Field label="Amount" value={fmtMoney(order.invoiceAmount)} valueClassName="font-semibold" />
            <Field label="Subtotal" value={fmtMoney(order.invoiceSubtotal)} />
            <Field label="Sales tax" value={fmtMoney(order.salesTax)} />
            <Field label="Shipping & handling" value={fmtMoney(order.shippingHandling)} />
            <Field label="Freight / dropship" value={fmtMoney(order.freightFee)} />
            <Field label="Payment terms" value={order.paymentTerms} />
            <Field label="Superbill batch" value={order.superbillBatch} className="col-span-2 sm:col-span-3" valueClassName="text-xs" />
          </div>
        </div>
      )}

    </Card>
  );
}
