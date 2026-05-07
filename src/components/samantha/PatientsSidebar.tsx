import { useMemo, useState } from "react";
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
import { Loader2, RefreshCw, User, AlertCircle, ArrowDownAZ } from "lucide-react";
import type { Patient } from "@/lib/samantha/workflow";
import type { SidebarGroup as SidebarGroupType } from "@/hooks/samantha/useMondayPatients";
import { cn } from "@/lib/utils";

const AUTH_TABS: { key: SidebarGroupType; label: string }[] = [
  { key: "submitAuth", label: "Submit Auth" },
  { key: "authOutstanding", label: "Auth Outstanding" },
];

const GROUP_LABELS: Record<SidebarGroupType, string> = {
  benefits: "Benefits",
  submitAuth: "Submit Auth",
  authOutstanding: "Auth Outstanding",
};

/** Group patients by their primaryInsurance, sorted alphabetically by insurer name. */
function groupByInsurance(patients: Patient[]): { label: string; patients: Patient[] }[] {
  const map = new Map<string, Patient[]>();
  for (const p of patients) {
    const key = p.primaryInsurance || "Unknown";
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, pts]) => ({ label, patients: pts }));
}

interface Props {
  patients: Patient[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  activeGroup: SidebarGroupType;
  onGroupChange?: (group: SidebarGroupType) => void;
  showGroupTabs?: boolean;
}

export function PatientsSidebar({ patients, selectedId, onSelect, loading, error, onRefresh, activeGroup, onGroupChange, showGroupTabs = false }: Props) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const [groupByIns, setGroupByIns] = useState(false);

  const activeLabel = GROUP_LABELS[activeGroup];

  const grouped = useMemo(() => groupByInsurance(patients), [patients]);

  // For Auth Outstanding, sort patients by daysSinceStageIndex descending
  // (longest in system first). Other groups keep Monday order.
  const sortedPatients = useMemo(() => {
    if (activeGroup !== "authOutstanding") return patients;
    return [...patients].sort((a, b) => (b.daysSinceStageIndex ?? -1) - (a.daysSinceStageIndex ?? -1));
  }, [patients, activeGroup]);

  const isAuthOutstanding = activeGroup === "authOutstanding";

  const renderPatient = (p: Patient) => (
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
              {p.primaryInsurance || "—"} · {p.serving || "—"}
            </p>
            {isAuthOutstanding && p.daysSinceStage && (
              <p className={cn(
                "text-[10px] font-medium truncate mt-0.5",
                (p.daysSinceStageIndex ?? 0) >= 3 ? "text-destructive" :
                (p.daysSinceStageIndex ?? 0) >= 2 ? "text-amber-400" :
                "text-muted-foreground",
              )}>
                {p.daysSinceStage}
              </p>
            )}
          </div>
        )}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

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
            {!collapsed && (
              <Button
                variant={groupByIns ? "default" : "ghost"}
                size="icon"
                className="h-7 w-7"
                onClick={() => setGroupByIns((v) => !v)}
                title="Group by insurance"
              >
                <ArrowDownAZ className="h-4 w-4" />
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

        {!collapsed && showGroupTabs && (
          <div className="flex gap-1 mt-2">
            {AUTH_TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => onGroupChange(tab.key)}
                className={cn(
                  "flex-1 text-[10px] font-medium py-1 px-1 rounded transition-colors truncate",
                  activeGroup === tab.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                {tab.label}
              </button>
            ))}
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

        {groupByIns && !collapsed ? (
          // Grouped by insurance
          grouped.map((g) => (
            <SidebarGroup key={g.label}>
              <SidebarGroupLabel className="text-[10px] uppercase tracking-wider">
                {g.label} ({g.patients.length})
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>{g.patients.map(renderPatient)}</SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))
        ) : (
          // Flat list
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {sortedPatients.map(renderPatient)}
                {!loading && patients.length === 0 && !error && !collapsed && (
                  <p className="px-3 py-4 text-xs text-muted-foreground">No patients in {activeLabel} group.</p>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
