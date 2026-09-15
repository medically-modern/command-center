/**
 * Backordered set → the swap request. The rules are `lib/orders/substitution`
 * (a read-only mirror of the email service's — see that file's header); this
 * is only the looks.
 *
 * READ-ONLY, like the rest of this role: the pick itself is made in Substitute
 * Infusion Set on the order board, and picking it is what sends the email.
 */
import { Card } from "@/components/ui/card";
import { AlertTriangle, ArrowRight, Check, Mail } from "lucide-react";
import { cn } from "@/lib/utils";
import { stockKey, stockVerdict } from "@/lib/welcomeCall/infusionStock";
import { etToday } from "@/lib/masheke/etDate";
import type { SkuTrackerRow } from "@/lib/orders/skuTrackerApi";
import { skuRowForLine } from "@/lib/orders/skuJoin";
import {
  backorderedEntries, backorderedSetOnOrder, hasSubstitutionStory, substitutionBlockers, substitutionVerdict,
} from "@/lib/orders/substitution";
import { isOpenStage, orderStage, type Order } from "@/lib/orders/workflow";
import { StockPill } from "./pills";
import { Field, SectionTitle } from "./Field";

export function SubstitutionCard({ order, skuRows }: { order: Order; skuRows: SkuTrackerRow[] | null }) {
  const open = isOpenStage(orderStage(order));
  // A closed order keeps its record — what was swapped and whether it went —
  // but nothing here is work any more, so it only renders while there is a
  // story to tell.
  if (!hasSubstitutionStory(order)) return null;

  const verdict = substitutionVerdict(order.substitutionStatus);
  const stuck = backorderedEntries(order.backordered);
  const setOnOrder = backorderedSetOnOrder(order);
  const substitute = (order.substituteInfusionSet ?? "").trim();
  const blockers = open && !substitute ? substitutionBlockers(order) : [];

  const subRow = substitute && skuRows ? skuRowForLine({ family: "infusionSets", product: substitute }, skuRows) : null;
  const subStock = subRow ? stockVerdict(substitute, new Map([[stockKey(substitute), subRow]]), etToday()) : null;

  return (
    <Card className="p-4">
      <SectionTitle
        aside={
          verdict.state === "sent" ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" /> Swap requested
            </span>
          ) : verdict.state === "error" ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 dark:text-rose-400">
              <AlertTriangle className="h-3.5 w-3.5" /> Swap request failed
            </span>
          ) : undefined
        }
      >
        Backorder substitution
      </SectionTitle>

      {stuck.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">On back order at Cardinal</p>
          <ul className="mt-1 space-y-0.5">
            {stuck.map((s) => (
              <li key={s} className="text-sm font-medium text-amber-700 dark:text-amber-400 break-words">{s}</li>
            ))}
          </ul>
          {order.backorderedQty && <p className="text-[11px] text-muted-foreground mt-1">Backordered qty {order.backorderedQty}</p>}
        </div>
      )}

      {/* set on the order → what the rep picked instead */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Set on the order</p>
          <p className="text-sm font-semibold break-words">
            {setOnOrder?.ambiguous
              ? setOnOrder.ambiguous.join(" and ")
              : setOnOrder?.name || <span className="font-normal text-muted-foreground">none on this order</span>}
          </p>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Substitute picked</p>
          {substitute ? (
            <p className="text-sm font-semibold break-words">
              {substitute}
              {subRow?.sku && <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">{subRow.sku}</span>}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">not picked yet</p>
          )}
        </div>
        {subStock && subStock.label && <StockPill verdict={subStock} />}
      </div>

      {substitute && skuRows && !subRow && (
        <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">
          That set is not on the Cardinal SKU Tracker, so there is no SKU to send. Add it to that board, then re-pick the substitute set.
        </p>
      )}

      {verdict.state !== "none" && (
        <div
          className={cn(
            "mt-3 rounded-lg border px-3 py-2 text-sm",
            verdict.state === "sent"
              ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100"
              : "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100",
          )}
        >
          <p className="font-semibold">{verdict.label}</p>
          {verdict.state === "sent" ? (
            <p className="text-xs mt-0.5 opacity-90">
              The swap request reached Cardinal customer care. The Notes below carry the line that was sent.
            </p>
          ) : (
            verdict.fix && <p className="text-xs mt-0.5 opacity-90">{verdict.fix}</p>
          )}
        </div>
      )}

      {blockers.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          <p className="font-semibold">A substitution would bounce as this order stands</p>
          <ul className="mt-0.5 text-xs space-y-0.5 list-disc pl-4">
            {blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      )}

      {order.substitutionCahNumber && (
        <div className="mt-3 pt-3 border-t">
          <Field
            label="Replacement Cardinal order"
            value={order.substitutionCahNumber}
            valueClassName="font-mono"
          />
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Cardinal deleted the original line and placed this order in its place. The original stays in CAH Order Number.
          </p>
        </div>
      )}

      <p className="mt-3 pt-3 border-t text-[11px] text-muted-foreground flex items-start gap-1.5">
        <Mail className="h-3.5 w-3.5 mt-px shrink-0" />
        <span>
          Picking a Substitute Infusion Set on the order board emails Cardinal customer care asking them to switch this
          order onto it — the SKU is read from the Cardinal SKU Tracker as the email is written, and the quantity is the
          order's own Qty: Infusion Set 1. Every pick sends, so re-picking is how you chase.
        </span>
      </p>
    </Card>
  );
}
