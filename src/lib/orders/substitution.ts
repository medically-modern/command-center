/**
 * Backordered infusion set → the swap request Cardinal receives.
 *
 * A rep opens an order whose infusion set is on back order and picks the
 * replacement in **Substitute Infusion Set** (`color_mm727jnp`) on the order
 * board. That one pick is the whole interaction: the `email-service` Railway
 * app (feature `backorder-substitution`, monday webhook `635472669`) hears the
 * column change, reads the replacement's SKU LIVE from the Cardinal SKU
 * Tracker, and emails Cardinal customer care asking them to switch the order.
 * It then writes **Substitution Status** (`color_mm727p5m`) — `Sent`, or an
 * `Error:` label naming exactly which field blocked it — plus a line in Notes.
 *
 * ⚠️ **THIS MODULE IS A READ-ONLY MIRROR OF THAT SERVICE'S RULES** — the same
 * hand-synced hazard as `oopEstimator.ts` vs the Railway financial backend
 * (§5.7) and `cardinalAddress.ts` vs `Cardinal-api` (§5.17), and with the same
 * failure mode: this page would say one thing and the email would do another.
 * Nothing here sends, writes, or decides anything; it explains on screen what
 * the service already did or would do. The service is the authority — when
 * `email-serivce/src/features/backorder-substitution/index.js` changes, change
 * the labels and the fix-it sentences here to match.
 *
 * ⚠️ **Every flip of the column sends** (`dedupe: false` there). Re-picking the
 * same set is a chase, not a duplicate, which is why the fix for every error
 * below ends "…then re-pick the substitute set".
 */
import type { Order } from "./workflow";

/**
 * The live labels on Substitution Status, read from the board's `settings_str`
 * on 2026-09-15. The service writes these strings verbatim, so the match is on
 * TEXT — but an unrecognised label is reported AS AN ERROR rather than as
 * silence, because every label but `Sent` is one (§5.20's rule inverted: here
 * the safe default is to keep complaining, since a swap nobody chased is an
 * order that ships the set the patient cannot get).
 */
export const SUBSTITUTION_SENT = "Sent";

/**
 * What to do about each error, in the words of the service that wrote it. The
 * service's own `reason` strings are longer and land in Notes; these are the
 * one-line version for the card.
 */
export const SUBSTITUTION_FIX: Record<string, string> = {
  "error: no cah order number":
    "Cardinal cannot act on the request without its own order number. Add the CAH Order Number, then re-pick the substitute set.",
  "error: no qty infusion set 1":
    "The email asks Cardinal for a number of boxes and will not guess one. Fill in Qty: Infusion Set 1, then re-pick the substitute set.",
  "error: sku board unreadable":
    "The Cardinal SKU Tracker could not be read, so there was no SKU to send. Nothing went out — re-pick the substitute set to retry.",
  "error: set not on sku board":
    "That set is not on the Cardinal SKU Tracker, so it has no SKU. Add it to that board (or fix the label), then re-pick the substitute set.",
  "error: no sku on board":
    "That set is on the Cardinal SKU Tracker but its SKU column is empty. Fill the SKU in, then re-pick the substitute set.",
  "error: which set is unclear":
    "This order carries two infusion sets and nothing singles one out, so which to switch would be a guess. Clear the set that is not being replaced, then re-pick the substitute set.",
  "error: same set picked":
    "The substitute is the set that is on back order. Pick a different one.",
  "error: no set on order":
    "Nothing on this order names an infusion set — Backordered and Infusion Set Type 1/2 are all empty — so there is no set to switch away from.",
};

export type SubstitutionState = "none" | "sent" | "error";

export interface SubstitutionVerdict {
  state: SubstitutionState;
  /** The board's own label, verbatim. */
  label: string;
  /** What a rep should do about it. "" when there is nothing to do. */
  fix: string;
}

/**
 * What the board says happened to the swap request. ⚠️ An UNRECOGNISED label
 * starting "Error:" still reports as an error with a generic fix — a new error
 * label added to the column must never read as success here.
 */
export function substitutionVerdict(status: string): SubstitutionVerdict {
  const label = (status ?? "").trim();
  if (!label) return { state: "none", label: "", fix: "" };
  if (label.toLowerCase() === SUBSTITUTION_SENT.toLowerCase()) {
    return { state: "sent", label, fix: "" };
  }
  const fix = SUBSTITUTION_FIX[label.toLowerCase()];
  if (fix) return { state: "error", label, fix };
  if (/^error/i.test(label)) {
    return { state: "error", label, fix: "Fix what this names on the order board, then re-pick the substitute set." };
  }
  return { state: "error", label, fix: "" };
}

/** Labels on Infusion Set Type 1/2 that mean "no set", not a product. */
const NOT_A_SET = ["not serving"];

export function isRealSet(label: string): boolean {
  const s = (label ?? "").trim();
  return !!s && !NOT_A_SET.includes(s.toLowerCase());
}

/**
 * `normalizeSetName` from the service (`email-serivce/src/cardinal.js`), which
 * is what lets three spellings of one set line up: the tracker's short name
 * (`AutoSoft 90 6 mm 23"`), Cardinal's own description (`AutoSoft 90 Infusion
 * Set · 6 mm Cannula · 23" Tubing · t:lock Connector · Grey - REPLACES
 * TN1002817`) and the Backordered column's (`AutoSoft 90 6mm 23" infusion
 * sets`). Kept separate from `infusionStock.stockKey`, which answers a
 * different question (board label → tracker row) and does not strip the
 * "infusion sets" suffix or a REPLACES tail.
 */
export function normalizeSetName(raw: string): string {
  return (raw ?? "")
    .toLowerCase()
    .replace(/[‘’“”″′]/g, '"')
    .replace(/\s*-\s*replaces\b.*$/, "")
    .replace(/[·,;|]/g, " ")
    .replace(/\s+infusion\s+sets?\s*$/, "")
    .replace(/(\d)\s*mm\b/g, "$1mm")
    .replace(/(\d)\s*(?:"|inches|inch|in\b)/g, "$1in")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The Backordered column holds one entry per out-of-stock product, joined by
 * ", ". Its own labels never contain a comma — the daily availability check
 * writes "·" where Cardinal's description has one — so splitting on ", " is
 * safe (the service splits the same way).
 */
export function backorderedEntries(backordered: string): string[] {
  return (backordered ?? "")
    .split(/,\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface BackorderedSet {
  /** The set to switch away from, in the short words a human reads. */
  name: string;
  /** Both of the order's sets are backordered — the service refuses this. */
  ambiguous?: string[];
}

/**
 * Which set on this order is the one on back order — the service's own
 * `backorderedSet()`, minus the tracker lookup it uses as its second pass
 * (this page already draws every line's tracker row beside it).
 *
 * 1. the order's set that the Backordered column also names — two matches is
 *    AMBIGUOUS, because one replacement cannot stand in for both;
 * 2. otherwise the order's only set, when it has exactly one;
 * 3. two sets and no signal is a question for a human, not a guess.
 */
export function backorderedSetOnOrder(o: Pick<Order, "backordered" | "infusionSet1" | "infusionSet2">): BackorderedSet | null {
  const stuck = backorderedEntries(o.backordered).map(normalizeSetName).filter(Boolean);
  const ordered = [o.infusionSet1, o.infusionSet2].map((s) => (s ?? "").trim()).filter(isRealSet);

  const matches = ordered.filter((label) => stuck.includes(normalizeSetName(label)));
  if (matches.length > 1) return { name: "", ambiguous: matches };
  if (matches.length === 1) return { name: matches[0] };
  if (ordered.length === 1) return { name: ordered[0] };
  if (ordered.length > 1) return { name: "", ambiguous: ordered };
  return null;
}

/**
 * The fields the email needs that this order does not have — so the card can
 * say why a pick will bounce BEFORE a rep makes it, rather than after the
 * service has written an `Error:` label. Same three refusals the service makes
 * in this order; the SKU checks it makes after them belong to the tracker and
 * are drawn from the substitute's own row.
 */
export function substitutionBlockers(
  o: Pick<Order, "backordered" | "infusionSet1" | "infusionSet2" | "cahOrderNumber" | "qtyInfusionSet1">,
): string[] {
  const out: string[] = [];
  if (!(o.cahOrderNumber ?? "").trim()) out.push("no CAH Order Number — Cardinal cannot act on the request without it");
  const boxes = Number.parseInt((o.qtyInfusionSet1 ?? "").trim(), 10);
  if (!Number.isFinite(boxes) || boxes <= 0) out.push("no usable Qty: Infusion Set 1 — the email will not guess a quantity");
  const set = backorderedSetOnOrder(o);
  if (!set) out.push("no infusion set on the order to switch away from");
  else if (set.ambiguous) out.push(`two infusion sets on the order (${set.ambiguous.join(" and ")}) and nothing singles one out`);
  return out;
}

/** Whether the substitution section has anything to say about this order. */
export function hasSubstitutionStory(
  o: Pick<Order, "backordered" | "substituteInfusionSet" | "substitutionStatus" | "substitutionCahNumber">,
): boolean {
  return !!(
    (o.backordered ?? "").trim() ||
    (o.substituteInfusionSet ?? "").trim() ||
    (o.substitutionStatus ?? "").trim() ||
    (o.substitutionCahNumber ?? "").trim()
  );
}

/* ── Picking and sending, from the Command Center ──────────────────────────
 *
 * The pick used to be made on the order board; from 2026-09-15 the page makes
 * it (Josh: *"let them actually pick the substitute and then click a 'send'
 * button, then notify them if email successfully sent via the second column"*).
 * Writing `color_mm727jnp` is what the email service listens to, so this page's
 * Send button and a rep's click on the board are the SAME act — there is no
 * second trigger and no second code path.
 *
 * ⚠️ WHICH MEANS THE WRITE IS THE SEND. There is no draft, no preview and no
 * undo: the email leaves the moment the column changes. Everything below is
 * about refusing a send that would bounce, and about not firing twice by
 * accident.
 */

export interface SubstitutionSendRefusal {
  /** Why Send is disabled. "" when it may be pressed. */
  reason: string;
}

/**
 * Why a send would bounce, in the words the card shows — checked BEFORE the
 * write, because after it the email has gone and an `Error:` label is the only
 * thing left to read. Mirrors the service's own refusals in its own order, plus
 * the one it cannot make (nothing picked).
 *
 * ⚠️ Every branch names something a rep can DO. A refusal with no passing move
 * is the dead end §5.10/§5.20/§5.31c/§5.32c each record reversing — which is
 * also why the missing-SKU case is NOT here: the card reports it beside the
 * pick, and the service is the authority on whether the tracker has a row.
 */
export function substitutionSendRefusal(
  o: Pick<Order, "backordered" | "infusionSet1" | "infusionSet2" | "cahOrderNumber" | "qtyInfusionSet1">,
  picked: string,
): string {
  const set = (picked ?? "").trim();
  if (!set) return "Pick the replacement set first.";
  const blockers = substitutionBlockers(o);
  if (blockers.length > 0) return `Cardinal would refuse this: ${blockers[0]}.`;
  const backordered = backorderedSetOnOrder(o);
  if (backordered?.name && normalizeSetName(backordered.name) === normalizeSetName(set)) {
    return "That is the set that is on back order — pick a different one.";
  }
  return "";
}

export type SubstitutionSendKind = "send" | "resend";

/**
 * ⚠️ **WRITING THE SAME LABEL AGAIN SENDS NOTHING** — the §9 advancer no-op,
 * one column over, and doubly so: Monday takes a status write onto the value it
 * already holds at HTTP 200 without firing a webhook, and the service's own
 * `matches()` rejects an event whose value equals its previous value anyway. So
 * a rep chasing an unanswered request would press Send, see green, and send no
 * email.
 *
 * A repeat IS a legitimate act — the service is explicit that it has no
 * "already sent" suppression because "a repeat pick may be a correction or a
 * chase" — so the column is CLEARED first and re-written, which is exactly what
 * a rep does on the board by hand. The clear itself cannot send (the service
 * needs a real set label), so the pair is one email, not two.
 */
export function substitutionSendKind(currentOnBoard: string, picked: string): SubstitutionSendKind {
  const now = (currentOnBoard ?? "").trim();
  const want = (picked ?? "").trim();
  if (!now || !want) return "send";
  return normalizeSetName(now) === normalizeSetName(want) ? "resend" : "send";
}

/**
 * The sets a rep may pick. The board's own label set, read live (never a
 * hardcoded list — the write is by label INDEX and a stale one lands blank,
 * `lib/shared/statusOptions`), minus the set this order is switching away from:
 * the service refuses that with `Error: Same Set Picked`, so offering it is
 * offering a guaranteed error.
 *
 * ⚠️ Dropped only when we know WHICH set that is. An ambiguous pair (two sets
 * on the order, nothing singling one out) drops nothing — the service will
 * refuse the whole request anyway and `substitutionBlockers` says so before the
 * send, which is a better answer than a silently shortened list.
 */
export function substitutionOptions(
  labels: readonly string[],
  o: Pick<Order, "backordered" | "infusionSet1" | "infusionSet2">,
): string[] {
  const backordered = backorderedSetOnOrder(o);
  if (!backordered?.name) return [...labels];
  const drop = normalizeSetName(backordered.name);
  return labels.filter((l) => normalizeSetName(l) !== drop);
}

/**
 * Has the service answered yet? Compared against the snapshot taken just
 * before the send, because a status column already reading `Sent` from an
 * earlier request cannot change to `Sent` again — a value-only test would wait
 * for ever on precisely the chase the resend path exists for. The Notes receipt
 * line is the second signal and the reliable one: the service appends to it on
 * every run, sent or refused.
 *
 * ⚠️ A timeout is NOT a failure. The email may still be going out, and the
 * status column will carry the verdict whenever it lands — saying "it failed"
 * because we stopped watching is the invented-outage class §5.13's monitor
 * records.
 */
export function substitutionAnswered(
  before: { status: string; notes: string },
  now: { status: string; notes: string },
): boolean {
  if ((now.status ?? "").trim() !== (before.status ?? "").trim()) return true;
  return (now.notes ?? "").length !== (before.notes ?? "").length;
}

/* ── The email itself, for the read-only preview ───────────────────────────
 *
 * ⚠️ **MIRROR of `email-serivce/src/features/backorder-substitution/template.js`**
 * — the same hand-synced hazard as the rules above, and the more visible one:
 * a drifted preview shows a rep prose Cardinal never receives, which is worse
 * than showing nothing. Keep the pronouns, the sentence and the three fact
 * lines byte-for-byte with that file's `render()`. It is a PREVIEW, not the
 * payload: nothing here is sent, and the service composes the real message
 * from the board as it writes it.
 */

/** The set the email names, i.e. the service's `replacement` (a tracker row). */
export interface SubstitutionReplacement {
  /** The tracker row's own name when there is one, else the board label. */
  name: string;
  /** The tracker row's SKU. "" when the tracker has no row or no SKU. */
  sku: string;
}

export interface SubstitutionEmailPreview {
  subject: string;
  /** The body paragraphs, in order. */
  body: string[];
  /** The sign-off, newline-separated as the email renders it. */
  signoff: string;
  /** Who it goes to, in words — see the note on `SUBSTITUTION_RECIPIENTS`. */
  recipients: string;
}

/**
 * ⚠️ Deliberately NOT the address list. The To/cc and the sign-off are
 * `config.backorderTo` / `backorderCc` / `backorderSignoff` on the service,
 * every one of them overridable by a Railway variable — so a list printed here
 * would claim to be the real recipients while being only this file's memory of
 * the defaults, with no test that could catch the drift. The sign-off IS
 * printed because the default is what every one of these emails has carried and
 * a signature-less preview reads unfinished.
 */
const SUBSTITUTION_RECIPIENTS = "Cardinal customer care, cc the MM team and our Cardinal reps";
const SUBSTITUTION_SIGNOFF = "Katie Tyler";

/** he / she / they, and the verb that goes with it. The service's `pronouns()`. */
export function substitutionPronouns(gender: string): { subject: string; possessive: string; needs: string } {
  const g = (gender ?? "").trim().toLowerCase();
  if (g === "male") return { subject: "he", possessive: "his", needs: "needs" };
  if (g === "female") return { subject: "she", possessive: "her", needs: "needs" };
  return { subject: "they", possessive: "their", needs: "need" };
}

/**
 * The email Cardinal will receive if this pick is sent.
 *
 * ⚠️ A field the order does not carry renders as an em dash rather than being
 * guessed or dropped: the preview's whole job is to show what would go out, and
 * a line quietly missing from it is how a rep learns nothing. Every one of them
 * is already a `substitutionBlockers` refusal, so the Send button is shut and
 * the card says why above.
 *
 * ⚠️ One known divergence, in the SET NAME only: the service falls back to the
 * tracker row for a backordered entry the order's own set columns do not name
 * (its `backorderedSet()` case 2), which `backorderedSetOnOrder` above does not
 * implement. In that case the email names the set slightly differently than
 * this preview. The order, the SKU and the quantity are unaffected.
 */
export function substitutionEmailPreview(
  o: Pick<Order, "name" | "gender" | "cahOrderNumber" | "qtyInfusionSet1" | "backordered" | "infusionSet1" | "infusionSet2">,
  replacement: SubstitutionReplacement,
): SubstitutionEmailPreview {
  const p = substitutionPronouns(o.gender);
  const set = (replacement.name ?? "").trim() || "—";
  const orderId = (o.cahOrderNumber ?? "").trim() || "—";
  const patient = (o.name ?? "").trim() || "—";
  const backordered = backorderedSetOnOrder(o)?.name?.trim() || "backordered infusion set";
  const n = Number.parseInt((o.qtyInfusionSet1 ?? "").trim(), 10);
  const boxes = Number.isFinite(n) && n > 0 ? String(n) : "—";

  return {
    subject: `Backordered infusion set - switch order ${orderId} to ${set}`,
    body: [
      "Hi Cardinal team,",
      `Patient ${patient} has placed an order for the ${backordered}, but the infusion set ` +
        `remains on back order and ${p.subject} ${p.needs} new supplies. Could we please switch ` +
        `${p.possessive} order to the ${set}?`,
      `Order ID: ${orderId}`,
      `SKU for new order: ${(replacement.sku ?? "").trim() || "—"}`,
      `Quantity of boxes to ship: ${boxes}`,
      "Let me know if you need additional information.",
    ],
    signoff: `Best,\n${SUBSTITUTION_SIGNOFF}`,
    recipients: SUBSTITUTION_RECIPIENTS,
  };
}
