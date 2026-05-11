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
import { Loader2, RefreshCw, User, AlertCircle, Pause, XCircle } from "lucide-react";
import type { Patient } from "@/lib/subscription/workflow";
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
  const collapsed = state === "collapsed";

  const active = patients.filter((p) => p.status === "Active");
  const paused = patients.filter((p) => p.status === "Paused");
  const dead = patients.filter((p) => p.status === "Dead");
  const other = patients.filter((p) => p.status !== "Active" && p.status !== "Paused" && p.status !== "Dead");

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
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        </div>
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

        {!loading && patients.length === 0 && !error && !collapsed && (
          <p className="px-3 py-4 text-xs text-muted-foreground">No patients found.</p>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
