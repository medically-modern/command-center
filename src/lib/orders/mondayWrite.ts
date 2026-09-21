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
import { clearStatus, COL, ORDER_STATUS_INDEX, readColumnText, writeStatusIndex } from "./mondayApi";
import { cashPayOrderingRefusal } from "./cashPayGate";
import { substitutionSendKind } from "./substitution";

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
