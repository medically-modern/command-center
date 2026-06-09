import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Ban, CalendarCheck, ChevronRight, Clock, FolderClock, Loader2, RefreshCw, User, AlertCircle, Undo2 } from "lucide-react";
import type { Patient } from "@/lib/masheke/workflow";
import type { TabKey } from "@/hooks/masheke/useMondayPatients";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { clearStatusColumn, clearDateColumn, COL } from "@/lib/masheke/mondayApi";

/** Convert YYYY-MM-DD → MM/DD/YYYY */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

const TAB_LABELS: Record<TabKey, string> = {
  evaluate: "Evaluate MN",
  sendRequest: "Send Request",
  confirmReceipt: "Confirm Receipt",
  chase: "Chase",
};


function PatientRow({
  patient,
  isActive,
  collapsed,
  onSelect,
}: {
  patient: Patient;
  isActive: boolean;
  collapsed: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        onClick={() => onSelect(patient.id)}
        className={cn(
          "flex items-start gap-2 py-2 h-auto",
          isActive && "bg-sidebar-accent",
        )}
      >
        <User className="h-4 w-4 mt-0.5 shrink-0" />
        {!collapsed && (
          <div className="min-w-0 text-left">
            <p className="text-sm font-medium truncate">{patient.name}</p>
            <p className="text-[11px] text-muted-foreground truncate">
              {patient.serving || "—"} · {patient.daysSinceStageStart || "—"}
            </p>
          </div>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

interface Props {
  patients: Patient[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  activeTab: TabKey;
}

export function PatientsSidebar({ patients, selectedId, onSelect, loading, error, onRefresh, activeTab }: Props) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  const [todayOnly, setTodayOnly] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  // const [filteredOpen, setFilteredOpen] = useState(false);

  // -- Blocked / Stuck / Follow-up filtering commented out for now --
  // const stuckPatients = patients.filter((p) => p.advancer2c === "Stuck" && p.blocked !== "Blocked");
  // const blockedPatients = patients.filter((p) => p.blocked === "Blocked");
  // const followUpPatients = patients.filter((p) => p.followUp === "Follow up" && p.blocked !== "Blocked" && p.escalation !== "Escalation Required" && p.advancer2c !== "Stuck");
  // const bothPatients = patients.filter((p) => p.escalation === "Escalation Required" && p.followUp === "Follow up" && p.blocked !== "Blocked" && p.advancer2c !== "Stuck");

  // Escalated patients are hidden from the active view (accessible via System Management)
  const activePatients = patients.filter((p) => p.escalation !== "Escalation Required");

  // Always use Eastern Time so all users see the same "today" regardless of their local timezone
  const etParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const todayStr = etParts; // "YYYY-MM-DD" in ET

  // For confirm-receipt and chase tabs: patients with a future nextActionDate go to Pending
  const hasPending = activeTab === "confirmReceipt" || activeTab === "chase";
  const pendingPatients = hasPending
    ? activePatients.filter((p) => {
        const nad = p.nextActionDate?.slice(0, 10);
        return nad && nad > todayStr;
      })
    : [];
  const activeNowPatients = hasPending
    ? activePatients.filter((p) => {
        const nad = p.nextActionDate?.slice(0, 10);
        return !nad || nad <= todayStr;
      })
    : activePatients;

  // For chase tab: split into "action today" vs rest
  const todayPatients = activeTab === "chase" && todayOnly
    ? activeNowPatients.filter((p) => p.nextActionDate?.slice(0, 10) === todayStr)
    : activeNowPatients;

  const activeLabel = TAB_LABELS[activeTab];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Monday · {activeLabel}</p>
              <p className="text-sm font-semibold truncate">Patients ({patients.length})</p>
            </div>
          )}
          <div className="flex items-center gap-1 shrink-0">
            {activeTab === "chase" && !collapsed && (
              <Button
                variant={todayOnly ? "default" : "ghost"}
                size="icon"
                className={cn("h-7 w-7", todayOnly && "bg-emerald-600 hover:bg-emerald-700 text-white")}
                onClick={() => setTodayOnly((v) => !v)}
                title={todayOnly ? "Showing today's actions — click to show all" : "Filter to today's action dates"}
              >
                <CalendarCheck className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onRefresh}
              disabled={loading}
              title="Refresh from Monday"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </div>

      </SidebarHeader>

      <SidebarContent>
        {error && !collapsed && (
          <div className="m-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive flex gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {/* ── Active patients (flat list, same for all tabs) ── */}
        <SidebarGroup>
            {activeTab === "chase" && todayOnly && !collapsed && (
              <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-emerald-600 font-semibold">
                Action Today ({todayPatients.length})
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {todayPatients.map((p) => (
                  <PatientRow
                    key={p.id}
                    patient={p}
                    isActive={selectedId === p.id}
                    collapsed={collapsed}
                    onSelect={onSelect}
                  />
                ))}
                {!loading && todayPatients.length === 0 && !error && !collapsed && (
                  <p className="px-3 py-4 text-xs text-muted-foreground">
                    {todayOnly ? "No patients with action date today." : `No patients in ${activeLabel}.`}
                  </p>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

        {/* ── Pending section — hidden from role view, functional via System Management ──
        {pendingPatients.length > 0 && !collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel
              className="text-[10px] uppercase tracking-wider text-violet-500 font-semibold flex items-center gap-1.5 cursor-pointer select-none"
              onClick={() => setPendingOpen((v) => !v)}
            >
              <FolderClock className="h-3 w-3" />
              Pending ({pendingPatients.length})
              <ChevronRight className={cn("h-3 w-3 ml-auto transition-transform", pendingOpen && "rotate-90")} />
            </SidebarGroupLabel>
            {pendingOpen && (
              <SidebarGroupContent>
                <SidebarMenu>
                  {pendingPatients.map((p) => (
                    <SidebarMenuItem key={p.id}>
                      <SidebarMenuButton
                        isActive={selectedId === p.id}
                        onClick={() => onSelect(p.id)}
                        className={cn(
                          "flex items-start gap-2 py-2 h-auto opacity-60",
                          selectedId === p.id && "bg-sidebar-accent opacity-100",
                        )}
                      >
                        <FolderClock className="h-4 w-4 mt-0.5 shrink-0 text-violet-400" />
                        <div className="min-w-0 text-left">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-[11px] text-violet-400 truncate">
                            Next: {p.nextActionDate ? fmtDate(p.nextActionDate) : "—"}
                            {p.mnAttempts ? ` · ${p.mnAttempts}` : ""}
                          </p>
                        </div>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            )}
          </SidebarGroup>
        )}
        */}

        {/* ── Filtered patients (Blocked/Stuck/Escalated/FollowUp) — commented out for now ──
        {(() => {
          const allFiltered = [
            ...blockedPatients.map((p) => ({ p, tag: `Blocked · ${p.blockedDate ? fmtDate(p.blockedDate) : "—"}`, tagColor: "text-red-400", icon: Ban, action: (id: string, name: string) => <UnblockButton patientId={id} patientName={name} onSuccess={onRefresh} /> })),
            ...stuckPatients.map((p) => ({ p, tag: "Stuck", tagColor: "text-amber-400", icon: AlertTriangle, action: (id: string, name: string) => <UnstuckButton patientId={id} patientName={name} onSuccess={onRefresh} /> })),
            ...escalatedPatients.map((p) => ({ p, tag: "Escalated", tagColor: "text-red-400", icon: AlertTriangle, action: (id: string, name: string) => <ClearEscalationButton patientId={id} patientName={name} onSuccess={onRefresh} /> })),
            ...followUpPatients.map((p) => ({ p, tag: `Follow Up · ${p.followUpDate ? fmtDate(p.followUpDate) : "—"}`, tagColor: "text-blue-400", icon: Clock, action: (id: string, name: string) => <ClearFollowUpButton patientId={id} patientName={name} onSuccess={onRefresh} /> })),
            ...bothPatients.map((p) => ({ p, tag: `Escalated · Follow Up ${p.followUpDate ? fmtDate(p.followUpDate) : ""}`, tagColor: "text-amber-400", icon: AlertTriangle, action: (id: string, name: string) => <ClearFollowUpButton patientId={id} patientName={name} onSuccess={onRefresh} /> })),
          ];
          if (allFiltered.length === 0 || collapsed) return null;
          return (
            <SidebarGroup>
              <SidebarGroupLabel
                className="text-[10px] uppercase tracking-wider text-orange-500 font-semibold flex items-center gap-1.5 cursor-pointer select-none"
                onClick={() => setFilteredOpen((v) => !v)}
              >
                <Ban className="h-3 w-3" />
                Filtered ({allFiltered.length})
                <ChevronRight className={cn("h-3 w-3 ml-auto transition-transform", filteredOpen && "rotate-90")} />
              </SidebarGroupLabel>
              {filteredOpen && (
                <SidebarGroupContent>
                  <SidebarMenu>
                    {allFiltered.map(({ p, tag, tagColor, icon: Icon, action }) => (
                      <SidebarMenuItem key={p.id}>
                        <div className="flex items-center gap-1 w-full">
                          <SidebarMenuButton
                            isActive={selectedId === p.id}
                            onClick={() => onSelect(p.id)}
                            className={cn(
                              "flex-1 flex items-start gap-2 py-2 h-auto opacity-60",
                              selectedId === p.id && "bg-sidebar-accent opacity-100",
                            )}
                          >
                            <Icon className={cn("h-4 w-4 mt-0.5 shrink-0", tagColor)} />
                            <div className="min-w-0 text-left">
                              <p className="text-sm font-medium truncate">{p.name}</p>
                              <p className={cn("text-[11px] truncate", tagColor)}>{tag}</p>
                            </div>
                          </SidebarMenuButton>
                          {action(p.id, p.name)}
                        </div>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              )}
            </SidebarGroup>
          );
        })()}
        */}
      </SidebarContent>

    </Sidebar>
  );
}


/** Small button to clear Blocked status + date on Monday */
function UnblockButton({ patientId, patientName, onSuccess }: { patientId: string; patientName: string; onSuccess: () => void }) {
  const [sending, setSending] = useState(false);

  const handleUnblock = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSending(true);
    try {
      await Promise.all([
        clearStatusColumn(patientId, COL.blocked),
        clearStatusColumn(patientId, COL.blockedDate),
      ]);
      toast.success(`${patientName} unblocked`);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to unblock: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      onClick={handleUnblock}
      disabled={sending}
      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
      title={`Unblock ${patientName}`}
    >
      {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
      Un-Block
    </button>
  );
}


/** Small button to clear Stuck status (Advancer 2C) on Monday */
function UnstuckButton({ patientId, patientName, onSuccess }: { patientId: string; patientName: string; onSuccess: () => void }) {
  const [sending, setSending] = useState(false);

  const handleUnstuck = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSending(true);
    try {
      await clearStatusColumn(patientId, COL.advancer2c);
      toast.success(`${patientName} returned to active`);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to unstick: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      onClick={handleUnstuck}
      disabled={sending}
      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors disabled:opacity-50"
      title={`Unstick ${patientName}`}
    >
      {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
      Unstick
    </button>
  );
}


/** Small button to clear Follow Up status + date on Monday */
function ClearFollowUpButton({ patientId, patientName, onSuccess }: { patientId: string; patientName: string; onSuccess: () => void }) {
  const [sending, setSending] = useState(false);

  const handleClear = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSending(true);
    try {
      await Promise.all([
        clearStatusColumn(patientId, COL.followUp),
        clearDateColumn(patientId, COL.followUpDate),
      ]);
      toast.success(`${patientName} returned to active`);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to clear follow up: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      onClick={handleClear}
      disabled={sending}
      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors disabled:opacity-50"
      title={`Clear follow up for ${patientName}`}
    >
      {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
      Active
    </button>
  );
}


/** Small button to clear Escalation status on Monday */
function ClearEscalationButton({ patientId, patientName, onSuccess }: { patientId: string; patientName: string; onSuccess: () => void }) {
  const [sending, setSending] = useState(false);

  const handleClear = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setSending(true);
    try {
      await clearStatusColumn(patientId, COL.escalation);
      toast.success(`${patientName} returned to active`);
      onSuccess();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to clear escalation: ${msg}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <button
      onClick={handleClear}
      disabled={sending}
      className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 transition-colors disabled:opacity-50"
      title={`Clear escalation for ${patientName}`}
    >
      {sending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
      Active
    </button>
  );
}
