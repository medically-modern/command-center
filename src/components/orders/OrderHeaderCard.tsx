/**
 * The banner of an open order: who it is for, where it is, what needs a
 * person, and the patient's other orders one click away.
 *
 * Two contracts live here:
 *   - The contact trio is `masheke/mmKit`'s `PatientContact` (Call · Text ·
 *     Calls) — the same three buttons every stage header carries (§5.16).
 *   - "Mark as Ordered" renders ONLY behind `ORDERING_FROM_COMMAND_CENTER`
 *     (`lib/orders/config.ts`). While the switch is off the banner says where
 *     the order IS placed, with the link, so nobody hunts for a button.
 */
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, Info, Loader2, PackageCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { PatientContact } from "@/components/masheke/mmKit";
import { orderMondayUrl } from "@/lib/orders/mondayApi";
import { ORDERING_FROM_COMMAND_CENTER } from "@/lib/orders/config";
import { markOrdered, OrderNotPlaceableError, canMarkOrdered } from "@/lib/orders/mondayWrite";
import {
  cardinalStatus, fmtDate, orderFlags, orderStage, ordersForSamePatient, STAGE_LABEL, type Order, type OrderFlag,
} from "@/lib/orders/workflow";
import { CardinalPill, Pill, StagePill } from "./pills";
import { STAGE_TONE } from "./tones";
import { Field } from "./Field";

interface Props {
  order: Order;
  /** The slim list — for the "other orders for this patient" strip. */
  allOrders: readonly Order[];
  onSelect: (id: string) => void;
  onPlaced?: () => void;
}

const FLAG_STYLE: Record<OrderFlag["tone"], string> = {
  rose: "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100",
  amber: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  sky: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100",
};

export function OrderHeaderCard({ order, allOrders, onSelect, onPlaced }: Props) {
  const stage = orderStage(order);
  const cs = cardinalStatus(order.apiStatus, order.holdReason, order.apiMessage);
  const flags = orderFlags(order);
  const others = ordersForSamePatient(order, allOrders)
    .slice()
    .sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""));

  return (
    <div className="space-y-3">
      <Card className="p-5 border-t-4 border-t-[color:var(--mm-teal)] rounded-2xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm uppercase tracking-wide text-muted-foreground font-semibold">Patient · order</p>
            <h2 className="text-3xl font-black leading-tight truncate" title={order.name}>{order.name}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StagePill stage={stage} />
              <CardinalPill status={cs} />
              {order.orderType && <Pill tone="slate">{order.orderType}</Pill>}
              {order.subscriptionType && <Pill tone="slate">{order.subscriptionType}</Pill>}
              {order.groupTitle && <Pill tone="slate" title="Board group">{order.groupTitle}</Pill>}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {[
                order.orderDate ? `Created ${fmtDate(order.orderDate)}` : "",
                order.cahOrderNumber ? `Cardinal order ${order.cahOrderNumber}` : "",
                order.poNumber ? `PO ${order.poNumber}` : "",
                `Item ${order.id}`,
              ].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <PatientContact phone={order.phone} />
            <div className="flex items-center gap-4">
              <Field label="DOB" value={order.dob} />
              <a
                href={orderMondayUrl(order.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Open on Monday <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>

        {flags.length > 0 && (
          <div className="mt-4 space-y-2">
            {flags.map((f) => (
              <div key={f.id} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", FLAG_STYLE[f.tone])}>
                {f.tone === "sky" ? <Info className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />}
                <div className="min-w-0">
                  <p className="font-semibold">{f.label}</p>
                  {f.detail && f.detail !== f.label && <p className="text-xs opacity-90 break-words">{f.detail}</p>}
                </div>
              </div>
            ))}
          </div>
        )}

        <PlaceOrderRow order={order} onPlaced={onPlaced} />
      </Card>

      {others.length > 0 && (
        <Card className="p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Other orders for this patient ({others.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {others.map((o) => {
              const s = orderStage(o);
              return (
                <button
                  key={o.id}
                  onClick={() => onSelect(o.id)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs hover:bg-muted/60 transition-colors"
                  title={`${o.name} · ${STAGE_LABEL[s]}`}
                >
                  <span className={cn("h-2 w-2 rounded-full", DOT[STAGE_TONE[s]])} />
                  <span className="font-medium tabular-nums">{o.orderDate ? fmtDate(o.orderDate) : "no date"}</span>
                  <span className="text-muted-foreground">{STAGE_LABEL[s]}</span>
                  {o.name.trim().toLowerCase() !== order.name.trim().toLowerCase() && (
                    <span className="text-muted-foreground">· {o.name}</span>
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

const DOT: Record<string, string> = {
  teal: "bg-[color:var(--mm-green)]",
  slate: "bg-slate-400",
  sky: "bg-sky-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};

/**
 * The switch's two faces. Off: one quiet sentence, because the board is where
 * this order gets placed today. On: the button, with a confirm, refusing
 * anything not sitting at "Order" (`mondayWrite.canMarkOrdered`).
 */
function PlaceOrderRow({ order, onPlaced }: { order: Order; onPlaced?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const stage = orderStage(order);
  if (stage !== "toPlace" && stage !== "placing") return null;

  if (!ORDERING_FROM_COMMAND_CENTER) {
    return (
      <p className="mt-4 text-xs text-muted-foreground flex items-center gap-1.5">
        <Info className="h-3.5 w-3.5 shrink-0" />
        Orders are placed on the New Order board for now — flip Order Status to “Ordered” there. Ordering from here is coming.
      </p>
    );
  }

  const placeable = canMarkOrdered(order.orderStatus);
  const place = async () => {
    setBusy(true);
    try {
      await markOrdered(order.id);
      toast.success("Order placed — Cardinal will answer in a moment");
      onPlaced?.();
    } catch (e) {
      toast.error(e instanceof OrderNotPlaceableError ? "Not placed" : "Placing the order failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <div className="mt-4 flex items-center gap-3">
      <Button onClick={() => setOpen(true)} disabled={!placeable || busy} className="gap-2 bg-[color:var(--mm-teal)] text-white hover:opacity-90">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Mark as Ordered
      </Button>
      {!placeable && <p className="text-xs text-muted-foreground">Order Status is “{order.orderStatus || "blank"}” — only an order at “Order” can be placed.</p>}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Place this order with Cardinal?</AlertDialogTitle>
            <AlertDialogDescription>
              {order.name} — flipping Order Status to “Ordered” hands the order to Cardinal. It cannot be un-sent from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); void place(); }} disabled={busy}>
              {busy ? "Placing…" : "Place order"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
