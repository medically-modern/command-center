/**
 * Backordered set → the swap request Cardinal receives.
 *
 * The rules are `lib/orders/substitution` (a read-only mirror of the email
 * service's — see that file's header); the write is
 * `mondayWrite.requestSubstitution`.
 *
 * ⚠️ **THE SEND BUTTON IS THE EMAIL.** Picking a set and pressing Send writes
 * Substitute Infusion Set, monday webhook 635472669 fires, and `email-serivce`
 * emails Cardinal customer care. There is no draft and no undo, which is why
 * every refusal is checked before the press and the button carries a confirm.
 * Afterwards the service writes its verdict into Substitution Status, and the
 * card watches that column for it — that column IS the notification.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Check, Loader2, Mail, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useStatusOptions } from "@/hooks/useStatusOptions";
import { indexForLabel } from "@/lib/shared/statusOptions";
import { stockKey, stockVerdict } from "@/lib/welcomeCall/infusionStock";
import { etToday } from "@/lib/masheke/etDate";
import type { SkuTrackerRow } from "@/lib/orders/skuTrackerApi";
import { skuRowForLine } from "@/lib/orders/skuJoin";
import { BOARD_ID, COL, readSubstitutionState } from "@/lib/orders/mondayApi";
import { requestSubstitution } from "@/lib/orders/mondayWrite";
import {
  backorderedEntries, backorderedSetOnOrder, hasSubstitutionStory, substitutionAnswered,
  substitutionBlockers, substitutionOptions, substitutionSendKind, substitutionSendRefusal,
  substitutionVerdict,
} from "@/lib/orders/substitution";
import { isOpenStage, orderStage, type Order } from "@/lib/orders/workflow";
import { StockPill } from "./pills";
import { Field, SectionTitle } from "./Field";

/** How long to watch Substitution Status after a send, and how often. */
const WATCH_EVERY_MS = 3000;
const WATCH_TRIES = 15;

type Phase = "idle" | "sending" | "waiting" | "answered" | "quiet";

export function SubstitutionCard({
  order, skuRows, onSent,
}: {
  order: Order;
  skuRows: SkuTrackerRow[] | null;
  /** Ask the page to refetch once the service has answered. */
  onSent?: () => void;
}) {
  const open = isOpenStage(orderStage(order));
  const onBoard = (order.substituteInfusionSet ?? "").trim();

  const [picked, setPicked] = useState(onBoard);
  const [phase, setPhase] = useState<Phase>("idle");
  const [confirming, setConfirming] = useState(false);
  // The verdict the watcher read, which is fresher than the 60s board poll.
  const [live, setLive] = useState<string | null>(null);
  const watch = useRef<{ cancelled: boolean } | null>(null);

  // A pick must never survive a change of order (§9's notes-box rule): the
  // Send button would write this order's id with the previous one's set. The
  // page also keys the card on the order, so this is belt and braces.
  const forId = useRef(order.id);
  if (forId.current !== order.id) {
    forId.current = order.id;
    if (watch.current) watch.current.cancelled = true;
    setPicked(onBoard);
    setPhase("idle");
    setLive(null);
  }

  useEffect(() => () => { if (watch.current) watch.current.cancelled = true; }, []);

  const { options, ready, error: optionsError } = useStatusOptions(BOARD_ID, [COL.substituteInfusionSet]);
  const labels = (options[COL.substituteInfusionSet] ?? []).map((o) => o.label);
  const choices = substitutionOptions(labels, order);

  const verdict = substitutionVerdict(live ?? order.substitutionStatus);
  const stuck = backorderedEntries(order.backordered);
  const setOnOrder = backorderedSetOnOrder(order);
  const blockers = open ? substitutionBlockers(order) : [];
  const refusal = open ? substitutionSendRefusal(order, picked) : "";
  const kind = substitutionSendKind(onBoard, picked);

  const subRow = picked && skuRows ? skuRowForLine({ family: "infusionSets", product: picked }, skuRows) : null;
  const subStock = subRow ? stockVerdict(picked, new Map([[stockKey(picked), subRow]]), etToday()) : null;

  /** Poll Substitution Status until the service answers, then hand back. */
  const watchForAnswer = useCallback(
    async (before: { status: string; notes: string }) => {
      const token = { cancelled: false };
      if (watch.current) watch.current.cancelled = true;
      watch.current = token;
      setPhase("waiting");
      for (let i = 0; i < WATCH_TRIES; i++) {
        await new Promise((r) => setTimeout(r, WATCH_EVERY_MS));
        if (token.cancelled) return;
        try {
          const now = await readSubstitutionState(order.id);
          if (token.cancelled) return;
          if (substitutionAnswered(before, now)) {
            setLive(now.status);
            setPhase("answered");
            onSent?.();
            return;
          }
        } catch {
          // A failed read is not an answer — keep watching.
        }
      }
      // ⚠️ Running out of tries says nothing about the email. The service may
      // still be working, and Substitution Status carries the verdict whenever
      // it lands, so this reports "no answer yet", never a failure.
      if (!token.cancelled) {
        setPhase("quiet");
        onSent?.();
      }
    },
    [order.id, onSent],
  );

  const send = useCallback(async () => {
    const index = indexForLabel(options[COL.substituteInfusionSet] ?? [], picked);
    if (index === null) {
      // The board has no such label, so the write would be dropped at HTTP 200
      // with nothing in the logs — refuse instead of reporting a send.
      toast.error(`"${picked}" is not a label on Substitute Infusion Set — reload and pick again.`);
      return;
    }
    setPhase("sending");
    try {
      const before = await readSubstitutionState(order.id);
      const { kind: sent } = await requestSubstitution(order.id, picked, index);
      toast.success(sent === "resend" ? "Swap request re-sent to Cardinal" : "Swap request sent to Cardinal");
      void watchForAnswer(before);
    } catch (e) {
      setPhase("idle");
      toast.error(e instanceof Error ? e.message : "Could not send the swap request");
    }
  }, [options, picked, order.id, watchForAnswer]);

  // Nothing to say about an ordinary order — but an OPEN order with a
  // backordered line is exactly where the rep needs the control, so the card
  // renders as soon as there is anything on back order.
  if (!hasSubstitutionStory(order)) return null;

  const busy = phase === "sending" || phase === "waiting";

  return (
    <Card className="p-4">
      <SectionTitle
        aside={
          verdict.state === "sent" ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" /> Email sent
            </span>
          ) : verdict.state === "error" ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700 dark:text-rose-400">
              <AlertTriangle className="h-3.5 w-3.5" /> Email not sent
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

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Set on the order</p>
          <p className="text-sm font-semibold break-words">
            {setOnOrder?.ambiguous
              ? setOnOrder.ambiguous.join(" and ")
              : setOnOrder?.name || <span className="font-normal text-muted-foreground">none on this order</span>}
          </p>
        </div>
        <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0 mb-1" />
        <div className="min-w-[14rem] flex-1">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold" htmlFor="sub-set">
            Switch to
          </label>
          {open ? (
            <select
              id="sub-set"
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
              disabled={!ready || busy}
              className="mt-0.5 w-full rounded-md border bg-background px-2 py-1.5 text-sm font-medium disabled:opacity-60"
            >
              <option value="">{ready ? "Pick a replacement set…" : "Loading the board's sets…"}</option>
              {choices.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
            </select>
          ) : (
            <p className="text-sm font-semibold break-words">
              {onBoard || <span className="font-normal text-muted-foreground">none picked</span>}
            </p>
          )}
          {subRow?.sku && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              SKU <span className="font-mono">{subRow.sku}</span> — read from the tracker again when the email is written
            </p>
          )}
        </div>
        {subStock && subStock.label && <StockPill verdict={subStock} />}
      </div>

      {picked && skuRows && !subRow && (
        <p className="mt-2 text-xs text-rose-700 dark:text-rose-400">
          That set is not on the Cardinal SKU Tracker, so there is no SKU to send. Add it to that board first.
        </p>
      )}

      {open && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button onClick={() => setConfirming(true)} disabled={!!refusal || !ready || busy} className="gap-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {phase === "sending" ? "Sending…" : phase === "waiting" ? "Waiting for Cardinal email…"
              : kind === "resend" ? "Re-send swap request" : "Send swap request"}
          </Button>
          <p className="text-xs text-muted-foreground min-w-0 flex-1">
            {refusal
              ? refusal
              : !ready
                ? optionsError
                  ? `Can't read the board's set list: ${optionsError}`
                  : "Reading the board's set list…"
                : kind === "resend"
                  ? "Same set as the board already holds — this clears it and re-picks, so Cardinal gets the request again."
                  : "This emails Cardinal customer care straight away."}
          </p>
        </div>
      )}

      {phase === "quiet" && (
        <p className="mt-2 text-xs text-muted-foreground">
          No answer from the email service yet. Substitution Status will show the verdict when it lands.
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
          <p className="font-semibold">Cardinal would refuse a swap as this order stands</p>
          <ul className="mt-0.5 text-xs space-y-0.5 list-disc pl-4">
            {blockers.map((b) => <li key={b}>{b}</li>)}
          </ul>
        </div>
      )}

      {order.substitutionCahNumber && (
        <div className="mt-3 pt-3 border-t">
          <Field label="Replacement Cardinal order" value={order.substitutionCahNumber} valueClassName="font-mono" />
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Cardinal deleted the original line and placed this order in its place. The original stays in CAH Order Number.
          </p>
        </div>
      )}

      <p className="mt-3 pt-3 border-t text-[11px] text-muted-foreground flex items-start gap-1.5">
        <Mail className="h-3.5 w-3.5 mt-px shrink-0" />
        <span>
          Sending asks Cardinal customer care to switch this order onto the set you picked. The SKU is read from the
          Cardinal SKU Tracker as the email is written, and the quantity is the order's own Qty: Infusion Set 1.
        </span>
      </p>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {kind === "resend" ? "Re-send this swap request?" : "Email Cardinal to switch this order?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              Cardinal customer care will be asked to switch {order.name}'s order
              {setOnOrder?.name ? ` off the ${setOnOrder.name}` : ""} and onto the <strong>{picked}</strong>
              {order.cahOrderNumber ? `, order ${order.cahOrderNumber}` : ""}. The email goes out straight away and
              cannot be recalled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void send()}>
              {kind === "resend" ? "Re-send" : "Send it"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
