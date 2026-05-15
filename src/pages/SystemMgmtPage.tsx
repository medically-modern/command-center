/**
 * System Management — cross-board patient search + escalation tracker.
 *
 * (A) Search by name (fuzzy) or phone (digit substring)
 * (B) Shows board + pipeline stage for each result
 * (C) Click redirects to the patient's current role view
 * (D) Escalation panel shows all escalated profiles grouped by stage
 * (E) Remove-escalation button per patient
 */
import { useState, useMemo, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  useSystemPatients,
  searchPatients,
} from "@/hooks/systemMgmt/useSystemPatients";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Search,
  AlertTriangle,
  ArrowLeft,
  RotateCcw,
  Settings2,
  ChevronRight,
  XCircle,
  Loader2,
  Database,
  CheckCircle2,
  FileText,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PipelineChart } from "@/components/systemMgmt/PipelineChart";

type Tab = "search" | "escalations";

const SystemMgmtPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { patients, escalated, completionMap, loading, error, refetch, removeEscalation } =
    useSystemPatients();

  const initialTab = searchParams.get("tab") === "escalations" ? "escalations" : "search";
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [chartSelection, setChartSelection] = useState<SystemPatient[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notesPatient, setNotesPatient] = useState<SystemPatient | null>(null);

  const handleChartSegmentClick = (segmentPatients: SystemPatient[]) => {
    setChartSelection(segmentPatients);
    setQuery(""); // clear search text so chart selection shows
  };

  // When user starts typing, clear chart selection
  const handleQueryChange = (q: string) => {
    setQuery(q);
    if (q.trim()) setChartSelection(null);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await refetch();
      toast.success("Refreshed all boards");
    } catch {
      toast.error("Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  // Search results
  const searchResults = useMemo(
    () => searchPatients(patients, query),
    [patients, query],
  );

  // Effective results: chart selection takes priority, then search
  const displayResults = chartSelection ?? (query.trim() ? searchResults : []);

  // Patients to show in the chart (filtered by search when typing)
  const chartPatients = useMemo(() => {
    if (!query.trim()) return patients;
    // Filter chart to only show matching patients
    return searchPatients(patients, query);
  }, [patients, query]);

  // Escalated grouped by pipeline stage
  const escalatedByStage = useMemo(() => {
    const map = new Map<string, SystemPatient[]>();
    for (const p of escalated) {
      const key = `${p.boardName} → ${p.pipelineStage}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [escalated]);

  const handlePatientClick = (patient: SystemPatient, fromEscalation = false) => {
    if (!patient.hasPage) {
      toast.info(`${patient.pipelineStage} doesn't have a dedicated page yet`, {
        description: `${patient.name} is on the ${patient.boardName}`,
      });
      return;
    }
    const params = new URLSearchParams({ patientId: patient.id });
    if (fromEscalation || patient.escalated) params.set("escalated", "1");
    params.set("from", "system-mgmt");
    navigate(`${patient.roleRoute}?${params.toString()}`);
  };

  const handleRemoveEscalation = async (patient: SystemPatient) => {
    setRemovingId(patient.id);
    try {
      await removeEscalation(patient);
      toast.success(`Removed escalation for ${patient.name}`);
    } catch (e) {
      toast.error("Failed to remove escalation", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gradient-subtle">
      {/* Fixed notes panel on right edge */}
      {notesPatient && (
        <NotesPanel patient={notesPatient} onClose={() => setNotesPatient(null)} />
      )}
      {/* Header */}
      <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border">
        <div className="px-3 sm:px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/?tab=dashboard")}
              className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
              <Settings2 className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">
                Medically Modern
              </p>
              <h1 className="text-2xl font-bold">System Management</h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {escalated.length > 0 && (
              <div className="flex items-center gap-1.5 bg-red-500/20 text-red-200 px-3 py-1.5 rounded-full text-xs font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" />
                {escalated.length} Escalation{escalated.length !== 1 ? "s" : ""}
              </div>
            )}
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              className="gap-2 bg-white text-navy hover:bg-white/90 shadow-elevate"
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Refresh
            </Button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="px-3 sm:px-6 flex gap-0">
          <TabBtn
            active={activeTab === "search"}
            onClick={() => setActiveTab("search")}
            icon={<Search className="w-4 h-4" />}
            label="Search"
          />
          <TabBtn
            active={activeTab === "escalations"}
            onClick={() => setActiveTab("escalations")}
            icon={<AlertTriangle className="w-4 h-4" />}
            label={`Escalations${escalated.length ? ` (${escalated.length})` : ""}`}
            alert={escalated.length > 0}
          />
        </div>
      </header>

      {/* Content */}
      <main className={cn("flex-1 px-3 sm:px-6 py-6 overflow-y-auto transition-[margin] duration-300", notesPatient ? "mr-[400px]" : "mr-0")}>
        <div className="max-w-4xl xl:max-w-6xl 2xl:max-w-7xl mx-auto">
          {loading && patients.length === 0 ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={handleRefresh} />
          ) : activeTab === "search" ? (
            <SearchView
              query={query}
              onQueryChange={handleQueryChange}
              results={displayResults}
              totalCount={patients.length}
              onPatientClick={handlePatientClick}
              completionMap={completionMap}
              chartPatients={chartPatients}
              onChartSegmentClick={handleChartSegmentClick}
              chartSelectionActive={chartSelection !== null}
              onClearChartSelection={() => setChartSelection(null)}
              onNotesClick={(p) => setNotesPatient((prev) => prev?.id === p.id ? null : p)}
            />
          ) : (
            <EscalationView
              escalatedByStage={escalatedByStage}
              onPatientClick={handlePatientClick}
              onRemoveEscalation={handleRemoveEscalation}
              removingId={removingId}
              completionMap={completionMap}
            />
          )}
        </div>
      </main>
    </div>
  );
};

export default SystemMgmtPage;

// ── Sub-components ───────────────────────────────────────────

function TabBtn({
  active,
  onClick,
  icon,
  label,
  alert,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  alert?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
        active
          ? "border-white text-white"
          : "border-transparent text-white/60 hover:text-white/80",
        alert && !active && "text-red-300",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function LoadingState() {
  return (
    <div className="rounded-xl bg-card border shadow-card p-16 text-center space-y-3">
      <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
      <p className="text-sm text-muted-foreground">
        Loading patients across all boards…
      </p>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl bg-card border border-red-200 shadow-card p-10 text-center space-y-3">
      <XCircle className="w-8 h-8 text-red-400 mx-auto" />
      <p className="text-sm text-red-600">{error}</p>
      <Button onClick={onRetry} variant="outline" size="sm">
        Retry
      </Button>
    </div>
  );
}

// ── Search View ──────────────────────────────────────────────

function SearchView({
  query,
  onQueryChange,
  results,
  totalCount,
  onPatientClick,
  completionMap,
  chartPatients,
  onChartSegmentClick,
  chartSelectionActive,
  onClearChartSelection,
  onNotesClick,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  results: SystemPatient[];
  totalCount: number;
  onPatientClick: (p: SystemPatient) => void;
  completionMap: Map<string, string[]>;
  chartPatients: SystemPatient[];
  onChartSegmentClick: (patients: SystemPatient[]) => void;
  chartSelectionActive: boolean;
  onClearChartSelection: () => void;
  onNotesClick: (p: SystemPatient) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by patient name or phone number…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="pl-10 h-12 text-base"
          autoFocus
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {totalCount} patients across all boards
        </span>
      </div>

      {/* Pipeline chart — always visible, filters with search */}
      <PipelineChart patients={chartPatients} onSegmentClick={onChartSegmentClick} />

      {/* Chart selection banner */}
      {chartSelectionActive && (
        <div data-chart-results className="flex items-center gap-2 px-3 py-2 bg-primary/10 rounded-lg border border-primary/20">
          <span className="text-xs text-primary font-medium">
            Showing {results.length} patient{results.length !== 1 ? "s" : ""} from chart selection
          </span>
          <button
            onClick={onClearChartSelection}
            className="ml-auto text-xs text-primary hover:text-primary/80 underline"
          >
            Clear
          </button>
        </div>
      )}

      {query.trim() && results.length === 0 && (
        <div className="rounded-xl bg-card border shadow-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No patients found matching &ldquo;{query}&rdquo;
          </p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground px-1">
            {results.length > 50
              ? `Showing 50 of ${results.length} results — refine your search`
              : `${results.length} result${results.length !== 1 ? "s" : ""}`}
          </p>
          {results.slice(0, 50).map((p) => (
            <PatientRow
              key={`${p.boardId}-${p.id}`}
              patient={p}
              onClick={() => onPatientClick(p)}
              completedStages={completionMap.get(p.name.trim().toLowerCase()) ?? []}
              onNotesClick={onNotesClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Escalation View ──────────────────────────────────────────

function EscalationView({
  escalatedByStage,
  onPatientClick,
  onRemoveEscalation,
  removingId,
  completionMap,
}: {
  escalatedByStage: Map<string, SystemPatient[]>;
  onPatientClick: (p: SystemPatient, fromEscalation?: boolean) => void;
  onRemoveEscalation: (p: SystemPatient) => void;
  removingId: string | null;
  completionMap: Map<string, string[]>;
}) {
  if (escalatedByStage.size === 0) {
    return (
      <div className="rounded-xl bg-card border shadow-card p-10 text-center space-y-2">
        <AlertTriangle className="w-8 h-8 text-green-400 mx-auto" />
        <p className="text-sm text-muted-foreground">
          No active escalations across any board.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {Array.from(escalatedByStage.entries()).map(([stage, pts]) => (
        <div key={stage} className="rounded-xl border bg-card shadow-card overflow-hidden">
          <div className="bg-red-50 dark:bg-red-950/30 px-4 py-3 border-b border-red-200 dark:border-red-900 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            <h3 className="text-sm font-semibold text-red-700 dark:text-red-400">
              {stage}
            </h3>
            <span className="ml-auto text-xs text-red-500 font-medium">
              {pts.length} escalated
            </span>
          </div>
          <div className="divide-y divide-border">
            {pts.map((p) => (
              <div
                key={`${p.boardId}-${p.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
              >
                <button
                  onClick={() => onPatientClick(p, true)}
                  className="flex-1 flex items-center gap-3 text-left min-w-0"
                >
                  <div className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center text-red-600 dark:text-red-400 font-bold text-xs shrink-0">
                    {p.name[0]}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {p.phone || "No phone"} · {p.pipelineStage}
                    </div>
                    <CompletionBadges stages={completionMap.get(p.name.trim().toLowerCase()) ?? []} />
                  </div>
                  {p.hasPage ? (
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 ml-auto" />
                  ) : (
                    <span className="text-[10px] text-muted-foreground shrink-0 ml-auto">No page</span>
                  )}
                </button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={removingId === p.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveEscalation(p);
                  }}
                  className="shrink-0 gap-1.5 text-xs border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  {removingId === p.id ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <XCircle className="w-3 h-3" />
                  )}
                  Remove
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


// ── Notes Side Panel ─────────────────────────────────────────

function NotesPanel({
  patient,
  onClose,
}: {
  patient: SystemPatient;
  onClose: () => void;
}) {
  // Split notes into entries by date-like patterns (MM/DD/YYYY or similar)
  const noteEntries = useMemo(() => {
    if (!patient.notes) return [];
    const text = patient.notes.trim();
    // Try to split on date patterns like "05/06/2026" or "4/30/2026"
    const parts = text.split(/(?=\d{1,2}\/\d{1,2}\/\d{4})/);
    return parts.filter((p) => p.trim().length > 0);
  }, [patient.notes]);

  return (
    <div className="fixed top-0 right-0 w-[400px] h-screen border-l bg-card shadow-2xl flex flex-col z-40">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b bg-muted/30">
        <FileText className="w-4 h-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{patient.name}</div>
          <div className="text-[10px] text-muted-foreground">
            {patient.boardName} · {patient.pipelineStage}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Notes content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {noteEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No notes available.
          </p>
        ) : noteEntries.length === 1 ? (
          <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {noteEntries[0]}
          </div>
        ) : (
          noteEntries.map((entry, i) => (
            <div
              key={i}
              className={cn(
                "text-sm text-foreground leading-relaxed whitespace-pre-wrap",
                i < noteEntries.length - 1 && "pb-3 border-b border-border",
              )}
            >
              {entry.trim()}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Patient Row (search results) ─────────────────────────────

function CompletionBadges({ stages }: { stages: string[] }) {
  if (stages.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {stages.map((s) => (
        <span
          key={s}
          className="inline-flex items-center gap-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 text-[10px] font-medium px-1.5 py-0.5 rounded"
        >
          <CheckCircle2 className="w-2.5 h-2.5" />
          {s}
        </span>
      ))}
    </div>
  );
}

function PatientRow({
  patient,
  onClick,
  completedStages,
  onNotesClick,
}: {
  patient: SystemPatient;
  onClick: () => void;
  completedStages: string[];
  onNotesClick?: (p: SystemPatient) => void;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipTimeout = useRef<ReturnType<typeof setTimeout>>();

  const recentNote = useMemo(() => {
    if (!patient.notes) return null;
    // Take first ~150 chars as the "most recent" preview
    const text = patient.notes.trim();
    return text.length > 150 ? text.slice(0, 150) + "…" : text;
  }, [patient.notes]);

  return (
    <div
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-lg border bg-card shadow-sm hover:shadow-md hover:border-primary/30 transition-all text-left",
        patient.escalated && "border-red-300 bg-red-50/50 dark:bg-red-950/20",
      )}
    >
      <button onClick={onClick} className="flex-1 flex items-center gap-3 min-w-0">
        <div
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0",
            patient.escalated
              ? "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400"
              : "bg-primary/10 text-primary",
          )}
        >
          {patient.name?.[0] ?? "?"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{patient.name}</span>
            {patient.escalated && (
              <span className="shrink-0 inline-flex items-center gap-1 bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 text-[10px] font-semibold px-1.5 py-0.5 rounded">
                <AlertTriangle className="w-2.5 h-2.5" />
                ESCALATED
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {patient.phone || "No phone"} · {patient.boardName} · {patient.pipelineStage}
          </div>
          <CompletionBadges stages={completedStages} />
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {patient.boardName}
          </div>
          <div className="text-xs font-medium text-primary">{patient.pipelineStage}</div>
          {patient.daysSinceStage && (
            <div className="text-[10px] text-muted-foreground">{patient.daysSinceStage}</div>
          )}
        </div>
      </button>

      {/* Notes button with hover tooltip */}
      {patient.notes && onNotesClick && (
        <div className="relative shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNotesClick(patient);
            }}
            onMouseEnter={() => {
              clearTimeout(tooltipTimeout.current);
              tooltipTimeout.current = setTimeout(() => setShowTooltip(true), 300);
            }}
            onMouseLeave={() => {
              clearTimeout(tooltipTimeout.current);
              setShowTooltip(false);
            }}
            className="p-2 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="View notes"
          >
            <FileText className="w-4 h-4" />
          </button>

          {/* Hover tooltip */}
          {showTooltip && recentNote && (
            <div className="absolute right-0 bottom-full mb-2 z-50 w-72 bg-popover border border-border rounded-lg shadow-lg p-3 pointer-events-none">
              <div className="text-[10px] font-semibold text-muted-foreground mb-1 uppercase tracking-wider">
                Latest Notes
              </div>
              <div className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                {recentNote}
              </div>
              <div className="text-[10px] text-muted-foreground mt-2 pt-1 border-t border-border">
                Click to view all notes
              </div>
            </div>
          )}
        </div>
      )}

      {patient.hasPage ? (
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      ) : (
        <span className="text-[10px] text-muted-foreground shrink-0">No page</span>
      )}
    </div>
  );
}
