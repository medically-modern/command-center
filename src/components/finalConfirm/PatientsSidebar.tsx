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
import { Loader2, RefreshCw, User, AlertCircle } from "lucide-react";
import type { Patient } from "@/lib/finalConfirm/workflow";
import { cn } from "@/lib/utils";

interface Props {
  patients: Patient[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}

export function PatientsSidebar({ patients, selectedId, onSelect, loading, error, onRefresh }: Props) {
  const { state } = useSidebar();
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
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
        </div>
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
          <SidebarGroupLabel>Patients ({patients.length})</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {patients.map((p) => (
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
              {!loading && patients.length === 0 && (
                <p className="text-xs text-muted-foreground px-3 py-4 text-center">
                  No patients in Final Profile Confirmation group.
                </p>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
