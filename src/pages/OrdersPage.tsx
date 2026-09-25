/**
 * Orders — the order board and the Cardinal SKU Tracker in one place.
 *
 * READ-ONLY (Josh, 2026-09-15): reps observe orders here and still place them
 * on the board. The one write this role knows how to make sits dark behind
 * `lib/orders/config.ts` (see that file before flipping it). What the page is
 * FOR is the phone call: a patient asks where their order is, the rep types
 * the name and reads ONE sentence. So the page is a single column read top to
 * bottom — the answer, the path, the tracking button, what was ordered, the
 * notes — and everything else on the item is folded under "Full order
 * details". Landing with nothing selected is deliberate: the landing IS the
 * search, and there is no "first patient" to auto-open on a board of 1,480
 * orders.
 *
 * Two views on one header toggle: Orders (the list + an open order) and
 * Inventory (the Cardinal SKU Tracker, §5.39h — the global header's
 * Inventory tab lands here). `?orderId=` deep-links an order; `?view=stock`
 * opens the tracker, and that param keeps its name so every existing link
 * still works.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, Boxes, Loader2, PackageSearch, RefreshCw } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { useOrders } from "@/hooks/orders/useOrders";
import { refreshSkuTracker, skuTrackerLastRun, useSkuTracker } from "@/hooks/orders/useSkuTracker";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { StaleDataNotice } from "@/components/shared/StaleDataNotice";
import { ReportIssueButton } from "@/components/shared/ReportIssueButton";
import { OrdersSidebar } from "@/components/orders/OrdersSidebar";
import { OrderHeaderCard } from "@/components/orders/OrderHeaderCard";
import { OrderLinesCard } from "@/components/orders/OrderLinesCard";
import { CashPayCard } from "@/components/orders/CashPayCard";
import { SubstitutionCard } from "@/components/orders/SubstitutionCard";
import { NotesCard } from "@/components/orders/PatientCoverageCard";
import { OrderDetails } from "@/components/orders/OrderDetails";
import { OrdersOverview } from "@/components/orders/OrdersOverview";
import { SkuTrackerView } from "@/components/orders/SkuTrackerView";
import { AbilityGate } from "@/components/shell/AbilityGate";
import { useAccessContext } from "@/components/AccessProvider";
import { hasAbility } from "@/lib/shell/abilities";

type View = "orders" | "stock";

/**
 * ⚠️ The ORDERS tab is hidden from the view switcher (Josh, 2026-09-25:
 * *"comment out 'orders' tab from inventory for now, we will work on this in
 * the future"*) — the `SHOW_CHASE_COLUMN` convention, one flip to bring it
 * back. Only the TAB is off: the orders VIEW itself still renders for every
 * door that lands on it directly — the role tile, `?orderId=` deep links, the
 * patient screen's "Open on Orders", System Search — and selecting an order
 * from Inventory's search still switches to it (`select`).
 */
const SHOW_ORDERS_TAB = false;

const OrdersPage = () => {
  const { goBack } = useBackNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkId = searchParams.get("orderId") ?? searchParams.get("patientId");
  const view: View = searchParams.get("view") === "stock" ? "stock" : "orders";
  // ⚠️ The SIGNED-IN person, never a borrowed one (§5.39g): this decides what I
  // may DO, and borrowing somebody's view must not hand me their buttons.
  const { email: myEmail, config: accessConfig } = useAccessContext();
  const canAdjustOrders = hasAbility(myEmail, accessConfig, "adjustOrders");

  const {
    orders, loading, initialLoading, loadedRows, error, refetch,
    detail, detailLoading, detailError, detailGone, loadDetail,
  } = useOrders(deepLinkId);
  const sku = useSkuTracker();
  const skuLastRun = useMemo(() => skuTrackerLastRun(sku.rows), [sku.rows]);

  const [selectedId, setSelectedId] = useState<string | null>(deepLinkId);
  const [query, setQuery] = useState("");
  const [showAllDelivered, setShowAllDelivered] = useState(false);

  // The open order follows the selection; the detail read is what renders.
  useEffect(() => {
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const setView = useCallback(
    (v: View) => {
      const next = new URLSearchParams(searchParams);
      if (v === "stock") next.set("view", "stock");
      else next.delete("view");
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (view === "stock") setView("orders");
    },
    [view, setView],
  );

  const selectedRow = useMemo(() => orders.find((o) => o.id === selectedId) ?? null, [orders, selectedId]);
  const open = detail && detail.id === selectedId ? detail : null;

  return (
    <SidebarProvider>
      {/* ⚠️⚠️ **SCOPED TO THE ORDERS VIEW — on Inventory it blocked the whole
          page for a read that view barely uses** (Josh, 2026-09-22: *"i'll
          accidentally press it, and then i'm stuck and have to wait 15 seconds
          before i can do anything or click anywhere else"*). This overlay is
          `fixed inset-0` and captures pointer events, and `initialLoading` is
          the ORDER BOARD's first read — ~1,500 rows over three sequential
          pages. Inventory reads the SKU tracker, which has its own loading
          state inside the table; all it wants from the orders list is the
          open-order count per SKU, which fills in when it lands (the column
          says "—" until then rather than a false 0).
          ⚠️ The orders view keeps it: there the stale previous list IS on
          screen behind it, which is what the overlay exists to stop a rep
          clicking.
          ⚠️⚠️ **AND ONLY WITH NOTHING SELECTED** (Josh, 2026-09-23: *"this
          takes 14 seconds to load and i can see it has the patient info via
          hyper link"*). A rep arriving on `?orderId=` came for ONE order, and
          that read is ONE item — it lands in about a second, while the list
          behind it is ~1,480 rows over three sequential pages. The order was
          therefore fully rendered and then covered by this overlay for another
          thirteen seconds, which is exactly what his screenshot shows. There
          is no stale list to protect a rep from here: the order on screen is
          the freshly-read one, and the sidebar and the header chip both say
          the list is still arriving. The landing keeps the overlay, because
          the overview's counts really do need the whole board (`fetchOrders`
          throws rather than return a partial list for the same reason). */}
      <PageLoadingOverlay show={view === "orders" && initialLoading && !selectedId} label="Loading orders…" />
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        {/* ⚠️ The order sidebar is the ORDERS view's search, and on Inventory
            it is a list of things this screen cannot open — Brandon's
            Inventory is a page of its own, and the tab beside the title is
            one click back to the orders list, sidebar and all. */}
        {view === "orders" && (
          <OrdersSidebar
            orders={orders}
            selectedId={selectedId}
            onSelect={select}
            loading={loading}
            initialLoading={initialLoading}
            loadedRows={loadedRows}
            error={error}
            onRefresh={() => void refetch(false)}
            query={query}
            onQueryChange={setQuery}
            showAllDelivered={showAllDelivered}
            onShowAllDelivered={() => setShowAllDelivered(true)}
          />
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border">
            <div className="px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                {view === "orders" && <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />}
                <button onClick={() => goBack()} className="p-1.5 rounded-md hover:bg-white/10 transition-colors" title="Back">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                  <PackageSearch className="h-5 w-5 text-primary-foreground" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern</p>
                  <h1 className="text-2xl font-bold">{view === "stock" ? "Inventory" : "Orders"}</h1>
                  {view === "orders" && (selectedRow || open) && (
                    <p className="text-sm opacity-80 mt-0.5 truncate">{(open ?? selectedRow)?.name}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* ⚠️ The order list is ~1,480 rows over three sequential pages
                    at Monday's 500 cap — cursor pagination, so the pages
                    cannot run in parallel and this is simply slow (Josh,
                    2026-09-23: *"show a loading icon in upper right until it's
                    all there"*). With the overlay gone from the deep-link path
                    this chip is the only thing saying the sidebar, the
                    siblings strip and Inventory's open-order counts are still
                    filling in. It carries the row count, because "loading" on
                    its own does not say whether anything is left. */}
                {(initialLoading || loading) && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2.5 py-1.5 text-xs font-semibold"
                    role="status"
                    aria-live="polite"
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {loadedRows ? `Loading orders… ${loadedRows.toLocaleString()}` : "Loading orders…"}
                  </span>
                )}
                <div className="inline-flex rounded-lg bg-white/10 p-0.5" role="tablist" aria-label="View">
                  {(SHOW_ORDERS_TAB || view === "orders") && (
                    <ViewTab active={view === "orders"} onClick={() => setView("orders")} icon={<PackageSearch className="h-3.5 w-3.5" />} label="Orders" />
                  )}
                  <ViewTab active={view === "stock"} onClick={() => setView("stock")} icon={<Boxes className="h-3.5 w-3.5" />} label="Inventory" />
                </div>
                <Button onClick={() => void refetch(false)} disabled={loading} className="gap-2 bg-white text-navy hover:bg-white/90 shadow-elevate">
                  <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
                </Button>
                <ReportIssueButton />
              </div>
            </div>
          </header>
          <StaleDataNotice
            error={error}
            scope="The order list"
            onRetry={() => void refetch(false)}
            retrying={loading}
            className="mx-3 sm:mx-6 mt-3"
          />
          {view === "orders" && selectedId && (
            <StaleDataNotice
              error={detailError}
              scope="The open order"
              onRetry={() => { loadDetail(null); loadDetail(selectedId); }}
              retrying={detailLoading}
              className="mx-3 sm:mx-6 mt-3"
            />
          )}

          <main className="flex-1 px-6 py-6 overflow-y-auto">
            {/* One column, read top to bottom, for the order view; the stock
                table earns its width. */}
            <section className={cn("mx-auto space-y-4", view === "stock" ? "max-w-full" : "max-w-4xl")}>
              {view === "stock" ? (
                // ⚠️ Inventory is an ASSIGNED page (§5.39g), and the wall has to
                // be here rather than on the route: `/orders` also serves the
                // order list, which is a different feature with its own role.
                <AbilityGate ability="inventory">
                <SkuTrackerView
                  rows={sku.rows}
                  loading={sku.loading}
                  error={sku.error}
                  lastRun={skuLastRun}
                  orders={orders}
                  ordersLoading={initialLoading}
                  onRefresh={() => void refreshSkuTracker(true)}
                />
                </AbilityGate>
              ) : !selectedId ? (
                <OrdersOverview
                  orders={orders}
                  skuRows={sku.rows}
                  onSelect={select}
                  onShowStock={() => setView("stock")}
                  loading={loading}
                  query={query}
                  onQueryChange={setQuery}
                />
              ) : detailGone ? (
                <Card className="p-10 text-center space-y-2">
                  <p className="text-base font-semibold">This order is no longer on the board.</p>
                  <p className="text-sm text-muted-foreground">It was deleted from Monday since the list last loaded.</p>
                  <Button variant="outline" size="sm" onClick={() => setSelectedId(null)}>Back to search</Button>
                </Card>
              ) : !open ? (
                <Card className="p-10 text-center">
                  <p className="text-sm text-muted-foreground inline-flex items-center gap-2">
                    {detailLoading || !detailError ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {detailError ? "Couldn't load this order — retry above." : `Loading ${selectedRow?.name ?? "the order"}…`}
                  </p>
                </Card>
              ) : (
                <>
                  <OrderHeaderCard order={open} allOrders={orders} ordersLoaded={!initialLoading} onSelect={select} onPlaced={() => void refetch(true)} />
                  <OrderLinesCard order={open} skuRows={sku.rows} />
                  {/* ⚠️ Both cards key on the ORDER so their per-order state
                      cannot survive a sidebar click (§9's notes-box rule) — and
                      the keys are PREFIXED because they are siblings: two
                      children of one parent carrying `key={open.id}` collide,
                      and React warns that such children "may be duplicated
                      and/or omitted". Found by rendering the page, not by
                      reading it (§5.30d).
                      ⚠️ Renders for CASH PAY orders only (it returns null
                      otherwise), and is deliberately NOT ability-gated — Josh,
                      2026-09-21: "No gate — any rep". Reading a patient their
                      total is the job; the manager-only control inside it is
                      the release, which is a different question. It sits under
                      "What was ordered" so the products are named once and
                      priced immediately below (§5.35's say-it-once rule). */}
                  <CashPayCard key={`cash-${open.id}`} order={open} skuRows={sku.rows} onChanged={() => void refetch(true)} />
                  {/* ⚠️ The substitution pick IS the send — it emails Cardinal
                      (§5.35) — so `adjustOrders` gates the card rather than
                      greying the button: a Send that refuses after the press
                      would be a control with no passing move. Without the
                      ability the order still reads in full; only the change is
                      withheld, which is the abilities rule (§5.39c: they unlock
                      buttons, they never hide information). */}
                  {canAdjustOrders && (
                    <SubstitutionCard key={`sub-${open.id}`} order={open} skuRows={sku.rows} onSent={() => void refetch(true)} />
                  )}
                  <NotesCard order={open} />
                  <OrderDetails order={open} />
                </>
              )}
            </section>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

function ViewTab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
        active ? "bg-white text-navy shadow-sm" : "text-navy-foreground/80 hover:bg-white/10",
      )}
    >
      {icon} {label}
    </button>
  );
}

export default OrdersPage;
