/**
 * Shipping, delivery and the documents Cardinal and the carrier produced.
 * Tracking numbers link to the carrier when the number's shape or the
 * Carrier column says which one (`workflow.trackingUrl`); otherwise they are
 * plain text rather than a link to the wrong carrier.
 */
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, FileText } from "lucide-react";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { FILE_COLUMNS } from "@/lib/orders/mondayApi";
import { fmtDate, trackingUrl, type Order } from "@/lib/orders/workflow";
import { Field, SectionTitle } from "./Field";

export function ShippingCard({ order }: { order: Order }) {
  const docs = FILE_COLUMNS.flatMap((c) => (order.files[c.id] ?? []).map((f) => ({ ...f, label: c.label })));
  const nothing =
    !order.shipDate && !order.estimatedShipDate && !order.carrier && order.tracking.length === 0 &&
    !order.deliveryDate && !order.warehouse && docs.length === 0 && !order.shipTextLog && !order.deliveryCheckinText;

  return (
    <Card className="p-4">
      <SectionTitle>Shipping & delivery</SectionTitle>
      {nothing ? (
        <p className="text-sm text-muted-foreground">Nothing has shipped yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <Field label="Estimated ship" value={fmtDate(order.estimatedShipDate)} />
          <Field label="Shipped" value={fmtDate(order.shipDate)} />
          <Field label="Carrier" value={[order.carrier, order.carrierDescription].filter(Boolean).join(" · ")} />
          <Field label="Warehouse" value={order.warehouse} />
          {order.tracking.length > 0 && (
            <Field label={order.tracking.length > 1 ? "Tracking numbers" : "Tracking number"} className="col-span-2">
              <ul className="space-y-0.5">
                {order.tracking.map((t) => {
                  const url = trackingUrl(t, order.carrier);
                  return (
                    <li key={t} className="text-sm font-mono">
                      {url ? (
                        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                          {t} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        t
                      )}
                    </li>
                  );
                })}
              </ul>
            </Field>
          )}
          <Field label="Package weight" value={order.packageWeight} />
          <Field label="Delivered" value={fmtDate(order.deliveryDate)} valueClassName="text-emerald-700" />
          <Field label="Signed by" value={order.signedBy} />
          <Field label="Confirmed delivery address" value={order.confirmedDeliveryAddress} className="col-span-2" />
          <Field label="Serial numbers" value={order.serialNumbers} className="col-span-2" valueClassName="font-mono text-xs whitespace-pre-wrap" />
          <Field label="Shipping texts to the patient" value={order.shipTextLog} className="col-span-2" valueClassName="text-xs whitespace-pre-wrap" />
          <Field label="Delivery check-in text" value={order.deliveryCheckinText} className="col-span-2" valueClassName="text-xs" />
          <Field label="USPS address check" value={order.uspsCheck} className="col-span-2" valueClassName="text-xs text-muted-foreground" />
        </div>
      )}

      {docs.length > 0 && (
        <div className="mt-3 pt-3 border-t">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Documents</p>
          <ul className="space-y-1">
            {docs.map((d) => (
              <li key={d.assetId} className="flex items-center justify-between gap-2 text-sm">
                <span className="inline-flex items-center gap-2 min-w-0">
                  <FileText className="h-4 w-4 shrink-0 text-red-500" />
                  <span className="truncate" title={d.name}>
                    <span className="font-medium">{d.label}</span>
                    <span className="text-muted-foreground"> · {d.name}</span>
                  </span>
                </span>
                <Button variant="outline" size="sm" className="h-7 text-xs shrink-0" onClick={() => openFileViewer({ url: d.url, name: d.name })}>
                  View
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
