/**
 * OversightTab — pipeline oversight dashboard with 12 bar charts (one per
 * pipeline stage) and drill-down tables when a bar is clicked.
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
import { Loader2, BarChart3, ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";

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

// ── StageChart (sub-component) ─────────────────────────────────────────────

interface StageChartProps {
  chart: ChartDef;
  patients: OversightPatient[];
  isExpanded: boolean;
  selectedBucket: DayBucketLabel | "all" | null;
  onBarClick: (bucket: DayBucketLabel | "all") => void;
  onClose: () => void;
}

function StageChart({
  chart,
  patients,
  isExpanded,
  selectedBucket,
  onBarClick,
  onClose,
}: StageChartProps) {
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

  const hasSelection = selectedBucket !== null;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm p-4 transition-all duration-200 cursor-pointer",
        isExpanded
          ? "border-blue-500 ring-1 ring-blue-500/30 border-b-blue-500"
          : "border-border hover:border-border/80 hover:shadow-md",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => onBarClick("all")}
          className="flex items-center gap-2 text-left group"
        >
          <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
          <h3 className="text-sm font-semibold text-foreground group-hover:text-blue-500 transition-colors truncate">
            {chart.title}
          </h3>
        </button>
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-foreground tabular-nums">
            {totalCount}
          </span>
          {isExpanded && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close drill-down"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-1 h-[200px]">
        {DAY_BUCKET_LABELS.map((label) => {
          const count = counts[label];
          const heightPct = count > 0 ? (count / maxCount) * 100 : 0;
          const isSelected = selectedBucket === label;
          const isDimmed = hasSelection && !isSelected && selectedBucket !== "all";

          return (
            <button
              key={label}
              onClick={(e) => {
                e.stopPropagation();
                onBarClick(label);
              }}
              className={cn(
                "flex-1 flex flex-col items-center justify-end h-full group/bar",
                "transition-opacity duration-200",
                isDimmed && "opacity-30",
              )}
              title={`${label}: ${count} patients`}
            >
              {/* Count above bar */}
              {count > 0 && (
                <span
                  className={cn(
                    "text-[10px] tabular-nums font-medium mb-1 transition-colors",
                    isSelected
                      ? "text-foreground font-bold"
                      : "text-muted-foreground",
                  )}
                >
                  {count}
                </span>
              )}

              {/* Bar */}
              <div className="w-full flex items-end justify-center flex-1">
                <div
                  className={cn(
                    "w-full rounded-t-sm transition-all duration-500 ease-out",
                    isSelected && "ring-2 ring-foreground/50 ring-offset-1 ring-offset-card",
                    count === 0 && "invisible",
                  )}
                  style={{
                    height: count > 0 ? `${Math.max(heightPct, 2)}%` : "0%",
                    backgroundColor: DAY_BUCKET_COLORS[label],
                    minHeight: count > 0 ? "4px" : undefined,
                  }}
                />
              </div>

              {/* Label below */}
              <span
                className={cn(
                  "text-[9px] mt-1.5 text-muted-foreground whitespace-nowrap",
                  isSelected && "text-foreground font-semibold",
                )}
              >
                {BUCKET_SHORT_LABELS[label]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Unknown note */}
      {unknownCount > 0 && (
        <p className="text-[10px] text-muted-foreground mt-2 text-right">
          +{unknownCount} unknown
        </p>
      )}

      {/* Expand indicator */}
      <div className="flex justify-center mt-2">
        {isExpanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-blue-500" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/40" />
        )}
      </div>
    </div>
  );
}

// ── DrilldownTable (sub-component) ─────────────────────────────────────────

interface DrilldownTableProps {
  chart: ChartDef;
  patients: OversightPatient[];
  bucket: DayBucketLabel | "all";
  onClose: () => void;
}

function DrilldownTable({ chart, patients, bucket, onClose }: DrilldownTableProps) {
  const tableRef = useRef<HTMLDivElement>(null);

  // Scroll into view on mount
  useEffect(() => {
    const el = tableRef.current;
    if (el) {
      // Small delay to let animation start
      const timer = setTimeout(() => {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [chart.id, bucket]);

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

  const bucketDisplay = bucket === "all" ? "all buckets" : bucket;

  // Check if any drilldown col is a "Days in Stage" column
  const daysInStageColId = useMemo(() => {
    const col = chart.drilldownCols.find(
      (c) => c.label === "Days in Stage",
    );
    return col?.colId ?? null;
  }, [chart.drilldownCols]);

  return (
    <div
      ref={tableRef}
      className={cn(
        "rounded-xl border bg-card shadow-sm overflow-hidden mt-2",
        "animate-in slide-in-from-top-2 fade-in duration-300",
      )}
    >
      {/* Table header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 className="h-4 w-4 text-blue-500 shrink-0" />
          <h4 className="text-sm font-semibold text-foreground truncate">
            {chart.title}
          </h4>
          <span className="text-xs text-muted-foreground shrink-0">
            Showing {filtered.length} patient{filtered.length !== 1 ? "s" : ""}{" "}
            in {bucketDisplay}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
          aria-label="Close table"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Table body */}
      {filtered.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          No patients in this bucket.
        </div>
      ) : (
        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card z-10">
              <tr className="border-b">
                <th className="text-left px-4 py-2 font-medium text-muted-foreground whitespace-nowrap">
                  Name
                </th>
                {chart.drilldownCols.map((col) => (
                  <th
                    key={col.colId}
                    className="text-left px-4 py-2 font-medium text-muted-foreground whitespace-nowrap"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((patient, idx) => (
                <tr
                  key={patient.id}
                  className={cn(
                    "border-b border-border/50 hover:bg-muted/50 transition-colors",
                    idx % 2 === 1 && "bg-muted/20",
                  )}
                >
                  <td className="px-4 py-2 font-medium text-foreground whitespace-nowrap">
                    {patient.name}
                  </td>
                  {chart.drilldownCols.map((col) => {
                    const value = patient.cols[col.colId] ?? "";
                    const isDaysCol = col.colId === daysInStageColId;
                    const bucketColor =
                      isDaysCol && patient.dayBucket !== "Unknown"
                        ? DAY_BUCKET_COLORS[patient.dayBucket]
                        : undefined;

                    return (
                      <td
                        key={col.colId}
                        className={cn(
                          "px-4 py-2 text-foreground/80 whitespace-nowrap",
                        )}
                      >
                        {bucketColor ? (
                          <span
                            className="inline-block px-2 py-0.5 rounded text-xs font-medium"
                            style={{
                              backgroundColor: `${bucketColor}20`,
                              color: bucketColor,
                            }}
                          >
                            {value || patient.dayBucket}
                          </span>
                        ) : (
                          <span className="text-sm">{value || "—"}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function OversightTab() {
  const cachedRef = useRef(loadCache());
  const [data, setData] = useState<Map<string, OversightPatient[]> | null>(
    cachedRef.current,
  );
  const [loading, setLoading] = useState(cachedRef.current === null);
  const [error, setError] = useState<string | null>(null);
  const [expandedChart, setExpandedChart] = useState<string | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<
    DayBucketLabel | "all" | null
  >(null);
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

    // If we have cache, show it instantly then refresh silently
    if (cachedRef.current) {
      refetch(true);
    } else {
      refetch(false);
    }

    // Poll
    const interval = setInterval(() => refetch(true), POLL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [refetch]);

  // ── Handlers ──────────────────────────────────────────────────

  const handleBarClick = useCallback(
    (chartId: string, bucket: DayBucketLabel | "all") => {
      if (expandedChart === chartId && selectedBucket === bucket) {
        // Clicking the same bar again collapses
        setExpandedChart(null);
        setSelectedBucket(null);
      } else {
        setExpandedChart(chartId);
        setSelectedBucket(bucket);
      }
    },
    [expandedChart, selectedBucket],
  );

  const handleClose = useCallback(() => {
    setExpandedChart(null);
    setSelectedBucket(null);
  }, []);

  // ── Derived values ────────────────────────────────────────────

  const totalPatients = useMemo(() => {
    if (!data) return 0;
    // Deduplicate by patient ID across charts (a patient appears in exactly one chart)
    const seen = new Set<string>();
    for (const patients of data.values()) {
      for (const p of patients) seen.add(p.id);
    }
    return seen.size;
  }, [data]);

  const expandedChartDef = useMemo(
    () =>
      expandedChart
        ? CHART_DEFS.find((c) => c.id === expandedChart) ?? null
        : null,
    [expandedChart],
  );

  const expandedPatients = useMemo(
    () =>
      expandedChart && data ? data.get(expandedChart) ?? [] : [],
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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-bold text-foreground">
            Pipeline Oversight
          </h2>
          <span className="text-sm text-muted-foreground tabular-nums">
            {totalPatients} total patient{totalPatients !== 1 ? "s" : ""}
          </span>
        </div>
        {loading && (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        )}
        {error && (
          <span className="text-xs text-destructive">
            Refresh failed &mdash; showing cached data
          </span>
        )}
      </div>

      {/* Chart stack — full width, one per row */}
      <div className="flex flex-col gap-4">
        {CHART_DEFS.map((chart) => {
          const patients = data?.get(chart.id) ?? [];
          return (
            <StageChart
              key={chart.id}
              chart={chart}
              patients={patients}
              isExpanded={expandedChart === chart.id}
              selectedBucket={
                expandedChart === chart.id ? selectedBucket : null
              }
              onBarClick={(bucket) => handleBarClick(chart.id, bucket)}
              onClose={handleClose}
            />
          );
        })}
      </div>

      {/* Drill-down table (full width below grid) */}
      {expandedChartDef && selectedBucket && (
        <DrilldownTable
          key={`${expandedChartDef.id}-${selectedBucket}`}
          chart={expandedChartDef}
          patients={expandedPatients}
          bucket={selectedBucket}
          onClose={handleClose}
        />
      )}
    </div>
  );
}
