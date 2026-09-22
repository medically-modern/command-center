/**
 * The only write this role can make — and it is dark (`config.ts`).
 *
 * Flipping Order Status to "Ordered" is exactly what a rep does on the board
 * today: webhook 595100182 fires on that value, cardinal-api-poller submits the
 * order, and workflow 7921060784 moves the status on to "Process Claim"
 * (`mondayApi.ts` header). No sibling data is written by the app first, so
 * this needs no verified-write transaction (§5.2) — the whole payload Cardinal
 * receives is already on the item. What it DOES need is the pre-write read:
 *
 * ⚠️ Monday takes a status write onto a column already holding that value at
 * HTTP 200 and fires nothing (§9). "Ordered" is transient, so the real
 * failure is the opposite one: an order at "Process Claim" (already placed)
 * or "On Hold" (deliberately not) flipped to "Ordered" would place it, or
 * place it AGAIN. The rule refuses anything not sitting at "Order".
 */
import { ORDERING_FROM_COMMAND_CENTER } from "./config";
import { appendStampedNote } from "@/lib/shared/noteStamp";
import { userInitials } from "@/lib/shared/auth";
import { assertTextLikeFits } from "@/lib/shared/longText";
import {
  BOARD_ID, CASH_PAY_ACTION_INDEX, clearStatus, COL, ORDER_STATUS_INDEX, readColumnText,
  readColumnTexts, writeNumber, writeStatusIndex, writeTextLike,
} from "./mondayApi";
import { executeWritesWithVerification, type WriteTask } from "@/lib/shared/verifiedWrite";
import { cashPayOrderingRefusal, cashPayReleaseNote, cashPayReleaseRefusal } from "./cashPayGate";
import { substitutionSendKind } from "./substitution";

/** The retry wrapper `executeWritesWithVerification` takes, as every other
 *  slice declares its own (§5.2). */
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 800;
async function executeWithRetry(task: WriteTask): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await task.fn();
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[mondayWrite:orders] ${task.label} (${task.columnId}) failed attempt ${attempt + 1}/${MAX_RETRIES + 1}: ${msg}`);
      if (attempt < MAX_RETRIES) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      else return `${task.label} (${task.columnId}): ${msg}`;
    }
  }
  return null;
}

/** The stage label every cash pay line on an order carries (§9). */
export const CASH_PAY_NOTE_STAGE = "Cash Pay";

export class OrderNotPlaceableError extends Error {
  constructor(public readonly currentStatus: string, reason?: string) {
    super(reason || placeabilityReason(currentStatus));
    this.name = "OrderNotPlaceableError";
  }
}

/**
 * Why an order in this status must not be flipped — or "" when it may.
 *
 * ⚠️ **"Paid Cash" IS PLACEABLE from 2026-09-21, and that is a reversal.** It
 * used to be read as "already placed with Cardinal", which was right while the
 * label was only ever set by hand on a finished cash order. It is now what the
 * Stripe webhook writes when a cash pay payment lands, i.e. the one state that
 * most needs placing. Josh chose to reuse the existing label rather than add a
 * "Paid — OK to Order" one.
 *
 * ⚠️ Which leaves a real collision, because the label ALSO sits on the two
 * historical cash orders: Debbie Hinze's reads `Paid Cash` while the order is
 * **Delivered**. Status alone therefore cannot tell "paid, place it" from
 * "paid months ago, long gone". `cahOrderNumber` can — Cardinal writes it when
 * it accepts the order, so it is positive evidence the order has been
 * submitted, and it is what refuses hers (1120157406). Callers that have the
 * order in hand should always pass it.
 */
export function placeabilityReason(
  currentStatus: string,
  opts: { cahOrderNumber?: string | null } = {},
): string {
  const s = (currentStatus ?? "").trim();
  /* Positive evidence this order has already been to Cardinal, whatever its
     status column says. Checked FIRST so a re-placed order is refused even
     from a status that would otherwise be allowed. */
  if ((opts.cahOrderNumber ?? "").trim()) {
    return "This order has already been placed with Cardinal.";
  }
  if (s === "Order" || s === "Paid Cash") return "";
  if (s === "Ordered") return "This order is already being placed.";
  if (s === "Process Claim") return "This order has already been placed with Cardinal.";
  if (s === "On Hold") return "This order is on hold — take it off hold on the board first.";
  if (s === "Stuck") return "This order is marked Stuck on the board.";
  if (s === "Return in Progress" || s === "Return Complete") return "This is a return, not an order to place.";
  if (!s) return "This order has no status yet — the board sets it a moment after the item is created.";
  return `Order Status is "${s}", not "Order".`;
}

export function canMarkOrdered(
  currentStatus: string,
  opts: { cahOrderNumber?: string | null } = {},
): boolean {
  return placeabilityReason(currentStatus, opts) === "";
}

/**
 * The whole gate: the status rule AND the cash pay payment rule.
 *
 * Callers with the order in hand should use this rather than
 * `placeabilityReason`, which knows nothing about money. Returns "" when the
 * order may be placed.
 */
export function orderingRefusal(o: {
  orderStatus: string;
  cahOrderNumber?: string | null;
  primaryInsurance?: string | null;
  generalInsurance?: string | null;
  stripeChargeId?: string | null;
  cashPayPaidDate?: string | null;
  notes?: string | null;
}): string {
  return placeabilityReason(o.orderStatus, { cahOrderNumber: o.cahOrderNumber })
    || cashPayOrderingRefusal(o);
}

/**
 * Place an order: Order Status → "Ordered" (label id 1). Re-reads the column
 * immediately before writing and refuses unless it reads "Order" — the value
 * on screen may be a minute old.
 */
export async function markOrdered(itemId: string): Promise<void> {
  if (!ORDERING_FROM_COMMAND_CENTER) {
    throw new Error("Ordering from the Command Center is not switched on (lib/orders/config.ts).");
  }
  /* ⚠️ The money gate is re-checked HERE, against columns read fresh, not
     just on the button. A disabled button is what a rep sees; this is what
     actually stops an unpaid cash pay order reaching Cardinal, and the value
     on screen may be a minute old. Same reasoning as the status re-read. */
  const [current, chargeId, paidDate, payer, notes, cahOrderNumber] = await Promise.all([
    readColumnText(itemId, COL.orderStatus),
    readColumnText(itemId, COL.stripeChargeId),
    readColumnText(itemId, COL.cashPayPaidDate),
    readColumnText(itemId, COL.primaryInsurance),
    readColumnText(itemId, COL.notes),
    readColumnText(itemId, COL.cahOrderNumber),
  ]);
  if (!canMarkOrdered(current, { cahOrderNumber })) throw new OrderNotPlaceableError(current);
  const moneyRefusal = cashPayOrderingRefusal({
    primaryInsurance: payer, stripeChargeId: chargeId,
    cashPayPaidDate: paidDate, notes,
  });
  if (moneyRefusal) throw new OrderNotPlaceableError(current, moneyRefusal);
  await writeStatusIndex(itemId, COL.orderStatus, ORDER_STATUS_INDEX.ordered);
}

/**
 * Ask Cardinal to swap a backordered infusion set — the ONE write this role
 * makes for real (Josh, 2026-09-15). It writes **Substitute Infusion Set**
 * `color_mm727jnp` and nothing else; everything after that belongs to the
 * `email-serivce` app, which hears monday webhook 635472669, reads the
 * replacement's SKU live off the Cardinal SKU Tracker, emails Cardinal customer
 * care and writes its verdict into **Substitution Status** (§5.35).
 *
 * ⚠️ **THE WRITE IS THE SEND.** There is no draft and no undo — so the caller
 * checks `substitutionSendRefusal` first, and this re-reads the column
 * immediately before writing rather than trusting a value that may be a minute
 * old (the same pre-write read `markOrdered` makes).
 *
 * ⚠️ **`index` MUST come from the live board** (`lib/shared/statusOptions`).
 * A write to a label id the column does not have is dropped at HTTP 200 with
 * nothing in the logs — §5.12/§5.20/§5.31c/§5.31d/§5.33, five times over — and
 * here that failure reads as "the email did not send" with no reason anywhere.
 *
 * ⚠️ A repeat pick is a CLEAR then a write (`substitutionSendKind`): writing the
 * label the column already holds fires no webhook, so a rep chasing would get a
 * green toast and no email. The clear cannot send on its own — the service needs
 * a real set label — so the pair is one email.
 */
export async function requestSubstitution(
  itemId: string,
  label: string,
  index: number,
): Promise<{ kind: "send" | "resend" }> {
  const current = await readColumnText(itemId, COL.substituteInfusionSet);
  const kind = substitutionSendKind(current, label);
  if (kind === "resend") await clearStatus(itemId, COL.substituteInfusionSet);
  await writeStatusIndex(itemId, COL.substituteInfusionSet, index);
  return { kind };
}

/**
 * A manager releases an unpaid cash pay order for ordering.
 *
 * Janelle on Debbie Hinze: *"she is older and does not have Venmo."* Patients
 * pay by cheque and over the phone, so a Stripe-only gate would leave those
 * orders unplaceable for ever — the dead end §5.10 · §5.20 · §5.31c · §5.31f ·
 * §5.39d each record reversing. This is the way through, and the stamped note
 * is the only record anywhere of why goods went out against no Stripe payment.
 *
 * ⚠️ **The refusals are re-checked HERE, against columns read fresh.** The
 * disabled button is what a manager sees; this is what stops a release landing
 * on an order that was paid, or already released, while the card sat open. The
 * same reasoning as `markOrdered`'s pre-write read.
 *
 * ⚠️ **The notes column is RE-READ immediately before appending.** Monday has
 * no compare-and-set — `change_multiple_column_values` REPLACES the value — so
 * appending onto the 60-second board poll's copy would silently delete whatever
 * the substitution service or another rep wrote in between (§5.28's rule, and
 * the one `dossierApi.appendNoteToRecord` exists to keep).
 */
export async function releaseCashPayOrder(
  itemId: string,
  opts: { isManager: boolean; reason: string },
): Promise<string> {
  const reason = opts.reason.trim();
  const [payer, chargeId, paidDate, notes] = await Promise.all([
    readColumnText(itemId, COL.primaryInsurance),
    readColumnText(itemId, COL.stripeChargeId),
    readColumnText(itemId, COL.cashPayPaidDate),
    readColumnText(itemId, COL.notes),
  ]);
  const refusal = cashPayReleaseRefusal(
    { primaryInsurance: payer, stripeChargeId: chargeId, cashPayPaidDate: paidDate, notes },
    { isManager: opts.isManager, reason },
  );
  if (refusal) throw new Error(refusal);

  const next = appendStampedNote(notes, cashPayReleaseNote(reason), CASH_PAY_NOTE_STAGE, {
    initials: userInitials(),
  });
  /* The 2,000-char cap is asked of the BOARD, never inferred from the id's
     prefix: the notes columns have been converted long_text → text once
     already, sometimes keeping their ids (§10). Refusing loudly is the point —
     a release whose reason Monday truncated away is a release with no reason. */
  await assertTextLikeFits(BOARD_ID, COL.notes, next, "Order notes");
  await writeTextLike(itemId, COL.notes, next);
  return next;
}

// ─── Cash pay: the two presses ─────────────────────────────────

/**
 * Generate the patient's payment link.
 *
 * ⚠️⚠️ **THE APP WRITES THE PRICE, THE BOARD TRIGGERS THE MINT.** Josh chose
 * coins' own mechanism (2026-09-21: *"do that route, it works perfectly fine
 * dont mess it up"*), so nothing here calls Stripe and no browser holds a
 * token: **Cash Pay Amount** goes on the row, then **Cash Pay Action** flips to
 * *Generate link*, a board automation turns that into a webhook to
 * `coins-form-payment`, and that service mints and writes **Cash Pay Link**
 * back. The pricing rule stays in `cashPayPricing.ts` and what crosses is a
 * number the rep has already read on screen.
 *
 * ⚠️ **A VERIFIED WRITE, with the action as the stage column** (§5.2). Monday
 * returns 200 on the amount before it is indexed, and the webhook reads that
 * very cell the instant the automation fires — so an unverified pair mints for
 * the PREVIOUS amount, or for a blank. This is the canonical case that utility
 * exists for, on a column whose staleness is money.
 *
 * ⚠️ **It refuses an order that already has a link, and does not re-price it.**
 * Once a link exists its amount IS the price (`cashPayLink.ts`): writing a new
 * amount beside an unchanged link would leave the board stating a figure Stripe
 * will not charge. Replacing a link is a deliberate, visible act — clear the
 * Cash Pay Link cell on the board — and the refusal says so.
 *
 * ⚠️ **The trigger is cleared first when it already holds a value.** Monday
 * takes a status write onto its own value at 200, fires nothing and records no
 * activity (§9), so pressing Generate after a failed attempt — the column then
 * reads *Link failed* — would be fine, but pressing it while it still reads
 * *Generate link* would be a silent no-op. The clear guarantees a change event.
 * Same rule `requestSubstitution` follows one column over.
 */
export async function generateCashPayLink(
  itemId: string,
  totalDollars: number,
): Promise<void> {
  if (!Number.isFinite(totalDollars) || totalDollars <= 0) {
    throw new Error("That order has no price to mint a link for.");
  }
  /* The pre-write read, against the board rather than the 60-second poll's
     copy — the same reasoning `markOrdered` and `releaseCashPayOrder` carry. */
  const [link, action] = await Promise.all([
    readColumnText(itemId, COL.cashPayLink),
    readColumnText(itemId, COL.cashPayAction),
  ]);
  if (link.trim()) {
    throw new Error(
      "This order already has a payment link. To price it again, clear the Cash Pay Link cell on the board first.",
    );
  }
  if (action.trim()) await clearStatus(itemId, COL.cashPayAction);

  const amount = totalDollars.toFixed(2);
  await executeWritesWithVerification({
    itemId,
    boardId: String(BOARD_ID),
    label: "Cash pay — generate link",
    stageColumnId: COL.cashPayAction,
    executeWithRetry,
    readColumns: readColumnTexts,
    tasks: [
      {
        label: "Cash Pay Amount",
        columnId: COL.cashPayAmount,
        value: amount,
        expectedText: amount,
        fn: () => writeNumber(itemId, COL.cashPayAmount, Number(amount)),
      },
      {
        label: "Cash Pay Action",
        columnId: COL.cashPayAction,
        value: { index: CASH_PAY_ACTION_INDEX.generate },
        fn: () => writeStatusIndex(itemId, COL.cashPayAction, CASH_PAY_ACTION_INDEX.generate),
      },
    ],
  });
}

/**
 * Send the link to the patient — **Cash Pay Action** → *Send to patient*.
 *
 * The text itself is the BOARD's, not this app's and not the payment service's:
 * a monday automation on this column sends it from the RC number and stamps
 * **Cash Pay Link Sent**. That stamp is what moves the card on to "waiting on
 * the patient", so an automation built without it leaves a rep re-sending.
 *
 * ⚠️ No verified write and no data column: there is nothing to write first, so
 * there is nothing to hold the trigger back for.
 *
 * ⚠️ **Cleared first when it already holds a value**, for the §9 reason above —
 * and a chase is exactly the case: the column still reads *Send to patient*
 * from last week, and a re-press onto its own value would fire nothing while
 * showing the rep a green toast.
 */
export async function sendCashPayLink(itemId: string): Promise<void> {
  const [link, action] = await Promise.all([
    readColumnText(itemId, COL.cashPayLink),
    readColumnText(itemId, COL.cashPayAction),
  ]);
  if (!link.trim()) throw new Error("There is no payment link on this order to send.");
  if (action.trim()) await clearStatus(itemId, COL.cashPayAction);
  await writeStatusIndex(itemId, COL.cashPayAction, CASH_PAY_ACTION_INDEX.send);
}
