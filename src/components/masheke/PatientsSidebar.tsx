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
import { AlertTriangle, Ban, ChevronRight, Clock, FolderClock, Loader2, RefreshCw, User, AlertCircle, Undo2 } from "lucide-react";
import type { Patient } from "@/lib/masheke/workflow";
import type { TabKey } from "@/hooks/masheke/useMondayPatients";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { clearStatusColumn, clearDateColumn, COL } from "@/lib/masheke/mondayApi";
import { useSearchParams } from "react-router-dom";
import { viewFilterFromParams } from "@/lib/roleView";

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
  overdue,
}: {
  patient: Patient;
  isActive: boolean;
  collapsed: boolean;
  onSelect: (id: string) => void;
  /** Show a red dot next to the name when the next-action date is past due */
  overdue?: boolean;
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
        <div className="relative shrink-0">
          <User className="h-4 w-4 mt-0.5" />
          {overdue && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500" />
          )}
        </div>
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
  /** Manager view (?manager=1): list ONLY escalated patients, no scheduled split. */
  managerMode?: boolean;
}

export function PatientsSidebar({ patients, selectedId, onSelect, loading, error, onRefresh, activeTab }: Props) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  // 3-way filter from the URL (?manager=1 = escalated, ?filter=all = all, else
  // non-escalated). In "all" the sidebar splits non-escalated vs escalated.
  const [sp] = useSearchParams();
  const viewFilter = viewFilterFromParams(sp);
  const escalatedOnly = viewFilter === "escalated";
  const splitAll = viewFilter === "all";

  const [showScheduled, setShowScheduled] = useState(false);
  // const [filteredOpen, setFilteredOpen] = useState(false);

  // ── Scheduled patients folder DISABLED on all roles for now ──
  // The filter button (FolderClock, sidebar header) and the Scheduled list
  // are hidden. Future-dated patients remain filtered OUT of the active list
  // (the date split below still applies) — they're just not browsable here.
  // Set to false (or per-tab) to restore the old behavior.
  const hideScheduledFolder = true;
  const scheduledOpen = showScheduled && !hideScheduledFolder;

  // -- Blocked / Stuck / Follow-up filtering commented out for now --
  // const stuckPatients = patients.filter((p) => p.advancer2c === "Stuck" && p.blocked !== "Blocked");
  // const blockedPatients = patients.filter((p) => p.blocked === "Blocked");
  // const followUpPatients = patients.filter((p) => p.followUp === "Follow up" && p.blocked !== "Blocked" && p.escalation !== "Escalation Required" && p.advancer2c !== "Stuck");
  // const bothPatients = patients.filter((p) => p.escalation === "Escalation Required" && p.followUp === "Follow up" && p.blocked !== "Blocked" && p.advancer2c !== "Stuck");

  // Always use Eastern Time so all users see the same "today".
  const etParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const todayStr = etParts; // "YYYY-MM-DD" in ET

  const isEsc = (p: Patient) => p.escalation === "Escalation Required";
  const escalatedList = patients.filter(isEsc);

  // Non-escalated active list keeps the Next-Action-Date scheduling split
  // (future-dated → scheduled folder). Escalated patients always show, no split.
  const nonEsc = patients.filter((p) => !isEsc(p));
  const pendingPatients = nonEsc.filter((p) => {
    const nad = p.nextActionDate?.slice(0, 10);
    return nad && nad > todayStr;
  });
  const nonEscNow = nonEsc.filter((p) => {
    const nad = p.nextActionDate?.slice(0, 10);
    return !nad || nad <= todayStr;
  });
  const hasPending = !escalatedOnly;

  // Main list: escalated-only → the escalated list; otherwise the
  // non-escalated active list. In "all" the escalated list renders below it.
  const mainList = escalatedOnly ? escalatedList : nonEscNow;

  const activeLabel = TAB_LABELS[activeTab];

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Monday · {activeLabel}</p>
              <p className={cn("text-sm font-semibold truncate", escalatedOnly && "text-red-500")}>
                {escalatedOnly
                  ? `Escalated (${mainList.length})`
                  : splitAll
                    ? `Non-escalated (${mainList.length})`
                    : `Patients (${mainList.length})`}
              </p>
            </div>
          )}
          <div className="flex items-center gap-1 shrink-0">
            {hasPending && pendingPatients.length > 0 && !collapsed && !hideScheduledFolder && (
              <Button
                variant={showScheduled ? "default" : "ghost"}
                size="icon"
                className={cn("h-7 w-7", showScheduled && "bg-violet-600 hover:bg-violet-700 text-white")}
                onClick={() => setShowScheduled((v) => !v)}
                title={showScheduled ? "Hide scheduled patients" : `Show scheduled patients (${pendingPatients.length})`}
              >
                <FolderClock className="h-4 w-4" />
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

        {/* ── Toggle: Active patients OR Scheduled patients ── */}
        {!scheduledOpen ? (
          <>
          <SidebarGroup>
            {splitAll && (
              <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Non-escalated patients
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {mainList.map((p) => {
                  const nad = p.nextActionDate?.slice(0, 10);
                  const isOverdue = hasPending && !!nad && nad < todayStr;
                  return (
                    <PatientRow
                      key={p.id}
                      patient={p}
                      isActive={selectedId === p.id}
                      collapsed={collapsed}
                      onSelect={onSelect}
                      overdue={isOverdue}
                    />
                  );
                })}
                {!loading && mainList.length === 0 && !error && !collapsed && (
                  <p className="px-3 py-4 text-xs text-muted-foreground">
                    {escalatedOnly
                      ? `No escalated patients in ${activeLabel}.`
                      : splitAll
                        ? `No non-escalated patients in ${activeLabel}.`
                        : `No patients in ${activeLabel}.`}
                  </p>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {/* Escalated patients — all view only, shown in red */}
          {splitAll && escalatedList.length > 0 && !collapsed && (
            <SidebarGroup>
              <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-red-500 font-semibold flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3" />
                Escalated patients ({escalatedList.length})
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {escalatedList.map((p) => (
                    <PatientRow
                      key={p.id}
                      patient={p}
                      isActive={selectedId === p.id}
                      collapsed={collapsed}
                      onSelect={onSelect}
                    />
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
          </>
        ) : (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-violet-500 font-semibold flex items-center gap-1.5">
              <FolderClock className="h-3 w-3" />
              Scheduled ({pendingPatients.length})
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {pendingPatients.map((p) => (
                  <SidebarMenuItem key={p.id}>
                    <SidebarMenuButton
                      isActive={selectedId === p.id}
                      onClick={() => onSelect(p.id)}
                      className={cn(
                        "flex items-start gap-2 py-2 h-auto",
                        selectedId === p.id && "bg-sidebar-accent",
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
                {pendingPatients.length === 0 && !collapsed && (
                  <p className="px-3 py-4 text-xs text-muted-foreground">No scheduled patients.</p>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* ── Chase Clinicals viewer folder — REMOVED June 2026 ──
            Update Clinicals' Submit now flips Stage Advancer back to
            "Evaluate MN", so chase patients return to the main Evaluate
            bucket on their own once clinicals are added. Restore from git
            history if a browse-only folder is ever needed again. */}

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
