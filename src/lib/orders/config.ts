/**
 * The ordering switch.
 *
 * Josh, 2026-09-15: *"right now we order from the new order board. this is only
 * for observation, but someday we will flip the switch on letting them order
 * from this ui (they'd just flip to "ordered" — that does it) — just not today."*
 *
 * So the one write this role knows how to make — Order Status → "Ordered",
 * which is the webhook trigger that hands the item to cardinal-api-poller — is
 * built (`mondayWrite.markOrdered`) and DARK. `OrdersPage` renders the "Mark as
 * Ordered" button only when this is true; while it is false every order shows
 * the note that it is placed on the board, with the link.
 *
 * `orderingSwitch.test.ts` pins this at false. Flipping it is a decision, and
 * the test failing is the reminder to read the checklist in CLAUDE.md §5.35
 * before making it: the flip is a status CHANGE the board keys on, so the
 * write re-reads the column first and refuses anything that is not sitting at
 * "Order" (a second press on a placed order would otherwise be a silent no-op
 * — §9's advancer class — or, worse, re-order a copied item).
 */
export const ORDERING_FROM_COMMAND_CENTER = false;
