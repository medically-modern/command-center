/**
 * The shipping long tail — what the carrier and the warehouse reported
 * beyond the date, the tracking number and the paperwork, which the header
 * already carries. Lives in the details drawer.
 */
import { Card } from "@/components/ui/card";
import { fmtDate, type Order } from "@/lib/orders/workflow";
import { Field, SectionTitle } from "./Field";

export function ShippingCard({ order }: { order: Order }) {
  const nothing =
    !order.shipDate && !order.estimatedShipDate && !order.carrier && !order.deliveryDate && !order.warehouse &&
    !order.packageWeight && !order.serialNumbers && !order.confirmedDeliveryAddress && !order.shipTextLog &&
    !order.deliveryCheckinText && !order.uspsCheck;

  return (
    <Card className="p-4">
      <SectionTitle>Shipping</SectionTitle>
      {nothing ? (
        <p className="text-sm text-muted-foreground">Nothing has shipped yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Estimated ship" value={fmtDate(order.estimatedShipDate)} />
          <Field label="Shipped" value={fmtDate(order.shipDate)} />
          <Field label="Carrier" value={[order.carrier, order.carrierDescription].filter(Boolean).join(" · ")} />
          <Field label="Warehouse" value={order.warehouse} />
          <Field label="Package weight" value={order.packageWeight} />
          <Field label="Delivered" value={fmtDate(order.deliveryDate)} />
          <Field label="Signed by" value={order.signedBy} />
          <Field label="Confirmed delivery address" value={order.confirmedDeliveryAddress} className="col-span-2" />
          <Field label="Serial numbers" value={order.serialNumbers} className="col-span-2" valueClassName="font-mono text-xs whitespace-pre-wrap" />
          <Field label="Shipping texts to the patient" value={order.shipTextLog} className="col-span-2" valueClassName="text-xs whitespace-pre-wrap" />
          <Field label="Delivery check-in text" value={order.deliveryCheckinText} className="col-span-2" valueClassName="text-xs" />
          <Field label="USPS address check" value={order.uspsCheck} className="col-span-2" valueClassName="text-xs text-muted-foreground" />
        </div>
      )}
    </Card>
  );
}
