/**
 * Cardinal's per-line record for an order — the **Line Item Detail** column
 * (`long_text_mm489t0z`), written by cardinal-api-poller on every status poll.
 *
 * ⚠️⚠️ **This IS per-line shipment data** (measured on the live board,
 * 2026-09-29). Pixel-match Phase 2 (§5.51c) was built believing the board had
 * none, so the order card could only number its boxes ("Shipment 1 of 2",
 * "Shipment 2 of 2") and list the items once, apart from them — which is what
 * confused the reps (Brandon, 2026-09-29, on a partially shipped order: *"make obvious
 * what's in each shipment … shipment 1 of 2 and 2 of 2 are confusing
 * people"*). The column says which SKU went in which tracking number:
 *
 *   ORDER STATUS 9/29/2026, 11:00:48 ET
 *   L2 TN1002817I x3 BX @71.94 -> Backordered (BO: 3)
 *   L1 TN1013310I x3 BX @30.95 -> SHIPPED
 *      SHIP FedEx 100000000001 qty 3 on 2026-09-15 from NEW JERSEY WAREHOUSE
 *   L2 TN1002817I xnull BX @71.94 -> Deleted
 *   SUBSTITUTED (dropped by Cardinal): TN1002817I
 *
 *   SUBSTITUTION ORDER 1120000001
 *   L1 TN1001680I x3 BX @71.94 -> SHIPPED
 *      SHIP FedEx 100000000002 qty 3 on 2026-09-23 from NEW JERSEY WAREHOUSE
 *
 * The shapes this reads were all seen live, and each is a test:
 *  · A line may appear TWICE with one SHIP record echoed under both (a line
 *    Cardinal split: `x2 -> Accepted` + `x1 -> SHIPPED`, one parcel) — SHIP
 *    records are de-duplicated, or the parcel would count twice.
 *  · A line with no quantity (`xnull`) and no SHIP record is not a product the
 *    patient ordered — Cardinal's hold line `9999` and the `00MMWELCOME`
 *    insert — and is left out.
 *  · A line Cardinal DROPPED for a substitution is still owed to the patient
 *    until a substitution order exists; once one does, its lines are the
 *    replacement, in their own parcel.
 *  · The text can be OLDER than the board's tracking columns (it is stamped;
 *    the poll that writes it and the one that writes tracking are not the same
 *    run). A tracking number the text does not list is returned in `unlisted`,
 *    and the card says its contents are not listed — never guesses them.
 *
 * Names come from the Cardinal SKU Tracker (`skuLabel`), joined by SKU; a SKU
 * the tracker does not know is shown as the code, verbatim (§5.20).
 */
import { FAMILY_LABEL, familyOfRow, type ProductFamily } from "./skuJoin";
import { isRunLogRow, type SkuTrackerRow } from "./skuTrackerApi";

export interface ShipRecord {
  carrier: string;
  track: string;
  qty: number | null;
  /** YYYY-MM-DD, or "" when Cardinal gave none. */
  date: string;
  warehouse: string;
}

export interface LineEntry {
  lineNum: number;
  sku: string;
  qty: number | null;
  uom: string;
  /** Cardinal's words with any "(BO: n)" taken off — "SHIPPED", "Backordered", "Accepted", "Deleted"… */
  status: string;
  /** The "(BO: n)" count, when Cardinal gave one. */
  backordered: number | null;
  ships: ShipRecord[];
}

export interface LineSection {
  kind: "order" | "substitution";
  /** The substitution order's CAH number; "" for the order itself. */
  cahNumber: string;
  entries: LineEntry[];
}

export interface ParsedLineItems {
  /** "9/29/2026, 11:00:48 ET" — when Cardinal was last asked. */
  stamp: string;
  sections: LineSection[];
  /** SKUs Cardinal dropped from the order for a substitution. */
  dropped: string[];
}

const HEAD = /^ORDER STATUS\s+(.+)$/i;
const LINE = /^L(\d+)\s+(\S+)\s+x(\d+|null)\s+(\S+)\s+@\S*\s+->\s+(.+)$/i;
const SHIP = /^SHIP\s+(.+?)\s+(\S+)\s+qty\s+(\d+|null)(?:\s+on\s+(\S+))?(?:\s+from\s+(.+))?$/i;
const SUB = /^SUBSTITUTION ORDER\s+(\S+)/i;
const DROPPED = /^SUBSTITUTED \(dropped by Cardinal\):\s*(.+)$/i;
const BO = /^(.*?)\s*\(BO:\s*(\d+)\)\s*$/i;

const num = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);

/** The column's text → its sections. Lines it does not recognise are skipped. */
export function parseLineItemDetail(text: string): ParsedLineItems {
  const out: ParsedLineItems = { stamp: "", sections: [], dropped: [] };
  let section: LineSection = { kind: "order", cahNumber: "", entries: [] };
  out.sections.push(section);
  let last: LineEntry | null = null;
  for (const raw of (text ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(HEAD))) {
      if (!out.stamp) out.stamp = m[1].trim();
      continue;
    }
    if ((m = line.match(SUB))) {
      section = { kind: "substitution", cahNumber: m[1], entries: [] };
      out.sections.push(section);
      last = null;
      continue;
    }
    if ((m = line.match(DROPPED))) {
      for (const sku of m[1].split(/[,\s]+/).map((s) => s.trim()).filter(Boolean)) {
        if (!out.dropped.includes(sku)) out.dropped.push(sku);
      }
      last = null;
      continue;
    }
    if ((m = line.match(LINE))) {
      const statusRaw = m[5].trim();
      const bo = statusRaw.match(BO);
      last = {
        lineNum: Number(m[1]),
        sku: m[2],
        qty: num(m[3]),
        uom: m[4],
        status: bo ? bo[1].trim() : statusRaw,
        backordered: bo ? Number(bo[2]) : null,
        ships: [],
      };
      section.entries.push(last);
      continue;
    }
    if ((m = line.match(SHIP)) && last) {
      last.ships.push({
        carrier: m[1].trim(),
        track: m[2],
        qty: num(m[3]),
        date: (m[4] ?? "").trim(),
        warehouse: (m[5] ?? "").trim(),
      });
    }
  }
  out.sections = out.sections.filter((s) => s.kind === "order" || s.entries.length > 0);
  return out;
}

export interface BoxItem {
  sku: string;
  qty: number | null;
  /** Shipped on a substitution order, in place of a line Cardinal dropped. */
  substitute: boolean;
}

export interface ParsedBox {
  track: string;
  carrier: string;
  /** The ship date Cardinal gave this parcel, YYYY-MM-DD, or "". */
  date: string;
  items: BoxItem[];
}

export interface PendingItem {
  sku: string;
  qty: number;
  /** Cardinal's status for the line — "Backordered", "Accepted"… — or, for a
   *  dropped line with no substitution yet, "Dropped by Cardinal". */
  status: string;
  dropped: boolean;
}

export interface LineItemView {
  stamp: string;
  /** In the board's tracking-column order, then any the columns lack. */
  boxes: ParsedBox[];
  /** Board tracking numbers the text does not list — the text is older. */
  unlisted: string[];
  /** Still to ship, by Cardinal's own line record. */
  pending: PendingItem[];
  /** Marked shipped by Cardinal with no parcel named. */
  unboxed: BoxItem[];
  /** The SKU a substitution replaced — only when there is exactly one. */
  replaced: string;
}

const isDeleted = (s: string) => /^deleted$/i.test(s.trim());
const isShipped = (s: string) => /^(shipped|delivered)$/i.test(s.trim());

/**
 * What went in each parcel and what is still to come. Null when the column
 * holds no product line at all (never polled, or before Cardinal records
 * began) — the card then draws exactly what it drew before.
 */
export function lineItemView(text: string, boardTracking: readonly string[] = []): LineItemView | null {
  const parsed = parseLineItemDetail(text);
  const hasSubstitution = parsed.sections.some((s) => s.kind === "substitution" && s.entries.length > 0);
  const boxes = new Map<string, ParsedBox>();
  for (const t of boardTracking) {
    const track = (t ?? "").trim();
    if (track && !boxes.has(track)) boxes.set(track, { track, carrier: "", date: "", items: [] });
  }
  const listed = new Set<string>();
  const pending: PendingItem[] = [];
  const unboxed: BoxItem[] = [];
  let productLines = 0;

  for (const section of parsed.sections) {
    const groups = new Map<string, LineEntry[]>();
    for (const e of section.entries) {
      const k = `${e.lineNum}|${e.sku}`;
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    for (const entries of groups.values()) {
      const sku = entries[0].sku;
      const qtys = entries.map((e) => e.qty).filter((q): q is number => q !== null);
      const ordered = qtys.length ? Math.max(...qtys) : null;
      const seen = new Set<string>();
      const ships: ShipRecord[] = [];
      for (const e of entries) {
        for (const s of e.ships) {
          const k = `${s.track}|${s.qty}|${s.date}`;
          if (seen.has(k)) continue;
          seen.add(k);
          ships.push(s);
        }
      }
      if (ordered === null && !ships.length) continue; // 9999 hold line, 00MMWELCOME insert
      productLines++;
      const substitute = section.kind === "substitution";

      let shipped = 0;
      for (const s of ships) {
        shipped += s.qty ?? 0;
        listed.add(s.track);
        const box = boxes.get(s.track) ?? { track: s.track, carrier: "", date: "", items: [] };
        if (!box.carrier) box.carrier = s.carrier;
        if (!box.date || (s.date && s.date < box.date)) box.date = s.date || box.date;
        const same = box.items.find((i) => i.sku === sku && i.substitute === substitute);
        if (same) same.qty = same.qty === null || s.qty === null ? null : same.qty + s.qty;
        else box.items.push({ sku, qty: s.qty, substitute });
        boxes.set(s.track, box);
      }

      const dropped = section.kind === "order" && parsed.dropped.includes(sku);
      if (dropped) {
        // Replaced: the substitution order's own lines are what ship now.
        if (hasSubstitution) continue;
        const left = (ordered ?? 0) - shipped;
        if (left > 0) pending.push({ sku, qty: left, status: "Dropped by Cardinal", dropped: true });
        continue;
      }
      const live = entries.filter((e) => !isDeleted(e.status));
      if (!live.length) continue;
      const waiting = live.find((e) => !isShipped(e.status));
      if (!waiting) {
        // Cardinal calls it shipped; no parcel named for (all of) it.
        if (!ships.length) unboxed.push({ sku, qty: ordered, substitute });
        continue;
      }
      const left = (ordered ?? 0) - shipped;
      if (left > 0) {
        pending.push({ sku, qty: left, status: waiting.status, dropped: false });
      }
    }
  }
  if (!productLines) return null;

  const all = [...boxes.values()];
  const unlisted = all.filter((b) => !listed.has(b.track)).map((b) => b.track);
  return {
    stamp: parsed.stamp,
    boxes: all.filter((b) => listed.has(b.track)),
    unlisted,
    pending,
    unboxed,
    replaced: hasSubstitution && parsed.dropped.length === 1 ? parsed.dropped[0] : "",
  };
}

export interface SkuLabel {
  /** The tracker row's name — "t:slim", "AutoSoft 90 6 mm 23\"", "G7 Receiver" — or the SKU itself. */
  product: string;
  family: ProductFamily | null;
  /** "Cartridges", "Infusion sets"… or "Cardinal SKU" when the tracker has no row for it. */
  familyLabel: string;
}

/**
 * A SKU's name, by the Cardinal SKU Tracker. Receiver rows are named
 * `<sensor(s)> → <receiver>`; the receiver is the right-hand side.
 */
export function skuLabel(sku: string, rows: readonly SkuTrackerRow[] | null): SkuLabel {
  const key = (sku ?? "").trim().toUpperCase();
  const row = rows?.find((r) => !isRunLogRow(r) && (r.sku ?? "").trim().toUpperCase() === key) ?? null;
  if (!row) return { product: sku, family: null, familyLabel: "Cardinal SKU" };
  const family = familyOfRow(row);
  const product = family === "cgmReceivers" && row.name.includes("→") ? row.name.split("→")[1].trim() : row.name;
  return { product, family, familyLabel: family ? FAMILY_LABEL[family] : "Cardinal SKU" };
}

/** "Backordered" / "Accepted" / … → the words the card puts beside a waiting item. */
export function pendingStatusText(p: Pick<PendingItem, "status" | "dropped">): string {
  // Whether a substitution is needed or already ordered is the block's pill
  // (Cardinal's verdict), never guessed per line.
  if (p.dropped) return "Dropped by Cardinal";
  const s = p.status.trim();
  if (/^backordered$/i.test(s)) return "Backordered";
  if (/^(accepted|open|processing|success|working on it)$/i.test(s)) return "Not shipped yet";
  return s || "Not shipped yet";
}
