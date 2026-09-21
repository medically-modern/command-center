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
 * ⚠️⚠️ **READ-ONLY, and that is a DEPARTURE from the mockup taken on purpose.**
 * Brandon's version carries Save / Reset and edits the Subscription columns in
 * place. This screen's founding promise is that it is purely additive and
 * writes nothing (§5.39, pinned by `patientScreen.test.ts`), and two writers
 * for one column is what this codebase records going wrong again and again —
 * the Secondary Insurance select leaving `PatientInfoCard` (§5.31c), the phone
 * editor leaving the Welcome Call banner (§5.31d). The mockup itself renders
 * "Read-only for <name>" whenever `editProfile` is off, so this is its own
 * read-only state shown to everyone; **Open the profile** is the one door that
 * writes, and it opens the tool that already owns those columns.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Eye, Package, User } from "lucide-react";
import type { DossierItem } from "@/lib/commsHub/dossier";
import { buildStageDetail, hasStageDetail } from "@/lib/commsHub/stageDetail";
import { mondayItemToOrder } from "@/lib/orders/mondayMapping";
import { fmtDate, orderStage, type Order } from "@/lib/orders/workflow";
import { orderLines } from "@/lib/orders/skuJoin";
import { StagePill } from "@/components/orders/pills";
import { usePatientOrders } from "@/hooks/patient/usePatientOrders";

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
        {/* The mockup shows Save / Reset here for somebody with `editProfile`,
            and this sentence for everybody else. Here it is always this one. */}
        <span className="xs muted row" style={{ gap: 5 }}>
          <Eye style={{ width: 12, height: 12 }} /> Read-only — edits happen on the profile page
        </span>
      </div>

      {tab === "profile" ? (
        <ProfileTab item={item} />
      ) : (
        <OrdersTab orders={orders} loading={loading} error={error} hasPhone={!!phone} />
      )}
    </>
  );
}

function ProfileTab({ item }: { item: DossierItem }) {
  const sections = useMemo(() => buildStageDetail(item.boardId, item.cols), [item]);
  // Brandon leads with a teal "Subscription overview" strip — the facts that
  // answer "when does the next box go out". That is this board's first mapped
  // section, so it wears the strip rather than being restated.
  const [overview, ...rest] = sections;

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

      {rest.map((s) => (
        <section className="card snapcard" key={s.title}>
          <div className="snap-ct">{s.title}</div>
          <div className="rogrid">
            {s.fields.map((f) => (
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
          Both open their existing pages, so there is exactly one place that writes these columns.
        </p>
      </section>
    </>
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
