/**
 * What a cash pay patient owes, and how the money gets collected.
 *
 * The card a rep works a Cash Pay order from: the priced lines, the one total
 * they read down the phone, where the payment has got to, and the two presses
 * that put a Stripe link in front of the patient. Rules live in
 * `lib/orders/cashPayPricing` (the money), `cashPayLink` (the link's life) and
 * `cashPayGate` (whether the order may go to Cardinal) — nothing here decides
 * any of them.
 *
 * ⚠️ **It renders for cash pay orders only** and returns null otherwise, so
 * `OrdersPage` can mount it unconditionally. An insured order must not grow a
 * money card it has no use for.
 *
 * ⚠️ **NOT ability-gated** (Josh, 2026-09-21, asked directly: *"No gate — any
 * rep"*). The RELEASE is manager-only, which is a different question: reading
 * a patient their total is the job, and letting an unpaid order through to
 * Cardinal is a decision.
 *
 * ⚠️ The two presses are INERT while `CASH_PAY_LINK_FROM_COMMAND_CENTER` is
 * false — shown with the reason, never hidden (that config's header has the
 * argument). The quote above them is live regardless, which is the half that
 * actually unblocked Debbie Hinze.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle, Banknote, Check, Copy, ExternalLink, Link2, Loader2, Receipt, Send, ShieldCheck,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useAccessContext } from "@/components/AccessProvider";
import type { SkuTrackerRow } from "@/lib/orders/skuTrackerApi";
import { fmtPhone, type Order } from "@/lib/orders/workflow";
import { CASH_PAY_LINK_FROM_COMMAND_CENTER } from "@/lib/orders/config";
import { CASH_PAY_MARKUP, cashPayQuote, SHIPPING_HANDLING_LABEL } from "@/lib/orders/cashPayPricing";
import {
  cashPayHeadline, cashPayLinkStep, generateRefusal, money, NOT_WIRED, quoteDrift, sendRefusal,
} from "@/lib/orders/cashPayLink";
import { cashPayReleaseRefusal, isCashPayOrder } from "@/lib/orders/cashPayGate";
import { generateCashPayLink, releaseCashPayOrder, sendCashPayLink } from "@/lib/orders/mondayWrite";
import { readCashPayState } from "@/lib/orders/mondayApi";
import { SectionTitle } from "./Field";

/** How long to watch for the payment service's answer, and how often.
 *  ⚠️ The mint happens in another service, so the card would otherwise sit
 *  unchanged until the 60-second board poll — which reads as the button not
 *  working and invites a second press. */
const WATCH_EVERY_MS = 3000;
const WATCH_TRIES = 15;

/** Where a press has got to. `quiet` is "no answer yet", never "it failed". */
type Phase = "idle" | "working" | "waiting" | "quiet";

export function CashPayCard({
  order, skuRows, onChanged,
}: {
  order: Order;
  skuRows: SkuTrackerRow[] | null;
  /** Ask the page to refetch once something landed on the board. */
  onChanged?: () => void;
}) {
  const { access } = useAccessContext();
  const isManager = access.type === "manager";

  const [releasing, setReleasing] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  /* What the watcher last read, which is fresher than the 60s board poll. */
  const [live, setLive] = useState<{ link: string; action: string } | null>(null);
  const watch = useRef<{ cancelled: boolean } | null>(null);

  /* A typed reason must never survive a change of order (§9's notes-box rule):
     it is stamped into THAT order's notes, and this card is keyed on the id by
     its caller as well — belt and braces, because the cost here is a reason
     filed against the wrong patient's order. */
  const forId = useRef(order.id);
  if (forId.current !== order.id) {
    forId.current = order.id;
    /* ⚠️ The watcher is bound to the order that was open when the press was
       made, so one surviving a switch would paint the PREVIOUS order's link
       onto this card — §5.5's `useDeliveryRecheck` rule, with a payment on it. */
    if (watch.current) watch.current.cancelled = true;
    setReason("");
    setReleasing(false);
    setPhase("idle");
    setLive(null);
  }

  useEffect(() => () => { if (watch.current) watch.current.cancelled = true; }, []);

  /* Derived above the handlers because they read them. The tracker not having
     loaded yet is a real state: say so rather than pricing at nothing. */
  const quote = skuRows ? cashPayQuote(order, skuRows) : null;
  const wired = CASH_PAY_LINK_FROM_COMMAND_CENTER;

  /* ⚠️ Attached to BOTH presses even though they are disabled while the flow
     is dark. Flipping `CASH_PAY_LINK_FROM_COMMAND_CENTER` before the endpoint
     exists would otherwise enable a button that does nothing at all — the
     silent no-op class §9 records costing five days of a rep re-pressing
     Advance. A loud refusal is the cheap half of that guard. */
  const notBuilt = useCallback(() => {
    toast.error("Payment links aren't built yet", { description: NOT_WIRED });
  }, []);

  /** Poll for the payment service's answer: a link, or "Link failed". */
  const watchForLink = useCallback(async () => {
    const token = { cancelled: false };
    if (watch.current) watch.current.cancelled = true;
    watch.current = token;
    setPhase("waiting");

    for (let i = 0; i < WATCH_TRIES; i++) {
      await new Promise((r) => setTimeout(r, WATCH_EVERY_MS));
      if (token.cancelled) return;
      try {
        const now = await readCashPayState(order.id);
        if (token.cancelled) return;
        if (now.link.trim() || now.action.trim() === "Link failed") {
          setLive(now);
          setPhase("idle");
          onChanged?.();
          return;
        }
      } catch {
        /* A failed read is not an answer — keep watching. */
      }
    }
    /* ⚠️ Running out is NOT a failure. The mint may still be in flight, and
       telling a rep it failed would have them press again and risk a second
       link — §5.35's rule for the substitution watcher, for the same reason. */
    if (!token.cancelled) setPhase("quiet");
  }, [order.id, onChanged]);

  const generate = useCallback(async () => {
    if (!wired) return notBuilt();
    if (!quote || quote.refusal) return;
    setPhase("working");
    try {
      await generateCashPayLink(order.id, quote.total);
      void watchForLink();
    } catch (e) {
      setPhase("idle");
      toast.error(e instanceof Error ? e.message : "Could not generate the link");
    }
  }, [order.id, wired, quote, notBuilt, watchForLink]);

  const send = useCallback(async () => {
    if (!wired) return notBuilt();
    setPhase("working");
    try {
      await sendCashPayLink(order.id);
      toast.success("Sending the link", { description: "The board texts it from the MM number." });
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send the link");
    } finally {
      setPhase("idle");
    }
  }, [order.id, wired, notBuilt, onChanged]);

  const release = useCallback(async () => {
    setSaving(true);
    try {
      await releaseCashPayOrder(order.id, { isManager, reason });
      toast.success("Released for ordering", { description: "The reason is stamped on the order's notes." });
      setReleasing(false);
      setReason("");
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not release this order");
    } finally {
      setSaving(false);
    }
  }, [order.id, isManager, reason, onChanged]);

  if (!isCashPayOrder(order)) return null;

  /* ⚠️ What the watcher read wins over the 60-second poll's copy, so a minted
     link appears the moment the payment service writes it. Everything below
     reads `shown`, not `order`: the heading, the buttons and the refusals must
     not disagree about whether a link exists. */
  const shown = live ? { ...order, cashPayLink: live.link } : order;
  const failed = (live?.action ?? "").trim() === "Link failed";

  const step = cashPayLinkStep(shown);
  const genRefusal = generateRefusal(shown, { quoteRefusal: quote?.refusal ?? "", wired });
  const sndRefusal = sendRefusal(shown, { wired });
  const drift = quote && !quote.refusal ? quoteDrift(shown, quote.total) : "";
  const releaseRefusal = cashPayReleaseRefusal(order, { isManager, reason });
  const busy = phase === "working" || phase === "waiting";

  const tone =
    step === "paid" ? "emerald"
      : step === "released" ? "sky"
        : step === "awaitingPayment" ? "amber"
          : "muted";

  return (
    <Card className="p-4">
      <SectionTitle
        aside={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
            <Banknote className="h-3 w-3" /> Cash pay
          </span>
        }
      >
        Payment
      </SectionTitle>

      <div
        className={cn(
          "rounded-lg border px-3 py-2 text-sm font-medium",
          tone === "emerald" && "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-100",
          tone === "sky" && "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100",
          tone === "amber" && "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100",
          tone === "muted" && "bg-muted/30",
        )}
      >
        <span className="inline-flex items-center gap-1.5">
          {step === "paid" ? <Check className="h-4 w-4" /> : step === "released" ? <ShieldCheck className="h-4 w-4" /> : null}
          {cashPayHeadline(shown)}
        </span>
      </div>

      {/* ── The money ──────────────────────────────────────────────────
          ⚠️ ONE NUMBER, and the itemisation folded away. §5.35's rule — say
          each fact once — bites here: `OrderLinesCard` directly above already
          names every product, its family, its SKU and its quantity, so a
          second full table is the busy-ness that page was rebuilt to remove.
          What a rep needs mid-call is the total; "what's that made of?" is the
          follow-up question, and it is one click down. */}
      {!skuRows ? (
        <p className="mt-3 text-sm text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading Cardinal's costs…
        </p>
      ) : quote?.refusal ? (
        <div className="mt-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-100">
          <p className="font-semibold inline-flex items-center gap-1.5">
            <AlertTriangle className="h-4 w-4" /> This order can't be priced
          </p>
          {/* ⚠️ Never a partial total. A quote that quietly drops a line is a
              patient charged for less than they are shipped (cashPayPricing). */}
          <p className="text-xs mt-0.5 opacity-90">{quote.refusal}</p>
        </div>
      ) : quote ? (
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Patient owes
            </p>
            <p className="text-2xl font-bold tabular-nums">{money(quote.total)}</p>
          </div>

          <details className="mt-2">
            <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground">
              <Receipt className="h-3.5 w-3.5 shrink-0" />
              How that's worked out
            </summary>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {quote.lines.map((l) => (
                  <tr key={`${l.family}:${l.product}`} className="border-b last:border-b-0">
                    <td className="py-1 pr-2 align-top break-words">{l.product}</td>
                    <td className="py-1 px-2 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                      {l.quantity} x {money(l.unitCost)}
                    </td>
                    <td className="py-1 pl-2 text-right tabular-nums font-medium whitespace-nowrap">{money(l.linePrice)}</td>
                  </tr>
                ))}
                {quote.shipping > 0 && (
                  <tr className="border-b last:border-b-0">
                    <td className="py-1 pr-2" colSpan={2}>
                      {SHIPPING_HANDLING_LABEL}
                      {/* The profit floor, said plainly — a rep asked about the
                          extra $10 on the phone needs the answer, not the rule. */}
                      <span className="block text-[11px] text-muted-foreground">Added on orders this small</span>
                    </td>
                    <td className="py-1 pl-2 text-right tabular-nums font-medium whitespace-nowrap">{money(quote.shipping)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Cardinal's cost {money(quote.cardinalCost)} plus {Math.round((CASH_PAY_MARKUP - 1) * 100)}%, rounded per line.
            </p>
          </details>
        </div>
      ) : null}

      {drift && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{drift}</p>
      )}

      {/* ── The link ──────────────────────────────────────────────────── */}
      {shown.cashPayLink && (
        <div className="mt-3 rounded-lg border bg-muted/30 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Payment link</p>
          <div className="mt-0.5 flex items-center gap-2">
            <a
              href={shown.cashPayLink}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-mono text-primary hover:underline break-all min-w-0"
            >
              {shown.cashPayLink}
            </a>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 shrink-0"
              title="Copy the link"
              onClick={() => {
                // A clipboard refusal (insecure origin, permissions policy) must
                // SAY so — §5.31f's rule; silently doing nothing reads as broken.
                navigator.clipboard?.writeText(shown.cashPayLink)
                  .then(() => toast.success("Payment link copied"))
                  .catch(() => toast.error("Couldn't copy — select the link and copy it by hand"));
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <a href={shown.cashPayLink} target="_blank" rel="noreferrer" className="shrink-0" title="Open the payment page">
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
            </a>
          </div>
          {order.cashPayAmount && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Minted for {money(Number(order.cashPayAmount))}
              {order.cashPayLinkSent ? ` · sent ${order.cashPayLinkSent}` : " · not sent yet"}
            </p>
          )}
        </div>
      )}

      {/* ── The two presses ───────────────────────────────────────────── */}
      {step !== "paid" && step !== "released" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {step === "generate" ? (
            <Button disabled={!!genRefusal || busy} className="gap-2" onClick={() => void generate()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
              Generate cash pay link
            </Button>
          ) : (
            <Button disabled={!!sndRefusal || busy} className="gap-2" onClick={() => void send()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {step === "awaitingPayment" ? "Re-send to patient" : "Send to patient"}
            </Button>
          )}
          <p className="text-xs text-muted-foreground min-w-0 flex-1">
            {/* ⚠️ The phase outranks the refusal while a press is in flight: a
                rep watching "Mints a Stripe checkout…" under a spinner cannot
                tell whether anything is happening, and that is the press they
                make twice. */}
            {phase === "working" ? "Writing it to the board…"
              : phase === "waiting" ? "Waiting for the payment service to mint the link…"
                : phase === "quiet" ? "No answer yet — the link will appear here when the payment service writes it. Don't press again."
                  : failed ? "The payment service couldn't mint the link — the board says \u201cLink failed\u201d. Check the order's amount and try again."
                    : step === "generate"
                      ? genRefusal || `Mints a Stripe payment link for ${quote ? money(quote.total) : "this order"}. Nothing is sent to the patient yet.`
                      : sndRefusal || `Texts the link to ${fmtPhone(order.phone)}.`}
          </p>
        </div>
      )}

      {/* ── The way through ───────────────────────────────────────────── */}
      {step !== "paid" && step !== "released" && (
        <div className="mt-3 pt-3 border-t">
          {!releasing ? (
            <button
              type="button"
              disabled={!isManager}
              onClick={() => setReleasing(true)}
              className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-60 disabled:hover:text-muted-foreground inline-flex items-center gap-1.5"
              title={isManager ? undefined : "Only a manager can release an unpaid cash pay order."}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Paid another way? Release this order for Cardinal
              {!isManager && " (manager only)"}
            </button>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold">Release this order without a Stripe payment</p>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="How was it paid? e.g. cheque received 9/18, cleared 9/21"
                className="text-sm"
              />
              {/* The reason is REQUIRED, and this line says why rather than
                  leaving a greyed button with no stated passing move. */}
              <p className="text-[11px] text-muted-foreground">
                Stamped on this order's notes with your initials — it is the only record of why it shipped unpaid.
              </p>
              <div className="flex items-center gap-2">
                <Button size="sm" disabled={!!releaseRefusal || saving} onClick={() => void release()} className="gap-2">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                  Release for ordering
                </Button>
                <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setReleasing(false); setReason(""); }}>
                  Cancel
                </Button>
                {releaseRefusal && <span className="text-xs text-muted-foreground">{releaseRefusal}</span>}
              </div>
            </div>
          )}
        </div>
      )}

    </Card>
  );
}
