/**
 * The top of an open order — everything a rep needs for the phone call, in
 * the order they need it: who it is for, WHERE IT IS in one sentence, what
 * (if anything) needs a person, the path so far, the tracking number and the
 * documents, and the patient's other orders one click away.
 *
 * The sentence is `lib/orders/headline` and the path is `lib/orders/timeline`
 * — both pure and tested. The card draws them; it decides nothing about the
 * order. Two contracts live here:
 *   - The contact trio is `masheke/mmKit`'s `PatientContact` (Call · Text ·
 *     Calls) — the same three buttons every stage header carries (§5.16).
 *   - "Mark as Ordered" renders ONLY behind `ORDERING_FROM_COMMAND_CENTER`
 *     (`lib/orders/config.ts`). While the switch is off there is no note about
 *     where orders are placed: the headline already says "waiting to be
 *     placed", and the ordering desk knows where.
 */
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { AlertTriangle, ExternalLink, FileText, Loader2, PackageCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { PatientContact } from "@/components/masheke/mmKit";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { ORDERING_FROM_COMMAND_CENTER } from "@/lib/orders/config";
import { FILE_COLUMNS } from "@/lib/orders/mondayApi";
import { markOrdered, OrderNotPlaceableError, canMarkOrdered } from "@/lib/orders/mondayWrite";
import { orderHeadline } from "@/lib/orders/headline";
import {
  fmtDate, orderFlags, orderStage, ordersForSamePatient, orderTypeLabel, trackingUrl, STAGE_LABEL,
  type Order,
} from "@/lib/orders/workflow";
import { productWords } from "@/lib/orders/rowSummary";
import { OrderTimeline } from "./OrderTimeline";
import { STAGE_TONE, type PillTone } from "./tones";

interface Props {
  order: Order;
  /** The slim list — for the "other orders for this patient" strip. */
  allOrders: readonly Order[];
  onSelect: (id: string) => void;
  onPlaced?: () => void;
}

/** The headline block wears the stage's colour — rose whenever a person is needed. */
const HEADLINE_TONE: Record<PillTone, string> = {
  teal: "border-[color:var(--mm-mint-ring)] bg-[color:var(--mm-mint)] text-[color:var(--mm-teal)]",
  slate: "border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
  sky: "border-sky-200 bg-sky-50 text-sky-950 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100",
  amber: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
  rose: "border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100",
  violet: "border-violet-200 bg-violet-50 text-violet-950 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-100",
};

const DOT: Record<PillTone, string> = {
  teal: "bg-[color:var(--mm-green)]",
  slate: "bg-slate-400",
  sky: "bg-sky-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};

export function OrderHeaderCard({ order, allOrders, onSelect, onPlaced }: Props) {
  const stage = orderStage(order);
  const head = orderHeadline(order);
  // Sky flags are information, and the headline already carries them
  // ("Partially shipped…"); the substitution card owns its own "sent" state.
  // A flag the headline states is not drawn twice.
  const flags = orderFlags(order).filter((f) => f.tone !== "sky" && f.id !== head.flagId);
  const needsPerson = flags.some((f) => f.tone === "rose") || ["hold", "error", "review"].includes(head.flagId ?? "");
  const tone: PillTone = needsPerson ? "rose" : STAGE_TONE[stage];

  const eyebrow = [orderTypeLabel(order, allOrders), order.subscriptionType || productWords(order)].filter(Boolean).join(" · ") || "Order";
  const meta = [order.dob ? `DOB ${order.dob}` : "", order.address ? `Ships to ${order.address}` : ""].filter(Boolean);

  const others = ordersForSamePatient(order, allOrders)
    .slice()
    .sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""));
  // Two orders for one patient on ONE day is usually a duplicate somebody is
  // about to place twice — not always (a split order is two items by design),
  // so it asks rather than declares.
  const sameDay = others.filter((o) => o.orderDate && o.orderDate === order.orderDate);

  return (
    <Card className="p-5 border-t-4 border-t-[color:var(--mm-teal)] rounded-2xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm uppercase tracking-wide text-muted-foreground font-semibold truncate">{eyebrow}</p>
          <h2 className="text-3xl font-black leading-tight truncate" title={order.name}>{order.name}</h2>
          {meta.length > 0 && <p className="mt-1 text-xs text-muted-foreground break-words">{meta.join(" · ")}</p>}
        </div>
        <div className="shrink-0">
          <PatientContact phone={order.phone} />
        </div>
      </div>

      {/* The answer. */}
      <div className={cn("mt-4 rounded-xl border px-4 py-3", HEADLINE_TONE[tone])}>
        <p className="text-xl font-bold leading-tight break-words">{head.text}</p>
        {head.detail && <p className="mt-0.5 text-sm opacity-90 break-words">{head.detail}</p>}
      </div>

      {flags.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {flags.map((f) => (
            <li
              key={f.id}
              className={cn(
                "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                f.tone === "rose"
                  ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100"
                  : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
              )}
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold">{f.label}</p>
                {/* Rose gets its sentence — a person has to act on it. Amber is
                    a heads-up, and its detail is what the card below says in
                    full (the substitution card names the backordered set). */}
                {f.tone === "rose" && f.detail && f.detail !== f.label && <p className="text-xs opacity-90 break-words">{f.detail}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <OrderTimeline order={order} className="mt-5 pt-5 border-t" />

      <DeliveryActions order={order} />

      {ORDERING_FROM_COMMAND_CENTER && <PlaceOrderRow order={order} onPlaced={onPlaced} />}

      {others.length > 0 && (
        <div className="mt-4 pt-3 border-t">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
            Other orders ({others.length})
          </p>
          {sameDay.length > 0 && (
            <p className="mb-1.5 text-xs text-amber-700 dark:text-amber-400 inline-flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {sameDay.length === 1 ? "Another order" : `${sameDay.length} more orders`} dated the same day — check it isn't a duplicate.
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {others.map((o) => {
              const s = orderStage(o);
              const isTwin = !!o.orderDate && o.orderDate === order.orderDate;
              return (
                <button
                  key={o.id}
                  onClick={() => onSelect(o.id)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs hover:bg-muted/60 transition-colors"
                  title={`${o.name} · ${STAGE_LABEL[s]}${o.cahOrderNumber ? ` · Cardinal ${o.cahOrderNumber}` : ""}`}
                >
                  <span className={cn("h-2 w-2 rounded-full", DOT[STAGE_TONE[s]])} />
                  <span className="font-medium tabular-nums">{o.orderDate ? fmtDate(o.orderDate) : "no date"}</span>
                  <span className="text-muted-foreground">{STAGE_LABEL[s]}</span>
                  {/* A same-day twin needs something that tells it apart from
                      the order already open — the date and stage alone won't. */}
                  {isTwin && (o.cahOrderNumber || productWords(o)) && (
                    <span className="text-muted-foreground">· {o.cahOrderNumber ? `Cardinal ${o.cahOrderNumber}` : productWords(o)}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * The two things a rep reaches for once an order has shipped: the tracking
 * page and the paperwork. Buttons, not fields — they are for pressing.
 * Renders nothing until there is something to press.
 */
function DeliveryActions({ order }: { order: Order }) {
  const docs = FILE_COLUMNS.flatMap((c) => (order.files[c.id] ?? []).map((f) => ({ ...f, label: c.label })));
  if (order.tracking.length === 0 && docs.length === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {order.tracking.map((t) => {
        const url = trackingUrl(t, order.carrier);
        const label = order.tracking.length > 1 ? "Track" : "Track package";
        return url ? (
          <a
            key={t}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md bg-[color:var(--mm-teal)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
          >
            {label} <span className="font-mono font-normal opacity-90">{t}</span> <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span key={t} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs" title="No carrier page known for this number">
            Tracking <span className="font-mono">{t}</span>
          </span>
        );
      })}
      {docs.map((d) => (
        <Button key={d.assetId} variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => openFileViewer({ url: d.url, name: d.name })} title={d.name}>
          <FileText className="h-3.5 w-3.5 text-red-500" /> {d.label}
        </Button>
      ))}
    </div>
  );
}

/**
 * The switch's ON face: the button, with a confirm, refusing anything not
 * sitting at "Order" (`mondayWrite.canMarkOrdered`). Never rendered while the
 * switch is off.
 */
function PlaceOrderRow({ order, onPlaced }: { order: Order; onPlaced?: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const stage = orderStage(order);
  if (stage !== "toPlace" && stage !== "placing") return null;

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
