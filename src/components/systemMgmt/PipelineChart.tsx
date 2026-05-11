/**
 * Pipeline visualization — stacked bar chart showing patient distribution
 * across groups/boards, color-coded by "Days Since Stage Started".
 *
 * Only shows Medical Evaluation, Insurance, and Welcome Call boards.
 * Excludes escalation and completed groups.
 * Filters in sync with the search bar.
 * Hover → tooltip with patient names. Click → populates search results.
 */
import { useMemo, useState } from "react";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";
import { cn } from "@/lib/utils";

// ── Day-range buckets using Monday's actual status labels + colors ────

export interface DayBucket {
  label: string;
  color: string;
  /** Tailwind bg class for hover/tooltip use */
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

// ── Chart-eligible boards (only these 3) ─────────────────────

const CHART_BOARD_IDS = new Set([18406060017, 18410601299, 18410804557]);

/** Board display order */
const BOARD_ORDER: { boardId: number; label: string; color: string }[] = [
  { boardId: 18406060017, label: "Medical Evaluation", color: "#8b5cf6" },
  { boardId: 18410601299, label: "Insurance",          color: "#ec4899" },
  { boardId: 18410804557, label: "Welcome Call",       color: "#14b8a6" },
];

// ── Types ────────────────────────────────────────────────────

interface GroupColumn {
  boardId: number;
  boardName: string;
  groupTitle: string;
  /** pipeline stage label (uses Stage Advancer for MN) */
  pipelineStage: string;
  /** Patients in each day bucket */
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
  /** All patients (pre-search-filtered) */
  patients: SystemPatient[];
  /** Callback when user clicks a segment — sets search to show these patients */
  onSegmentClick: (patients: SystemPatient[]) => void;
}

export function PipelineChart({ patients, onSegmentClick }: PipelineChartProps) {
  const [hover, setHover] = useState<HoverState | null>(null);

  // Build grouped columns from patients
  const columns = useMemo(() => {
    // Filter to chart-eligible, non-escalation, non-completed, active patients
    const eligible = patients.filter(
      (p) =>
        CHART_BOARD_IDS.has(p.boardId) &&
        !p.isCompleted &&
        !p.isInEscalationGroup,
    );

    // Group by boardId + pipelineStage
    const groupMap = new Map<string, GroupColumn>();

    for (const p of eligible) {
      const key = `${p.boardId}::${p.pipelineStage}`;
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          boardId: p.boardId,
          boardName: p.boardName,
          groupTitle: p.pipelineStage,
          pipelineStage: p.pipelineStage,
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

    // Sort: by board order, then by group title
    const boardIdx = new Map(BOARD_ORDER.map((b, i) => [b.boardId, i]));
    const cols = Array.from(groupMap.values()).sort((a, b) => {
      const ai = boardIdx.get(a.boardId) ?? 99;
      const bi = boardIdx.get(b.boardId) ?? 99;
      if (ai !== bi) return ai - bi;
      return a.groupTitle.localeCompare(b.groupTitle);
    });

    return cols;
  }, [patients]);

  const maxTotal = useMemo(
    () => Math.max(...columns.map((c) => c.total), 1),
    [columns],
  );

  if (columns.length === 0) {
    return null;
  }

  // Group columns by board for bracket rendering
  const boardGroups = useMemo(() => {
    const groups: { board: (typeof BOARD_ORDER)[0]; startIdx: number; count: number }[] = [];
    let idx = 0;
    for (const board of BOARD_ORDER) {
      const count = columns.filter((c) => c.boardId === board.boardId).length;
      if (count > 0) {
        groups.push({ board, startIdx: idx, count });
        idx += count;
      }
    }
    return groups;
  }, [columns]);

  // Hovered segment patients
  const hoveredPatients = useMemo(() => {
    if (!hover) return [];
    const col = columns[hover.groupIdx];
    if (!col) return [];
    return col.buckets.get(hover.bucketLabel) ?? [];
  }, [hover, columns]);

  return (
    <div className="rounded-xl border bg-card shadow-card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">
          Pipeline Overview
        </h3>
        <div className="flex items-center gap-3 flex-wrap">
          {DAY_BUCKETS.map((b) => (
            <div key={b.label} className="flex items-center gap-1">
              <div
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: b.color }}
              />
              <span className="text-[10px] text-muted-foreground">{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Chart area */}
      <div className="relative">
        {/* Bars */}
        <div className="flex items-end gap-2" style={{ height: "220px" }}>
          {columns.map((col, colIdx) => {
            const barHeight = Math.max((col.total / maxTotal) * 200, 8);
            // Build stacked segments (bottom to top: least urgent → most urgent)
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
                key={`${col.boardId}-${col.pipelineStage}`}
                className="flex-1 flex flex-col justify-end items-stretch min-w-[48px]"
              >
                {/* Count label */}
                <div className="text-center text-xs font-semibold text-foreground mb-1">
                  {col.total}
                </div>

                {/* Stacked bar */}
                <div
                  className="flex flex-col-reverse rounded-t-md overflow-hidden"
                  style={{ height: `${barHeight}px` }}
                >
                  {segments.map((seg) => (
                    <div
                      key={seg.bucket.label}
                      className={cn(
                        "w-full cursor-pointer transition-opacity",
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

                {/* Group label */}
                <div className="text-center mt-2 px-0.5">
                  <div className="text-[11px] font-medium text-foreground leading-tight truncate">
                    {col.pipelineStage}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Board brackets */}
        <div className="flex gap-1.5 mt-1 border-t border-border pt-2">
          {boardGroups.map(({ board, startIdx, count }) => {
            // Calculate flex basis to match columns
            const totalCols = columns.length;
            const widthPct = (count / totalCols) * 100;
            return (
              <div
                key={board.boardId}
                className="text-center"
                style={{ width: `${widthPct}%` }}
              >
                <div
                  className="h-0.5 rounded-full mx-2"
                  style={{ backgroundColor: board.color }}
                />
                <div
                  className="text-[10px] font-semibold mt-1 truncate"
                  style={{ color: board.color }}
                >
                  {board.label}
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
