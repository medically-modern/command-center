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
import { CalendarCheck, Loader2, RefreshCw, User, AlertCircle } from "lucide-react";
import type { Patient } from "@/lib/mesheke/workflow";
import type { TabKey } from "@/hooks/mesheke/useMondayPatients";
import { cn } from "@/lib/utils";

const TAB_LABELS: Record<TabKey, string> = {
  evaluate: "Evaluate MN",
  sendRequest: "Send Request",
  confirmReceipt: "Confirm Receipt",
  chase: "Chase",
};

// Order of stage groups inside the Evaluate tab sidebar
const EVALUATE_GROUP_ORDER = [
  "Evaluate MN",
  "Send Request",
  "Confirm Receipt",
  "Chase Clinicals",
] as const;

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

  const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // For chase tab: split into "action today" vs rest
  const todayPatients = activeTab === "chase" && todayOnly
    ? patients.filter((p) => p.nextActionDate?.slice(0, 10) === todayStr)
    : patients;

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
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
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

        {activeTab === "evaluate" ? (
          <>
            {EVALUATE_GROUP_ORDER.map((stage) => {
              const inStage = patients.filter((p) => (p.subStage ?? "") === stage);
              if (inStage.length === 0) return null;
              return (
                <SidebarGroup key={stage}>
                  {!collapsed && (
                    <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                      {stage} ({inStage.length})
                    </SidebarGroupLabel>
                  )}
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {inStage.map((p) => (
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
              );
            })}
            {!loading && patients.length === 0 && !error && !collapsed && (
              <p className="px-3 py-4 text-xs text-muted-foreground">No patients in any MN stage.</p>
            )}
          </>
        ) : (
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
        )}
      </SidebarContent>
    </Sidebar>
  );
}
