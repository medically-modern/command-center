/**
 * Patient Questions sidebar — read-only inbox list.
 * Shows patients sorted newest-first with message preview.
 */
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
import { Loader2, RefreshCw, MessageCircle, Search, X, AlertCircle } from "lucide-react";
import type { PatientQuestion } from "@/lib/patientQuestions/types";
import { cn } from "@/lib/utils";

interface Props {
  patients: PatientQuestion[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  activeTab: "all" | "subscription" | "claims";
  onTabChange: (tab: "all" | "subscription" | "claims") => void;
}

function formatTimeAgo(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0 || isNaN(diff)) return "";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function truncate(text: string, maxLen = 60): string {
  const clean = text.replace(/\n/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + "…" : clean;
}

function SourceBadge({ source }: { source: "subscription" | "claims" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider",
        source === "subscription"
          ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
          : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
      )}
    >
      {source === "subscription" ? "Reorder" : "Co-Pay"}
    </span>
  );
}

export function PatientsSidebar({
  patients, selectedId, onSelect, loading, error, onRefresh, activeTab, onTabChange,
}: Props) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = patients
    .filter((p) => activeTab === "all" || p.source === activeTab)
    .filter((p) =>
      !searchQuery.trim() || p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()),
    );

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Patient Messages
              </p>
              <p className="text-sm font-semibold truncate">Inbox ({filtered.length})</p>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={() => onRefresh()}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>

        {/* Tab filter */}
        {!collapsed && (
          <div className="flex gap-1 mt-2">
            {(["all", "subscription", "claims"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => onTabChange(tab)}
                className={cn(
                  "flex-1 text-[10px] font-semibold uppercase tracking-wider py-1.5 rounded-md transition-colors",
                  activeTab === tab
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted",
                )}
              >
                {tab === "all" ? "All" : tab === "subscription" ? "Reorder" : "Co-Pay"}
              </button>
            ))}
          </div>
        )}

        {/* Search */}
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

        <SidebarGroup>
          {!collapsed && filtered.length > 0 && (
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
              <MessageCircle className="h-3 w-3" />
              Messages ({filtered.length})
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {filtered.map((p) => (
                <SidebarMenuItem key={`${p.source}-${p.id}`}>
                  <SidebarMenuButton
                    isActive={selectedId === p.id}
                    onClick={() => onSelect(p.id)}
                    className={cn(
                      "flex items-start gap-2 py-2.5 h-auto",
                      selectedId === p.id && "bg-sidebar-accent",
                    )}
                  >
                    <MessageCircle className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                    {!collapsed && (
                      <div className="min-w-0 text-left flex-1">
                        <div className="flex items-center justify-between gap-1.5">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {formatTimeAgo(p.messageUpdatedAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <SourceBadge source={p.source} />
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                          {truncate(p.message, 80)}
                        </p>
                      </div>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {!loading && filtered.length === 0 && !error && !collapsed && (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            No patient messages found.
          </p>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
