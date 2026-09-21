/**
 * Update Clinicals — simplified view for uploading new clinical documents.
 *
 * Pulls patients from BOTH boards (June 2026):
 *   - Subscription board (18407459988) — all patients, labeled with their
 *     subscription status (Active / Paused / …)
 *   - Medical Necessity board (18406060017) — all patients EXCEPT the
 *     Completed stage, labeled with their Stage Advancer value
 * Each row shows a "board · stage" label so the user knows where the
 * patient lives. Uploads + visit-date writes target the right board.
 */
import { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeft, FileUp, RefreshCw, Search, User, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { ProfileStatusBadge } from "@/components/shared/ProfileStatusBadge";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { ReportIssueButton } from "@/components/shared/ReportIssueButton";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { StaleDataNotice } from "@/components/shared/StaleDataNotice";
import {
  ClinicalsWorkPane,
  useClinicalsPatients,
  type ClinicalsRow,
} from "@/components/updateClinicals/ClinicalsWork";
/* ── Simplified Sidebar ─────────────────────────────────────── */

function ClinicalsSidebar({
  patients,
  selectedId,
  onSelect,
  loading,
  error,
  onRefresh,
}: {
  patients: ClinicalsRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = searchQuery.trim()
    ? patients.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : patients;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Monday · Clinicals
              </p>
              <p className="text-sm font-semibold truncate">
                Patients ({patients.length})
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
              className="w-full pl-8 pr-8 py-1.5 rounded-md border border-border bg-white dark:bg-card text-gray-900 dark:text-foreground text-sm placeholder:text-gray-400 dark:placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
          <div className="m-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
            {error}
          </div>
        )}

        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              All Patients ({filtered.length})
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {filtered.map((p) => (
                <SidebarMenuItem key={p.id}>
                  <SidebarMenuButton
                    isActive={selectedId === p.id}
                    onClick={() => onSelect(p.id)}
                    className={cn(
                      "flex items-start gap-2 py-2 h-auto",
                      selectedId === p.id && "bg-sidebar-accent"
                    )}
                  >
                    <User className="h-4 w-4 mt-0.5 shrink-0" />
                    {!collapsed && (
                      <div className="min-w-0 text-left">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        {/* board · stage label so the user knows where this
                            patient lives (Subscription vs Medical Necessity) */}
                        <p
                          className={cn(
                            "text-[11px] truncate font-medium",
                            p.board === "mn" ? "text-violet-500" : "text-teal-600",
                          )}
                        >
                          {p.boardLabel} · {p.stage}
                        </p>
                      </div>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {!loading && patients.length === 0 && !error && !collapsed && (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            No patients found.
          </p>
        )}
      </SidebarContent>
    </Sidebar>
  );
}


const UpdateClinicalsPage = () => {
  const { goBack } = useBackNavigation();
  const { patients, loading, initialLoading, error, refetch } = useClinicalsPatients();

  // No auto-select — the page opens to a patient search so the user
  // explicitly picks who they're updating.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = useMemo(() => patients.find((p) => p.id === selectedId), [patients, selectedId]);

  return (
    <SidebarProvider>
      <PageLoadingOverlay show={initialLoading} />
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <ClinicalsSidebar
          patients={patients}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={loading}
          error={error}
          onRefresh={refetch}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border">
            <div className="px-6 py-5 flex items-center gap-3">
              <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
              <button
                onClick={() => goBack()}
                className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                <FileUp className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">
                  Medically Modern
                </p>
                <h1 className="text-2xl font-bold">Update Clinicals</h1>
                {selected && (
                  <p className="text-sm opacity-80 mt-0.5">{selected.name}</p>
                )}
              </div>
              <span className="ml-auto">
                <ReportIssueButton />
              </span>
            </div>
          </header>
          <StaleDataNotice
            error={error}
            scope="The patient list"
            onRetry={() => { void refetch(); }}
            className="mx-3 sm:mx-6 mt-3"
          />

          <main className="flex-1 px-6 py-6 overflow-y-auto">
            <section className="max-w-3xl mx-auto space-y-5">
              {/* ⚠️ The body is `ClinicalsWorkPane` (§5.39c4) — the same
                  component the Fax bar's right pane renders, so the flow and
                  its three write paths exist once. This page is the shell
                  around it: the sidebar, the header, the stale notice. */}
              <ClinicalsWorkPane
                patients={patients}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onRefresh={refetch}
              />
            </section>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default UpdateClinicalsPage;
