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
 *   - Total Patients inline next to title
 *   - Hover → tooltip with patient names
 *   - Click → populates search results
 *   - Fluid CSS-driven animations with staggered entrance and spring easing
 */
import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";
import { cn } from "@/lib/utils";
import { Filter, ChevronDown } from "lucide-react";

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

// ── Spring-like easing ──────────────────────────────────────
// cubic-bezier that overshoots slightly then settles — feels physical
const SPRING_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const SMOOTH_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

// ── Pipeline group definitions ──────────────────────────────

export interface PipelineGroupDef {
  id: string;
  label: string;
  color: string;
  boardIds: number[];
  stageOrder: string[];
  match?: (p: SystemPatient) => boolean;
}

const CHART_BOARD_IDS = new Set([
  18406352652, 18406060017, 18410601299, 18410804557,
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

// ── Inline keyframes (injected once) ────────────────────────

let stylesInjected = false;
function injectAnimationStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    @keyframes barEnter {
      0% {
        opacity: 0;
        transform: scaleY(0) translateY(20px);
      }
      60% {
        opacity: 1;
        transform: scaleY(1.04) translateY(-2px);
      }
      100% {
        opacity: 1;
        transform: scaleY(1) translateY(0);
      }
    }
    @keyframes barExit {
      0% {
        opacity: 1;
        transform: scaleX(1);
        max-width: 200px;
      }
      100% {
        opacity: 0;
        transform: scaleX(0);
        max-width: 0;
        padding: 0;
        margin: 0;
        gap: 0;
        min-width: 0;
      }
    }
    @keyframes countPop {
      0% { transform: scale(1); }
      40% { transform: scale(1.25); }
      100% { transform: scale(1); }
    }
    @keyframes bracketSlide {
      0% {
        opacity: 0;
        transform: translateY(8px);
      }
      100% {
        opacity: 1;
        transform: translateY(0);
      }
    }
    .pipeline-bar-enter {
      animation: barEnter 0.5s ${SPRING_EASE} both;
      transform-origin: bottom center;
    }
    .pipeline-bar-exit {
      animation: barExit 0.35s ${SMOOTH_EASE} both;
      overflow: hidden;
    }
    .pipeline-count-pop {
      animation: countPop 0.4s ${SPRING_EASE};
    }
    .pipeline-bracket-enter {
      animation: bracketSlide 0.4s ${SMOOTH_EASE} both;
    }
  `;
  document.head.appendChild(style);
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

  // Track previous filter to drive enter/exit animations
  const [prevFilter, setPrevFilter] = useState<string>("all");
  const [animKey, setAnimKey] = useState(0);

  // Inject keyframe styles on mount
  useEffect(() => injectAnimationStyles(), []);

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

  const handleFilterChange = useCallback((newFilter: string) => {
    setPrevFilter(activeFilter);
    setActiveFilter(newFilter);
    setAnimKey((k) => k + 1);
    setFilterOpen(false);
  }, [activeFilter]);

  const getGroup = (p: SystemPatient): PipelineGroupDef | undefined =>
    PIPELINE_GROUPS.find((g) => g.match?.(p));

  // Build grouped columns
  const columns = useMemo(() => {
    const eligible = patients.filter(
      (p) => CHART_BOARD_IDS.has(p.boardId) && !p.isCompleted,
    );

    const groupMap = new Map<string, GroupColumn>();
    for (const p of eligible) {
      const pg = getGroup(p);
      if (!pg) continue;
      const stageLabel = p.boardId === 18406352652 ? "Profile Checklist" : p.pipelineStage;
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

    const groupIdx = new Map(PIPELINE_GROUPS.map((g, i) => [g.id, i]));
    return Array.from(groupMap.values()).sort((a, b) => {
      const ai = groupIdx.get(a.pipelineGroupId) ?? 99;
      const bi = groupIdx.get(b.pipelineGroupId) ?? 99;
      if (ai !== bi) return ai - bi;
      const group = PIPELINE_GROUPS.find((g) => g.id === a.pipelineGroupId);
      if (group) {
        const aStageIdx = group.stageOrder.indexOf(a.pipelineStage);
        const bStageIdx = group.stageOrder.indexOf(b.pipelineStage);
        const aIdx = aStageIdx >= 0 ? aStageIdx : group.stageOrder.findIndex((s) => a.pipelineStage.startsWith(s));
        const bIdx = bStageIdx >= 0 ? bStageIdx : group.stageOrder.findIndex((s) => b.pipelineStage.startsWith(s));
        return (aIdx >= 0 ? aIdx : 99) - (bIdx >= 0 ? bIdx : 99);
      }
      return a.pipelineStage.localeCompare(b.pipelineStage);
    });
  }, [patients]);

  const filteredColumns = useMemo(() => {
    if (activeFilter === "all") return columns;
    return columns.filter((c) => c.pipelineGroupId === activeFilter);
  }, [columns, activeFilter]);

  const maxTotal = useMemo(
    () => Math.max(...filteredColumns.map((c) => c.total), 1),
    [filteredColumns],
  );

  const totalPatients = useMemo(
    () => filteredColumns.reduce((sum, c) => sum + c.total, 0),
    [filteredColumns],
  );

  const pipelineGroupBrackets = useMemo(() => {
    const brackets: { group: PipelineGroupDef; count: number }[] = [];
    for (const pg of PIPELINE_GROUPS) {
      if (activeFilter !== "all" && pg.id !== activeFilter) continue;
      const count = filteredColumns.filter((c) => c.pipelineGroupId === pg.id).length;
      if (count > 0) brackets.push({ group: pg, count });
    }
    return brackets;
  }, [filteredColumns, activeFilter]);

  const hoveredPatients = useMemo(() => {
    if (!hover) return [];
    const col = filteredColumns[hover.groupIdx];
    if (!col) return [];
    return col.buckets.get(hover.bucketLabel) ?? [];
  }, [hover, filteredColumns]);

  const activeFilterLabel = useMemo(() => {
    if (activeFilter === "all") return "All Groups";
    return PIPELINE_GROUPS.find((g) => g.id === activeFilter)?.label ?? "All Groups";
  }, [activeFilter]);

  if (columns.length === 0) return null;

  return (
    <div className="rounded-xl border bg-card shadow-card p-5 space-y-3">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Group filter dropdown */}
          <div className="relative" ref={filterRef}>
            <button
              onClick={() => setFilterOpen((o) => !o)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all duration-200",
                activeFilter !== "all"
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "bg-muted/50 border-border text-foreground hover:bg-muted",
              )}
            >
              <Filter className="w-3.5 h-3.5" />
              {activeFilterLabel}
              <ChevronDown
                className={cn(
                  "w-3 h-3 transition-transform duration-200",
                  filterOpen && "rotate-180",
                )}
              />
            </button>

            {filterOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 w-56 bg-popover border border-border rounded-lg shadow-lg py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                <button
                  onClick={() => handleFilterChange("all")}
                  className={cn(
                    "w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center gap-2",
                    activeFilter === "all" && "bg-primary/10 text-primary font-semibold",
                  )}
                >
                  <div className="w-2.5 h-2.5 rounded-sm bg-gradient-to-br from-purple-500 to-pink-500" />
                  All Groups
                </button>
                {PIPELINE_GROUPS.map((pg) => {
                  const groupCount = columns.filter((c) => c.pipelineGroupId === pg.id).reduce((s, c) => s + c.total, 0);
                  return (
                    <button
                      key={pg.id}
                      onClick={() => handleFilterChange(pg.id)}
                      className={cn(
                        "w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center gap-2",
                        activeFilter === pg.id && "bg-primary/10 text-primary font-semibold",
                      )}
                    >
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: pg.color }} />
                      {pg.label}
                      <span className="ml-auto text-[10px] text-muted-foreground">{groupCount}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <h3 className="text-sm font-semibold text-foreground">
            Pipeline Overview
          </h3>

          {/* Total patients — inline separator + count */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="text-border">|</span>
            <span
              key={`total-${animKey}`}
              className="font-bold text-foreground tabular-nums pipeline-count-pop"
            >
              {totalPatients}
            </span>
            <span className="text-xs">patients</span>
          </div>
        </div>

        {/* Day-bucket legend */}
        <div className="flex items-center gap-3 flex-wrap">
          {DAY_BUCKETS.map((b) => (
            <div key={b.label} className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: b.color }} />
              <span className="text-[10px] text-muted-foreground">{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Chart area ── */}
      <div className="relative">
        {/* Bars */}
        <div
          key={`bars-${animKey}`}
          className="flex items-end gap-2"
          style={{ height: "360px" }}
        >
          {filteredColumns.map((col, colIdx) => {
            const barHeight = Math.max((col.total / maxTotal) * 320, 12);
            const allBuckets = [...DAY_BUCKETS, UNKNOWN_BUCKET];
            const segments: { bucket: DayBucket; patients: SystemPatient[] }[] = [];
            for (const bucket of allBuckets) {
              const pts = col.buckets.get(bucket.label) ?? [];
              if (pts.length > 0) segments.push({ bucket, patients: pts });
            }

            // Staggered entrance delay per bar
            const staggerDelay = colIdx * 60;

            return (
              <div
                key={`${col.pipelineGroupId}-${col.pipelineStage}`}
                className="flex-1 flex flex-col justify-end items-stretch min-w-[56px] pipeline-bar-enter"
                style={{
                  animationDelay: `${staggerDelay}ms`,
                }}
              >
                {/* Count label */}
                <div
                  className="text-center text-xs font-semibold text-foreground mb-1"
                  style={{
                    opacity: 0,
                    animation: `barEnter 0.4s ${SPRING_EASE} ${staggerDelay + 200}ms both`,
                  }}
                >
                  {col.total}
                </div>

                {/* Stacked bar */}
                <div
                  className="flex flex-col-reverse rounded-t-md overflow-hidden"
                  style={{
                    height: `${barHeight}px`,
                    transition: `height 0.6s ${SMOOTH_EASE}`,
                  }}
                >
                  {segments.map((seg, segIdx) => (
                    <div
                      key={seg.bucket.label}
                      className={cn(
                        "w-full cursor-pointer",
                        hover &&
                          (hover.groupIdx !== colIdx || hover.bucketLabel !== seg.bucket.label)
                          ? "opacity-40"
                          : "opacity-100 hover:brightness-110",
                      )}
                      style={{
                        backgroundColor: seg.bucket.color,
                        flexGrow: seg.patients.length,
                        minHeight: "4px",
                        transition: `opacity 0.2s ease, flex-grow 0.5s ${SMOOTH_EASE}`,
                      }}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
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
                <div
                  className="text-center mt-2 px-0.5"
                  style={{
                    opacity: 0,
                    animation: `barEnter 0.35s ${SMOOTH_EASE} ${staggerDelay + 150}ms both`,
                  }}
                >
                  <div className="text-[11px] font-medium text-foreground leading-tight truncate">
                    {col.pipelineStage}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pipeline group brackets */}
        <div
          key={`brackets-${animKey}`}
          className="flex gap-1.5 mt-1 border-t border-border pt-2"
        >
          {pipelineGroupBrackets.map(({ group, count }, bIdx) => {
            const totalCols = filteredColumns.length;
            const widthPct = (count / totalCols) * 100;
            return (
              <div
                key={group.id}
                className="text-center pipeline-bracket-enter"
                style={{
                  width: `${widthPct}%`,
                  animationDelay: `${bIdx * 80 + 300}ms`,
                  transition: `width 0.6s ${SMOOTH_EASE}`,
                }}
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
              animation: `barEnter 0.15s ${SMOOTH_EASE} both`,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <div
                className="w-3 h-3 rounded-sm"
                style={{ backgroundColor: getBucket(hover.bucketLabel).color }}
              />
              <span className="text-xs font-semibold text-foreground">
                {hover.bucketLabel}
              </span>
              <span className="text-[10px] text-muted-foreground ml-auto">
                {hoveredPatients.length} patient{hoveredPatients.length !== 1 ? "s" : ""}
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
