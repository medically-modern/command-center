/**
 * Every order on the board, sectioned by where it is (`lib/orders/sidebarList`)
 * and searchable by patient name, phone, Cardinal order number, PO number or
 * tracking number — the search is the page's whole reason to exist: a patient
 * calls asking where their order is, and the rep finds it here.
 */
import { useMemo, useState } from "react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, Loader2, Package, RefreshCw, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ContactStateMarks } from "@/components/shared/ContactStateMarks";
import type { Order } from "@/lib/orders/workflow";
import { fmtDateShort, orderFlags, orderStage } from "@/lib/orders/workflow";
import { sidebarSections, type OrderSections } from "@/lib/orders/sidebarList";
import { rowSummary } from "@/lib/orders/rowSummary";
import { STAGE_TONE } from "./tones";

interface Props {
  orders: Order[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  initialLoading: boolean;
  loadedRows: number;
  error: string | null;
  onRefresh: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  showAllDelivered: boolean;
  onShowAllDelivered: () => void;
}

const DOT: Record<string, string> = {
  teal: "bg-[color:var(--mm-green)]",
  slate: "bg-slate-400",
  sky: "bg-sky-500",
  amber: "bg-amber-500",
  emerald: "bg-emerald-500",
  rose: "bg-rose-500",
  violet: "bg-violet-500",
};

export function OrdersSidebar({
  orders, selectedId, onSelect, loading, initialLoading, loadedRows, error, onRefresh,
  query, onQueryChange, showAllDelivered, onShowAllDelivered,
}: Props) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const [openCancelled, setOpenCancelled] = useState(false);

  const sections: OrderSections = useMemo(
    () => sidebarSections(orders, { query, showAllDelivered }),
    [orders, query, showAllDelivered],
  );
  const searching = query.trim().length > 0;
  const total = orders.length;
  const shown = [
    sections.toPlace, sections.onHold, sections.inProgress, sections.shipped, sections.delivered,
    sections.returns, sections.stuck, sections.other, sections.cancelled,
  ].reduce((n, l) => n + l.length, 0);

  const renderRow = (o: Order, dim = false) => {
    const stage = orderStage(o);
    const flags = orderFlags(o);
    const rose = flags.find((f) => f.tone === "rose");
    const amber = flags.find((f) => f.tone === "amber");
    const date = o.deliveryDate || o.shipDate || o.orderDate;
    return (
      <SidebarMenuItem key={o.id}>
        <SidebarMenuButton
          isActive={selectedId === o.id}
          onClick={() => onSelect(o.id)}
          className={cn("flex items-start gap-2 py-2 h-auto", dim && "opacity-70", selectedId === o.id && "bg-sidebar-accent opacity-100")}
          title={flags.map((f) => f.label).join(" · ") || undefined}
        >
          {rose ? (
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-rose-500" />
          ) : (
            <span className={cn("mt-1.5 h-2.5 w-2.5 rounded-full shrink-0", DOT[STAGE_TONE[stage]])} />
          )}
          {!collapsed && (
            <div className="min-w-0 text-left flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium truncate">{o.name}</p>
                {date && <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">{fmtDateShort(date)}</span>}
              </div>
              <p className={cn("text-[11px] truncate", rose ? "text-rose-600" : amber ? "text-amber-700" : "text-muted-foreground")}>
                {rose ? rose.label : amber ? amber.label : rowSummary(o)}
              </p>
            </div>
          )}
          <ContactStateMarks phone={o.phone} />
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  const renderGroup = (label: string, list: Order[], opts: { dim?: boolean; hint?: React.ReactNode; tone?: string } = {}) => {
    if (list.length === 0) return null;
    return (
      <SidebarGroup>
        {!collapsed && (
          <SidebarGroupLabel className={cn("text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5", opts.tone ?? "text-muted-foreground")}>
            {label} ({list.length})
          </SidebarGroupLabel>
        )}
        <SidebarGroupContent>
          <SidebarMenu>{list.map((o) => renderRow(o, opts.dim))}</SidebarMenu>
          {!collapsed && opts.hint}
        </SidebarGroupContent>
      </SidebarGroup>
    );
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Order board</p>
              <p className="text-sm font-semibold truncate">
                {initialLoading ? (
                  <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading{loadedRows ? ` · ${loadedRows.toLocaleString("en-US")} rows` : "…"}</span>
                ) : searching ? (
                  `${shown.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} orders`
                ) : (
                  `Orders (${total.toLocaleString("en-US")})`
                )}
              </p>
            </div>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onRefresh} disabled={loading} title="Refresh from Monday">
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
        {!collapsed && (
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Name, phone, order # or tracking…"
              className="w-full pl-8 pr-8 py-1.5 rounded-md border border-border bg-white text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {query && (
              <button onClick={() => onQueryChange("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" title="Clear">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        {error && !collapsed && (
          <div className="m-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive flex gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {renderGroup("To place", sections.toPlace, { tone: "text-[color:var(--mm-teal)]" })}
        {renderGroup("On hold", sections.onHold)}
        {renderGroup("Placed · in progress", sections.inProgress, { tone: "text-amber-700" })}
        {renderGroup("Shipped", sections.shipped, { tone: "text-sky-700" })}
        {renderGroup(
          "Delivered",
          sections.delivered,
          {
            tone: "text-emerald-700",
            hint: sections.deliveredHidden > 0 ? (
              <button
                onClick={onShowAllDelivered}
                className="mx-2 mt-1 mb-2 text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <ChevronDown className="h-3 w-3" /> Show all {(sections.delivered.length + sections.deliveredHidden).toLocaleString("en-US")} delivered — {sections.deliveredHidden.toLocaleString("en-US")} more
              </button>
            ) : undefined,
          },
        )}
        {renderGroup("Returns", sections.returns, { tone: "text-violet-700" })}
        {renderGroup("Stuck", sections.stuck, { tone: "text-rose-600" })}
        {renderGroup("Other", sections.other)}

        {sections.cancelled.length > 0 && !collapsed && (
          <SidebarGroup>
            <button
              onClick={() => setOpenCancelled((v) => !v)}
              className="w-full text-left px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5 hover:text-foreground"
            >
              {openCancelled ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Cancelled ({sections.cancelled.length})
            </button>
            {openCancelled && (
              <SidebarGroupContent>
                <SidebarMenu>{sections.cancelled.map((o) => renderRow(o, true))}</SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}

        {!loading && !initialLoading && shown === 0 && !error && !collapsed && (
          <p className="px-3 py-4 text-xs text-muted-foreground flex items-center gap-2">
            <Package className="h-3.5 w-3.5" /> {searching ? "No order matches that search." : "No orders on the board."}
          </p>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
