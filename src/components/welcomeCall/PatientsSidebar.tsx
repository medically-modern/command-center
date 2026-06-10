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
import { AlertTriangle, Clock, Loader2, RefreshCw, User, AlertCircle, Undo2, Search, X} from "lucide-react";
import type { Patient } from "@/lib/welcomeCall/workflow";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { clearStatusColumn, clearDateColumn, COL } from "@/lib/welcomeCall/mondayApi";

/** Convert YYYY-MM-DD → MM/DD/YYYY */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

interface Props {
  patients: Patient[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  /** Manager view (?manager=1): list ONLY escalated patients. */
  managerMode?: boolean;
}

export function PatientsSidebar({ patients, selectedId, onSelect, loading, error, onRefresh, managerMode = false }: Props) {
  const { state } = useSidebar();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredBySearch = searchQuery.trim()
    ? patients.filter((p) => p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : patients;

  const collapsed = state === "collapsed";

  // Split patients into active vs follow-up
  // "Done" is the text Monday returns for status index 1 (our follow-up marker)
  // Manager view: the main list IS the escalated list; other sections hide.
  const escalatedPatients = managerMode ? [] : filteredBySearch.filter((p) => p.escalated && p.followUp !== "Done");
  const activePatients = managerMode
    ? filteredBySearch.filter((p) => p.escalated)
    : filteredBySearch.filter((p) => !p.escalated && p.followUp !== "Done");
  const followUpPatients = managerMode ? [] : filteredBySearch.filter((p) => p.followUp === "Done" && !p.escalated);
  const bothPatients = managerMode ? [] : filteredBySearch.filter((p) => p.escalated && p.followUp === "Done");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Monday · Welcome Call
              </p>
              <p className={cn("text-sm font-semibold truncate", managerMode && "text-red-500")}>
                {managerMode ? `Escalated (${activePatients.length})` : `Patients (${patients.length})`}
              </p>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh from Monday"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      
        {!collapsed && (
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search patients…"
              className="w-full pl-8 pr-8 py-1.5 rounded-md border border-border bg-white text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
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

        {/* Active patients */}
        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Active ({activePatients.length})
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {activePatients.map((p) => (
                <SidebarMenuItem key={p.id}>
                  <SidebarMenuButton
                    isActive={selectedId === p.id}
                    onClick={() => onSelect(p.id)}
                    className={cn(
                      "flex items-start gap-2 py-2 h-auto",
                      selectedId === p.id && "bg-sidebar-accent",
                    )}
                  >
                    <User className="h-4 w-4 mt-0.5 shrink-0" />
                    {!collapsed && (
                      <div className="min-w-0 text-left">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {p.serving && p.primaryInsurance
                            ? `${p.serving} · ${p.primaryInsurance}`
                            : p.serving || p.primaryInsurance || "—"}
                        </p>
                      </div>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {!loading && activePatients.length === 0 && !error && !collapsed && (
                <p className="px-3 py-4 text-xs text-muted-foreground">No active patients.</p>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Escalated section */}
        {escalatedPatients.length > 0 && !collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-red-500 font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              Escalated ({escalatedPatients.length})
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {escalatedPatients.map((p) => (
                  <SidebarMenuItem key={p.id}>
                    <SidebarMenuButton
                      isActive={selectedId === p.id}
                      onClick={() => onSelect(p.id)}
                      className={cn(
                        "flex items-start gap-2 py-2 h-auto opacity-60",
                        selectedId === p.id && "bg-sidebar-accent opacity-100",
                      )}
                    >
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-400" />
                      {!collapsed && (
                        <div className="min-w-0 text-left">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-[11px] text-red-400 truncate">
                            Escalation Required
                          </p>
                        </div>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* Follow Up Tomorrow section */}
        {followUpPatients.length > 0 && !collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-blue-500 font-semibold flex items-center gap-1.5">
              <Clock className="h-3 w-3" />
              Follow Up ({followUpPatients.length})
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {followUpPatients.map((p) => (
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
                        <Clock className="h-4 w-4 mt-0.5 shrink-0 text-blue-400" />
                        <div className="min-w-0 text-left">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-[11px] text-blue-400 truncate">
                            Until {p.followUpDate ? fmtDate(p.followUpDate) : "—"}
                          </p>
                        </div>
                      </SidebarMenuButton>
                      <ClearFollowUpButton patientId={p.id} patientName={p.name} onSuccess={onRefresh} />
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* ── Escalated + Follow Up (both statuses) ── */}
        {bothPatients.length > 0 && !collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-amber-500 font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              Escalated + Follow Up ({bothPatients.length})
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {bothPatients.map((p) => (
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
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" />
                        <div className="min-w-0 text-left">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-[10px] text-amber-400 truncate">
                            Escalated \u00b7 Follow up {p.followUpDate ? fmtDate(p.followUpDate) : ""}
                          </p>
                        </div>
                      </SidebarMenuButton>
                      <ClearFollowUpButton patientId={p.id} patientName={p.name} onSuccess={onRefresh} />
                    </div>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

    </Sidebar>
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
