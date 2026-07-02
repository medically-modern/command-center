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
import { AlertTriangle, Loader2, RefreshCw, User, AlertCircle, Pause, XCircle, Search, X } from "lucide-react";
import type { Patient } from "@/lib/subscription/workflow";
import { sidebarSections } from "@/lib/subscription/sidebarList";
import { cn } from "@/lib/utils";

interface Props {
  patients: Patient[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

function StatusBadge({ status }: { status: string }) {
  if (status === "Active") return <span className="inline-block w-2 h-2 rounded-full bg-green-500 shrink-0" title="Active" />;
  if (status === "Paused") return <Pause className="h-3 w-3 shrink-0 text-amber-500" />;
  if (status === "Dead") return <XCircle className="h-3 w-3 shrink-0 text-red-500" />;
  return null;
}

export function PatientsSidebar({ patients, selectedId, onSelect, loading, error, onRefresh }: Props) {
  const { state } = useSidebar();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredBySearch = searchQuery.trim()
    ? patients.filter((p) => p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : patients;

  const collapsed = state === "collapsed";

  // Status groups + escalated section — the shared list math lives in
  // sidebarList.ts so page auto-select matches what renders here.
  const { active, paused, dead, other, escalatedPatients } = useMemo(
    () => sidebarSections(filteredBySearch),
    [filteredBySearch],
  );

  const renderGroup = (label: string, list: Patient[], icon?: React.ReactNode) => {
    if (list.length === 0) return null;
    return (
      <SidebarGroup>
        {!collapsed && (
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
            {icon}
            {label} ({list.length})
          </SidebarGroupLabel>
        )}
        <SidebarGroupContent>
          <SidebarMenu>
            {list.map((p) => (
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
                    <div className="min-w-0 text-left flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <StatusBadge status={p.status} />
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {[p.subscription, p.daysToOrder].filter(Boolean).join(" · ") || "—"}
                      </p>
                    </div>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
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
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Monday · Subscriptions
              </p>
              <p className="text-sm font-semibold truncate">Patients ({patients.length})</p>
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

        {renderGroup("Active", active)}
        {renderGroup("Paused", paused, <Pause className="h-3 w-3 text-amber-500" />)}
        {renderGroup("Dead", dead, <XCircle className="h-3 w-3 text-red-500" />)}
        {renderGroup("Other", other)}

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

        {!loading && patients.length === 0 && !error && !collapsed && (
          <p className="px-3 py-4 text-xs text-muted-foreground">No patients found.</p>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
