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
import { AlertTriangle, Loader2, RefreshCw, User, AlertCircle, Search, X} from "lucide-react";
import type { Patient } from "@/lib/finalConfirm/workflow";
import { cn } from "@/lib/utils";

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

  // Manager view: main list shows ONLY escalated patients; the separate
  // escalated section is hidden (it would duplicate the list).
  const mainPatients = managerMode
    ? filteredBySearch.filter((p) => p.escalated)
    : filteredBySearch.filter((p) => !p.escalated);
  const escalatedSection = managerMode ? [] : filteredBySearch.filter((p) => p.escalated);

  const collapsed = state === "collapsed";

  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="p-3 border-b border-sidebar-border">
        <div className="flex items-center justify-between">
          {!collapsed && (
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
              Final Profile Confirmation
            </span>
          )}
          <Button variant="ghost" size="icon" onClick={onRefresh} className="h-7 w-7" disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
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
        {error && (
          <div className="px-3 py-2">
            <div className="flex items-start gap-2 text-destructive text-xs">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        )}
        <SidebarGroup>
          <SidebarGroupLabel className={cn(managerMode && "text-red-500 font-semibold")}>
            {managerMode ? `Escalated (${mainPatients.length})` : `Active (${mainPatients.length})`}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainPatients.map((p) => (
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
                          {p.primaryInsurance || "No insurance"} · {p.serving || "—"}
                        </p>
                      </div>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              {!loading && mainPatients.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-4 text-center">
                  {managerMode
                    ? "No escalated patients in Final Profile Confirmation group."
                    : "No patients in Final Profile Confirmation group."}
                </p>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Escalated section (hidden in manager view — main list covers it) */}
        {escalatedSection.length > 0 && !collapsed && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-red-500 font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-3 w-3" />
              Escalated ({filteredBySearch.filter((p) => p.escalated).length})
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {filteredBySearch.filter((p) => p.escalated).map((p) => (
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
      </SidebarContent>
    </Sidebar>
  );
}
