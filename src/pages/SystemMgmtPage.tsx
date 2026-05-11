/**
 * System Management — cross-board patient search + escalation tracker.
 *
 * (A) Search by name (fuzzy) or phone (digit substring)
 * (B) Shows board + pipeline stage for each result
 * (C) Click redirects to the patient's current role view
 * (D) Escalation panel shows all escalated profiles grouped by stage
 * (E) Remove-escalation button per patient
 */
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
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
} from "lucide-react";
import { toast } from "sonner";

type Tab = "search" | "escalations";

const SystemMgmtPage = () => {
  const navigate = useNavigate();
  const { patients, escalated, loading, error, refetch, removeEscalation } =
    useSystemPatients();

  const [activeTab, setActiveTab] = useState<Tab>("search");
  const [query, setQuery] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Search results
  const searchResults = useMemo(
    () => searchPatients(patients, query),
    [patients, query],
  );

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
    const params = new URLSearchParams({ patientId: patient.id });
    if (fromEscalation || patient.escalated) params.set("escalated", "1");
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
      {/* Header */}
      <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border">
        <div className="px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
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
              onClick={refetch}
              className="gap-2 bg-white text-navy hover:bg-white/90 shadow-elevate"
            >
              <RotateCcw className="h-4 w-4" /> Refresh
            </Button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="px-6 flex gap-0">
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
      <main className="flex-1 px-6 py-6 overflow-y-auto">
        <div className="max-w-4xl mx-auto">
          {loading && patients.length === 0 ? (
            <LoadingState />
          ) : error ? (
            <ErrorState error={error} onRetry={refetch} />
          ) : activeTab === "search" ? (
            <SearchView
              query={query}
              onQueryChange={setQuery}
              results={searchResults}
              totalCount={patients.length}
              onPatientClick={handlePatientClick}
            />
          ) : (
            <EscalationView
              escalatedByStage={escalatedByStage}
              onPatientClick={handlePatientClick}
              onRemoveEscalation={handleRemoveEscalation}
              removingId={removingId}
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
}: {
  query: string;
  onQueryChange: (q: string) => void;
  results: SystemPatient[];
  totalCount: number;
  onPatientClick: (p: SystemPatient) => void;
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

      {query.trim() && results.length === 0 && (
        <div className="rounded-xl bg-card border shadow-card p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No patients found matching "{query}"
          </p>
        </div>
      )}

      {results.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground px-1">
            {results.length} result{results.length !== 1 ? "s" : ""}
          </p>
          {results.map((p) => (
            <PatientRow key={`${p.boardId}-${p.id}`} patient={p} onClick={() => onPatientClick(p)} />
          ))}
        </div>
      )}

      {!query.trim() && (
        <div className="rounded-xl bg-card border shadow-card p-10 text-center space-y-2">
          <Database className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm text-muted-foreground">
            Type a name or phone number to search across all pipeline boards.
          </p>
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
}: {
  escalatedByStage: Map<string, SystemPatient[]>;
  onPatientClick: (p: SystemPatient, fromEscalation?: boolean) => void;
  onRemoveEscalation: (p: SystemPatient) => void;
  removingId: string | null;
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
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 ml-auto" />
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

// ── Patient Row (search results) ─────────────────────────────

function PatientRow({
  patient,
  onClick,
}: {
  patient: SystemPatient;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-4 py-3 rounded-lg border bg-card shadow-sm hover:shadow-md hover:border-primary/30 transition-all text-left",
        patient.escalated && "border-red-300 bg-red-50/50 dark:bg-red-950/20",
      )}
    >
      <div
        className={cn(
          "w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0",
          patient.escalated
            ? "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400"
            : "bg-primary/10 text-primary",
        )}
      >
        {patient.name[0]}
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
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {patient.boardName}
        </div>
        <div className="text-xs font-medium text-primary">{patient.pipelineStage}</div>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
  );
}
