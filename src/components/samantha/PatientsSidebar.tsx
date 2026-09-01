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
import { RefreshCw, User, AlertCircle, ArrowDownAZ, Search, X} from "lucide-react";
import type { Patient } from "@/lib/samantha/workflow";
import type { SidebarGroup as SidebarGroupType } from "@/hooks/samantha/useMondayPatients";
import { cn } from "@/lib/utils";
import { daysAuthOutstanding } from "@/lib/samantha/authOutstandingDays";
import { useSearchParams } from "react-router-dom";
import { viewFilterFromParams } from "@/lib/roleView";
import { sidebarSections } from "@/lib/samantha/sidebarList";
import { managerOriginFromParams } from "@/lib/shared/managerOrigin";
import { ContactStateMarks } from "@/components/shared/ContactStateMarks";

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
  /** Manager view (?manager=1): list ONLY escalated patients. */
  managerMode?: boolean;
}

export function PatientsSidebar({ patients, selectedId, onSelect, loading, error, onRefresh, activeGroup, onGroupChange, showGroupTabs = false }: Props) {
  const { state } = useSidebar();
  const [searchQuery, setSearchQuery] = useState("");

  // 3-way filter from the URL. `managerMode` (escalated-only) is kept as an
  // alias for the existing labels.
  const [sp] = useSearchParams();
  const viewFilter = viewFilterFromParams(sp);
  const managerMode = viewFilter === "escalated";
  // Which oversight manager column this page was opened from, so the list
  // matches the bar chart that produced it (see sidebarList.matchesOrigin).
  const managerOrigin = managerOriginFromParams(sp);

  const filteredBySearch = searchQuery.trim()
    ? patients.filter((p) => p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : patients;

  const collapsed = state === "collapsed";
  // Auth Outstanding defaults to group-by-payer (redesign §12); the toggle
  // still lets the rep flatten the list.
  const [groupByIns, setGroupByIns] = useState(activeGroup === "authOutstanding");

  const activeLabel = GROUP_LABELS[activeGroup];

  // Split patients into active vs follow-up vs escalated vs both, plus the
  // Auth Outstanding re-sort — shared with the role pages' auto-select
  // (sidebarList.ts) so the sidebar and pages can never drift apart.
  const { activePatients, sortedPatients } = useMemo(
    () => sidebarSections(filteredBySearch, viewFilter, activeGroup, undefined, managerOrigin),
    [filteredBySearch, viewFilter, activeGroup, managerOrigin],
  );

  const grouped = useMemo(() => groupByInsurance(activePatients), [activePatients]);

  const isAuthOutstanding = activeGroup === "authOutstanding";

  const renderPatient = (p: Patient) => (
    <SidebarMenuItem key={p.id}>
      <div className="flex items-center gap-1 w-full">
        <SidebarMenuButton
          isActive={selectedId === p.id}
          onClick={() => onSelect(p.id)}
          className={cn(
            "flex-1 flex items-start gap-2 py-2 h-auto",
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
              {isAuthOutstanding && (() => {
                // Days-outstanding row (redesign handoff §12) — days since the
                // earliest Auth Submission Date (live compute, board-column
                // fallback). Old "Days Since Stage" status label only when
                // neither source has data.
                const days = daysAuthOutstanding(p);
                if (days !== null) {
                  return (
                    <p className={cn(
                      "text-[10px] font-medium truncate mt-0.5",
                      days >= 14 ? "text-destructive" :
                      days >= 7 ? "text-amber-400" :
                      "text-muted-foreground",
                    )}>
                      {days} {days === 1 ? "day" : "days"} outstanding
                    </p>
                  );
                }
                return p.daysSinceStage ? (
                  <p className={cn(
                    "text-[10px] font-medium truncate mt-0.5",
                    (p.daysSinceStageIndex ?? 0) >= 3 ? "text-destructive" :
                    (p.daysSinceStageIndex ?? 0) >= 2 ? "text-amber-400" :
                    "text-muted-foreground",
                  )}>
                    {p.daysSinceStage}
                  </p>
                ) : null;
              })()}
            </div>
          )}
          <ContactStateMarks phone={p.patientPhone} />
        </SidebarMenuButton>
      </div>
    </SidebarMenuItem>
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Monday · {activeLabel}</p>
              <p className={cn("text-sm font-semibold truncate", managerMode && "text-red-500")}>
                {managerMode ? `Escalated (${activePatients.length})` : `Patients (${activePatients.length})`}
              </p>
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
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
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
                {!loading && activePatients.length === 0 && !error && !collapsed && (
                  <p className="px-3 py-4 text-xs text-muted-foreground">
                    {managerMode ? `No escalated patients in ${activeLabel} group.` : `No patients in ${activeLabel} group.`}
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
