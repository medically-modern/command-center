/**
 * Pipeline visualization — stacked bar chart showing patient distribution
 * across pipeline groups, color-coded by "Days Since Stage Started".
 *
 * ADD-friendly features (toggle dropdown):
 *   - Focus Mode: solid single-color bars, no stacked segments, larger labels
 *   - Attention Needed: highlights 21+ day overdue patients, dims the rest
 *   - Keyboard Nav: arrow-key navigation with visible shortcut bar
 *
 * Other features:
 *   - Group filter dropdown
 *   - Total Patients inline next to title
 *   - Hover tooltips, click to search
 *   - Spring-eased staggered animations
 */
import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";
import { cn } from "@/lib/utils";
import {
  Filter,
  ChevronDown,
  Zap,
  Eye,
  AlertTriangle,
  Keyboard,
  ArrowLeft,
  ArrowRight,
  CornerDownLeft,
} from "lucide-react";

// ── Day-range buckets ───────────────────────────────────────

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

/** Buckets considered "overdue" for Attention Needed */
const OVERDUE_BUCKETS = new Set(["21-29 Days", "30+ Days"]);

function getBucket(daysSinceStage: string): DayBucket {
  return DAY_BUCKETS.find((b) => b.label === daysSinceStage) ?? UNKNOWN_BUCKET;
}

// ── Easing constants ────────────────────────────────────────

const SPRING_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const SMOOTH_EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

// ── Pipeline groups ─────────────────────────────────────────

export interface PipelineGroupDef {
  id: string;
  label: string;
  color: string;
  boardIds: number[];
  stageOrder: string[];
  match?: (p: SystemPatient) => boolean;
}

const CHART_BOARD_IDS = new Set([18406352652, 18406060017, 18410601299, 18410804557]);

export const PIPELINE_GROUPS: PipelineGroupDef[] = [
  {
    id: "profile-checklist", label: "Profile Checklist", color: "#f59e0b",
    boardIds: [18406352652], stageOrder: ["Profile Checklist"],
    match: (p) => p.boardId === 18406352652,
  },
  {
    id: "medical-eval", label: "Medical Evaluation", color: "#8b5cf6",
    boardIds: [18406060017], stageOrder: ["Evaluate MN", "Send Request", "Confirm Receipt", "Chase Clinicals"],
    match: (p) => p.boardId === 18406060017,
  },
  {
    id: "insurance", label: "Insurance", color: "#ec4899",
    boardIds: [18410601299], stageOrder: ["Benefits / SoS", "Submit Auth.", "Auth. Outstanding", "Auth Denied"],
    match: (p) => p.boardId === 18410601299,
  },
  {
    id: "welcome-call", label: "Welcome Call", color: "#14b8a6",
    boardIds: [18410804557], stageOrder: ["Welcome Call"],
    match: (p) => p.boardId === 18410804557 && p.pipelineStage === "Welcome Call",
  },
  {
    id: "review-profile", label: "Review Profile", color: "#06b6d4",
    boardIds: [18410804557], stageOrder: ["Review Profile", "Final Profile Confirmation"],
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
  /** Number of patients in 21+ day buckets */
  overdueCount: number;
}

interface HoverState {
  groupIdx: number;
  bucketLabel: string;
  x: number;
  y: number;
}

// ── Injected CSS (once) ─────────────────────────────────────

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    @keyframes barEnter {
      0%  { opacity:0; transform:scaleY(0) translateY(20px); }
      60% { opacity:1; transform:scaleY(1.04) translateY(-2px); }
      100%{ opacity:1; transform:scaleY(1) translateY(0); }
    }
    @keyframes countPop {
      0%  { transform:scale(1); }
      40% { transform:scale(1.25); }
      100%{ transform:scale(1); }
    }
    @keyframes bracketSlide {
      0%  { opacity:0; transform:translateY(8px); }
      100%{ opacity:1; transform:translateY(0); }
    }
    @keyframes pulseGlow {
      0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
      50%     { box-shadow: 0 0 12px 4px rgba(239,68,68,0.25); }
    }
    @keyframes focusRing {
      0%,100% { box-shadow: 0 0 0 2px rgba(99,102,241,0.5); }
      50%     { box-shadow: 0 0 0 4px rgba(99,102,241,0.3); }
    }
    @keyframes kbBarSlide {
      0%  { opacity:0; transform:translateY(8px); }
      100%{ opacity:1; transform:translateY(0); }
    }
    .pl-bar-enter {
      animation: barEnter 0.5s ${SPRING_EASE} both;
      transform-origin: bottom center;
    }
    .pl-count-pop { animation: countPop 0.4s ${SPRING_EASE}; }
    .pl-bracket-enter { animation: bracketSlide 0.4s ${SMOOTH_EASE} both; }
    .pl-overdue-pulse { animation: pulseGlow 2s ease-in-out infinite; }
    .pl-kb-focus {
      animation: focusRing 1.5s ease-in-out infinite;
      border-radius: 6px;
    }
    .pl-kb-bar-enter { animation: kbBarSlide 0.3s ${SMOOTH_EASE} both; }
  `;
  document.head.appendChild(s);
}

// ── Component ────────────────────────────────────────────────

interface PipelineChartProps {
  patients: SystemPatient[];
  onSegmentClick: (patients: SystemPatient[]) => void;
}

export function PipelineChart({ patients, onSegmentClick }: PipelineChartProps) {
  // Core state
  const [hover, setHover] = useState<HoverState | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const filterRef = useRef<HTMLDivElement>(null);

  // ADD-friendly state
  const [focusMode, setFocusMode] = useState(false);
  const [attentionNeeded, setAttentionNeeded] = useState(false);
  const [keyboardNav, setKeyboardNav] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const toolsRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const activeToolCount = [focusMode, attentionNeeded, keyboardNav].filter(Boolean).length;

  useEffect(() => injectStyles(), []);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setToolsOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Reset keyboard focus when nav is disabled
  useEffect(() => {
    if (!keyboardNav) setFocusedIdx(-1);
  }, [keyboardNav]);

  const handleFilterChange = useCallback((f: string) => {
    setActiveFilter(f);
    setAnimKey((k) => k + 1);
    setFilterOpen(false);
    setFocusedIdx(-1);
  }, []);

  const getGroup = (p: SystemPatient): PipelineGroupDef | undefined =>
    PIPELINE_GROUPS.find((g) => g.match?.(p));

  // ── Data pipeline ────────────────────────────────────────

  const columns = useMemo(() => {
    const eligible = patients.filter((p) => CHART_BOARD_IDS.has(p.boardId) && !p.isCompleted);
    const map = new Map<string, GroupColumn>();

    for (const p of eligible) {
      const pg = getGroup(p);
      if (!pg) continue;
      const stageLabel = p.boardId === 18406352652 ? "Profile Checklist" : p.pipelineStage;
      const key = `${pg.id}::${stageLabel}`;
      if (!map.has(key)) {
        map.set(key, {
          boardId: p.boardId, boardName: p.boardName,
          groupTitle: stageLabel, pipelineStage: stageLabel,
          pipelineGroupId: pg.id, buckets: new Map(), total: 0, overdueCount: 0,
        });
      }
      const col = map.get(key)!;
      const bucket = getBucket(p.daysSinceStage);
      if (!col.buckets.has(bucket.label)) col.buckets.set(bucket.label, []);
      col.buckets.get(bucket.label)!.push(p);
      col.total++;
      if (OVERDUE_BUCKETS.has(bucket.label)) col.overdueCount++;
    }

    const gIdx = new Map(PIPELINE_GROUPS.map((g, i) => [g.id, i]));
    return Array.from(map.values()).sort((a, b) => {
      const ai = gIdx.get(a.pipelineGroupId) ?? 99;
      const bi = gIdx.get(b.pipelineGroupId) ?? 99;
      if (ai !== bi) return ai - bi;
      const group = PIPELINE_GROUPS.find((g) => g.id === a.pipelineGroupId);
      if (group) {
        const idx = (s: string) => {
          const exact = group.stageOrder.indexOf(s);
          return exact >= 0 ? exact : (group.stageOrder.findIndex((o) => s.startsWith(o)) ?? 99);
        };
        return idx(a.pipelineStage) - idx(b.pipelineStage);
      }
      return a.pipelineStage.localeCompare(b.pipelineStage);
    });
  }, [patients]);

  const filteredColumns = useMemo(() => {
    if (activeFilter === "all") return columns;
    return columns.filter((c) => c.pipelineGroupId === activeFilter);
  }, [columns, activeFilter]);

  const maxTotal = useMemo(() => Math.max(...filteredColumns.map((c) => c.total), 1), [filteredColumns]);

  const totalPatients = useMemo(() => filteredColumns.reduce((s, c) => s + c.total, 0), [filteredColumns]);

  const totalOverdue = useMemo(() => filteredColumns.reduce((s, c) => s + c.overdueCount, 0), [filteredColumns]);

  const pipelineGroupBrackets = useMemo(() => {
    const out: { group: PipelineGroupDef; count: number }[] = [];
    for (const pg of PIPELINE_GROUPS) {
      if (activeFilter !== "all" && pg.id !== activeFilter) continue;
      const count = filteredColumns.filter((c) => c.pipelineGroupId === pg.id).length;
      if (count > 0) out.push({ group: pg, count });
    }
    return out;
  }, [filteredColumns, activeFilter]);

  const hoveredPatients = useMemo(() => {
    if (!hover) return [];
    return filteredColumns[hover.groupIdx]?.buckets.get(hover.bucketLabel) ?? [];
  }, [hover, filteredColumns]);

  const activeFilterLabel = useMemo(() => {
    if (activeFilter === "all") return "All Groups";
    return PIPELINE_GROUPS.find((g) => g.id === activeFilter)?.label ?? "All Groups";
  }, [activeFilter]);

  // ── Keyboard navigation ──────────────────────────────────

  useEffect(() => {
    if (!keyboardNav) return;
    const handler = (e: KeyboardEvent) => {
      const len = filteredColumns.length;
      if (!len) return;

      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          setFocusedIdx((i) => (i < len - 1 ? i + 1 : 0));
          break;
        case "ArrowLeft":
          e.preventDefault();
          setFocusedIdx((i) => (i > 0 ? i - 1 : len - 1));
          break;
        case "Enter": {
          e.preventDefault();
          if (focusedIdx >= 0 && focusedIdx < len) {
            const col = filteredColumns[focusedIdx];
            const allPatients = Array.from(col.buckets.values()).flat();
            onSegmentClick(allPatients);
          }
          break;
        }
        case "Escape":
          e.preventDefault();
          setFocusedIdx(-1);
          break;
        // Number keys 1-5 jump to pipeline groups
        case "1": case "2": case "3": case "4": case "5": {
          const groupNum = parseInt(e.key) - 1;
          const targetGroup = PIPELINE_GROUPS[groupNum];
          if (targetGroup) {
            const targetIdx = filteredColumns.findIndex((c) => c.pipelineGroupId === targetGroup.id);
            if (targetIdx >= 0) {
              e.preventDefault();
              setFocusedIdx(targetIdx);
            }
          }
          break;
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [keyboardNav, filteredColumns, focusedIdx, onSegmentClick]);

  if (columns.length === 0) return null;

  // ── Render helpers ───────────────────────────────────────

  /** Get group color for a column */
  const groupColor = (col: GroupColumn) =>
    PIPELINE_GROUPS.find((g) => g.id === col.pipelineGroupId)?.color ?? "#888";

  /** Should a bar be dimmed (attention mode but no overdue patients) */
  const isDimmed = (col: GroupColumn) => attentionNeeded && col.overdueCount === 0;

  return (
    <div className="rounded-xl border bg-card shadow-card p-5 space-y-3" ref={chartRef}>
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
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
              <ChevronDown className={cn("w-3 h-3 transition-transform duration-200", filterOpen && "rotate-180")} />
            </button>
            {filterOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 w-56 bg-popover border border-border rounded-lg shadow-lg py-1 animate-in fade-in slide-in-from-top-1 duration-150">
                <button onClick={() => handleFilterChange("all")} className={cn("w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center gap-2", activeFilter === "all" && "bg-primary/10 text-primary font-semibold")}>
                  <div className="w-2.5 h-2.5 rounded-sm bg-gradient-to-br from-purple-500 to-pink-500" /> All Groups
                </button>
                {PIPELINE_GROUPS.map((pg) => {
                  const gc = columns.filter((c) => c.pipelineGroupId === pg.id).reduce((s, c) => s + c.total, 0);
                  return (
                    <button key={pg.id} onClick={() => handleFilterChange(pg.id)} className={cn("w-full text-left px-3 py-2 text-xs hover:bg-muted/50 transition-colors flex items-center gap-2", activeFilter === pg.id && "bg-primary/10 text-primary font-semibold")}>
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: pg.color }} />
                      {pg.label}
                      <span className="ml-auto text-[10px] text-muted-foreground">{gc}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* ADD tools dropdown */}
          <div className="relative" ref={toolsRef}>
            <button
              onClick={() => setToolsOpen((o) => !o)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all duration-200",
                activeToolCount > 0
                  ? "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
                  : "bg-muted/50 border-border text-foreground hover:bg-muted",
              )}
            >
              <Zap className="w-3.5 h-3.5" />
              Tools
              {activeToolCount > 0 && (
                <span className="ml-0.5 w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center">
                  {activeToolCount}
                </span>
              )}
              <ChevronDown className={cn("w-3 h-3 transition-transform duration-200", toolsOpen && "rotate-180")} />
            </button>

            {toolsOpen && (
              <div className="absolute left-0 top-full mt-1 z-50 w-72 bg-popover border border-border rounded-lg shadow-lg py-2 px-1 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="px-2 pb-2 mb-1 border-b border-border">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Accessibility Tools</div>
                </div>

                {/* Focus Mode */}
                <ToolToggle
                  active={focusMode}
                  onToggle={() => { setFocusMode((v) => !v); setAnimKey((k) => k + 1); }}
                  icon={<Eye className="w-4 h-4" />}
                  label="Focus Mode"
                  description="Simple solid bars, no color stacking. Reduces visual noise so you can scan counts at a glance."
                  color="#6366f1"
                />

                {/* Attention Needed */}
                <ToolToggle
                  active={attentionNeeded}
                  onToggle={() => { setAttentionNeeded((v) => !v); setAnimKey((k) => k + 1); }}
                  icon={<AlertTriangle className="w-4 h-4" />}
                  label="Attention Needed"
                  description={`Highlights patients waiting 21+ days. ${totalOverdue > 0 ? `${totalOverdue} overdue right now.` : "None overdue currently."}`}
                  color="#ef4444"
                  badge={totalOverdue > 0 ? totalOverdue : undefined}
                />

                {/* Keyboard Navigation */}
                <ToolToggle
                  active={keyboardNav}
                  onToggle={() => { setKeyboardNav((v) => !v); if (!keyboardNav) setFocusedIdx(0); }}
                  icon={<Keyboard className="w-4 h-4" />}
                  label="Keyboard Navigation"
                  description="Use arrow keys to move between bars. Enter to select. Numbers 1-5 jump to groups."
                  color="#14b8a6"
                />
              </div>
            )}
          </div>

          <h3 className="text-sm font-semibold text-foreground">Pipeline Overview</h3>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="text-border">|</span>
            <span key={`t-${animKey}`} className="font-bold text-foreground tabular-nums pl-count-pop">{totalPatients}</span>
            <span className="text-xs">patients</span>
            {attentionNeeded && totalOverdue > 0 && (
              <>
                <span className="text-border">·</span>
                <span className="font-bold text-red-500 tabular-nums">{totalOverdue}</span>
                <span className="text-xs text-red-500">overdue</span>
              </>
            )}
          </div>
        </div>

        {/* Day-bucket legend — hidden in focus mode */}
        {!focusMode && (
          <div className="flex items-center gap-3 flex-wrap transition-opacity duration-300">
            {DAY_BUCKETS.map((b) => (
              <div key={b.label} className={cn("flex items-center gap-1 transition-opacity duration-200", attentionNeeded && !OVERDUE_BUCKETS.has(b.label) && "opacity-30")}>
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: b.color }} />
                <span className="text-[10px] text-muted-foreground">{b.label}</span>
              </div>
            ))}
          </div>
        )}
        {focusMode && (
          <div className="text-xs text-muted-foreground italic">Focus Mode — simplified view</div>
        )}
      </div>

      {/* ── Chart ── */}
      <div className="relative">
        <div key={`bars-${animKey}`} className="flex items-end gap-2" style={{ height: focusMode ? "320px" : "360px" }}>
          {filteredColumns.map((col, colIdx) => {
            const barHeight = Math.max((col.total / maxTotal) * (focusMode ? 280 : 320), 12);
            const stagger = colIdx * 60;
            const dimmed = isDimmed(col);
            const focused = keyboardNav && focusedIdx === colIdx;

            return (
              <div
                key={`${col.pipelineGroupId}-${col.pipelineStage}`}
                className={cn(
                  "flex-1 flex flex-col justify-end items-stretch pl-bar-enter",
                  focusMode ? "min-w-[72px]" : "min-w-[56px]",
                  focused && "pl-kb-focus",
                )}
                style={{
                  animationDelay: `${stagger}ms`,
                  transition: `opacity 0.4s ${SMOOTH_EASE}`,
                  opacity: dimmed ? 0.25 : 1,
                }}
              >
                {/* Count + overdue badge */}
                <div
                  className="text-center mb-1 relative"
                  style={{ opacity: 0, animation: `barEnter 0.4s ${SPRING_EASE} ${stagger + 200}ms both` }}
                >
                  <span className={cn(
                    "text-xs font-semibold tabular-nums",
                    focusMode ? "text-base" : "text-xs",
                    dimmed ? "text-muted-foreground" : "text-foreground",
                  )}>
                    {col.total}
                  </span>
                  {attentionNeeded && col.overdueCount > 0 && (
                    <span className="absolute -top-1 -right-0.5 w-5 h-5 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center pl-overdue-pulse">
                      {col.overdueCount}
                    </span>
                  )}
                </div>

                {/* Bar */}
                <div
                  className={cn(
                    "rounded-t-md overflow-hidden",
                    !focusMode && "flex flex-col-reverse",
                    attentionNeeded && col.overdueCount > 0 && "pl-overdue-pulse",
                  )}
                  style={{
                    height: `${barHeight}px`,
                    transition: `height 0.6s ${SMOOTH_EASE}`,
                  }}
                >
                  {focusMode ? (
                    /* Focus mode: single solid bar in group color */
                    <div
                      className={cn(
                        "w-full h-full rounded-t-md cursor-pointer transition-all duration-200",
                        hover && hover.groupIdx === colIdx ? "brightness-110" : "",
                        focused && "ring-2 ring-indigo-400 ring-offset-1",
                      )}
                      style={{ backgroundColor: groupColor(col) }}
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setHover({ groupIdx: colIdx, bucketLabel: "__all__", x: rect.left + rect.width / 2, y: rect.top });
                      }}
                      onMouseLeave={() => setHover(null)}
                      onClick={() => {
                        const allPts = Array.from(col.buckets.values()).flat();
                        onSegmentClick(attentionNeeded ? allPts.filter((p) => OVERDUE_BUCKETS.has(getBucket(p.daysSinceStage).label)) : allPts);
                      }}
                    />
                  ) : (
                    /* Normal mode: stacked segments */
                    [...DAY_BUCKETS, UNKNOWN_BUCKET].map((bucket) => {
                      const pts = col.buckets.get(bucket.label) ?? [];
                      if (pts.length === 0) return null;
                      const isOverdueSeg = OVERDUE_BUCKETS.has(bucket.label);
                      return (
                        <div
                          key={bucket.label}
                          className={cn(
                            "w-full cursor-pointer",
                            hover && (hover.groupIdx !== colIdx || hover.bucketLabel !== bucket.label)
                              ? "opacity-40" : "opacity-100 hover:brightness-110",
                            attentionNeeded && !isOverdueSeg && "opacity-20",
                          )}
                          style={{
                            backgroundColor: bucket.color,
                            flexGrow: pts.length,
                            minHeight: "4px",
                            transition: `opacity 0.2s ease, flex-grow 0.5s ${SMOOTH_EASE}`,
                          }}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setHover({ groupIdx: colIdx, bucketLabel: bucket.label, x: rect.left + rect.width / 2, y: rect.top });
                          }}
                          onMouseLeave={() => setHover(null)}
                          onClick={() => onSegmentClick(pts)}
                        />
                      );
                    })
                  )}
                </div>

                {/* Stage label */}
                <div
                  className="text-center mt-2 px-0.5"
                  style={{ opacity: 0, animation: `barEnter 0.35s ${SMOOTH_EASE} ${stagger + 150}ms both` }}
                >
                  <div className={cn(
                    "font-medium text-foreground leading-tight truncate",
                    focusMode ? "text-xs" : "text-[11px]",
                    dimmed && "text-muted-foreground",
                  )}>
                    {col.pipelineStage}
                  </div>
                  {/* In attention mode, show overdue count under label */}
                  {attentionNeeded && col.overdueCount > 0 && (
                    <div className="text-[10px] text-red-500 font-semibold mt-0.5">
                      {col.overdueCount} overdue
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Brackets */}
        <div key={`br-${animKey}`} className="flex gap-1.5 mt-1 border-t border-border pt-2">
          {pipelineGroupBrackets.map(({ group, count }, bIdx) => {
            const widthPct = (count / filteredColumns.length) * 100;
            return (
              <div
                key={group.id}
                className="text-center pl-bracket-enter"
                style={{ width: `${widthPct}%`, animationDelay: `${bIdx * 80 + 300}ms`, transition: `width 0.6s ${SMOOTH_EASE}` }}
              >
                <div className="h-0.5 rounded-full mx-2" style={{ backgroundColor: group.color }} />
                <div className="text-[10px] font-semibold mt-1 truncate" style={{ color: group.color }}>{group.label}</div>
              </div>
            );
          })}
        </div>

        {/* Hover tooltip */}
        {hover && (hover.bucketLabel === "__all__" ? (
          /* Focus mode tooltip: show full breakdown */
          <FocusTooltip
            col={filteredColumns[hover.groupIdx]}
            x={hover.x}
            y={hover.y}
            attentionNeeded={attentionNeeded}
          />
        ) : hoveredPatients.length > 0 && (
          <div
            className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg p-3 max-w-[260px] pointer-events-none"
            style={{ left: `${hover.x}px`, top: `${hover.y - 8}px`, transform: "translate(-50%, -100%)", animation: `barEnter 0.15s ${SMOOTH_EASE} both` }}
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: getBucket(hover.bucketLabel).color }} />
              <span className="text-xs font-semibold text-foreground">{hover.bucketLabel}</span>
              <span className="text-[10px] text-muted-foreground ml-auto">{hoveredPatients.length} patient{hoveredPatients.length !== 1 ? "s" : ""}</span>
            </div>
            <div className="space-y-1 max-h-[160px] overflow-y-auto">
              {hoveredPatients.slice(0, 10).map((p) => (
                <div key={p.id} className="text-xs text-foreground truncate">{p.name}</div>
              ))}
              {hoveredPatients.length > 10 && <div className="text-[10px] text-muted-foreground">+{hoveredPatients.length - 10} more…</div>}
            </div>
            <div className="text-[10px] text-muted-foreground mt-2 border-t border-border pt-1">Click to view in search</div>
          </div>
        ))}
      </div>

      {/* ── Keyboard shortcut bar ── */}
      {keyboardNav && (
        <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg bg-muted/60 border border-border pl-kb-bar-enter">
          <Keyboard className="w-4 h-4 text-muted-foreground shrink-0" />
          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
            <Shortcut keys={["←", "→"]} label="Navigate" />
            <Shortcut keys={["Enter"]} label="Select" icon={<CornerDownLeft className="w-3 h-3" />} />
            <Shortcut keys={["1", "–", "5"]} label="Jump to group" />
            <Shortcut keys={["Esc"]} label="Clear focus" />
          </div>
          {focusedIdx >= 0 && focusedIdx < filteredColumns.length && (
            <div className="ml-auto flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Focused:</span>
              <span className="font-semibold text-foreground">{filteredColumns[focusedIdx].pipelineStage}</span>
              <span className="text-muted-foreground">({filteredColumns[focusedIdx].total} patients)</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────

/** Toggle button for ADD tools dropdown */
function ToolToggle({
  active, onToggle, icon, label, description, color, badge,
}: {
  active: boolean;
  onToggle: () => void;
  icon: React.ReactNode;
  label: string;
  description: string;
  color: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onToggle}
      className={cn(
        "w-full text-left px-2 py-2.5 rounded-md transition-all duration-200 flex items-start gap-3 group",
        active ? "bg-muted/80" : "hover:bg-muted/40",
      )}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-all duration-200",
          active ? "text-white shadow-sm" : "text-muted-foreground bg-muted",
        )}
        style={active ? { backgroundColor: color } : undefined}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn("text-xs font-semibold", active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}>{label}</span>
          {badge !== undefined && badge > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 text-[10px] font-bold">{badge}</span>
          )}
          <div className={cn(
            "ml-auto w-8 h-[18px] rounded-full transition-all duration-200 relative",
            active ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600",
          )}>
            <div className={cn(
              "absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-all duration-200",
              active ? "left-[18px]" : "left-[2px]",
            )} />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{description}</p>
      </div>
    </button>
  );
}

/** Keyboard shortcut hint chip */
function Shortcut({ keys, label, icon }: { keys: string[]; label: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-0.5">
        {keys.map((k, i) => (
          <kbd key={i} className="px-1.5 py-0.5 rounded bg-background border border-border text-[10px] font-mono font-semibold text-foreground shadow-sm min-w-[20px] text-center">
            {k}
          </kbd>
        ))}
      </div>
      <span className="flex items-center gap-1">{icon}{label}</span>
    </div>
  );
}

/** Tooltip for focus mode — shows a summary breakdown of the bar */
function FocusTooltip({ col, x, y, attentionNeeded }: { col: GroupColumn | undefined; x: number; y: number; attentionNeeded: boolean }) {
  if (!col) return null;
  const allPts = Array.from(col.buckets.values()).flat();
  const groupDef = PIPELINE_GROUPS.find((g) => g.id === col.pipelineGroupId);

  return (
    <div
      className="fixed z-50 bg-popover border border-border rounded-lg shadow-lg p-3 max-w-[280px] pointer-events-none"
      style={{ left: `${x}px`, top: `${y - 8}px`, transform: "translate(-50%, -100%)", animation: `barEnter 0.15s ${SMOOTH_EASE} both` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: groupDef?.color ?? "#888" }} />
        <span className="text-xs font-semibold text-foreground">{col.pipelineStage}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{col.total} total</span>
      </div>

      {/* Compact breakdown */}
      <div className="space-y-1">
        {[...DAY_BUCKETS, UNKNOWN_BUCKET].map((b) => {
          const pts = col.buckets.get(b.label) ?? [];
          if (pts.length === 0) return null;
          const isOverdue = OVERDUE_BUCKETS.has(b.label);
          return (
            <div key={b.label} className={cn("flex items-center gap-2 text-xs", attentionNeeded && !isOverdue && "opacity-40")}>
              <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: b.color }} />
              <span className="text-muted-foreground flex-1">{b.label}</span>
              <span className={cn("font-semibold tabular-nums", isOverdue && attentionNeeded ? "text-red-500" : "text-foreground")}>{pts.length}</span>
            </div>
          );
        })}
      </div>

      {col.overdueCount > 0 && (
        <div className="mt-2 pt-1 border-t border-border text-[10px] text-red-500 font-semibold">
          {col.overdueCount} patient{col.overdueCount !== 1 ? "s" : ""} overdue (21+ days)
        </div>
      )}

      <div className="text-[10px] text-muted-foreground mt-1 pt-1 border-t border-border">
        Click to view {attentionNeeded ? "overdue " : ""}patients
      </div>
    </div>
  );
}
