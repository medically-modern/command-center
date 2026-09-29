/**
 * Brandon's order card (pixel-match Phase 2) — the selected order on the
 * patient screen's Subscription › Orders tab, drawn from ONE full-width order
 * read (`usePatientOrderDetail`), never a list row.
 *
 * The looks are his `orderCard`; the facts are the orders slice's own rules
 * (`lib/patient/orderCard.ts` explains the mapping and what his mockup
 * invented). Nothing here writes. The one control that does — swapping a
 * backordered set, which EMAILS Cardinal (§5.35) — is `/orders`' own
 * `SubstitutionCard`, rendered unchanged and gated exactly as `/orders` gates
 * it: on the Adjust orders ability.
 */
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Clock,
  Monitor,
  Package,
  Truck,
  Zap,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { SubstitutionCard } from "@/components/orders/SubstitutionCard";
import { useSkuTracker } from "@/hooks/orders/useSkuTracker";
import { FAMILY_LABEL, orderLines, type OrderLine, type ProductFamily } from "@/lib/orders/skuJoin";
import { hasSubstitutionStory, swapWorkable } from "@/lib/orders/substitution";
import { orderTimeline, type TimelineStep } from "@/lib/orders/timeline";
import { cardinalStatus, fmtDate, isOpenStage, orderStage, type Order } from "@/lib/orders/workflow";
import {
  isPreTracking,
  orderIsSettled,
  orderNumberLabel,
  orderPill,
  orderShipments,
  orderShipmentsFromLines,
  type LinesShipmentView,
  type OrderPill,
  type ParcelView,
} from "@/lib/patient/orderCard";
import { pendingStatusText, skuLabel, type BoxItem, type PendingItem } from "@/lib/orders/lineItems";
import type { SkuTrackerRow } from "@/lib/orders/skuTrackerApi";

const S = { width: 12, height: 12 } as const;

export function PillView({ pill }: { pill: OrderPill }) {
  const icon: ReactNode =
    pill.icon === "check" ? <Check style={S} /> :
    pill.icon === "truck" ? <Truck style={S} /> :
    pill.icon === "alert" ? <AlertTriangle style={S} /> :
    pill.icon === "clock" ? <Clock style={S} /> : null;
  return (
    <span className={`pill ${pill.tone}`}>
      {icon}
      {pill.text}
    </span>
  );
}

/** His `kindIcon`: sensors · pump · cartridges · receiver · sets. */
function familyIcon(family: ProductFamily): ReactNode {
  const s = { width: 18, height: 18 };
  if (family === "cgmSensors") return <Activity style={s} />;
  if (family === "insulinPumps") return <Zap style={s} />;
  if (family === "cartridges") return <Package style={s} />;
  if (family === "cgmReceivers") return <Monitor style={s} />;
  return <ArrowLeftRight style={s} />;
}

function ItemRow({ line }: { line: OrderLine }) {
  return (
    <div className="oi">
      <span className="tile">{familyIcon(line.family)}</span>
      <div className="grow">
        <b>{line.product}</b>
        <div className="xs muted">
          Quantity: {line.quantity} · {FAMILY_LABEL[line.family]}
        </div>
      </div>
    </div>
  );
}

/**
 * A product the board names as backordered — no quantity is invented for it,
 * and the line says where the name came from: Cardinal's backorder list for
 * this order, which is what the board holds, never a per-line shipment record
 * (there is none — PIXEL_MATCH_PLAN.md §7).
 */
function NamedRow({ name, qty }: { name: string; qty: string }) {
  return (
    <div className="oi">
      <span className="tile">
        <ArrowLeftRight style={{ width: 18, height: 18 }} />
      </span>
      <div className="grow">
        <b>{name}</b>
        <div className="xs muted">
          {qty ? `Backordered quantity: ${qty}` : "On Cardinal's backorder list for this order"}
        </div>
      </div>
    </div>
  );
}

/** A line from Cardinal's line list, named by the SKU tracker (§5.51c). */
function SkuRow({
  sku,
  qty,
  rows,
  note,
}: {
  sku: string;
  qty: number | null;
  rows: readonly SkuTrackerRow[] | null;
  note?: string;
}) {
  const l = skuLabel(sku, rows);
  return (
    <div className="oi">
      <span className="tile">{l.family ? familyIcon(l.family) : <Package style={{ width: 18, height: 18 }} />}</span>
      <div className="grow">
        <b>{l.product}</b>
        <div className="xs muted">
          {qty !== null ? `Quantity: ${qty} · ` : ""}
          {l.familyLabel}
          {note ? ` · ${note}` : ""}
        </div>
      </div>
    </div>
  );
}

function ParcelHead({ p }: { p: ParcelView }) {
  return (
    <div className="shp-h">
      <b>{p.of > 1 ? `Shipment ${p.n} of ${p.of}` : "Shipment"}</b>
      <PillView pill={p.pill} />
      <span className="xs muted">
        {p.carrier}
        {p.track && (
          <>
            {p.carrier ? " · " : ""}
            {p.url ? (
              <a className="trk" href={p.url} target="_blank" rel="noreferrer" title="Opens the carrier's tracking page">
                {p.track}
              </a>
            ) : (
              <span className="trk">{p.track}</span>
            )}
          </>
        )}
        {p.signedBy && ` · signed ${p.signedBy}`}
      </span>
    </div>
  );
}

/**
 * Each parcel WITH what Cardinal says is in it, then what has not shipped —
 * one block, never numbered as a shipment (Brandon, 2026-09-29: *"make obvious
 * what's in each shipment … shipment 1 of 2 and 2 of 2 are confusing
 * people"*). Reads the SKU tracker for the names (one shared 30-minute read,
 * `useSkuTracker`); until it lands, a line shows its SKU code.
 */
function LinesShipments({ view, delivered }: { view: LinesShipmentView; delivered: boolean }) {
  const sku = useSkuTracker();
  const rows = sku.rows;
  const replacedName = view.replaced ? skuLabel(view.replaced, rows).product : "";
  const pendingNote = (p: PendingItem) => pendingStatusText(p);
  const boxNote = (i: BoxItem) => (i.substitute ? (replacedName ? `substitute for ${replacedName}` : "substitute") : "");
  return (
    <div className="shipments">
      {view.parcels.map((p) => (
        <div key={`${p.n}-${p.track}`} className={`shp ${delivered || p.pill.tone === "active" ? "dlv" : "trn"}`}>
          <ParcelHead p={p} />
          {p.items ? (
            <div className="oitems">
              {p.items.map((i) => (
                <SkuRow key={`${i.sku}-${i.substitute}`} sku={i.sku} qty={i.qty} rows={rows} note={boxNote(i)} />
              ))}
            </div>
          ) : (
            <div className="xs muted">
              What&apos;s in this box isn&apos;t in Cardinal&apos;s line list yet
              {view.stamp ? ` (last updated ${view.stamp})` : ""}.
            </div>
          )}
        </div>
      ))}

      {!!view.unboxed.length && (
        <div className="shp trn">
          <div className="shp-h">
            <b>Shipped</b>
            <span className="xs muted">Cardinal didn&apos;t name the box</span>
          </div>
          <div className="oitems">
            {view.unboxed.map((i) => (
              <SkuRow key={`u-${i.sku}`} sku={i.sku} qty={i.qty} rows={rows} note={boxNote(i)} />
            ))}
          </div>
        </div>
      )}

      {view.pending && (
        <div className={`shp pend${view.pending.tone === "red" ? " bo" : ""}`}>
          <div className="shp-h">
            <b>Not shipped yet</b>
            <span className={`pill ${view.pending.tone}`}>
              {view.pending.tone === "red" ? <AlertTriangle style={S} /> : <Clock style={S} />}
              {view.pending.label}
            </span>
            {view.pending.eta && <span className="xs muted">Cardinal ETA {view.pending.eta}</span>}
          </div>
          <div className="oitems">
            {view.pending.items.map((i) => (
              <SkuRow key={`p-${i.sku}`} sku={i.sku} qty={i.qty} rows={rows} note={pendingNote(i)} />
            ))}
          </div>
          {view.parcels.some((p) => !p.items) && view.stamp && (
            <div className="xs muted">As of Cardinal&apos;s line list, {view.stamp}.</div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * His `.tracker` — the orders slice's own steps (`orderTimeline`), in his look.
 *
 * His last COMPLETED step wears the primary ring ("done now"); ours keeps that
 * look for the same step, but only when no step is waiting or blocked — the
 * slice already marks where an order is stuck, and two highlighted steps would
 * say the order is in two places.
 */
function Tracker({ steps, delivered }: { steps: TimelineStep[]; delivered: boolean }) {
  const cursor = steps.some((s) => s.state === "current" || s.state === "blocked");
  // The last step REACHED — done, or passed with a note. Only a plain `done`
  // one takes the ring; a note step (a partial shipment) already stands out.
  let lastReached = -1;
  steps.forEach((s, i) => {
    if (s.state === "done" || s.state === "note") lastReached = i;
  });
  const style = {
    gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`,
    // The connecting line runs from the first circle's centre to the last's.
    "--edge": `${50 / Math.max(steps.length, 1)}%`,
  } as CSSProperties;
  return (
    <div className={`tracker${delivered ? " delivered" : ""}`} style={style} aria-label="Order progress">
      {steps.map((s, i) => {
        const cls =
          s.state === "done" ? (!cursor && i === lastReached ? "done now" : "done") :
          s.state === "current" ? "now" :
          s.state === "blocked" ? "err" :
          // ⚠️ Not "note": `.cc-pt .note` is the notes card's box, and a step
          // wearing it drew as a grey panel. "part" is his own class name.
          s.state === "note" ? "part" : "";
        return (
          <div key={s.key} className={`st ${cls}`}>
            <div className="c">
              {s.state === "done" || s.state === "note" ? (
                <Check style={S} />
              ) : s.state === "blocked" ? (
                <AlertTriangle style={S} />
              ) : s.state === "current" ? (
                <Clock style={S} />
              ) : null}
            </div>
            <div className="t">{s.title}</div>
            <div className="s">{s.lines[0] ?? ""}</div>
          </div>
        );
      })}
    </div>
  );
}

export function PatientOrderCard({ order: o, canAdjust }: { order: Order; canAdjust: boolean }) {
  const stage = orderStage(o);
  const cs = cardinalStatus(o.apiStatus, o.holdReason, o.apiMessage);
  const pill = orderPill(o);
  const view = orderShipments(o);
  const fromLines = orderShipmentsFromLines(o);
  const lines = orderLines(o);
  const delivered = stage === "delivered";
  const settled = orderIsSettled(o);
  const preTracking = isPreTracking(o);
  const open = isOpenStage(stage);
  const blocking = cs.kind === "hold" || cs.kind === "error" || cs.kind === "review" || cs.kind === "deleted";
  const shipTo = (o.confirmedDeliveryAddress || o.address || "").trim();

  return (
    <>
      <div className={`ord ${settled ? "done" : "open"} oc`} data-testid="order-card">
        <div className="oc-band">
          <div>
            <div className="eyebrow">Order</div>
            <b className="mono">{orderNumberLabel(o)}</b>
          </div>
          <div>
            <div className="eyebrow">Placed</div>
            <b>{o.orderDate ? fmtDate(o.orderDate) : "—"}</b>
          </div>
          <div>
            <div className="eyebrow">Type</div>
            <b>
              {o.orderType || "—"}
              {o.subscriptionType && (
                <span className="muted" style={{ fontWeight: 400 }}>
                  {" "}
                  · {o.subscriptionType}
                </span>
              )}
            </b>
          </div>
          {o.poNumber && o.cahOrderNumber && (
            <div>
              <div className="eyebrow">PO</div>
              <b className="mono xs">{o.poNumber}</b>
            </div>
          )}
          <div style={{ marginLeft: "auto" }}>
            <PillView pill={pill} />
          </div>
        </div>

        {/* Cardinal's own words, when the pill only names the problem. ⚠️ Never
            the pill's text a second time (§5.35's say-it-once rule). */}
        {blocking && !delivered && cs.detail && cs.detail !== pill.text && (
          <div className="notice red xs">
            <AlertTriangle style={S} /> <div>{cs.detail}</div>
          </div>
        )}
        {open && cs.kind === "substitution" && (
          <div className="notice amber xs">
            <ArrowLeftRight style={S} />{" "}
            <div>
              Cardinal needs a substitution — the ordered set isn&apos;t available.
              {canAdjust ? " Pick a replacement below." : " Someone with Adjust orders picks the replacement."}
            </div>
          </div>
        )}

        {/* His DDP card's grey notice, in the words the slice's own headline
            uses — no shipments and no progress are drawn, because the board
            holds none for this order. */}
        {preTracking && (
          <div className="notice grey xs">
            <AlertTriangle style={S} />{" "}
            <div>
              Shipped before Cardinal records began — there is no tracking, shipment or status on file for this
              order.
            </div>
          </div>
        )}

        {fromLines ? (
          <LinesShipments view={fromLines} delivered={delivered} />
        ) : (
          <div className="shipments">
            {view.notYet && (
              <div className="shp wait">
                <div className="shp-h">
                  <b>{view.notYet.heading}</b>
                  <PillView pill={view.notYet.pill} />
                  {view.notYet.eta && <span className="xs muted">Cardinal ETA {view.notYet.eta}</span>}
                </div>
                {!!lines.length && (
                  <div className="oitems">
                    {lines.map((l, i) => (
                      <ItemRow key={`${l.family}-${i}`} line={l} />
                    ))}
                  </div>
                )}
                {!!view.notYet.backordered.length && (
                  <div className="xs" style={{ color: "var(--warn-fg)" }}>
                    On Cardinal&apos;s backorder list: {view.notYet.backordered.join(", ")}
                  </div>
                )}
              </div>
            )}

            {view.boxes.map((b) => (
              <div key={`${b.n}-${b.track}`} className={`shp ${delivered ? "dlv" : "trn"}`}>
                <div className="shp-h">
                  <b>{b.of > 1 ? `Shipment ${b.n} of ${b.of}` : "Shipment"}</b>
                  <PillView pill={b.pill} />
                  <span className="xs muted">
                    {b.carrier}
                    {b.track && (
                      <>
                        {b.carrier ? " · " : ""}
                        {b.url ? (
                          <a className="trk" href={b.url} target="_blank" rel="noreferrer" title="Opens the carrier's tracking page">
                            {b.track}
                          </a>
                        ) : (
                          <span className="trk">{b.track}</span>
                        )}
                      </>
                    )}
                    {b.signedBy && ` · signed ${b.signedBy}`}
                  </span>
                </div>
                {view.itemsInBox && !!lines.length && (
                  <div className="oitems">
                    {lines.map((l, i) => (
                      <ItemRow key={`${l.family}-${i}`} line={l} />
                    ))}
                  </div>
                )}
              </div>
            ))}

            {view.pending && (
              <div className={`shp pend${view.pending.tone === "red" ? " bo" : ""}`}>
                <div className="shp-h">
                  <b>{view.boxes.length ? `Shipment ${view.pending.n} of ${view.pending.of}` : "Not shipped yet"}</b>
                  <span className={`pill ${view.pending.tone}`}>
                    {view.pending.tone === "red" ? <AlertTriangle style={S} /> : <Clock style={S} />}
                    {view.pending.label}
                  </span>
                  <span className="xs muted">
                    {view.boxes.length ? "not shipped yet" : ""}
                    {view.pending.eta ? `${view.boxes.length ? " · " : ""}Cardinal ETA ${view.pending.eta}` : ""}
                  </span>
                </div>
                {!!view.pending.products.length && (
                  <div className="oitems">
                    {view.pending.products.map((name) => (
                      <NamedRow
                        key={name}
                        name={name}
                        qty={view.pending!.products.length === 1 ? view.pending!.qty : ""}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* The items once, on their own, whenever they cannot honestly be put
            in one box — the board does not say which box carried what. With
            Cardinal's line list every item is already in its parcel or in
            "Not shipped yet", unless a parcel's contents aren't listed. */}
        {(fromLines ? fromLines.parcels.some((p) => !p.items) : !view.itemsInBox && !view.notYet) && !!lines.length && (
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>In this order</div>
            <div className="oitems">
              {lines.map((l, i) => (
                <ItemRow key={`${l.family}-${i}`} line={l} />
              ))}
            </div>
          </div>
        )}

        {shipTo && (
          <div className="line xs">
            <span className="muted">Ship to</span>
            <span>{shipTo}</span>
          </div>
        )}
        {view.boxes.length > 1 && delivered && o.signedBy && (
          <div className="line xs">
            <span className="muted">Signed by</span>
            <span>{o.signedBy}</span>
          </div>
        )}

        {!preTracking && <Tracker steps={orderTimeline(o)} delivered={delivered} />}

        {o.lastCardinalSync && (
          <div className="line xs muted">
            <span>Last updated {o.lastCardinalSync} · Cardinal sync</span>
          </div>
        )}
      </div>

      {/* The swap — `/orders`' own card, unchanged. ⚠️ It IS the email to
          Cardinal (§5.35), so it is gated on Adjust orders exactly as /orders
          gates it; without the ability the order still reads in full and one
          line says who can make the change (§5.39c). */}
      {hasSubstitutionStory(o) &&
        (canAdjust ? (
          <SwapCard order={o} />
        ) : swapWorkable(o) ? (
          <div className="notice grey xs">
            {/* One child: `.notice` is a flex row, and bare text beside a <b>
                split into three columns (seen rendered, 2026-09-29). */}
            <div>
              Swapping a backordered set emails Cardinal and needs <b>Adjust orders</b> — an admin can turn it on
              in Users.
            </div>
          </div>
        ) : null)}
    </>
  );
}

/** The SKU tracker is a 30-minute module cache shared with /orders; the
 *  shipment list reads it too, for names (`LinesShipments`). */
function SwapCard({ order }: { order: Order }) {
  const sku = useSkuTracker();
  return <SubstitutionCard key={`sub-${order.id}`} order={order} skuRows={sku.rows} />;
}
