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
 */
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { AlertTriangle, ArrowUpRight, Package, RotateCcw, User } from "lucide-react";
import type { DossierItem } from "@/lib/commsHub/dossier";
import { buildStageDetail, hasStageDetail } from "@/lib/commsHub/stageDetail";
import { mondayItemToOrder } from "@/lib/orders/mondayMapping";
import { fmtDate, orderStage, type Order } from "@/lib/orders/workflow";
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
  // ⚠️ Fetched only while the Orders tab is open — a per-patient board read on a
  // page a rep clicks through is INCIDENT_2026-08-20's shape if it runs on
  // render. The count on the tab therefore appears once they have looked, which
  // is the same trade §5.16 makes for the call log.
  const canEdit = useAbility("editProfile");
  const { orders: raw, loading, error } = usePatientOrders(phone, tab === "orders");
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
        <ProfileTab key={item.itemId} item={item} canEdit={canEdit} />
      ) : (
        <OrdersTab orders={orders} loading={loading} error={error} hasPhone={!!phone} />
      )}
    </>
  );
}

function ProfileTab({ item, canEdit }: { item: DossierItem; canEdit: boolean }) {
  const sections = useMemo(() => buildStageDetail(item.boardId, item.cols), [item]);
  // Brandon leads with a teal "Subscription overview" strip — the facts that
  // answer "when does the next box go out". That is this board's first mapped
  // section, so it wears the strip rather than being restated.
  const [overview, ...rest] = sections;
  // ⚠️ The form OWNS its two sections, so they are not also rendered as cards:
  // one fact editable and the same fact read-only, on one screen, is worse
  // than either alone.
  const cards = canEdit ? rest.filter((sc) => !FORM_SECTIONS.includes(sc.title)) : rest;

  return (
    <>
      {sections.length === 0 && (
        <div className="card pad small muted">
          {hasStageDetail(item.boardId)
            ? "Nothing has been filled in on this board yet."
            : "No read-only view is mapped for this board — open it on Monday."}
        </div>
      )}

      {overview && (
        <section className="card pad left-teal">
          <div className="eyebrow" style={{ marginBottom: 10 }}>
            {overview.title}
          </div>
          <div className="strip">
            {overview.fields.map((f) => (
              <div className="fact" key={f.col}>
                <div className="k">{f.label}</div>
                <div className="v">{f.value}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {canEdit && <SubscriptionEditor itemId={item.itemId} />}

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

      <section className="card pad">
        <div className="row wrap" style={{ gap: 8 }}>
          <Link className="btn outline sm" to={`/subscription?patientId=${item.itemId}&from=patient`}>
            Open the profile <ArrowUpRight style={{ width: 13, height: 13 }} />
          </Link>
          <Link className="btn outline sm" to={`/update-clinicals?patientId=${item.itemId}&from=patient`}>
            Update clinicals <ArrowUpRight style={{ width: 13, height: 13 }} />
          </Link>
          <span className="xs muted">
            {item.boardName} · {item.groupTitle}
          </span>
        </div>
        <p className="xs muted" style={{ marginTop: 10, marginBottom: 0 }}>
          {canEdit
            ? "MN documents and the visit date are still on their own pages — each has side effects this card does not carry."
            : "Both open their existing pages, so there is exactly one place that writes these columns."}
        </p>
      </section>
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
function SubscriptionEditor({ itemId }: { itemId: string }) {
  const canEdit = useAbility("editProfile");
  const { patient, loading, error, reload } = useSubscriptionRecord(itemId, canEdit);
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
        {loading ? "Reading the Subscription board…" : "Nothing to edit yet."}
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

      <SubscriptionForm patient={merged} onFieldChange={onFieldChange} />
    </section>
  );
}

/** Brandon's `ordersPage` history table, minus the selected-order card above it
 *  — that card is the /orders page, which a row opens. */
function OrdersTab({
  orders,
  loading,
  error,
  hasPhone,
}: {
  orders: Order[] | null;
  loading: boolean;
  error: string;
  hasPhone: boolean;
}) {
  // ⚠️ A patient with no number on file gets an honest sentence, never an
  // unfiltered board read — that would hand one patient's screen every order in
  // the company (`fetchOrdersForPatient` fails closed for the same reason).
  if (!hasPhone) {
    return (
      <section className="card pad small muted">
        No phone number on this record, and orders are matched by number — add one on the profile
        page to see this patient&apos;s order history.
      </section>
    );
  }
  if (error) {
    return (
      <section className="card pad small">
        <b>Couldn&apos;t read the order board.</b> <span className="muted">{error}</span>
      </section>
    );
  }
  if (loading && !orders) {
    return <section className="card pad small muted">Reading the order board…</section>;
  }
  if (!orders?.length) {
    return (
      <section className="card pad small muted">
        No orders on the order board for this number. The first one is created at Final Profile
        Confirmation.
      </section>
    );
  }

  // Newest first — "where is my order" means the latest one. Ties keep Monday's
  // own order, which is item id, i.e. the order in which they were created.
  const rows = [...orders].sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""));

  return (
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
