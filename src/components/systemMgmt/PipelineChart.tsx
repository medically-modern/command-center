/**
 * Pipeline visualization — stacked bar chart showing patient distribution
 * across pipeline groups, color-coded by "Days Since Stage Started".
 *
 * Groups (left → right):
 *   Profile Checklist | Medical Evaluation (4 stages) | Insurance (4 stages) |
 *   Welcome Call | Review Profile
 *
 * Features:
 *   - Group filter dropdown (upper-left) with animated show/hide
 *   - Total Patients counter (dead center)
 *   - Hover → tooltip with patient names
 *   - Click → populates search results
 */
import { useMemo, useState, useRef, useEffect } from "react";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";
import { cn } from "@/lib/utils";
import { Filter, ChevronDown, Users } from "lucide-react";

// ── Day-range buckets using Monday's actual status labels + colors ────

export interface DayBucket {
  label: string;
  color: string;
  bgClass: string;
}

export const DAY_BUCKETS: DayBucket[] = [
  { label: "0–2 Days",   color: "#9cd326", bgClass: "bg-[#9cd326]" },
  { label: "3–5 Days",   color: "#00c875", bgClass: "bg-[#00c875]" },
  { label: "6–8 Days",   color: "#037f4c", bgClass: "bg-[#037f4c]" },
  { label: "9–12 Days",  color: "#faa1f1", bgClass: "bg-[#faa1f1]" },
  { label: "13-15 Days", color: "#ff5ac4", bgClass: "bg-[#ff5ac4]" },
  { label: "16-20 Days", color: "#ff007f", bgClass: "bg-[#ff007f]" },
  { label: "21-29 Days", color: "#df2f4a", bgClass: "bg-[#df2f4a]" },
  { label: "30+ Days",   color: "#bb3354", bgClass: "bg-[#bb3354]" },
];

const UNKNOWN_BUCKET: DayBucket = {
  label: "Unknown",
  color: "#c4c4c4",
  bgClass: "bg-gray-400",
};

function getBucket(daysSinceStage: string): DayBucket {
  const found = DAY_BUCKETS.find((b) => b.label === daysSinceStage);
  return found ?? UNKNOWN_BUCKET;
}

// ── Pipeline group definitions ──────────────────────────────

export interface PipelineGroupDef {
  id: string;
  label: string;
  color: string;
  /** Board IDs that contribute patients to this group */
  boardIds: number[];
  /** Ordered stage labels expected in this group (for ordering columns) */
  stageOrder: string[];
  /**
   * Filter function: given a patient, does it belong to this group?
   * Defaults to boardId membership if not provided.
   */
  match?: (p: SystemPatient) => boolean;
}

/** Chart-eligible board IDs */
const CHART_BOARD_IDS = new Set([
  18406352652, // Profile Send Off
  18406060017, // Medical Evaluation
  18410601299, // Insurance
  18410804557, // Welcome Call
]);

export const PIPELINE_GROUPS: PipelineGroupDef[] = [
  {
    id: "profile-checklist",
    label: "Profile Checklist",
    color: "#f59e0b",
    boardIds: [18406352652],
    stageOrder: ["Profile Checklist"],
    match: (p) => p.boardId === 18406352652,
  },
  {
    id: "medical-eval",
    label: "Medical Evaluation",
    color: "#8b5cf6",
    boardIds: [18406060017],
    stageOrder: ["Evaluate MN", "Send Request", "Confirm Receipt", "Chase Clinicals"],
    match: (p) => p.boardId === 18406060017,
  },
  {
    id: "insurance",
    label: "Insurance",
    color: "#ec4899",
    boardIds: [18410601299],
    stageOrder: ["Benefits / SoS", "Submit Auth.", "Auth. Outstanding", "Auth Denied"],
    match: (p) => p.boardId === 18410601299,
  },
  {
    id: "welcome-call",
    label: "Welcome Call",
    color: "#14b8a6",
    boardIds: [18410804557],
    stageOrder: ["Welcome Call"],
    match: (p) => p.boardId === 18410804557 && p.pipelineStage === "Welcome Call",
  },
  {
    id: "review-profile",
    label: "Review Profile",
    color: "#06b6d4",
    boardIds: [18410804557],
    stageOrder: ["Review Profile", "Final Profile Confirmation"],
    match: (p) => p.boardId === 18410804557 && p.pipelineStage !== "Welcome Call",
  },
];

// ── Types ────────────────────────────────────────────────────

interface GroupColumn {
  boardId: number;
  boardName: string;
  groupTitle: string;
  pipelineStage: string;
  /** Pipeline group this column belongs to */
  pipelineGroupId: string;
  buckets: Map<string, SystemPatient[]>;
  total: number;
}

interface HoverState {
  groupIdx: number;
  bucketLabel: string;
  x: number;
  y: number;
}

// ── Component ────────────────────────────────────────────────

interface PipelineChartProps {
  patients: SystemPatient[];
  onSegmentClick: (patients: SystemPatient[]) => void;
}

export function PipelineChart({ patients, onSegmentClick }: PipelineChartProps) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  // Close filter dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Helper: get pipeline group for a patient
  const getGroup = (p: SystemPatient): PipelineGroupDef | undefined =>
    PIPELINE_GROUPS.find((g) => g.match?.(p));

  // Build grouped columns from patients
  const columns = useMemo(() => {
    const eligible = patients.filter(
      (p) => CHART_BOARD_IDS.has(p.boardId) && !p.isCompleted,
    );

    const groupMap = new Map<string, GroupColumn>();

    for (const p of eligible) {
      const pg = getGroup(p);
      if (!pg) continue;

      // Normalize stage label for Profile board
      const stageLabel =
        p.boardId === 18406352652 ? "Profile Checklist" : p.pipelineStage;

      const key = `${pg.id}::${stageLabel}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          boardId: p.boardId,
          boardName: p.boardName,
          groupTitle: stageLabel,
          pipelineStage: stageLabel,
          pipelineGroupId: pg.id,
          buckets: new Map(),
          total: 0,
        });
      }
      const col = groupMap.get(key)!;
      const bucket = getBucket(p.daysSinceStage);
      if (!col.buckets.has(bucket.label)) col.buckets.set(bucket.label, []);
      col.buckets.get(bucket.label)!.push(p);
      col.total++;
    }

    // Sort: by pipeline group order, then by stage order within group
    const groupIdx = new Map(PIPELINE_GROUPS.map((g, i) => [g.id, i]));
    const cols = Array.from(groupMap.values()).sort((a, b) => {
      const ai = groupIdx.get(a.pipelineGroupId) ?? 99;
      const bi = groupIdx.get(b.pipelineGroupId) ?? 99;
      if (ai !== bi) return ai - bi;

      // Within the same group, use stageOrder
      const group = PIPELINE_GROUPS.find((g) => g.id === a.pipelineGroupId);
      if (group) {
        const aStageIdx = group.stageOrder.indexOf(a.pipelineStage);
        const bStageIdx = group.stageOrder.indexOf(b.pipelineStage);
        // Auth Denied variants: match by startsWith
        const aIdx =
          aStageIdx >= 0
            ? aStageIdx
            : group.stageOrder.findIndex((s) =>
                a.pipelineStage.startsWith(s),
              );
        const bIdx =
          bStageIdx >= 0
            ? bStageIdx
            : group.stageOrder.findIndex((s) =>
                b.pipelineStage.startsWith(s),
              );
        return (aIdx >= 0 ? aIdx : 99) - (bIdx >= 0 ? bIdx : 99);
      }

      return a.pipelineStage.localeCompare(b.pipelineStage);
    });

    return cols;
  }, [patients]);

  // Filtered columns based on active filter
  const filteredColumns = useMemo(() => {
    if (activeFilter === "all") return columns;
    return columns.filter((c) => c.pipelineGroupId === activeFilter);
  }, [columns, activeFilter]);

  const maxTotal = useMemo(
    () => Math.max(...filteredColumns.map((c) => c.total), 1),
    [filteredColumns],
  );

  // Total patients across visible bars
  const totalPatients = useMemo(
    () => filteredColumns.reduce((sum, c) => sum + c.total, 0),
    [filteredColumns],
  );

  // Group filtered columns by pipeline group for bracket rendering
  const pipelineGroupBrackets = useMemo(() => {
    const brackets: {
      group: PipelineGroupDef;
      count: number;
    }[] = [];
    for (const pg of PIPELINE_GROUPS) {
      if (activeFilter !== "all" && pg.id !== activeFilter) continue;
      const count = filteredColumns.filter(
        (c) => c.pipelineGroupId === pg.id,
      ).length;
      if (count > 0) {
        brackets.push({ group: pg, count });
      }
    }
    return brackets;
  }, [filteredColumns, activeFilter]);

  // Hovered segment patients
  const hoveredPatients = useMemo(() => {
    if (!hover) return [];
    const col = filteredColumns[hover.groupIdx];
    if (!col) return [];
    return col.buckets.get(hover.bucketLabel) ?? [];
  }, [hover, filteredColumns]);

  // Active filter label
  const activeFilterLabel = useMemo(() => {
    if (activeFilter === "all") return "All Groups";
    return PIPELINE_GROUPS.find((g) => g.id === activeFilter)?.label ?? "All Groups";
  }, [activeFilter]);

  if (columns.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border bg-card shadow-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Group filter dropdown */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setFilterOpen((o) => !o)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all",
                activeFilter !== "all"
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-muted/50 border-border text-foreground hover:bg-muted",
              )}
            >
              <Filter className="w-3.5 h-3.5" />
              {activeFilterLabel}
              <ChevronDown
                className={cn(
                  "w-3 h-3 transition-transform",
                  filterOpen && "rotate-180",
                )}
              />
            </button>

            {filterOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 w-56 bg-popover border border-border rounded-lg shadow-lg py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                <button
                  onClick={() => {
                    setActiveFilter("all");
                    setFilterOpen(false);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center gap-2",
                    activeFilter === "all" && "bg-primary/10 text-primary font-semibold",
                  )}
                >
                  <div className="w-2.5 h-2.5 rounded-sm bg-gradient-to-br from-purple-500 to-pink-500" />
                  All Groups
                </button>
                {PIPELINE_GROUPS.map((pg) => {
                  const groupCount = columns.filter(
                    (c) => c.pipelineGroupId === pg.id,
                  ).reduce((s, c) => s + c.total, 0);
                  return (
                    <button
                      key={pg.id}
                      onClick={() => {
                        setActiveFilter(pg.id);
                        setFilterOpen(false);
                      }}
                      className={cn(
                        "w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center gap-2",
                        activeFilter === pg.id &&
                          "bg-primary/10 text-primary font-semibold",
                      )}
                    >
                      <div
                        className="w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: pg.color }}
                      />
                      {pg.label}
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {groupCount}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <h3 className="text-sm font-semibold text-foreground">
            Pipeline Overview
          </h3>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {DAY_BUCKETS.map((b) => (
            <div key={b.label} className="flex items-center gap-1">
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: b.color }}
              />
              <span className="text-[10px] text-muted-foreground">
                {b.label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Chart area */}
      <div className="relative">
        {/* Total Patients — dead center */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
          <div className="flex flex-col items-center gap-0.5 bg-card/80 backdrop-blur-sm px-4 py-2 rounded-xl border border-border/50 shadow-sm">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-2xl font-bold text-foreground tabular-nums">
              {totalPatients}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
              Total Patients
            </span>
          </div>
        </div>

        {/* Bars */}
        <div
          className="flex items-end gap-2 transition-all duration-500 ease-in-out"
          style={{ height: "360px" }}
        >
          {filteredColumns.map((col, colIdx) => {
            const barHeight = Math.max((col.total / maxTotal) * 320, 12);
            const allBuckets = [...DAY_BUCKETS, UNKNOWN_BUCKET];
            const segments: {
              bucket: DayBucket;
              patients: SystemPatient[];
            }[] = [];

            for (const bucket of allBuckets) {
              const pts = col.buckets.get(bucket.label) ?? [];
              if (pts.length === 0) continue;
              segments.push({ bucket, patients: pts });
            }

            return (
              <div
                key={`${col.pipelineGroupId}-${col.pipelineStage}`}
                className="flex-1 flex flex-col justify-end items-stretch min-w-[56px] transition-all duration-500 ease-in-out"
                style={{
                  opacity: 1,
                  transform: "scaleX(1)",
                }}
              >
                {/* Count label */}
                <div className="text-center text-xs font-semibold text-foreground mb-1">
                  {col.total}
                </div>

                {/* Stacked bar */}
                <div
                  className="flex flex-col-reverse rounded-t-md overflow-hidden transition-all duration-500 ease-in-out"
                  style={{ height: `${barHeight}px` }}
                >
                  {segments.map((seg) => (
                    <div
                      key={seg.bucket.label}
                      className={cn(
                        "w-full cursor-pointer transition-opacity duration-200",
                        hover &&
                          (hover.groupIdx !== colIdx ||
                            hover.bucketLabel !== seg.bucket.label)
                          ? "opacity-40"
                          : "opacity-100 hover:brightness-110",
                      )}
                      style={{
                        backgroundColor: seg.bucket.color,
                        flexGrow: seg.patients.length,
                        minHeight: "4px",
                      }}
                      onMouseEnter={(e) => {
                        const rect =
                          e.currentTarget.getBoundingClientRect();
                        setHover({
                          groupIdx: colIdx,
                          bucketLabel: seg.bucket.label,
                          x: rect.left + rect.width / 2,
                          y: rect.top,
                        });
                      }}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => onSegmentClick(seg.patients)}
                    />
                  ))}
                </div>

                {/* Stage label */}
                <div className="text-center mt-2 px-0.5">
                  <div className="text-[11px] font-medium text-foreground leading-tight truncate">
                    {col.pipelineStage}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pipeline group brackets */}
        <div className="flex gap-1.5 mt-1 border-t border-border pt-2 transition-all duration-500 ease-in-out">
          {pipelineGroupBrackets.map(({ group, count }) => {
            const totalCols = filteredColumns.length;
            const widthPct = (count / totalCols) * 100;
            return (
              <div
                key={group.id}
                className="text-center transition-all duration-500 ease-in-out"
                style={{ width: `${widthPct}%` }}
              >
                <div
                  className="h-0.5 rounded-full mx-2"
                  style={{ backgroundColor: group.color }}
                />
                <div
                  className="text-[10px] font-semibold mt-1 truncate"
                  style={{ color: group.color }}
                >
                  {group.label}
                </div>
              </div>
            );
          })}
        </div>

        {/* Hover tooltip */}
        {hover && hoveredPatients.length > 0 && (
          <div
            className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg p-3 max-w-[260px] pointer-events-none"
            style={{
              left: `${hover.x}px`,
              top: `${hover.y - 8}px`,
              transform: "translate(-50%, -100%)",
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-3 h-3 rounded-sm"
                style={{
                  backgroundColor: getBucket(hover.bucketLabel).color,
                }}
              />
              <span className="text-xs font-semibold text-foreground">
                {hover.bucketLabel}
              </span>
              <span className="text-[10px] text-muted-foreground ml-auto">
                {hoveredPatients.length} patient
                {hoveredPatients.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="space-y-1 max-h-[160px] overflow-y-auto">
              {hoveredPatients.slice(0, 10).map((p) => (
                <div key={p.id} className="text-xs text-foreground truncate">
                  {p.name}
                </div>
              ))}
              {hoveredPatients.length > 10 && (
                <div className="text-[10px] text-muted-foreground">
                  +{hoveredPatients.length - 10} more…
                </div>
              )}
            </div>
            <div className="text-[10px] text-muted-foreground mt-2 border-t border-border pt-1">
              Click to view in search
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
