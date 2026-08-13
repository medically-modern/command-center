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
import { Clock, Loader2, RefreshCw, User, AlertCircle, Undo2, Search, X, ChevronRight } from "lucide-react";
import type { Patient } from "@/lib/profile/workflow";
import { titleCaseName } from "@/lib/profile/workflow";
import { sidebarSections } from "@/lib/profile/sidebarList";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { clearStatusColumn, clearDateColumn, COL } from "@/lib/profile/mondayApi";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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
  hasOverlay?: (id: string) => boolean;
  /** Optional filter chips rendered under the sidebar header. Used by Patient
   *  Intake, whose queue is split by Monday GROUP rather than by a status
   *  column, so the split belongs next to the list it filters. Omitted by
   *  Verified Referrals, which has a single pool. */
  filters?: React.ReactNode;
  /** Ignore the Follow Up column entirely: no dimmed section, and its patients
   *  stay in the main list with everyone else.
   *
   *  Patient Intake sets this, because that stage has no snooze — a call
   *  attempt bumps the attempt counter and nothing else. ⚠️ It must IGNORE the
   *  column rather than merely hide the section: `sidebarSections` moves
   *  `followUp === "Done"` patients out of the source groups, so hiding the
   *  section alone dropped them from the sidebar altogether — which is exactly
   *  what happened to every patient the old snooze had parked. Verified
   *  Referrals and Already In System use the column as a genuine follow-up flag
   *  and keep the split. */
  ignoreFollowUp?: boolean;
}

export function PatientsSidebar({ patients, selectedId, onSelect, loading, error, onRefresh, hasOverlay, filters, ignoreFollowUp }: Props) {
  const { state } = useSidebar();
  const [searchQuery, setSearchQuery] = useState("");

  const filteredBySearch = searchQuery.trim()
    ? patients.filter((p) => p.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : patients;

  const collapsed = state === "collapsed";

  // Active patients grouped by referral source + Follow Up section — the
  // shared list math lives in sidebarList.ts so page auto-select matches.
  const { sourceGroups: groupedBySource, followUpPatients } = useMemo(
    () => sidebarSections(filteredBySearch, { ignoreFollowUp }),
    [filteredBySearch, ignoreFollowUp],
  );

  // Track which groups are collapsed (all open by default)
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());

  const toggleGroup = (source: string) => {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Monday · Profile</p>
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
        {filters && <div className="mt-2.5 flex flex-wrap gap-1.5">{filters}</div>}
      </SidebarHeader>

      <SidebarContent>
        {error && !collapsed && (
          <div className="m-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive flex gap-2">
            <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {/* Active patients grouped by referral source */}
        {groupedBySource.map(({ source, patients: groupPatients }) => (
          <Collapsible
            key={source}
            open={!closedGroups.has(source)}
            onOpenChange={() => toggleGroup(source)}
          >
            <SidebarGroup>
              {!collapsed && (
                <CollapsibleTrigger asChild>
                  <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold cursor-pointer hover:text-sidebar-foreground transition-colors flex items-center gap-1.5">
                    <ChevronRight className={cn(
                      "h-3 w-3 transition-transform duration-200",
                      !closedGroups.has(source) && "rotate-90",
                    )} />
                    {source} ({groupPatients.length})
                  </SidebarGroupLabel>
                </CollapsibleTrigger>
              )}
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {groupPatients.map((p) => (
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
                                {/* Display-normalized — the working copy is fixed for real on open */}
                                <p className="text-sm font-medium truncate">{titleCaseName(p.name)}</p>
                                {hasOverlay?.(p.id) && (
                                  <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" title="Unsaved edits" />
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate">
                                {p.dateOfIntake || "—"}
                              </p>
                            </div>
                          )}
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </SidebarGroup>
          </Collapsible>
        ))}

        {!loading && groupedBySource.length === 0 && !error && !collapsed && (
          <p className="px-3 py-4 text-xs text-muted-foreground">No active patients.</p>
        )}

        {/* Follow Up section. Empty by construction when `ignoreFollowUp` is
            set, so this needs no second guard. */}
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
                        <div className="min-w-0 text-left flex-1">
                          <div className="flex items-center gap-1.5">
                            <p className="text-sm font-medium truncate">{titleCaseName(p.name)}</p>
                            {hasOverlay?.(p.id) && (
                              <span className="h-2 w-2 rounded-full bg-amber-400 shrink-0" title="Unsaved edits" />
                            )}
                          </div>
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
