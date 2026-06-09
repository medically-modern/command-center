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
import { writeStageAdvancer, STAGE_OPTIONS } from "@/lib/systemMgmt/mondayApi";
import { EscalationDetailModal } from "@/components/shared/EscalationDetailModal";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parseEscalation } from "@/lib/shared/escalation";
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
  Activity,
  BarChart3,
  CheckCircle2,
  FileText,
  X,
  ArrowRightLeft,
  Clock,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { PipelineChart, DAY_BUCKETS } from "@/components/systemMgmt/PipelineChart";
import { OperationsTab } from "@/components/systemMgmt/OperationsTab";
import OversightTab from "@/components/oversight/OversightTab";

type Tab = "search" | "escalations" | "operations" | "stageManager" | "oversight";

const SystemMgmtPage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { patients, escalated, completionMap, loading, error, refetch, removeEscalation } =
    useSystemPatients();

  const tabParam = searchParams.get("tab");
  const initialTab: Tab = tabParam === "escalations" ? "escalations" : tabParam === "operations" ? "operations" : tabParam === "stageManager" ? "stageManager" : tabParam === "oversight" ? "oversight" : "search";
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const [query, setQuery] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [detailPatient, setDetailPatient] = useState<SystemPatient | null>(null);
  const [chartSelection, setChartSelection] = useState<SystemPatient[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notesPatient, setNotesPatient] = useState<SystemPatient | null>(null);
  const [attemptNotesPatient, setAttemptNotesPatient] = useState<SystemPatient | null>(null);
  const [stageFilter, setStageFilter] = useState<string | null>(null);

  const handleChartSegmentClick = (segmentPatients: SystemPatient[]) => {
    setChartSelection(segmentPatients);
    setStageFilter(null);
    setQuery(""); // clear search text so chart selection shows
  };

  // When user starts typing, clear chart/stage selection
  const handleQueryChange = (q: string) => {
    setQuery(q);
    if (q.trim()) { setChartSelection(null); setStageFilter(null); }
  };

  const handleStageClick = (stage: string) => {
    setStageFilter((prev) => (prev === stage ? null : stage));
    setChartSelection(null);
    setQuery("");
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

  // Stage filter results — sorted by longest days in pipeline first
  const stageResults = useMemo(() => {
    if (!stageFilter) return null;
    const dayOrder: Record<string, number> = {
      "30+ Days": 30, "21-29 Days": 21, "16-20 Days": 16,
      "13-15 Days": 13, "9–12 Days": 9, "6–8 Days": 6,
      "3–5 Days": 3, "0–2 Days": 0, "Unknown": -1,
    };
    return patients
      .filter((p) => p.pipelineStage === stageFilter)
      .sort((a, b) => (dayOrder[b.daysSinceStage] ?? -1) - (dayOrder[a.daysSinceStage] ?? -1));
  }, [patients, stageFilter]);

  // Effective results: stage filter > chart selection > search
  const displayResults = stageResults ?? chartSelection ?? (query.trim() ? searchResults : []);

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
    <>
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
          <TabBtn
            active={activeTab === "stageManager"}
            onClick={() => setActiveTab("stageManager")}
            icon={<ArrowRightLeft className="w-4 h-4" />}
            label="Stage Manager"
          />
          <TabBtn
            active={activeTab === "operations"}
            onClick={() => setActiveTab("operations")}
            icon={<Activity className="w-4 h-4" />}
            label="Operations"
          />
          <TabBtn
            active={activeTab === "oversight"}
            onClick={() => setActiveTab("oversight")}
            icon={<BarChart3 className="w-4 h-4" />}
            label="Oversight"
          />
        </div>
      </header>

      {/* Content */}
      <main className={cn("flex-1 px-3 sm:px-6 py-6 overflow-y-auto transition-[margin] duration-300", notesPatient ? "mr-[400px]" : "mr-0")}>
        <div className={cn("mx-auto", activeTab === "oversight" ? "max-w-full" : "max-w-4xl xl:max-w-6xl 2xl:max-w-7xl")}>
          {loading && patients.length === 0 ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={handleRefresh} />
          ) : activeTab === "stageManager" ? (
            <StageManagerView patients={patients} onMoved={refetch} />
          ) : activeTab === "operations" ? (
            <OperationsTab />
          ) : activeTab === "oversight" ? (
            <OversightTab />
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
              onEscalationClick={(p) => setDetailPatient(p)}
              onStageClick={handleStageClick}
              stageFilter={stageFilter}
              onClearStageFilter={() => setStageFilter(null)}
            />
          ) : (
            <EscalationView
              escalatedByStage={escalatedByStage}
              onPatientClick={handlePatientClick}
              onRemoveEscalation={handleRemoveEscalation}
              removingId={removingId}
              completionMap={completionMap}
              onViewDetails={(p) => {
                const isAttemptStage = p.pipelineStage === "Chase Clinicals" || p.pipelineStage === "Confirm Receipt";
                if (isAttemptStage) {
                  setAttemptNotesPatient(p);
                } else {
                  setDetailPatient(p);
                }
              }}
            />
          )}
        </div>
      </main>
    </div>
    <EscalationDetailModal
      open={!!detailPatient}
      onOpenChange={(open) => { if (!open) setDetailPatient(null); }}
      patientName={detailPatient?.name ?? ""}
      data={parseEscalation(detailPatient?.escalationNotes)}
    />
    <AttemptNotesModal
      open={!!attemptNotesPatient}
      onOpenChange={(open) => { if (!open) setAttemptNotesPatient(null); }}
      patient={attemptNotesPatient}
    />
    </>
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
  onEscalationClick,
  onStageClick,
  stageFilter,
  onClearStageFilter,
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
  onEscalationClick: (p: SystemPatient) => void;
  onStageClick: (stage: string) => void;
  stageFilter: string | null;
  onClearStageFilter: () => void;
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

      {/* Stage filter banner */}
      {stageFilter && (
        <div data-chart-results className="flex items-center gap-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
          <span className="text-xs text-blue-700 dark:text-blue-300 font-medium">
            Showing {results.length} patient{results.length !== 1 ? "s" : ""} in &ldquo;{stageFilter}&rdquo; — sorted by longest in pipeline
          </span>
          <button
            onClick={onClearStageFilter}
            className="ml-auto text-xs text-blue-600 dark:text-blue-400 hover:text-blue-500 underline"
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
              onEscalationClick={onEscalationClick}
              onStageClick={onStageClick}
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
  onViewDetails,
}: {
  escalatedByStage: Map<string, SystemPatient[]>;
  onPatientClick: (p: SystemPatient, fromEscalation?: boolean) => void;
  onRemoveEscalation: (p: SystemPatient) => void;
  removingId: string | null;
  completionMap: Map<string, string[]>;
  onViewDetails: (p: SystemPatient) => void;
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
            {pts.map((p) => {
              const esc = parseEscalation(p.escalationNotes);
              const urgency = esc?.urgency ?? "Medium";
              const rowBg = {
                Low:    "bg-gray-50 dark:bg-gray-900/30 border-l-4 border-l-gray-400",
                Medium: "bg-yellow-50 dark:bg-yellow-950/20 border-l-4 border-l-yellow-400",
                High:   "bg-orange-50 dark:bg-orange-950/20 border-l-4 border-l-orange-400",
                Urgent: "bg-red-50 dark:bg-red-950/25 border-l-4 border-l-red-500",
              }[urgency];
              const avatarBg = {
                Low:    "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200",
                Medium: "bg-yellow-200 dark:bg-yellow-800/60 text-yellow-800 dark:text-yellow-200",
                High:   "bg-orange-200 dark:bg-orange-800/60 text-orange-800 dark:text-orange-200",
                Urgent: "bg-red-200 dark:bg-red-800/60 text-red-800 dark:text-red-200",
              }[urgency];
              return (
              <div
                key={`${p.boardId}-${p.id}`}
                className={`flex items-center gap-3 px-4 py-3 transition-colors hover:brightness-95 dark:hover:brightness-110 ${rowBg}`}
              >
                <button
                  onClick={() => onPatientClick(p, true)}
                  className="flex-1 flex items-center gap-3 text-left min-w-0"
                >
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${avatarBg}`}>
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
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewDetails(p);
                  }}
                  className="shrink-0 gap-1.5 text-xs border-blue-300 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                >
                  <FileText className="w-3 h-3" />
                  Details
                </Button>
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
              ); })}
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
  const noteEntries = useMemo(() => parseNoteEntriesNewestFirst(patient.notes), [patient.notes]);

  return (
    <div className="fixed top-0 right-0 w-[400px] h-screen border-l bg-card shadow-2xl flex flex-col z-40">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b bg-muted/30">
        <FileText className="w-4 h-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{patient.name}</div>
          <div className="text-[10px] text-muted-foreground">
            {patient.boardName} · {patient.pipelineStage} · {noteEntries.length} note{noteEntries.length !== 1 ? "s" : ""}
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Notes content — shows ALL notes, parsed or raw */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {!patient.notes?.trim() ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            No notes available.
          </p>
        ) : noteEntries.length === 0 ? (
          /* Fallback: raw text if parser returns nothing */
          <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
            {patient.notes}
          </div>
        ) : (
          noteEntries.map((entry, i) => (
            <div
              key={i}
              className={cn(
                i < noteEntries.length - 1 && "pb-3 border-b border-border",
              )}
            >
              {entry.header && (
                <div className="text-xs text-primary font-semibold mb-1">{entry.header}</div>
              )}
              <div className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                {entry.body}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Stage Manager View ──────────────────────────────────────

const MOVABLE_BOARD_IDS = new Set([18406060017, 18410601299]);

function StageManagerView({
  patients,
  onMoved,
}: {
  patients: SystemPatient[];
  onMoved: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SystemPatient | null>(null);
  const [targetStage, setTargetStage] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [lastMoved, setLastMoved] = useState<{ name: string; from: string; to: string } | null>(null);
  const [chartSelection, setChartSelection] = useState<SystemPatient[] | null>(null);

  // Only show patients from Med Eval and Insurance boards
  const movablePatients = useMemo(
    () => patients.filter((p) => MOVABLE_BOARD_IDS.has(p.boardId) && !p.isCompleted),
    [patients],
  );

  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    return searchPatients(movablePatients, query);
  }, [movablePatients, query]);

  // Effective results: chart selection > search
  const results = chartSelection ?? searchResults;

  const handleChartSegmentClick = (segmentPatients: SystemPatient[]) => {
    setChartSelection(segmentPatients);
    setQuery("");
    setSelected(null);
    setTargetStage(null);
  };

  const stageOptions = selected ? (STAGE_OPTIONS[selected.boardId] ?? []) : [];

  const handleSelect = (p: SystemPatient) => {
    setSelected(p);
    setTargetStage(null);
  };

  const handleMove = async () => {
    if (!selected || !targetStage) return;
    setMoving(true);
    try {
      await writeStageAdvancer(selected, targetStage);
      const fromStage = selected.pipelineStage;
      setLastMoved({ name: selected.name, from: fromStage, to: targetStage });
      toast.success(`Moved ${selected.name} → ${targetStage}`);
      setSelected(null);
      setTargetStage(null);
      setQuery("");
      onMoved();
    } catch (e) {
      toast.error("Move failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setMoving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-card border shadow-card p-5 space-y-1">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-primary" />
          Stage Manager
        </h2>
        <p className="text-xs text-muted-foreground">
          Search for a patient on the Medical Evaluation or Insurance board, then move them to a different stage.
        </p>
      </div>

      {/* Pipeline chart — Med Eval + Insurance only */}
      <PipelineChart patients={movablePatients} onSegmentClick={handleChartSegmentClick} />

      {/* Chart selection banner */}
      {chartSelection && (
        <div className="flex items-center gap-2 px-3 py-2 bg-primary/10 rounded-lg border border-primary/20">
          <span className="text-xs text-primary font-medium">
            Showing {chartSelection.length} patient{chartSelection.length !== 1 ? "s" : ""} from chart selection
          </span>
          <button
            onClick={() => setChartSelection(null)}
            className="ml-auto text-xs text-primary hover:text-primary/80 underline"
          >
            Clear
          </button>
        </div>
      )}

      {/* Success banner */}
      {lastMoved && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-sm text-emerald-800">
            <strong>{lastMoved.name}</strong> moved from <strong>{lastMoved.from}</strong> → <strong>{lastMoved.to}</strong>
          </span>
          <button onClick={() => setLastMoved(null)} className="ml-auto text-emerald-600 hover:text-emerald-800">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by patient name or phone…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); if (selected) setSelected(null); if (e.target.value.trim()) setChartSelection(null); }}
          className="pl-10 h-12 text-base"
          autoFocus
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {movablePatients.length} patients
        </span>
      </div>

      {/* Search results */}
      {!selected && query.trim() && !chartSelection && results.length === 0 && (
        <div className="rounded-xl bg-card border shadow-card p-8 text-center">
          <p className="text-sm text-muted-foreground">No patients found matching &ldquo;{query}&rdquo;</p>
        </div>
      )}

      {!selected && results.length > 0 && (
        <div className="rounded-xl bg-card border shadow-card overflow-hidden divide-y">
          <div className="px-4 py-2 bg-muted/30">
            <p className="text-xs text-muted-foreground">{results.length} result{results.length !== 1 ? "s" : ""} — click to select</p>
          </div>
          {results.slice(0, 30).map((p) => (
            <button
              key={`${p.boardId}-${p.id}`}
              onClick={() => handleSelect(p)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-xs shrink-0">
                {p.name?.[0] ?? "?"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.phone || "No phone"}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{p.boardName}</div>
                <div className="text-xs font-medium text-primary">{p.pipelineStage}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* Selected patient — move UI */}
      {selected && (
        <div className="rounded-xl bg-card border-2 border-primary/30 shadow-card overflow-hidden">
          <div className="bg-primary/5 px-5 py-4 border-b flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm shrink-0">
              {selected.name?.[0] ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold truncate">{selected.name}</div>
              <div className="text-xs text-muted-foreground">{selected.phone || "No phone"} · {selected.boardName}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setSelected(null); setTargetStage(null); }} className="text-xs gap-1">
              <X className="w-3 h-3" /> Change
            </Button>
          </div>

          <div className="p-5 space-y-4">
            {/* Current stage */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">Current Stage</p>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border bg-muted/30 text-sm font-medium">
                <Database className="w-3.5 h-3.5 text-muted-foreground" />
                {selected.pipelineStage}
              </div>
            </div>

            {/* Target stage picker */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Move To</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {stageOptions.map((stage) => {
                  const isCurrent = stage === selected.pipelineStage || stage === selected.stageAdvancerText;
                  const isSelected = stage === targetStage;
                  return (
                    <button
                      key={stage}
                      onClick={() => setTargetStage(isSelected ? null : stage)}
                      disabled={isCurrent}
                      className={cn(
                        "rounded-lg border-2 px-3 py-3 text-sm font-medium transition-colors text-center",
                        isCurrent
                          ? "border-muted bg-muted/30 text-muted-foreground cursor-not-allowed opacity-50"
                          : isSelected
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-background hover:bg-primary/5 hover:border-primary/40",
                      )}
                    >
                      {stage}
                      {isCurrent && <span className="block text-[10px] mt-0.5 text-muted-foreground">(current)</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Move button */}
            <div className="flex items-center justify-end gap-3 pt-2">
              {targetStage && (
                <p className="text-xs text-muted-foreground">
                  {selected.pipelineStage} → <strong className="text-primary">{targetStage}</strong>
                </p>
              )}
              <Button
                size="lg"
                onClick={handleMove}
                disabled={!targetStage || moving}
                className="gap-2 bg-primary hover:bg-primary/90 text-white shadow-elevate min-w-[160px] justify-center"
              >
                {moving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Moving…
                  </>
                ) : (
                  <>
                    <ArrowRightLeft className="w-4 h-4" />
                    Move Patient
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
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

/**
 * Get the color for a patient's daysSinceStage bucket (matches chart colors).
 */
const UNKNOWN_COLOR = "#c4c4c4";
function getDayBucketColor(daysSinceStage: string): string {
  const bucket = DAY_BUCKETS.find((b) => b.label === daysSinceStage);
  return bucket?.color ?? UNKNOWN_COLOR;
}

/**
 * Parse notes into individual entries.
 * Handles bracketed headers like [May 14, 2026, 12:04 PM] and also
 * date-like patterns (MM/DD/YYYY) or plain paragraphs for older notes.
 */
function parseNoteEntries(notes: string): { header: string; body: string }[] {
  if (!notes) return [];
  const text = notes.trim();

  // Try splitting on bracketed date headers first: [May 14, 2026, 12:04 PM]
  const bracketParts = text.split(/(?=\[[^\]]*\d{4}[^\]]*\])/);
  if (bracketParts.length > 1 || /^\[[^\]]*\d{4}[^\]]*\]/.test(text)) {
    const entries = bracketParts
      .filter((p) => p.trim().length > 0)
      .map((entry) => {
        const headerMatch = entry.match(/^\[([^\]]+)\]/);
        const header = headerMatch ? headerMatch[1].trim() : "";
        const body = headerMatch ? entry.slice(headerMatch[0].length).trim() : entry.trim();
        return { header, body };
      });
    if (entries.length > 0) return entries;
  }

  // Fallback: try splitting on date patterns like MM/DD/YYYY or YYYY-MM-DD
  const dateParts = text.split(/(?=(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}))/);
  if (dateParts.length > 1) {
    return dateParts
      .filter((p) => p.trim().length > 0)
      .map((entry) => {
        const dateMatch = entry.match(/^(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/);
        const header = dateMatch ? dateMatch[1] : "";
        const body = dateMatch ? entry.slice(dateMatch[0].length).trim() : entry.trim();
        return { header, body };
      });
  }

  // Final fallback: split on double newlines as separate entries
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  if (paragraphs.length > 1) {
    return paragraphs.map((p) => ({ header: "", body: p.trim() }));
  }

  // Single block of text
  return [{ header: "", body: text }];
}

/** Reverse so most recent (last in Monday text) comes first */
function parseNoteEntriesNewestFirst(notes: string): { header: string; body: string }[] {
  return parseNoteEntries(notes).reverse();
}

function PatientRow({
  patient,
  onClick,
  completedStages,
  onNotesClick,
  onEscalationClick,
  onStageClick,
}: {
  patient: SystemPatient;
  onClick: () => void;
  completedStages: string[];
  onNotesClick?: (p: SystemPatient) => void;
  onEscalationClick?: (p: SystemPatient) => void;
  onStageClick?: (stage: string) => void;
}) {
  const [showNotesTooltip, setShowNotesTooltip] = useState(false);
  const notesTooltipTimeout = useRef<ReturnType<typeof setTimeout>>();

  const noteEntries = useMemo(() => parseNoteEntriesNewestFirst(patient.notes), [patient.notes]);
  const mostRecent = noteEntries[0] ?? null;
  const recentThree = noteEntries.slice(0, 3);

  return (
    <div
      className={cn(
        "w-full flex items-stretch gap-0 rounded-lg border bg-card shadow-sm hover:shadow-md hover:border-primary/30 transition-all text-left",
        patient.escalated && "border-red-300 bg-red-50/50 dark:bg-red-950/20",
      )}
    >
      {/* Left: avatar + name + days badge + completion — clickable to navigate */}
      <button onClick={onClick} className="flex gap-3 px-4 py-3 min-w-0 shrink-0 w-[260px]">
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 mt-0.5",
            patient.escalated
              ? "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400"
              : "bg-primary/10 text-primary",
          )}
        >
          {patient.name?.[0] ?? "?"}
        </div>
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-semibold truncate leading-tight">{patient.name}</span>
            {patient.escalated && (
              <span className="shrink-0 inline-flex items-center gap-0.5 bg-red-100 dark:bg-red-900/50 text-red-600 dark:text-red-400 text-[9px] font-bold px-1.5 py-0.5 rounded">
                <AlertTriangle className="w-2.5 h-2.5" />
                ESC
              </span>
            )}
          </div>
          <span
            className="self-start inline-flex items-center px-2 py-0.5 rounded text-white text-[10px] font-bold leading-none tracking-wide"
            style={{ backgroundColor: getDayBucketColor(patient.daysSinceStage) }}
          >
            {patient.daysSinceStage || "Unknown"}
          </span>
          <CompletionBadges stages={completedStages} />
        </div>
      </button>

      {/* Center: notes preview — large, uses available space. Click opens sidebar (or escalation form for escalated patients). */}
      <div
        className={cn(
          "relative flex-1 border-l border-r border-border min-w-0 cursor-pointer transition-colors",
          patient.escalated ? "hover:bg-red-100/50 dark:hover:bg-red-950/30" : "hover:bg-muted/30",
        )}
        onClick={() => patient.escalated ? onEscalationClick?.(patient) : onNotesClick?.(patient)}
        onMouseEnter={() => {
          if (recentThree.length > 0) {
            clearTimeout(notesTooltipTimeout.current);
            notesTooltipTimeout.current = setTimeout(() => setShowNotesTooltip(true), 400);
          }
        }}
        onMouseLeave={() => {
          clearTimeout(notesTooltipTimeout.current);
          setShowNotesTooltip(false);
        }}
      >
        <div className="px-4 py-3 h-full flex flex-col justify-center min-w-0">
          {patient.escalated ? (
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
              <span className="text-sm font-medium text-red-600 dark:text-red-400">
                View Escalation Form
              </span>
            </div>
          ) : mostRecent ? (
            <>
              {mostRecent.header && (
                <div className="text-[10px] text-primary font-semibold mb-0.5 truncate">{mostRecent.header}</div>
              )}
              <div className="text-sm text-foreground leading-snug whitespace-pre-wrap">
                {mostRecent.body}
              </div>
            </>
          ) : (
            <span className="text-sm text-muted-foreground italic">No notes</span>
          )}
        </div>

        {/* Hover tooltip — 3 most recent notes (only for non-escalated) */}
        {showNotesTooltip && !patient.escalated && recentThree.length > 0 && (
          <div className="absolute left-4 bottom-full mb-2 z-50 w-96 bg-popover border border-border rounded-lg shadow-lg p-4 pointer-events-none">
            <div className="text-[10px] font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
              Recent Notes ({noteEntries.length} total)
            </div>
            <div className="space-y-2.5">
              {recentThree.map((entry, i) => (
                <div key={i} className={cn(i < recentThree.length - 1 && "pb-2.5 border-b border-border")}>
                  {entry.header && (
                    <div className="text-[10px] text-primary font-semibold mb-0.5">{entry.header}</div>
                  )}
                  <div className="text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                    {entry.body.length > 250 ? entry.body.slice(0, 250) + "…" : entry.body}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-[10px] text-muted-foreground mt-2 pt-1 border-t border-border">
              Click to view all notes
            </div>
          </div>
        )}
      </div>

      {/* Right: stage (clickable) + days */}
      <div className="shrink-0 w-[160px] flex flex-col items-end justify-center px-4 py-3 gap-0.5">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {patient.boardName}
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onStageClick?.(patient.pipelineStage);
          }}
          className="text-xs font-medium text-primary hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-right"
        >
          {patient.pipelineStage}
        </button>
        {patient.daysSinceStage && (
          <div className="text-[10px] text-muted-foreground">{patient.daysSinceStage}</div>
        )}
      </div>

      {/* Arrow */}
      <button onClick={onClick} className="shrink-0 flex items-center px-2 hover:bg-muted/30 transition-colors rounded-r-lg">
        {patient.hasPage ? (
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        ) : (
          <span className="text-[10px] text-muted-foreground">No page</span>
        )}
      </button>
    </div>
  );
}

// ── Attempt Notes Modal (Chase Clinicals / Confirm Receipt) ──

const ATTEMPT_PREFIXES = ["C.C. Attempt", "C.R. Attempt", "S.R. Attempt"];

function parseAttemptNotes(notes: string): { timestamp: string; label: string; body: string }[] {
  if (!notes) return [];
  const entries = parseNoteEntries(notes);
  return entries
    .filter((e) => ATTEMPT_PREFIXES.some((pfx) => e.body.startsWith(pfx)))
    .map((e) => {
      const colonIdx = e.body.indexOf(":");
      const label = colonIdx > -1 ? e.body.slice(0, colonIdx).trim() : e.body.trim();
      const body = colonIdx > -1 ? e.body.slice(colonIdx + 1).trim() : "";
      return { timestamp: e.header, label, body };
    });
}

function AttemptNotesModal({
  open,
  onOpenChange,
  patient,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: SystemPatient | null;
}) {
  const attempts = useMemo(
    () => (patient ? parseAttemptNotes(patient.notes) : []),
    [patient],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-amber-500" />
            Attempt History — {patient?.name ?? ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="text-xs text-muted-foreground">
            {patient?.pipelineStage} · {attempts.length} attempt{attempts.length !== 1 ? "s" : ""} logged
          </div>

          {attempts.length === 0 ? (
            <div className="rounded-lg border bg-muted/30 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No attempt notes found for this patient.
              </p>
            </div>
          ) : (
            attempts.map((attempt, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-lg border p-4 space-y-1.5",
                  i === attempts.length - 1
                    ? "bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
                    : "bg-muted/30",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{attempt.label}</span>
                  {attempt.timestamp && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                      <Clock className="h-3 w-3" />
                      {attempt.timestamp}
                    </span>
                  )}
                </div>
                <p className="text-sm whitespace-pre-wrap">
                  {attempt.body || <span className="text-muted-foreground italic">No notes recorded</span>}
                </p>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
