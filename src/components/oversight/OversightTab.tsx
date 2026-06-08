/**
 * OversightTab — pipeline oversight dashboard with 12 bar charts in a
 * compact 3×4 grid that fits on one screen. Clicking a chart opens a
 * modal drill-down table overlay.
 *
 * Data is fetched from Monday.com via oversightApi, cached in localStorage
 * for instant reload, and polled every 90 seconds.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  fetchOversightData,
  CHART_DEFS,
  DAY_BUCKET_LABELS,
  DAY_BUCKET_COLORS,
  type OversightPatient,
  type ChartDef,
  type DayBucketLabel,
} from "@/lib/oversight/oversightApi";
import { Loader2, BarChart3, X, ExternalLink, StickyNote } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

// ── Chart ID → Command Center route mapping ──────────────────────────────

const CHART_ROUTES: Record<string, string | null> = {
  "dtc-partial-leads": null,        // no CC view
  "dtc-raw-intake": null,           // no CC view
  "profile-send-off": "/profile",
  "evaluate": "/evaluate",
  "send-request": "/send-request",
  "confirm-receipt": "/confirm-receipt",
  "chase-clinicals": "/chase-benefits",
  "benefits": "/benefits",
  "submit-auth": "/submit-auth",
  "auth-outstanding": "/auth-outstanding",
  "auth-denial": null,              // no CC view yet
  "welcome-call": "/welcome-call",
};

// ── Constants ──────────────────────────────────────────────────────────────

const POLL_MS = 90_000;
const LS_CACHE_KEY = "oversight-cache";

/** Abbreviated labels for bar chart x-axis */
const BUCKET_SHORT_LABELS: Record<DayBucketLabel, string> = {
  "0–2 Days": "0-2",
  "3–5 Days": "3-5",
  "6–8 Days": "6-8",
  "9–12 Days": "9-12",
  "13-15 Days": "13-15",
  "16-20 Days": "16-20",
  "21-29 Days": "21-29",
  "30+ Days": "30+",
};

// ── LocalStorage cache helpers ─────────────────────────────────────────────

type CacheShape = Record<string, OversightPatient[]>;

function loadCache(): Map<string, OversightPatient[]> | null {
  try {
    const raw = localStorage.getItem(LS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheShape;
    const map = new Map<string, OversightPatient[]>();
    for (const [k, v] of Object.entries(parsed)) map.set(k, v);
    return map;
  } catch {
    return null;
  }
}

function persistCache(data: Map<string, OversightPatient[]>): void {
  try {
    const obj: CacheShape = {};
    for (const [k, v] of data.entries()) obj[k] = v;
    localStorage.setItem(LS_CACHE_KEY, JSON.stringify(obj));
  } catch {
    /* quota exceeded or private browsing */
  }
}

// ── Bucket ordering for sort ───────────────────────────────────────────────

const BUCKET_ORDER: Record<string, number> = {};
DAY_BUCKET_LABELS.forEach((label, i) => {
  BUCKET_ORDER[label] = i;
});
BUCKET_ORDER["Unknown"] = DAY_BUCKET_LABELS.length;

function bucketSortValue(bucket: DayBucketLabel | "Unknown"): number {
  return BUCKET_ORDER[bucket] ?? DAY_BUCKET_LABELS.length;
}

// ── StageChart (compact card) ─────────────────────────────────────────────

interface StageChartProps {
  chart: ChartDef;
  patients: OversightPatient[];
  onChartClick: () => void;
  onBarClick: (bucket: DayBucketLabel) => void;
}

function StageChart({ chart, patients, onChartClick, onBarClick }: StageChartProps) {
  const bucketCounts = useMemo(() => {
    const counts: Record<DayBucketLabel, number> = {} as Record<
      DayBucketLabel,
      number
    >;
    for (const label of DAY_BUCKET_LABELS) counts[label] = 0;
    let unknownCount = 0;

    for (const p of patients) {
      if (p.dayBucket === "Unknown") {
        unknownCount++;
      } else {
        counts[p.dayBucket]++;
      }
    }
    return { counts, unknownCount };
  }, [patients]);

  const { counts, unknownCount } = bucketCounts;
  const totalCount = patients.length;
  const maxCount = useMemo(
    () => Math.max(1, ...Object.values(counts)),
    [counts],
  );

  return (
    <div
      className={cn(
        "rounded-lg border bg-card shadow-sm p-3 transition-all duration-200",
        "text-left w-full",
        "border-border hover:border-blue-400/60 hover:shadow-md hover:ring-1 hover:ring-blue-400/20",
      )}
    >
      {/* Header — clickable to show all patients */}
      <button
        onClick={onChartClick}
        className="flex items-center justify-between mb-2 w-full text-left group cursor-pointer"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
          <h3 className="text-sm font-bold text-foreground truncate group-hover:text-blue-500 transition-colors">
            {chart.title}
          </h3>
        </div>
        <span className="text-lg font-bold text-foreground tabular-nums ml-2 shrink-0">
          {totalCount}
        </span>
      </button>

      {/* Bar chart — compact height, each bar clickable */}
      <div className="flex items-end gap-[3px] h-[100px]">
        {DAY_BUCKET_LABELS.map((label) => {
          const count = counts[label];
          const heightPct = count > 0 ? (count / maxCount) * 100 : 0;

          return (
            <button
              key={label}
              onClick={(e) => {
                e.stopPropagation();
                if (count > 0) onBarClick(label);
              }}
              className={cn(
                "flex-1 flex flex-col items-center justify-end h-full",
                count > 0 ? "cursor-pointer" : "cursor-default",
              )}
              title={`${label}: ${count} patients`}
            >
              {/* Count above bar */}
              {count > 0 && (
                <span className="text-[8px] tabular-nums font-medium mb-0.5 text-muted-foreground">
                  {count}
                </span>
              )}

              {/* Bar */}
              <div className="w-full flex items-end justify-center flex-1">
                <div
                  className={cn(
                    "w-full rounded-t-sm transition-all duration-300 ease-out",
                    count > 0 && "hover:opacity-80 hover:ring-1 hover:ring-foreground/30",
                    count === 0 && "invisible",
                  )}
                  style={{
                    height: count > 0 ? `${Math.max(heightPct, 3)}%` : "0%",
                    backgroundColor: DAY_BUCKET_COLORS[label],
                    minHeight: count > 0 ? "3px" : undefined,
                  }}
                />
              </div>

              {/* Label below */}
              <span className="text-[7px] mt-1 text-muted-foreground whitespace-nowrap">
                {BUCKET_SHORT_LABELS[label]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Unknown note */}
      {unknownCount > 0 && (
        <p className="text-[8px] text-muted-foreground mt-1 text-right">
          +{unknownCount} unknown
        </p>
      )}
    </div>
  );
}

// ── DrilldownModal (overlay) ──────────────────────────────────────────────

interface DrilldownModalProps {
  chart: ChartDef;
  patients: OversightPatient[];
  bucket: DayBucketLabel | "all";
  onBucketChange: (bucket: DayBucketLabel | "all") => void;
  onClose: () => void;
  onPatientClick: (patientId: string) => void;
  hasRoute: boolean;
}

function DrilldownModal({
  chart,
  patients,
  bucket,
  onBucketChange,
  onClose,
  onPatientClick,
  hasRoute,
}: DrilldownModalProps) {
  const [notesOpenId, setNotesOpenId] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (notesOpenId) {
          setNotesOpenId(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, notesOpenId]);

  const filtered = useMemo(() => {
    const list =
      bucket === "all"
        ? patients
        : patients.filter((p) => p.dayBucket === bucket);

    // Sort by day bucket descending (30+ first)
    return [...list].sort(
      (a, b) => bucketSortValue(b.dayBucket) - bucketSortValue(a.dayBucket),
    );
  }, [patients, bucket]);

  // Bucket counts for the filter chips
  const bucketCounts = useMemo(() => {
    const counts: Record<string, number> = { all: patients.length };
    for (const label of DAY_BUCKET_LABELS) counts[label] = 0;
    for (const p of patients) {
      if (p.dayBucket !== "Unknown") counts[p.dayBucket]++;
    }
    return counts;
  }, [patients]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[90vw] max-w-6xl max-h-[85vh] flex flex-col animate-in zoom-in-95 fade-in duration-200">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <BarChart3 className="h-4 w-4 text-blue-500 shrink-0" />
            <h3 className="text-base font-semibold text-foreground truncate">
              {chart.title}
            </h3>
            <span className="text-xs text-muted-foreground shrink-0">
              {filtered.length} patient{filtered.length !== 1 ? "s" : ""}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Bucket filter chips */}
        <div className="flex items-center gap-1.5 px-5 py-2 border-b overflow-x-auto shrink-0">
          <button
            onClick={() => onBucketChange("all")}
            className={cn(
              "px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap",
              bucket === "all"
                ? "bg-blue-500 text-white"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            All ({bucketCounts.all})
          </button>
          {DAY_BUCKET_LABELS.map((label) => {
            const count = bucketCounts[label] ?? 0;
            if (count === 0) return null;
            return (
              <button
                key={label}
                onClick={() => onBucketChange(label)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs font-medium transition-colors whitespace-nowrap",
                  bucket === label
                    ? "text-white"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
                style={
                  bucket === label
                    ? { backgroundColor: DAY_BUCKET_COLORS[label] }
                    : undefined
                }
              >
                {BUCKET_SHORT_LABELS[label]} ({count})
              </button>
            );
          })}
        </div>

        {/* Table body */}
        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            No patients in this bucket.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b">
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    Name
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground whitespace-nowrap">
                    Days in Stage
                  </th>
                  {chart.drilldownCols
                    .filter((c) => c.label !== "Days in Stage")
                    .map((col) => (
                      <th
                        key={col.colId}
                        className="text-left px-4 py-2 font-medium text-muted-foreground whitespace-nowrap"
                      >
                        {col.label}
                      </th>
                    ))}
                  {chart.notesColId && (
                    <th className="px-3 py-2 font-medium text-muted-foreground whitespace-nowrap text-center w-12">
                      Notes
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((patient, idx) => {
                  const bucketColor =
                    patient.dayBucket !== "Unknown"
                      ? DAY_BUCKET_COLORS[patient.dayBucket]
                      : "#888888";
                  return (
                    <tr
                      key={patient.id}
                      onClick={() => hasRoute && onPatientClick(patient.id)}
                      className={cn(
                        "border-b border-border/50 hover:bg-muted/50 transition-colors",
                        idx % 2 === 1 && "bg-muted/20",
                        hasRoute && "cursor-pointer",
                      )}
                    >
                      <td className="px-4 py-2 font-medium text-foreground whitespace-nowrap">
                        <span className="flex items-center gap-1.5">
                          {patient.name}
                          {hasRoute && (
                            <ExternalLink className="h-3 w-3 text-blue-400" />
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span
                          className="inline-block px-2.5 py-1 rounded text-xs font-bold"
                          style={{
                            backgroundColor: `${bucketColor}20`,
                            color: bucketColor,
                          }}
                        >
                          {patient.dayBucket}
                        </span>
                      </td>
                      {chart.drilldownCols
                        .filter((c) => c.label !== "Days in Stage")
                        .map((col) => {
                          const value = patient.cols[col.colId] ?? "";
                          return (
                            <td
                              key={col.colId}
                              className="px-4 py-2 text-foreground/80 whitespace-nowrap"
                            >
                              <span className="text-sm">{value || "—"}</span>
                            </td>
                          );
                        })}
                      {chart.notesColId && (() => {
                        const noteText = patient.cols[chart.notesColId!] ?? "";
                        const hasNote = noteText.trim().length > 0;
                        const isOpen = notesOpenId === patient.id;
                        return (
                          <td className="px-3 py-2 text-center relative">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setNotesOpenId(isOpen ? null : patient.id);
                              }}
                              className={cn(
                                "p-1 rounded transition-colors",
                                hasNote
                                  ? "text-blue-500 hover:bg-blue-500/10"
                                  : "text-muted-foreground/30 cursor-default",
                              )}
                              disabled={!hasNote}
                              title={hasNote ? "View notes" : "No notes"}
                            >
                              <StickyNote className="h-4 w-4" />
                            </button>
                            {isOpen && hasNote && (
                              <div
                                className="absolute right-0 top-full mt-1 z-50 w-80 max-h-60 overflow-y-auto rounded-lg border bg-popover p-3 shadow-lg text-left"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-xs font-semibold text-muted-foreground">
                                    {patient.name}
                                  </span>
                                  <button
                                    onClick={() => setNotesOpenId(null)}
                                    className="p-0.5 rounded hover:bg-muted text-muted-foreground"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </div>
                                <p className="text-sm text-foreground whitespace-pre-wrap break-words">
                                  {noteText}
                                </p>
                              </div>
                            )}
                          </td>
                        );
                      })()}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function OversightTab() {
  const navigate = useNavigate();
  const cachedRef = useRef(loadCache());
  const [data, setData] = useState<Map<string, OversightPatient[]> | null>(
    cachedRef.current,
  );
  const [loading, setLoading] = useState(cachedRef.current === null);
  const [error, setError] = useState<string | null>(null);
  const [expandedChart, setExpandedChart] = useState<string | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<
    DayBucketLabel | "all"
  >("all");
  const mountedRef = useRef(true);

  // ── Data fetching ─────────────────────────────────────────────

  const refetch = useCallback(async (silent = false) => {
    if (mountedRef.current && !silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const result = await fetchOversightData();
      if (!mountedRef.current) return;
      setData(result);
      persistCache(result);
      setError(null);
    } catch (e) {
      if (mountedRef.current) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (mountedRef.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (cachedRef.current) {
      refetch(true);
    } else {
      refetch(false);
    }

    const interval = setInterval(() => refetch(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [refetch]);

  // ── Handlers ──────────────────────────────────────────────────

  const handleChartClick = useCallback((chartId: string) => {
    setExpandedChart(chartId);
    setSelectedBucket("all");
  }, []);

  const handleBarClick = useCallback((chartId: string, bucket: DayBucketLabel) => {
    setExpandedChart(chartId);
    setSelectedBucket(bucket);
  }, []);

  const handleClose = useCallback(() => {
    setExpandedChart(null);
    setSelectedBucket("all");
  }, []);

  const handleBucketChange = useCallback((bucket: DayBucketLabel | "all") => {
    setSelectedBucket(bucket);
  }, []);

  const handlePatientClick = useCallback(
    (patientId: string) => {
      if (!expandedChart) return;
      const route = CHART_ROUTES[expandedChart];
      if (!route) {
        toast.info("This stage doesn't have a dedicated page yet");
        return;
      }
      const params = new URLSearchParams({ patientId });
      params.set("from", "system-mgmt");
      navigate(`${route}?${params.toString()}`);
    },
    [expandedChart, navigate],
  );

  // ── Derived values ────────────────────────────────────────────

  const totalPatients = useMemo(() => {
    if (!data) return 0;
    const seen = new Set<string>();
    for (const patients of data.values()) {
      for (const p of patients) seen.add(p.id);
    }
    return seen.size;
  }, [data]);

  // Find the expanded chart's data for the modal
  const expandedChartDef = useMemo(
    () => (expandedChart ? CHART_DEFS.find((c) => c.id === expandedChart) : null),
    [expandedChart],
  );
  const expandedPatients = useMemo(
    () => (expandedChart && data ? data.get(expandedChart) ?? [] : []),
    [expandedChart, data],
  );

  // ── Render ────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Loading pipeline data...
        </p>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-sm text-destructive">{error}</p>
        <button
          onClick={() => refetch(false)}
          className="text-sm text-blue-500 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-bold text-foreground">
            Pipeline Oversight
          </h2>
          <span className="text-sm text-muted-foreground tabular-nums">
            {totalPatients} total patients
          </span>
        </div>
        <div className="flex items-center gap-2">
          {loading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          {error && (
            <span className="text-[10px] text-destructive">
              Refresh failed
            </span>
          )}
        </div>
      </div>

      {/* 3-column × 4-row grid — fits one screen */}
      <div className="grid grid-cols-3 gap-3">
        {CHART_DEFS.map((chart) => {
          const patients = data?.get(chart.id) ?? [];
          return (
            <StageChart
              key={chart.id}
              chart={chart}
              patients={patients}
              onChartClick={() => handleChartClick(chart.id)}
              onBarClick={(bucket) => handleBarClick(chart.id, bucket)}
            />
          );
        })}
      </div>

      {/* Drill-down modal overlay */}
      {expandedChart && expandedChartDef && (
        <DrilldownModal
          chart={expandedChartDef}
          patients={expandedPatients}
          bucket={selectedBucket}
          onBucketChange={handleBucketChange}
          onClose={handleClose}
          onPatientClick={handlePatientClick}
          hasRoute={CHART_ROUTES[expandedChart!] !== null}
        />
      )}
    </div>
  );
}
