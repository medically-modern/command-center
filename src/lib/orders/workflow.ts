/**
 * Orders — domain model + the pure rules the page renders from.
 *
 * Everything here is derived from columns the board already has; nothing is
 * written (the role is observation-only — `mondayApi.ts` header). The three
 * questions a rep brings to this page, in the order they ask them:
 *
 *   1. "Where is this patient's order?"  → `orderStage` + `cardinalStatus`
 *   2. "Is anything wrong with it?"       → `orderFlags`
 *   3. "What did we send them?"           → `skuJoin.orderLines`
 *
 * ⚠️ STATUS TEXT IS MATCHED BY PATTERN, NOT BY EQUALITY, for Cardinal's own
 * sentences: API Status carries labels like *"Order has been put on hold, Hold
 * reason: Credit Check Failure, Please contact sales team for more details"*
 * (five distinct hold labels live on the column today, two of them "HOLD
 * RELEASED; Another Hold applied…"). A rep does not need the sentence — they
 * need "On hold — Credit Check Failure". An UNRECOGNISED label is printed
 * verbatim (§5.20's rule), never silently bucketed as fine.
 */
import { GROUPS } from "./mondayApi";

// ── The record ───────────────────────────────────────────────────────

export interface OrderFile {
  assetId: string;
  name: string;
  /** Monday's protected asset URL — `fetchAssetBytes` knows how to fetch it. */
  url: string;
}

export interface Order {
  id: string;
  /** The item name — the patient. */
  name: string;
  groupId: string;
  groupTitle: string;
  createdAt: string;
  updatedAt: string;
  /**
   * True on rows from the slim LIST read (§5.25). A partial record carries ""
   * for every column the list did not ask for, so it must never be rendered as
   * the open order — the detail pane waits for `detail`.
   */
  partial?: boolean;

  // Lifecycle
  orderStatus: string;
  orderStatusIndex: number | null;
  apiStatus: string;
  orderDate: string;          // YYYY-MM-DD (ET, naive)
  orderType: string;          // First Order / Reorder
  subscriptionType: string;
  shipMethod: string;
  ddpOrder: string;
  pos: string;
  preCheck: string;
  preCheckDetail: string;
  notes: string;
  orderFrequency: string;
  referralStatus: string;
  referralFlag: string;

  // Availability
  backordered: string;        // dropdown text, comma-joined labels
  inactiveProducts: string;
  backorderedQty: string;
  substituteInfusionSet: string;
  substitutionStatus: string;
  substitutionCahNumber: string;

  // Products
  cgmType: string;
  qtySensors: string;
  qtyMonitor: string;
  pumpType: string;
  qtyPump: string;
  infusionSet1: string;
  qtyInfusionSet1: string;
  infusionSet2: string;
  qtyInfusionSet2: string;
  cartridgeType: string;
  qtyCartridge: string;

  // Auth IDs
  monitorAuthId: string;
  sensorsAuthId: string;
  pumpAuthId: string;
  infusionSetAuthId: string;
  cartridgesAuthId: string;

  // Patient
  dob: string;
  gender: string;
  phone: string;
  email: string;
  address: string;
  snfHospice: string;

  // Coverage
  primaryInsurance: string;
  memberId: string;
  secondaryInsurance: string;
  secondaryId: string;
  otherPayerId: string;
  diagnosisCode: string;
  cgmCoverage: string;
  medicarePriorPumpDate: string;

  // Doctor
  doctorName: string;
  doctorNpi: string;
  doctorAddress: string;
  doctorPhone: string;
  doctorFax: string;

  // Cardinal
  cahOrderNumber: string;
  poNumber: string;
  lastCardinalSync: string;
  apiMessage: string;
  holdReason: string;
  uspsCheck: string;
  lineItemDetail: string;
  orderDiscrepancy: string;

  // Shipping
  warehouse: string;
  carrier: string;
  carrierDescription: string;
  estimatedShipDate: string;
  shipDate: string;
  tracking: string[];         // the five tracking columns, blanks dropped, order kept
  packageWeight: string;
  serialNumbers: string;
  deliveryDate: string;
  signedBy: string;
  confirmedDeliveryAddress: string;
  shipTextLog: string;
  deliveryCheckinText: string;

  // Billing
  invoiceNumber: string;
  invoiceDate: string;
  invoiceDueDate: string;
  invoiceAmount: string;
  invoiceSubtotal: string;
  salesTax: string;
  shippingHandling: string;
  freightFee: string;
  paymentTerms: string;
  superbillBatch: string;

  /** Files by column id — populated by the DETAIL read only. */
  files: Record<string, OrderFile[]>;
}

// ── Cardinal's answer, normalised ────────────────────────────────────

export type CardinalKind =
  | "none"          // nothing from Cardinal yet (or ever — pre-poller orders)
  | "processing"    // "Working on it"
  | "accepted"      // Accepted / Success
  | "warning"       // Warning with no hold named
  | "hold"          // any of the hold sentences, or a Hold Reason on an unshipped order
  | "error"         // could not be booked
  | "review"        // Needs Review
  | "backordered"
  | "substitution"  // Substitution Needed / Ordered
  | "shipped"       // SHIPPED / Substitution Shipped
  | "partial"       // Partially Shipped
  | "delivered"
  | "deleted"
  | "unknown";      // a label this file has no rule for — printed verbatim

export interface CardinalStatus {
  kind: CardinalKind;
  /** Short, rep-facing: "On hold — Credit Check Failure". */
  label: string;
  /** Cardinal's own words, for a tooltip or the detail card. */
  detail: string;
  holdReason: string;
}

/** "Order has been put on hold, Hold reason: Credit Check Failure, Please…" → "Credit Check Failure" */
export function holdReasonFrom(text: string): string {
  const m = /hold\s+reason\s*:\s*([^,]+?)\s*(?:,|$)/i.exec(text ?? "");
  return m ? m[1].trim() : "";
}

/**
 * The verdict for one order's Cardinal side. Takes the STATUS label, the Hold
 * Reason column and the API Message column, because the three disagree in a
 * way that matters: a live row reads API Status "Warning" while Hold Reason
 * says "Credit Check Failure" and API Message carries the hold sentence — the
 * label alone would render that order as a mild warning.
 *
 * ⚠️ A Hold Reason only upgrades an UNSHIPPED verdict. The column is never
 * cleared by the poller, so a delivered order can still carry the hold that
 * delayed it; reading it there would report a delivered parcel as stuck.
 */
export function cardinalStatus(apiStatus: string, holdReason = "", apiMessage = ""): CardinalStatus {
  const raw = (apiStatus ?? "").trim();
  const t = raw.toLowerCase();
  const detail = raw || (apiMessage ?? "").trim();
  const reason = (holdReason ?? "").trim() || holdReasonFrom(raw) || holdReasonFrom(apiMessage ?? "");

  const done = (kind: CardinalKind, label: string): CardinalStatus => ({ kind, label, detail, holdReason: "" });
  if (!t) {
    if (reason) return { kind: "hold", label: `On hold — ${reason}`, detail, holdReason: reason };
    return done("none", "No Cardinal status");
  }
  if (t === "delivered") return done("delivered", "Delivered");
  if (t === "shipped") return done("shipped", "Shipped");
  if (t === "substitution shipped") return done("shipped", "Substitution shipped");
  if (t === "partially shipped") return done("partial", "Partially shipped");
  if (t === "deleted") return done("deleted", "Deleted at Cardinal");
  if (/put on hold|hold reason|hold released/.test(t)) {
    const r = holdReasonFrom(raw) || reason;
    return { kind: "hold", label: r ? `On hold — ${r}` : "On hold", detail, holdReason: r };
  }
  if (/cannot be processed|error/.test(t)) return done("error", "Booking error");
  if (t === "needs review") return done("review", "Needs review");
  if (t === "backordered") return done("backordered", "Backordered");
  if (t === "substitution needed") return done("substitution", "Substitution needed");
  if (t === "substitution ordered") return done("substitution", "Substitution ordered");

  // The soft answers — a Hold Reason beside any of them IS the answer.
  if (reason) return { kind: "hold", label: `On hold — ${reason}`, detail, holdReason: reason };
  if (t === "working on it") return done("processing", "Processing");
  if (t === "accepted" || t === "success") return done("accepted", "Accepted by Cardinal");
  if (t === "warning") return done("warning", "Accepted with a warning");
  return done("unknown", raw);
}

// ── Stage ────────────────────────────────────────────────────────────

export type OrderStage =
  | "toPlace"     // Order Status "Order" — waiting for a human to place it
  | "onHold"      // Order Status "On Hold" — snoozed until Order Date
  | "placing"     // Order Status "Ordered" — the poller is about to submit it
  | "inProgress"  // placed; Cardinal has not shipped it (accepted, held, errored, backordered…)
  | "shipped"     // SHIPPED / Partially Shipped — or pre-poller orders with no Cardinal record
  | "delivered"
  | "returns"
  | "cancelled"
  | "stuck"
  | "other";

export const STAGE_LABEL: Record<OrderStage, string> = {
  toPlace: "To place",
  onHold: "On hold",
  placing: "Placing",
  inProgress: "Placed — in progress",
  shipped: "Shipped",
  delivered: "Delivered",
  returns: "Returns",
  cancelled: "Cancelled",
  stuck: "Stuck",
  other: "Other",
};

/** The stages a rep or the ordering desk still has something to do about. */
export const OPEN_STAGES: readonly OrderStage[] = ["toPlace", "onHold", "placing", "inProgress"];

export function isOpenStage(stage: OrderStage): boolean {
  return OPEN_STAGES.includes(stage);
}

type StageInput = Pick<Order, "groupId" | "orderStatus" | "apiStatus" | "holdReason" | "apiMessage">;

/**
 * Where an order is. Precedence, and why:
 *   1. The Cancelled and Returns GROUPS and the return statuses — hand-moved,
 *      terminal, and the status column may still read "Process Claim".
 *   2. Order Status Stuck / On Hold / Order / Ordered — the pre-placement
 *      states, which only ever exist before Cardinal has the order.
 *   3. Cardinal's verdict for a placed order — API Status FIRST, because the
 *      group lags it (`mondayApi.ts` header: Delivered orders sit in
 *      Accepted / Partial, holds sit in Shipped/Delivered).
 *   4. No Cardinal record at all: the Shipped/Delivered group says it shipped
 *      before the poller existed; anywhere else it is placed and waiting.
 */
export function orderStage(o: StageInput): OrderStage {
  const status = (o.orderStatus ?? "").trim();
  if (o.groupId === GROUPS.cancelled) return "cancelled";
  if (o.groupId === GROUPS.returns || status === "Return in Progress" || status === "Return Complete") return "returns";
  if (status === "Stuck") return "stuck";
  if (status === "On Hold") return "onHold";
  if (status === "Order") return "toPlace";
  if (status === "Ordered") {
    // Transient — but a copied item keeps its Cardinal columns, and the
    // poller's answer arrives seconds after the flip. Delivered beats it.
    const k = cardinalStatus(o.apiStatus).kind;
    if (k === "delivered") return "delivered";
    if (k === "shipped" || k === "partial") return "shipped";
    return "placing";
  }
  if (status === "Process Claim" || status === "Paid Cash") {
    const k = cardinalStatus(o.apiStatus, o.holdReason, o.apiMessage).kind;
    if (k === "delivered") return "delivered";
    if (k === "shipped" || k === "partial") return "shipped";
    if (k === "none") return o.groupId === GROUPS.shippedDelivered ? "shipped" : "inProgress";
    if (k === "deleted") return "cancelled";
    return "inProgress";
  }
  return "other";
}

// ── Attention flags ──────────────────────────────────────────────────

export type FlagTone = "rose" | "amber" | "sky";

export interface OrderFlag {
  id: string;
  tone: FlagTone;
  label: string;
  detail: string;
}

type FlagInput = Pick<
  Order,
  | "groupId" | "orderStatus" | "apiStatus" | "holdReason" | "apiMessage"
  | "backordered" | "inactiveProducts" | "substitutionStatus" | "preCheck"
>;

/**
 * What is wrong (or merely notable) about an order — rose needs a person,
 * amber is a heads-up, sky is information. Empty for a healthy order.
 *
 * ⚠️ The availability columns (Backordered / Inactive) are written by a daily
 * sweep on EVERY order, delivered ones included, so they only count while the
 * order is still open — a delivered order whose set later went on backorder
 * is not a problem for that patient.
 */
export function orderFlags(o: FlagInput): OrderFlag[] {
  const stage = orderStage(o);
  const open = isOpenStage(stage);
  const cs = cardinalStatus(o.apiStatus, o.holdReason, o.apiMessage);
  const flags: OrderFlag[] = [];

  if (open && cs.kind === "hold") {
    flags.push({ id: "hold", tone: "rose", label: cs.label, detail: cs.detail || "Cardinal has this order on hold." });
  }
  if (open && cs.kind === "error") {
    flags.push({ id: "error", tone: "rose", label: "Cardinal could not book it", detail: cs.detail });
  }
  if (open && cs.kind === "review") {
    flags.push({ id: "review", tone: "rose", label: "Needs review", detail: cs.detail });
  }
  if (cs.kind === "deleted") {
    flags.push({ id: "deleted", tone: "rose", label: "Deleted at Cardinal", detail: cs.detail });
  }
  const sub = (o.substitutionStatus ?? "").trim();
  if (open && /^error/i.test(sub)) {
    flags.push({ id: "substitution-error", tone: "rose", label: "Substitution request failed", detail: `Substitution Status: ${sub} — fix that field on the board, then re-pick the substitute set.` });
  } else if (open && sub === "Sent") {
    flags.push({ id: "substitution-sent", tone: "sky", label: "Substitution requested", detail: "The swap request reached Cardinal customer care." });
  }
  if (open && cs.kind === "substitution") {
    flags.push({ id: "substitution", tone: "amber", label: cs.label, detail: "A line is backordered; pick a Substitute Infusion Set on the board." });
  }
  const bo = (o.backordered ?? "").trim();
  if (open && (bo || cs.kind === "backordered")) {
    flags.push({ id: "backordered", tone: "amber", label: "Backordered at Cardinal", detail: bo ? `Out of stock at Cardinal (ships on backorder): ${bo}` : cs.detail });
  }
  const inactive = (o.inactiveProducts ?? "").trim();
  if (open && inactive) {
    flags.push({ id: "inactive", tone: "rose", label: "Product not for sale at Cardinal", detail: `Flagged inactive (would hold the order): ${inactive}` });
  }
  if (cs.kind === "partial") {
    flags.push({ id: "partial", tone: "sky", label: "Partially shipped", detail: "Part of the order is still to ship." });
  }
  const pc = (o.preCheck ?? "").trim();
  if (stage === "toPlace" && pc && !/^good to go/i.test(pc)) {
    flags.push({ id: "precheck", tone: "amber", label: `Pre-check: ${pc}`, detail: "Advisory only — it does not block ordering. Details in the Pre-check card." });
  }
  return flags;
}

// ── Formatting ───────────────────────────────────────────────────────

/** "2026-09-15" → "9/15/2026". Anything else passes through verbatim —
 *  Monday's dates are naive ET, so they are never parsed (§9). */
export function fmtDate(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((raw ?? "").trim());
  if (!m) return (raw ?? "").trim();
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

/** "2026-09-15" → "9/15", for dense rows. */
export function fmtDateShort(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((raw ?? "").trim());
  if (!m) return (raw ?? "").trim();
  return `${Number(m[2])}/${Number(m[3])}`;
}

export function fmtMoney(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return `$${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

export function fmtPhone(raw: string): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return (raw ?? "").trim();
}

/** A quantity column's text as a number, or null when blank/unreadable —
 *  never 0, for the §5.22b reason: blank and zero are different facts here. */
export function qty(raw: string): number | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Digits of a phone, last ten — what a search compares (§7's rule). */
export function phoneDigits(raw: string): string {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

// ── Tracking ─────────────────────────────────────────────────────────

/**
 * A carrier tracking page for a number. Keyed on the Carrier column first,
 * then on the number's shape; null when neither says anything, so the number
 * renders as plain text rather than a link to the wrong carrier.
 */
export function trackingUrl(number: string, carrier = ""): string | null {
  const n = (number ?? "").trim();
  if (!n) return null;
  const c = (carrier ?? "").toLowerCase();
  if (c.includes("ups") || /^1z[0-9a-z]{16}$/i.test(n)) {
    return `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`;
  }
  if (c.includes("fedex") || /^\d{12}$/.test(n) || /^\d{15}$/.test(n) || /^\d{20}$/.test(n)) {
    return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`;
  }
  if (c.includes("usps") || /^(94|93|92|95)\d{18,20}$/.test(n)) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}`;
  }
  return null;
}

// ── Search ───────────────────────────────────────────────────────────

/**
 * Does a typed query match this order? Every token must appear somewhere in
 * the row's searchable text — the patient's name, the last ten digits of their
 * phone, the CAH order number, the PO number, the first tracking number, the
 * item id. "doe jane" finds Jane Doe; "1121265988" finds a CAH number; a
 * phone typed with punctuation still matches on digits.
 */
export function orderMatchesQuery(
  o: Pick<Order, "id" | "name" | "phone" | "cahOrderNumber" | "poNumber" | "tracking">,
  query: string,
): boolean {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return true;
  const hay = [
    o.name,
    phoneDigits(o.phone),
    o.cahOrderNumber,
    o.poNumber,
    ...(o.tracking ?? []),
    o.id,
  ]
    .join(" ")
    .toLowerCase();
  const tokens = q.split(/\s+/).map((t) => (/^[\d\s\-().+]+$/.test(t) ? t.replace(/\D/g, "") : t)).filter(Boolean);
  return tokens.every((t) => hay.includes(t));
}

// ── Same patient ─────────────────────────────────────────────────────

const norm = (s: string) => (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The other orders for the person an order belongs to. A NAME IS NOT AN
 * IDENTITY (§5.28): the phone is the join when there is one, and an exact
 * name is accepted on top only because every chip the strip renders carries
 * its own name and date — a merged namesake is visible, never silent.
 */
export function ordersForSamePatient<T extends Pick<Order, "id" | "name" | "phone">>(
  order: T,
  all: readonly T[],
): T[] {
  const digits = phoneDigits(order.phone);
  const name = norm(order.name);
  return all.filter(
    (o) => o.id !== order.id && ((digits && phoneDigits(o.phone) === digits) || (name && norm(o.name) === name)),
  );
}

/**
 * The Order Type chip to draw — which is NOT always what the column says.
 *
 * Board-wide the column is a real signal (a mix of First Order and Reorder
 * across 1,484 rows, read 2026-09-15), but it is not maintained per item: on
 * that date every one of the eleven orders in the Order group read
 * "First Order", including a same-day PAIR for one patient, which cannot both
 * be a first order. "First Order" on a patient's fifth order is worse than no
 * chip at all, so it is SUPPRESSED whenever the board itself contradicts it —
 * another order for the same patient dated on or before this one.
 *
 * ⚠️ Suppression on positive evidence only, never a correction: a missing date
 * on either side proves nothing and leaves the chip alone, and "Reorder" is
 * always drawn as the board has it. ⚠️ Nothing downstream reads this — the
 * email service's first-order delivery check-in text keys off the COLUMN, so a
 * wrong "First Order" still texts a repeat patient. That is the board's to fix.
 */
export function orderTypeLabel<T extends Pick<Order, "id" | "name" | "phone" | "orderType" | "orderDate">>(
  order: T,
  all: readonly T[],
): string {
  const label = (order.orderType ?? "").trim();
  if (!/^first order$/i.test(label)) return label;
  const mine = (order.orderDate ?? "").trim();
  if (!mine) return label;
  const contradicted = ordersForSamePatient(order, all).some((o) => {
    const theirs = (o.orderDate ?? "").trim();
    return !!theirs && theirs <= mine;
  });
  return contradicted ? "" : label;
}
