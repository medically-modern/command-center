/**
 * The patient screen's SUBSCRIPTION view — Brandon's Profile | Orders tabs
 * (§5.45).
 *
 * Josh, 2026-09-21, looking at what shipped: *"is this what brandons mockup did
 * here? if not follow it"*. It was not: §5.39 recorded these tabs as "still not
 * built, deliberately", and what stood in for them was two link buttons on an
 * otherwise empty page. His `patientMain` renders a Profile | Orders segmented
 * toggle carrying the order COUNT, then either `profilePage` (a subscription
 * overview strip, then the board's facts in cards, then the notes) or
 * `ordersPage` (the order history table, newest first).
 *
 * ⚠️⚠️ **EDITABLE BEHIND `editProfile`, READ-ONLY WITHOUT IT** (Josh,
 * 2026-09-21: *"if the person has edit profile access they should be able to
 * edit from this page too / read only if you dont have it, the way it is
 * today"*). That is Brandon's own rule — his `profilePage` renders Save /
 * Reset for somebody who can edit and "Read-only for <name>" for everybody
 * else — and it is exactly what `editProfile` was defined to mean (§5.39h:
 * *"can change the Subscription profile … without it the profile is
 * read-only"*).
 *
 * ⚠️⚠️ **ONE WRITER, TWO SCREENS — never a second implementation.** The edit
 * path renders `/subscription`'s own `SubscriptionForm` and calls its own
 * `sendPatientToMonday`, on a `Patient` read through the subscription slice's
 * own `fetchItemById` + mapping. What this codebase keeps recording going
 * wrong is two INDEPENDENT writers for one column — the Secondary Insurance
 * select leaving `PatientInfoCard` (§5.31c), the phone editor leaving the
 * Welcome Call banner (§5.31d) — and calling the existing one from a second
 * screen is the opposite of that: there is still exactly one place that knows
 * how these columns are written.
 *
 * ⚠️ **This narrows §5.39's "writes nothing" promise to "writes nothing
 * WITHOUT the ability".** `patientScreen.test.ts` still scans every other file
 * on the screen, and still pins that the write is ability-gated on the control
 * AND inside the handler — §5.39h's rule, because the button is what a rep
 * sees and the handler is what stops the write.
 *
 * ⚠️⚠️ **THE ORDER-DETAILS FORM RENDERS FOR EVERYBODY FROM 2026-09-22, INERT
 * WITHOUT THE ABILITY** (Josh: *"Delete the open read-only button in the
 * profile view and just use that view it takes you to display in the bottom
 * section"* · *"there shouldn't be a button at the bottom taking you to open
 * the profile and update clinicals"*). Those two buttons were the screen
 * admitting it was a summary: a rep read four cards and then left for
 * `/subscription` to see the rest. Brandon's `profilePage` has no such link —
 * it draws the order-details grid inline and `disabled`s it for somebody who
 * cannot edit, which is what this now does.
 *
 * ⚠️ **`inert` is the mechanism, not a per-control `disabled` prop**, the same
 * one `StagePanelEmbed` uses for the same job (§5.39c2): measured in Chrome
 * 141, a real click is not hittable and focus cannot enter the subtree. Every
 * write in `SubscriptionForm` is in an event handler, so nothing behind it can
 * fire — and the callbacks are no-ops on top, because a form that cannot be
 * clicked still should not be handed a writer.
 */
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { AlertTriangle, ArrowUpRight, Eye, Package, RotateCcw, User } from "lucide-react";
import type { DossierItem } from "@/lib/commsHub/dossier";
import { buildStageDetail, hasStageDetail } from "@/lib/commsHub/stageDetail";
import { subscriptionOverview, type OverviewFact } from "@/lib/patient/subscriptionOverview";
import { mondayItemToOrder } from "@/lib/orders/mondayMapping";
import { fmtDate, orderStage, type Order } from "@/lib/orders/workflow";
import { orderHeadline } from "@/lib/orders/headline";
import { orderLines } from "@/lib/orders/skuJoin";
import { StagePill } from "@/components/orders/pills";
import { usePatientOrders } from "@/hooks/patient/usePatientOrders";
import { useSubscriptionRecord } from "@/hooks/patient/useSubscriptionRecord";
import { SubscriptionForm } from "@/components/subscription/SubscriptionForm";
import { SendToMondayButton } from "@/components/subscription/SendToMondayButton";
import { AbilityLockNote, useAbility } from "@/components/shell/AbilityLock";
import { sendPatientToMonday } from "@/lib/subscription/mondayWrite";
import { validatePatientForSend, type Patient as SubPatient } from "@/lib/subscription/workflow";
import { GatewayPendingError } from "@/lib/shared/verifiedWrite";
import { refusePendingNote } from "@/components/shared/pendingNoteGuard";

/**
 * The sections whose facts `SubscriptionForm` renders as INPUTS, so they are
 * not also rendered as read-only cards while editing: one fact editable and the
 * same fact read-only, on one screen, is worse than either alone.
 *
 * ⚠️ **"Next order" is in the list and is not in practice filtered**, because
 * it is the FIRST mapped section and the first section wears the teal overview
 * strip rather than being a card. That is deliberate rather than dead: the
 * strip is this screen's `PatientInfoCard`, and `/subscription` shows exactly
 * the same six facts read-only above its own form (Status · Days to Order ·
 * Ordering Cycle · Next Order · Order Type). It stays listed so the filter
 * still holds if the SUBSCRIPTION map is ever reordered and it lands in the
 * cards.
 *
 * ⚠️ Matching by TITLE is why `subscriptionView.test.ts` asserts both strings
 * against the live SUBSCRIPTION map: renamed there, the filter matches nothing
 * and the facts double-render with nothing erroring.
 */
export const FORM_SECTIONS = ["Next order", "What ships"];

export type SubTab = "profile" | "orders";

export function parseSubTab(raw: string | null): SubTab {
  return raw === "orders" ? "orders" : "profile";
}

export function SubscriptionView({
  item,
  phone,
  tab,
  onTab,
}: {
  item: DossierItem;
  phone: string;
  tab: SubTab;
  onTab: (next: SubTab) => void;
}) {
  const canEdit = useAbility("editProfile");
  /**
   * ⚠️ **Read once for the WHOLE Subscription view, not once per tab.** It was
   * gated on `tab === "orders"`; the Profile tab's overview strip needs the
   * FIRST order date (§5.46b), and the tab badge should carry the count before
   * a rep has pressed it, exactly as Brandon draws it.
   *
   * ⚠️ That is still "on open, never on render": this view is mounted only when
   * a rep is looking at it, and `fetchOrdersForPatient` is ONE filtered query
   * against the order board, module-cached per number. It is not the shape
   * INCIDENT_2026-08-20 warns about — that is a read per ROW, or a read on a
   * timer — and it does not touch RingCentral at all.
   */
  const { orders: raw, loading, error } = usePatientOrders(phone, true);
  /* ⚠️ `partial: true` — these rows come from the LIST columns, so every column
     the list did not ask for is "" (§5.25). The flag is what stops a partial
     record ever being rendered as the OPEN order, which is the orders page's
     own rule. Here a row is only ever a summary, and clicking opens the real
     one on /orders. */
  const orders = useMemo(
    () => raw?.map((it) => mondayItemToOrder(it, { partial: true })) ?? null,
    [raw],
  );
  const count = orders?.length ?? null;
  /* ⚠️ Computed ONCE for both tabs — the Profile strip and the Orders tab's
     upcoming card are the same four facts, and two derivations of "when is the
     next box due" is how the two tabs of one screen come to disagree. */
  const overview = useMemo(
    () => subscriptionOverview(item.cols, orders?.map((o) => o.orderDate) ?? null),
    [item.cols, orders],
  );

  return (
    <>
      <div className="row wrap sub-toggle">
        <div className="segc">
          <button className={tab === "profile" ? "on" : ""} onClick={() => onTab("profile")}>
            <User style={{ width: 13, height: 13 }} /> Profile
          </button>
          <button className={tab === "orders" ? "on" : ""} onClick={() => onTab("orders")}>
            <Package style={{ width: 13, height: 13 }} /> Orders
            {count !== null && <span className="n">{count}</span>}
          </button>
        </div>
        {/* Brandon's own split: Save / Reset for somebody who can edit, this
            sentence for everybody else. The Save lives in the form below,
            beside the fields it writes, so this stays the read-only half. */}
        {tab === "profile" && !canEdit && <AbilityLockNote ability="editProfile" />}
      </div>

      {tab === "profile" ? (
        <ProfileTab key={item.itemId} item={item} canEdit={canEdit} overview={overview} />
      ) : (
        <OrdersTab
          orders={orders}
          loading={loading}
          error={error}
          hasPhone={!!phone}
          overview={overview}
        />
      )}
    </>
  );
}

function ProfileTab({
  item,
  canEdit,
  overview,
}: {
  item: DossierItem;
  canEdit: boolean;
  overview: OverviewFact[];
}) {
  const sections = useMemo(() => buildStageDetail(item.boardId, item.cols), [item]);
  /* ⚠️ Filtered ALWAYS now, not only while editing: the order-details form is
     rendered for everybody (inert without the ability), so its fields would
     otherwise appear twice — once as an input and once as a read-only row.
     ⚠️ Matching by TITLE is why `subscriptionView.test.ts` asserts both strings
     against the live SUBSCRIPTION map: renamed there, the filter matches
     nothing and the facts double-render with nothing erroring. */
  const cards = sections.filter((sc) => !FORM_SECTIONS.includes(sc.title));

  return (
    <>
      {sections.length === 0 && (
        <div className="card pad small muted">
          {hasStageDetail(item.boardId)
            ? "Nothing has been filled in on this board yet."
            : "No read-only view is mapped for this board — open it on Monday."}
        </div>
      )}

      {/* Brandon's teal "Subscription overview" strip — four facts, his four
          (§5.46b). ⚠️ Rendered unconditionally so the shape of the screen does
          not change with the data: a blank is an em dash, never a missing row,
          because a fact nobody has answered and a fact that is not asked look
          identical once the row disappears. */}
      <section className="card pad left-teal">
        <div className="eyebrow" style={{ marginBottom: 10 }}>
          Subscription overview
        </div>
        <div className="strip">
          {overview.map((f) => (
            <div className="fact" key={f.label}>
              <div className="k">{f.label}</div>
              <div className="v">
                {f.value || "—"}
                {f.note && (
                  <span className={`xs ${f.warn ? "warn" : "muted"}`} style={{ marginLeft: 6 }}>
                    {f.value ? `(${f.note})` : f.note}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <SubscriptionEditor itemId={item.itemId} canEdit={canEdit} />

      {cards.map((sc) => (
        <section className="card snapcard" key={sc.title}>
          <div className="snap-ct">{sc.title}</div>
          <div className="rogrid">
            {sc.fields.map((f) => (
              <div className={`rof${f.lead ? " lead" : ""}`} key={f.col}>
                <div className="k">{f.label}</div>
                <div className="v">{f.value}</div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {item.notes.trim() && (
        <section className="card pad">
          <div className="section-h">
            <b className="small">Subscription notes</b>
            <span className="xs muted">from the board&apos;s notes column</span>
          </div>
          <div className="note">{item.notes.trim()}</div>
        </section>
      )}

      {/* ⚠️ The "Open the profile / Update clinicals" card that used to sit here
          is GONE (Josh, 2026-09-22) — the profile it linked to is rendered
          above. Update Clinicals keeps its own page and its own role bar, and
          the visit date is still only writable there, because that save also
          writes the MR rung (§5.36); what is removed is a button, not a route.
          The board and group the record lives on now ride in the footer line so
          nothing is lost from the screen. */}
      <p className="xs muted" style={{ margin: "2px 2px 0" }}>
        {item.boardName} · {item.groupTitle} · medical-necessity documents and the visit date are
        on Update Clinicals, which writes the Medical Records status with them.
      </p>
    </>
  );
}

/**
 * The editable half — `/subscription`'s own form and its own send, on a
 * `Patient` read at full width (§5.45b).
 *
 * ⚠️ Local edits live HERE and the parent keys this component on the item, so
 * a draft cannot survive a patient switch — §9's notes-box rule, which this
 * codebase records costing a note filed against the wrong chart.
 */
function SubscriptionEditor({ itemId, canEdit }: { itemId: string; canEdit: boolean }) {
  /* ⚠️ Read for EVERYBODY now, not only for an editor — the read-only half of
     this screen is the same form, inert. It is one item read against the
     board, and the cards above render from the dossier we already hold, so
     nothing is blank while it lands. */
  const { patient, loading, error, reload } = useSubscriptionRecord(itemId, true);
  const [edits, setEdits] = useState<Partial<SubPatient>>({});

  const merged = useMemo(
    () => (patient ? ({ ...patient, ...edits } as SubPatient) : null),
    [patient, edits],
  );
  const validation = useMemo(
    () => (merged ? validatePatientForSend(merged) : { valid: false, errors: [] }),
    [merged],
  );
  const dirty = Object.keys(edits).length > 0;

  const onFieldChange = useCallback((field: keyof SubPatient, value: string | number | null) => {
    setEdits((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSend = useCallback(async () => {
    if (!merged) return;
    // ⚠️ Checked HERE as well as on the button: the button is what a rep sees,
    // this is what stops the write (§5.39h). A typed URL, a stale tab or a
    // revoked ability all reach this line and not that one.
    if (!canEdit) return;
    if (refusePendingNote()) return;
    try {
      await sendPatientToMonday(merged, { requireDone: true });
      toast.success("Sent to Monday");
      confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 } });
      setEdits({});
      await reload();
    } catch (e) {
      if (e instanceof GatewayPendingError) {
        // Durably queued and it WILL run — not a failure, and above all not
        // retryable. The edits stay on screen so nothing looks lost, and the
        // board would still read the OLD values if we re-read now.
        toast.warning("Queued — Monday is still writing this save", {
          description: e.message,
          duration: 15_000,
        });
        return;
      }
      toast.error("Send to Monday failed", {
        description: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }, [merged, canEdit, reload]);

  if (error) {
    return (
      <section className="card pad small">
        <b>Couldn&apos;t read this Subscription record.</b> <span className="muted">{error}</span>
      </section>
    );
  }
  if (!merged) {
    return (
      <section className="card pad small muted">
        {loading ? "Reading the Subscription board…" : "Nothing to show yet."}
      </section>
    );
  }

  return (
    /* ⚠️ NOT a `.card` — `SubscriptionForm` brings its own cards, and wrapping
       them in another one nests a card in a card. This is the bare block the
       /subscription page uses, with Brandon's bar over it. */
    <section className="sub-edit">
      {/* Brandon's `dirty-bar` (mockup line 2200), merged with the Save he also
          keeps in the toggle row — ONE row doing both jobs, because two Saves
          at opposite ends of an 800px form is two affordances to keep in step.
          ⚠️ It sits ABOVE the form on purpose: the form is taller than the
          viewport, so a Save at its foot is below the fold on every patient. */}
      {canEdit ? (
        <div className={`sub-bar${dirty ? " dirty" : ""}`}>
          {dirty && <AlertTriangle className="ico" />}
          <div className="grow">
            {dirty ? (
              <>
                <b>Unsaved changes.</b> Nothing is written to Monday until you press Send.
              </>
            ) : (
              <span className="muted">
                Editable — the same write as the profile page, on the same board.
              </span>
            )}
          </div>
          {dirty && (
            <button type="button" className="btn ghost sm" onClick={() => setEdits({})}>
              <RotateCcw style={{ width: 13, height: 13 }} /> Discard
            </button>
          )}
          <SendToMondayButton
            compact
            onSend={handleSend}
            disabled={!validation.valid}
            validationErrors={validation.errors}
          />
        </div>
      ) : (
        <div className="sub-bar">
          <Eye className="ico" />
          <div className="grow">
            <AbilityLockNote ability="editProfile" />
          </div>
        </div>
      )}

      {/* ⚠️⚠️ `inert` is the read-only guard and it is load-bearing (§5.39c2):
          the wrapper cannot be clicked and focus cannot enter it, so none of
          `SubscriptionForm`'s event handlers can fire. The no-op callback is
          belt and braces — a form nobody can click still should not hold a
          writer. Rendering the real form rather than a second read-only copy
          is what stops the two drifting (§5.31c · §5.31d). */}
      <div
        className={canEdit ? undefined : "sub-ro"}
        {...(canEdit ? {} : { inert: "" as unknown as boolean })}
      >
        <SubscriptionForm patient={merged} onFieldChange={canEdit ? onFieldChange : noop} />
      </div>
    </section>
  );
}

/** A form handed to somebody who may not edit gets a writer that writes
 *  nothing — declared once so it is a stable identity across renders. */
function noop() {}

/**
 * Brandon's `ordersPage`: the **upcoming order**, then the **latest order**,
 * then the history table (§5.46b).
 *
 * Josh, 2026-09-22: *"Order tab should look identical to the redesign view,
 * like: Should show the upcoming order and latest order information on top"*.
 * What shipped was the history table alone, so the answer to the question this
 * tab exists for — *where is my order, and when is the next one* — was a row a
 * rep had to find and read across.
 *
 * ⚠️ **They are two different orders and the card says which.** The upcoming
 * one is the Subscription board's NEXT ORDER DATE — a box that does not exist
 * yet — and the latest is the most recent row on the New Order Board. Merging
 * them into one "current order" card is how a rep tells a patient their next
 * delivery has shipped.
 */
function OrdersTab({
  orders,
  loading,
  error,
  hasPhone,
  overview,
}: {
  orders: Order[] | null;
  loading: boolean;
  error: string;
  hasPhone: boolean;
  /** The Subscription board's own next-order facts, for the upcoming card. */
  overview: OverviewFact[];
}) {
  // ⚠️ A patient with no number on file gets an honest sentence, never an
  // unfiltered board read — that would hand one patient's screen every order in
  // the company (`fetchOrdersForPatient` fails closed for the same reason).
  /* ⚠️ The upcoming card rides on EVERY branch below, the failures included:
     it is read from the Subscription board, which this screen already has in
     hand, so "we could not reach the order board" must not also take away the
     one fact that did not come from it (§9 — a failed read is not an empty
     answer, and it is not an excuse to blank what did load). */
  const upcoming = <UpcomingOrder facts={overview} />;

  // ⚠️ A patient with no number on file gets an honest sentence, never an
  // unfiltered board read — that would hand one patient's screen every order in
  // the company (`fetchOrdersForPatient` fails closed for the same reason).
  if (!hasPhone) {
    return (
      <>
        {upcoming}
        <section className="card pad small muted">
          No phone number on this record, and orders are matched by number — add one on the profile
          page to see this patient&apos;s order history.
        </section>
      </>
    );
  }
  if (error) {
    return (
      <>
        {upcoming}
        <section className="card pad small">
          <b>Couldn&apos;t read the order board.</b> <span className="muted">{error}</span>
        </section>
      </>
    );
  }
  if (loading && !orders) {
    return (
      <>
        {upcoming}
        <section className="card pad small muted">Reading the order board…</section>
      </>
    );
  }
  if (!orders?.length) {
    return (
      <>
        {upcoming}
        <section className="card pad small muted">
          No orders on the order board for this number. The first one is created at Final Profile
          Confirmation.
        </section>
      </>
    );
  }

  // Newest first — "where is my order" means the latest one. Ties keep Monday's
  // own order, which is item id, i.e. the order in which they were created.
  const rows = [...orders].sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""));

  return (
    <>
      {upcoming}
      <LatestOrder order={rows[0]} />
      <section className="card">
      <div className="section-h ordhead">
        <div>
          <b className="small">Order history</b>
          <div className="xs muted">
            {rows.length} order{rows.length === 1 ? "" : "s"} on the order board · newest first ·
            click a row to open it
          </div>
        </div>
      </div>
      <div className="scroll-x">
        <table className="otable">
          <thead>
            <tr>
              <th>Order #</th>
              <th>Created</th>
              <th>Type</th>
              <th>Items</th>
              <th>Status</th>
              <th>Shipped</th>
              <th>Delivered</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o, i) => (
              <OrderRow key={o.id} order={o} latest={i === 0} />
            ))}
          </tbody>
        </table>
      </div>
      </section>
    </>
  );
}

/**
 * Brandon's `upcomingOrder` — the box that has NOT gone out yet.
 *
 * ⚠️ **Every fact here is the Subscription board's**, not the order board's:
 * there is no item for a delivery that has not been created. So it renders
 * even when the order read failed, and it renders "—" rather than borrowing
 * the latest order's date, which would answer a different question.
 */
function UpcomingOrder({ facts }: { facts: OverviewFact[] }) {
  const next = facts.find((f) => f.label === "Next order");
  return (
    <section className="card pad left-teal">
      <div className="section-h" style={{ marginBottom: 10 }}>
        <div className="eyebrow">Upcoming order</div>
        {next?.note && (
          <span className={`chip${next.warn ? " amber" : ""}`}>{next.note}</span>
        )}
      </div>
      <div className="strip">
        {facts
          .filter((f) => f.label !== "First order")
          .map((f) => (
            <div className="fact" key={f.label}>
              <div className="k">{f.label}</div>
              <div className="v">
                {f.value || "—"}
                {f.label !== "Next order" && f.note && (
                  <span className="xs muted" style={{ marginLeft: 6 }}>
                    {f.note}
                  </span>
                )}
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}

/**
 * Brandon's "Latest order" header — the most recent row on the New Order
 * Board, answered in ONE sentence.
 *
 * ⚠️ **`orderHeadline` and `orderStage` are the orders page's own rules, never
 * a second reading of the status columns here** (§5.35): the group is not the
 * stage on that board and the API status is, so a local rule would have this
 * card disagreeing with the page its own button opens.
 *
 * ⚠️ It is a SUMMARY. Everything that acts on an order — placing it, the
 * backorder substitution, the cash-pay link — stays on `/orders`, because each
 * of those writes, and two writers for one column is the failure this codebase
 * keeps recording (§5.31c · §5.31d).
 */
function LatestOrder({ order: o }: { order: Order }) {
  const head = orderHeadline(o);
  const lines = orderLines(o);
  return (
    <section className="card pad">
      <div className="section-h" style={{ marginBottom: 10 }}>
        <div>
          <div className="eyebrow">Latest order</div>
          <b style={{ fontSize: 15 }}>{head.text}</b>
          {head.detail && <div className="xs muted">{head.detail}</div>}
        </div>
        <Link className="btn outline sm" to={`/orders?orderId=${o.id}&from=patient`}>
          Open order <ArrowUpRight style={{ width: 13, height: 13 }} />
        </Link>
      </div>
      <div className="strip">
        <div className="fact">
          <div className="k">Order #</div>
          <div className="v mono">{o.cahOrderNumber || o.poNumber || `#${o.id.slice(-4)}`}</div>
        </div>
        <div className="fact">
          <div className="k">Placed</div>
          <div className="v">{o.orderDate ? fmtDate(o.orderDate) : "—"}</div>
        </div>
        <div className="fact">
          <div className="k">Status</div>
          <div className="v">
            <StagePill stage={orderStage(o)} size="sm" />
          </div>
        </div>
        <div className="fact">
          <div className="k">{o.deliveryDate ? "Delivered" : "Shipped"}</div>
          <div className="v">
            {o.deliveryDate
              ? fmtDate(o.deliveryDate)
              : o.shipDate
                ? fmtDate(o.shipDate)
                : "—"}
            {!o.deliveryDate && o.carrier && (
              <span className="xs muted" style={{ marginLeft: 6 }}>
                {o.carrier}
              </span>
            )}
          </div>
        </div>
      </div>
      {!!lines.length && (
        <p className="xs muted" style={{ margin: "10px 2px 0" }}>
          {lines.map((l) => `${l.quantity} × ${l.product}`).join(", ")}
        </p>
      )}
    </section>
  );
}

function OrderRow({ order: o, latest }: { order: Order; latest: boolean }) {
  // ⚠️ The stage comes from `orderStage`/`StagePill`, the same pair the orders
  // page wears — never a second reading of the status columns here. The group
  // is not the stage on that board and the API status is (§5.35), so a local
  // rule would disagree with the page this row opens.
  const lines = orderLines(o);
  const to = `/orders?orderId=${o.id}&from=patient`;

  return (
    <tr>
      <td className="mono">
        <Link to={to} className="ordlink">
          {o.cahOrderNumber || o.poNumber || `#${o.id.slice(-4)}`}
          {latest && <span className="chip blue latest">latest</span>}
          <ArrowUpRight style={{ width: 12, height: 12 }} />
        </Link>
      </td>
      <td>{o.orderDate ? fmtDate(o.orderDate) : "—"}</td>
      <td>
        {o.orderType || "—"}
        {o.subscriptionType && <div className="xs muted">{o.subscriptionType}</div>}
      </td>
      <td className="items">
        {lines.length
          ? lines.map((l) => `${l.quantity} × ${l.product}`).join(", ")
          : "—"}
      </td>
      <td>
        <StagePill stage={orderStage(o)} size="sm" />
      </td>
      <td>
        {o.shipDate ? fmtDate(o.shipDate) : "—"}
        {o.carrier && (
          <div className="xs muted">
            {o.carrier}
            {o.tracking[0] ? ` · ${o.tracking[0]}` : ""}
          </div>
        )}
      </td>
      <td>{o.deliveryDate ? fmtDate(o.deliveryDate) : "—"}</td>
    </tr>
  );
}
