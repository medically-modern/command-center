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
  fetchPriorityOptions,
  fetchPillColors,
  CHART_DEFS,
  OVERSIGHT_SECTIONS,
  DAY_BUCKET_LABELS,
  DAY_BUCKET_COLORS,
  type OversightPatient,
  type ChartDef,
  type DayBucketLabel,
} from "@/lib/oversight/oversightApi";
import { Loader2, BarChart3, X, ExternalLink, StickyNote, Search, ArrowUp, ArrowDown, ArrowUpDown, Star, SlidersHorizontal, Plus, Trash2, RotateCcw } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  loadPriorityConfig,
  savePriorityConfig,
  isVip,
  DEFAULT_PRIORITY_CONFIG,
  DAY_BUCKETS_ORDERED,
  type PriorityConfig,
  type PriorityTier,
} from "@/lib/oversight/priority";

// ── Chart ID → Command Center route mapping ──────────────────────────────

const CHART_ROUTES: Record<string, string | null> = {
  "dtc-partial-leads": null,        // no CC view
  "dtc-raw-intake": null,           // no CC view
  "profile-send-off": "/profile",
  "evaluate": "/evaluate",
  "send-request": "/send-request",
  "confirm-receipt": "/confirm-receipt",
  "confirm-receipt-escalations": "/confirm-receipt",
  "chase-clinicals": "/chase-fax", // chase split June 2026 — deep links land on the fax role (parachute patients still open via ?patientId injection)
  "chase-clinicals-escalations": "/chase-fax",
  "benefits": "/benefits",
  "submit-auth": "/submit-auth",
  "auth-outstanding": "/auth-outstanding",
  "auth-denial": null,              // no CC view yet
  "welcome-call": "/welcome-call",
};

// ── Constants ──────────────────────────────────────────────────────────────

const POLL_MS = 90_000;
const LS_CACHE_KEY = "oversight-cache";

// ── "Requesting" summary (Send Request / Confirm Receipt / Chase) ─────────
// Derived from the MN Request Consolidated dropdown — the actual doctor-facing
// ask list. Up to four pills:
//   CGM Script / IP Script  → that script document is being requested
//   MR                      → medical records document is being requested
//   Language in MR          → records exist but coverage language is missing
// MR and "Language in MR" are mutually exclusive: if we still need the records
// document, we don't separately call out the language.
const REQ_CONSOLIDATED_COL = "dropdown_mm2yd3a2";
const REQ_COLORS: Record<string, string> = {
  "CGM Script": "#0ea5e9",
  "IP Script": "#8b5cf6",
  MR: "#f59e0b",
  "Language in MR": "#db2777",
};
const LANG_KEYWORDS = [
  "language",
  "education",
  "injection",
  "blood sugar",
  "cgm use",
  "current cgm",
  "hypoglyc",
];

function requestingPills(p: OversightPatient): string[] {
  const items = (p.cols[REQ_CONSOLIDATED_COL] ?? "").toLowerCase();
  if (!items.trim()) return [];
  const pills: string[] = [];
  if (items.includes("cgm script")) pills.push("CGM Script");
  if (items.includes("pump script")) pills.push("IP Script");
  const needsMr = items.includes("medical records") || items.includes("letter of medical necessity");
  if (needsMr) {
    pills.push("MR");
  } else if (LANG_KEYWORDS.some((k) => items.includes(k))) {
    pills.push("Language in MR");
  }
  return pills;
}

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
  priorityConfig: PriorityConfig;
  onChartClick: () => void;
  onBarClick: (bucket: DayBucketLabel) => void;
}

const VIP_COLOR = "var(--mm-teal)";

function StageChart({ chart, patients, priorityConfig, onChartClick, onBarClick }: StageChartProps) {
  const bucketCounts = useMemo(() => {
    const counts: Record<DayBucketLabel, number> = {} as Record<DayBucketLabel, number>;
    const vipCounts: Record<DayBucketLabel, number> = {} as Record<DayBucketLabel, number>;
    for (const label of DAY_BUCKET_LABELS) {
      counts[label] = 0;
      vipCounts[label] = 0;
    }
    let unknownCount = 0;
    let totalVip = 0;

    for (const p of patients) {
      const vip = isVip(p, priorityConfig);
      if (p.dayBucket === "Unknown") {
        unknownCount++;
      } else {
        counts[p.dayBucket]++;
        if (vip) vipCounts[p.dayBucket]++;
      }
      if (vip) totalVip++;
    }
    return { counts, vipCounts, unknownCount, totalVip };
  }, [patients, priorityConfig]);

  const { counts, vipCounts, unknownCount, totalVip } = bucketCounts;
  const totalCount = patients.length;
  const maxCount = useMemo(
    () => Math.max(1, ...Object.values(counts)),
    [counts],
  );

  return (
    <div
      className={cn(
        "rounded-2xl border bg-card shadow-sm p-4 transition-all duration-200",
        "text-left w-full",
        "border-border hover:shadow-md hover:ring-1 hover:ring-foreground/10",
      )}
    >
      {/* Header — clickable to show all patients */}
      <button
        onClick={onChartClick}
        className="flex items-center justify-between mb-3 w-full text-left group cursor-pointer"
      >
        <h3 className="text-[0.95rem] font-bold tracking-tight text-foreground truncate min-w-0 group-hover:underline decoration-foreground/30 underline-offset-4">
          {chart.title}
        </h3>
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          {totalVip > 0 && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white"
              style={{ backgroundColor: VIP_COLOR }}
              title={`${totalVip} priority patient${totalVip !== 1 ? "s" : ""}`}
            >
              <Star className="h-2.5 w-2.5 fill-white" />
              {totalVip}
            </span>
          )}
          <span className="text-2xl font-bold text-foreground tabular-nums leading-none">
            {totalCount}
          </span>
        </div>
      </button>

      {/* Bar chart — each bar clickable to filter */}
      <div className="flex items-end gap-1.5 h-[200px]">
        {DAY_BUCKET_LABELS.map((label) => {
          const count = counts[label];
          const vip = vipCounts[label];
          const heightPct = count > 0 ? (count / maxCount) * 100 : 0;

          return (
            <button
              key={label}
              onClick={(e) => {
                e.stopPropagation();
                if (count > 0) onBarClick(label);
              }}
              className={cn(
                "flex-1 flex flex-col items-center justify-end h-full group/bar",
                count > 0 ? "cursor-pointer" : "cursor-default",
              )}
              title={`${label}: ${count} patient${count !== 1 ? "s" : ""}${vip > 0 ? ` · ${vip} VIP` : ""}`}
            >
              {/* VIP count (gold ★) for this bucket */}
              <span className="text-[8px] font-bold leading-none h-2.5" style={{ color: vip > 0 ? VIP_COLOR : "transparent" }}>
                {vip > 0 ? `★${vip}` : "★"}
              </span>

              {/* Count above bar */}
              <span className="text-[9px] tabular-nums font-semibold mb-0.5 text-muted-foreground h-3">
                {count > 0 ? count : ""}
              </span>

              {/* Bar — VIP portion highlighted gold at the top */}
              <div className="w-full flex items-end justify-center flex-1">
                <div
                  className={cn(
                    "w-full rounded-t-md overflow-hidden flex flex-col justify-start transition-all duration-300 ease-out",
                    count > 0 && "group-hover/bar:opacity-80 group-hover/bar:ring-1 group-hover/bar:ring-foreground/30",
                    count === 0 && "invisible",
                  )}
                  style={{
                    height: count > 0 ? `${Math.max(heightPct, 3)}%` : "0%",
                    backgroundColor: DAY_BUCKET_COLORS[label],
                    minHeight: count > 0 ? "4px" : undefined,
                  }}
                >
                  {vip > 0 && (
                    <div
                      style={{ height: `${(vip / count) * 100}%`, backgroundColor: VIP_COLOR }}
                      title={`${vip} VIP`}
                    />
                  )}
                </div>
              </div>

              {/* Label below */}
              <span className="text-[8px] mt-1 text-muted-foreground whitespace-nowrap">
                {BUCKET_SHORT_LABELS[label]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Unknown note */}
      {unknownCount > 0 && (
        <p className="text-[9px] text-muted-foreground mt-1.5 text-right">
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
  priorityConfig: PriorityConfig;
  pillColors: Record<string, Record<string, string>>;
  onBucketChange: (bucket: DayBucketLabel | "all") => void;
  onClose: () => void;
  onPatientClick: (patientId: string) => void;
  hasRoute: boolean;
}

/** Sortable table header cell. */
function Th({
  label,
  dir,
  onClick,
  width,
}: {
  label: string;
  dir: "asc" | "desc" | null;
  onClick: () => void;
  width?: string;
}) {
  return (
    <th className={cn("text-left px-2 py-1.5 font-medium text-muted-foreground select-none", width)}>
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1 max-w-full hover:text-foreground transition-colors"
        title={`Sort by ${label}`}
      >
        <span className="truncate">{label}</span>
        {dir === null ? (
          <ArrowUpDown className="h-3 w-3 opacity-30 shrink-0" />
        ) : dir === "asc" ? (
          <ArrowUp className="h-3 w-3 shrink-0" />
        ) : (
          <ArrowDown className="h-3 w-3 shrink-0" />
        )}
      </button>
    </th>
  );
}

function DrilldownModal({
  chart,
  patients,
  bucket,
  priorityConfig,
  pillColors,
  onBucketChange,
  onClose,
  onPatientClick,
  hasRoute,
}: DrilldownModalProps) {
  const [notesOpenId, setNotesOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // sortKey: "name" | "days" | a column id; null = default (day bucket desc)
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Close on Escape (notes popup first, then the modal)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (notesOpenId) setNotesOpenId(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, notesOpenId]);

  // Columns in the chart's authored order. The "Days in Stage" column renders
  // as the day-bucket pill wherever the chart places it.
  const cols = chart.drilldownCols;
  const isDaysCol = (label: string) => label === "Days in Stage";

  // Day-bucket counts for the bar chart + filtering
  const bucketCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const label of DAY_BUCKET_LABELS) counts[label] = 0;
    for (const p of patients) if (p.dayBucket !== "Unknown") counts[p.dayBucket]++;
    return counts;
  }, [patients]);
  const maxBucket = useMemo(
    () => Math.max(1, ...DAY_BUCKET_LABELS.map((l) => bucketCounts[l] ?? 0)),
    [bucketCounts],
  );

  const setSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "days" ? "desc" : "asc");
    }
  };

  const filtered = useMemo(() => {
    let list = bucket === "all" ? patients : patients.filter((p) => p.dayBucket === bucket);

    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.dayBucket.toLowerCase().includes(q) ||
          cols.some((c) => (p.cols[c.colId] ?? "").toLowerCase().includes(q)),
      );
    }

    // If sorting by the Days column, sort by the actual day-bucket order.
    const sortCol = sortKey ? cols.find((c) => c.colId === sortKey) : null;
    const sortingDays = !!sortCol && isDaysCol(sortCol.label);

    const sorted = [...list];
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      sorted.sort((a, b) => {
        let av: string | number;
        let bv: string | number;
        if (sortKey === "name") {
          av = a.name.toLowerCase();
          bv = b.name.toLowerCase();
        } else if (sortingDays) {
          return (bucketSortValue(a.dayBucket) - bucketSortValue(b.dayBucket)) * dir;
        } else {
          av = (a.cols[sortKey] ?? "").toLowerCase();
          bv = (b.cols[sortKey] ?? "").toLowerCase();
        }
        // Numeric compare when both values are purely numeric (dates/counts)
        const an = parseFloat(av as string);
        const bn = parseFloat(bv as string);
        const numeric =
          !Number.isNaN(an) &&
          !Number.isNaN(bn) &&
          /^[\d.,$%\s/-]+$/.test(av as string) &&
          /^[\d.,$%\s/-]+$/.test(bv as string);
        if (numeric) return (an - bn) * dir;
        return String(av).localeCompare(String(bv)) * dir;
      });
    } else {
      sorted.sort((a, b) => bucketSortValue(b.dayBucket) - bucketSortValue(a.dayBucket));
    }
    return sorted;
  }, [patients, bucket, search, sortKey, sortDir, cols]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card w-screen h-screen max-w-none max-h-none flex flex-col animate-in fade-in duration-150">
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <BarChart3 className="h-4 w-4 text-blue-500 shrink-0" />
            <h3 className="text-base font-semibold text-foreground truncate">
              {chart.title}
            </h3>
            <span className="text-xs text-muted-foreground shrink-0">
              {patients.length} total{bucket !== "all" ? ` · ${bucket}` : ""}
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

        {/* Bar chart — days-in-stage distribution; click a bar to filter */}
        <div className="px-5 pt-4 pb-3 border-b shrink-0">
          <div className="flex items-end gap-2 h-[140px]">
            {DAY_BUCKET_LABELS.map((label) => {
              const count = bucketCounts[label] ?? 0;
              const heightPct = count > 0 ? (count / maxBucket) * 100 : 0;
              const selected = bucket === label;
              const dimmed = bucket !== "all" && !selected;
              return (
                <button
                  key={label}
                  onClick={() => count > 0 && onBucketChange(selected ? "all" : label)}
                  className={cn(
                    "flex-1 flex flex-col items-center justify-end h-full group",
                    count > 0 ? "cursor-pointer" : "cursor-default",
                  )}
                  title={`${label}: ${count} patient${count !== 1 ? "s" : ""}`}
                >
                  <span className="text-[10px] tabular-nums font-semibold mb-1 text-muted-foreground h-3.5">
                    {count > 0 ? count : ""}
                  </span>
                  <div className="w-full flex items-end justify-center flex-1">
                    <div
                      className={cn(
                        "w-full rounded-t-sm transition-all duration-300",
                        count > 0 && "group-hover:opacity-90",
                        selected && "ring-2 ring-offset-1 ring-foreground/40",
                      )}
                      style={{
                        height: count > 0 ? `${Math.max(heightPct, 3)}%` : "2px",
                        backgroundColor: DAY_BUCKET_COLORS[label],
                        opacity: dimmed ? 0.3 : 1,
                      }}
                    />
                  </div>
                  <span
                    className={cn(
                      "text-[9px] mt-1 whitespace-nowrap",
                      selected ? "font-bold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {BUCKET_SHORT_LABELS[label]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Toolbar — search + clear filters + count */}
        <div className="flex items-center gap-2 px-5 py-2 border-b shrink-0">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or any column…"
              className="w-full pl-7 pr-2 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          {(bucket !== "all" || search) && (
            <button
              onClick={() => {
                onBucketChange("all");
                setSearch("");
              }}
              className="text-xs text-blue-500 hover:underline shrink-0"
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground shrink-0 tabular-nums">
            {filtered.length} shown
          </span>
        </div>

        {/* Table body */}
        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-muted-foreground">
            No patients match.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0">
            <table className="w-full table-fixed text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b">
                  {chart.notesColId && (
                    <th className="w-8 px-1 py-1.5" />
                  )}
                  <Th
                    label="Name"
                    dir={sortKey === "name" ? sortDir : null}
                    onClick={() => setSort("name")}
                  />
                  {cols.map((col) => (
                    <Th
                      key={col.colId}
                      label={col.label}
                      dir={sortKey === col.colId ? sortDir : null}
                      onClick={() => setSort(col.colId)}
                    />
                  ))}
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
                      {chart.notesColId && (() => {
                        const noteText = patient.cols[chart.notesColId!] ?? "";
                        const hasNote = noteText.trim().length > 0;
                        return (
                          <td className="px-1 py-1 text-center w-8">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (hasNote) setNotesOpenId(patient.id);
                              }}
                              className={cn(
                                "p-0.5 rounded transition-colors",
                                hasNote
                                  ? "text-blue-500 hover:bg-blue-500/10"
                                  : "text-muted-foreground/20 cursor-default",
                              )}
                              disabled={!hasNote}
                              title={hasNote ? "View notes" : "No notes"}
                            >
                              <StickyNote className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        );
                      })()}
                      <td className="px-2 py-1 font-medium text-foreground truncate">
                        <span className="flex items-center gap-1">
                          {isVip(patient, priorityConfig) && (
                            <Star
                              className="h-3 w-3 shrink-0"
                              style={{ color: VIP_COLOR, fill: VIP_COLOR }}
                              aria-label="Priority patient"
                            />
                          )}
                          <span className="truncate">{patient.name}</span>
                          {hasRoute && (
                            <ExternalLink className="h-3 w-3 text-blue-400 shrink-0" />
                          )}
                        </span>
                      </td>
                      {cols.map((col) => {
                        if (isDaysCol(col.label)) {
                          return (
                            <td key={col.colId} className="px-2 py-1">
                              <span
                                className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap"
                                style={{
                                  backgroundColor: `${bucketColor}20`,
                                  color: bucketColor,
                                }}
                              >
                                {patient.dayBucket}
                              </span>
                            </td>
                          );
                        }
                        if (/ Log$/.test(col.label)) {
                          const raw = patient.cols[col.colId] ?? "";
                          const ts = raw.split(" · ")[0] ?? "";
                          return (
                            <td
                              key={col.colId}
                              className="px-2 py-1 text-foreground/80 truncate"
                              title={raw || undefined}
                            >
                              {ts ? (
                                <span className={raw.includes(" · ") ? "cursor-help underline decoration-dotted underline-offset-2" : ""}>
                                  {ts}
                                </span>
                              ) : (
                                "—"
                              )}
                            </td>
                          );
                        }
                        if (col.pill) {
                          const raw = patient.cols[col.colId] ?? "";
                          const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
                          const colorMap = pillColors[col.colId] ?? {};
                          return (
                            <td key={col.colId} className="px-2 py-1">
                              {parts.length ? (
                                <span className="flex flex-wrap gap-1">
                                  {parts.map((v, i) => {
                                    const hex = colorMap[v.toLowerCase()] ?? "#94a3b8";
                                    return (
                                      <span
                                        key={i}
                                        className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap"
                                        style={{ backgroundColor: `${hex}22`, color: hex }}
                                      >
                                        {v}
                                      </span>
                                    );
                                  })}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          );
                        }
                        if (col.label === "Requesting") {
                          const pills = requestingPills(patient);
                          return (
                            <td key={col.colId} className="px-2 py-1">
                              {pills.length ? (
                                <span className="flex flex-wrap gap-1">
                                  {pills.map((pp) => (
                                    <span
                                      key={pp}
                                      className="inline-block rounded px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap"
                                      style={{
                                        backgroundColor: `${REQ_COLORS[pp]}20`,
                                        color: REQ_COLORS[pp],
                                      }}
                                    >
                                      {pp}
                                    </span>
                                  ))}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          );
                        }
                        const value = patient.cols[col.colId] ?? "";
                        return (
                          <td
                            key={col.colId}
                            className="px-2 py-1 text-foreground/80 truncate"
                          >
                            {value || "—"}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Notes popup (centered overlay) ── */}
      {notesOpenId && (() => {
        const pt = filtered.find((p) => p.id === notesOpenId) ?? patients.find((p) => p.id === notesOpenId);
        const noteText = pt && chart.notesColId ? pt.cols[chart.notesColId] ?? "" : "";
        if (!pt || !noteText) return null;
        return (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40"
            onClick={() => setNotesOpenId(null)}
          >
            <div
              className="bg-card border border-border rounded-xl shadow-2xl w-[500px] max-h-[70vh] flex flex-col animate-in zoom-in-95 fade-in duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <StickyNote className="h-4 w-4 text-blue-500 shrink-0" />
                  <h4 className="text-sm font-semibold text-foreground truncate">
                    {pt.name}
                  </h4>
                </div>
                <button
                  onClick={() => setNotesOpenId(null)}
                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
                <p className="text-sm text-foreground whitespace-pre-wrap break-words leading-relaxed">
                  {noteText}
                </p>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function OversightTab() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const cachedRef = useRef(loadCache());
  const [data, setData] = useState<Map<string, OversightPatient[]> | null>(
    cachedRef.current,
  );
  const [loading, setLoading] = useState(cachedRef.current === null);
  const [error, setError] = useState<string | null>(null);
  // Drill-down + stage state is seeded from the URL so the browser Back button
  // (e.g. returning from a patient's CC page) restores the exact view the user
  // left — the open chart, its bucket filter, and the selected stage.
  const [expandedChart, setExpandedChart] = useState<string | null>(
    () => searchParams.get("chart"),
  );
  const [selectedBucket, setSelectedBucket] = useState<DayBucketLabel | "all">(() => {
    const b = searchParams.get("bucket");
    return b && (DAY_BUCKET_LABELS as readonly string[]).includes(b) ? (b as DayBucketLabel) : "all";
  });
  const [priorityConfig, setPriorityConfig] = useState<PriorityConfig>(loadPriorityConfig);
  const [configOpen, setConfigOpen] = useState(false);
  const [priorityOptions, setPriorityOptions] = useState<{
    referralTypes: string[];
    insurances: string[];
  }>({ referralTypes: [], insurances: [] });
  const [pillColors, setPillColors] = useState<Record<string, Record<string, string>>>({});
  // Which pipeline stage is selected (one section's charts shown at a time).
  const [selectedStage, setSelectedStage] = useState<string>(() => {
    const s = searchParams.get("stage");
    return s && OVERSIGHT_SECTIONS.some((x) => x.id === s) ? s : OVERSIGHT_SECTIONS[0].id;
  });
  const mountedRef = useRef(true);

  const updateConfig = useCallback((c: PriorityConfig) => {
    setPriorityConfig(c);
    savePriorityConfig(c);
  }, []);

  // Pull the live status-label options for the scoring editor.
  useEffect(() => {
    fetchPriorityOptions()
      .then((opts) => setPriorityOptions(opts))
      .catch(() => {
        /* editor falls back to whatever labels are already in the config */
      });
    fetchPillColors()
      .then((c) => setPillColors(c))
      .catch(() => {
        /* pills fall back to a neutral color */
      });
  }, []);

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

  // Mirror stage + drill-down state into the URL (replace, no history spam) so
  // the entry that exists when the user clicks through to a patient already
  // encodes this view — Back then lands right back on the open drilldown.
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", "oversight");
    next.set("stage", selectedStage);
    if (expandedChart) next.set("chart", expandedChart);
    else next.delete("chart");
    if (expandedChart && selectedBucket !== "all") next.set("bucket", selectedBucket);
    else next.delete("bucket");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStage, expandedChart, selectedBucket]);

  // ── Derived values ────────────────────────────────────────────

  const totalPatients = useMemo(() => {
    if (!data) return 0;
    const seen = new Set<string>();
    for (const patients of data.values()) {
      for (const p of patients) seen.add(p.id);
    }
    return seen.size;
  }, [data]);

  const chartById = useMemo(
    () => new Map(CHART_DEFS.map((c) => [c.id, c])),
    [],
  );

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
          <Select value={selectedStage} onValueChange={setSelectedStage}>
            <SelectTrigger className="w-[220px] h-9 font-semibold">
              <SelectValue placeholder="Select a stage…" />
            </SelectTrigger>
            <SelectContent>
              {OVERSIGHT_SECTIONS.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground tabular-nums">
            {totalPatients} total patients
          </span>
        </div>
        <div className="flex items-center gap-3">
          {loading && (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          )}
          {error && (
            <span className="text-[10px] text-destructive">
              Refresh failed
            </span>
          )}
          <button
            onClick={() => setConfigOpen(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <SlidersHorizontal className="h-4 w-4" /> Edit scoring
          </button>
        </div>
      </div>

      {/* Selected stage only — charts for the chosen pipeline stage */}
      {(() => {
        const section =
          OVERSIGHT_SECTIONS.find((s) => s.id === selectedStage) ?? OVERSIGHT_SECTIONS[0];

        const resolve = (ids: string[]) =>
          ids.map((id) => chartById.get(id)).filter((c): c is ChartDef => Boolean(c));
        const charts = resolve(section.chartIds);
        const secondaryCharts = section.secondaryChartIds
          ? resolve(section.secondaryChartIds)
          : [];

        // Unique patients across this stage's primary charts.
        const seen = new Set<string>();
        for (const c of charts) for (const p of data?.get(c.id) ?? []) seen.add(p.id);
        const sectionTotal = seen.size;

        const renderGrid = (list: ChartDef[]) => (
          <div className={cn("grid gap-4 grid-cols-1", list.length > 1 && "md:grid-cols-2")}>
            {list.map((chart) => (
              <StageChart
                key={chart.id}
                chart={chart}
                patients={data?.get(chart.id) ?? []}
                priorityConfig={priorityConfig}
                onChartClick={() => handleChartClick(chart.id)}
                onBarClick={(bucket) => handleBarClick(chart.id, bucket)}
              />
            ))}
          </div>
        );

        return (
          <section className="space-y-3">
            <div className="flex items-baseline gap-3 border-b border-border pb-2">
              <h3 className="text-xl font-bold tracking-tight text-foreground">{section.title}</h3>
              <span className="text-sm font-semibold text-muted-foreground tabular-nums">
                {sectionTotal} patient{sectionTotal !== 1 ? "s" : ""}
              </span>
            </div>
            {renderGrid(charts)}

            {secondaryCharts.length > 0 && (
              <div className="space-y-3 pt-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-[0.15em] text-amber-600">
                    {section.secondaryTitle ?? "Escalations"}
                  </span>
                  <span className="h-px flex-1 bg-amber-200" />
                </div>
                {renderGrid(secondaryCharts)}
              </div>
            )}
          </section>
        );
      })()}

      {/* Drill-down modal overlay */}
      {expandedChart && expandedChartDef && (
        <DrilldownModal
          chart={expandedChartDef}
          patients={expandedPatients}
          bucket={selectedBucket}
          priorityConfig={priorityConfig}
          pillColors={pillColors}
          onBucketChange={handleBucketChange}
          onClose={handleClose}
          onPatientClick={handlePatientClick}
          hasRoute={CHART_ROUTES[expandedChart!] !== null}
        />
      )}

      {/* Priority scoring config */}
      {configOpen && (
        <PriorityConfigModal
          config={priorityConfig}
          referralOptions={priorityOptions.referralTypes}
          insuranceOptions={priorityOptions.insurances}
          onChange={updateConfig}
          onReset={() => updateConfig(DEFAULT_PRIORITY_CONFIG)}
          onClose={() => setConfigOpen(false)}
        />
      )}
    </div>
  );
}

// ── PriorityConfigModal ──────────────────────────────────────────────────

const NUM_INPUT =
  "rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-blue-400";

function PriorityConfigModal({
  config,
  referralOptions,
  insuranceOptions,
  onChange,
  onReset,
  onClose,
}: {
  config: PriorityConfig;
  referralOptions: string[];
  insuranceOptions: string[];
  onChange: (c: PriorityConfig) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  type TierGroup = "referralTiers" | "insuranceTiers";
  type DefKey = "referralDefault" | "insuranceDefault";

  const setTier = (group: TierGroup, idx: number, patch: Partial<PriorityTier>) =>
    onChange({
      ...config,
      [group]: config[group].map((t, i) => (i === idx ? { ...t, ...patch } : t)),
    });
  const addTier = (group: TierGroup) =>
    onChange({ ...config, [group]: [...config[group], { points: 1, match: [] }] });
  const removeTier = (group: TierGroup, idx: number) =>
    onChange({ ...config, [group]: config[group].filter((_, i) => i !== idx) });

  const renderTierGroup = (
    group: TierGroup,
    label: string,
    defKey: DefKey,
    options: string[],
  ) => {
    const usedInGroup = new Set(config[group].flatMap((t) => t.match));
    // Default-tier labels = real options not assigned to any tier above.
    const defaultLabels = options.filter((o) => !usedInGroup.has(o));
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold text-foreground">{label}</h4>
          <button
            onClick={() => addTier(group)}
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            <Plus className="h-3 w-3" /> Add tier
          </button>
        </div>
        <div className="space-y-2.5">
          {config[group].map((t, i) => {
            // Options available to add to THIS tier = not used by any tier.
            const available = options.filter((o) => !usedInGroup.has(o));
            return (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg border border-border p-2"
              >
                <div className="flex items-center gap-1 shrink-0 pt-0.5">
                  <input
                    type="number"
                    value={t.points}
                    onChange={(e) => setTier(group, i, { points: Number(e.target.value) })}
                    className={cn(NUM_INPUT, "w-12")}
                  />
                  <span className="text-[11px] text-muted-foreground">pts</span>
                </div>
                <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
                  {t.match.map((m) => (
                    <span
                      key={m}
                      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground"
                    >
                      {m}
                      <button
                        onClick={() =>
                          setTier(group, i, { match: t.match.filter((x) => x !== m) })
                        }
                        className="text-muted-foreground hover:text-red-600"
                        title="Remove"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <select
                    value=""
                    onChange={(e) => {
                      if (e.target.value)
                        setTier(group, i, { match: [...t.match, e.target.value] });
                    }}
                    className={cn(NUM_INPUT, "max-w-[180px]")}
                    disabled={available.length === 0}
                  >
                    <option value="">+ Add…</option>
                    {available.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => removeTier(group, i)}
                  className="text-muted-foreground hover:text-red-600 shrink-0 pt-0.5"
                  title="Remove tier"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          <div className="flex items-start gap-2 pt-0.5">
            <div className="flex items-center gap-1 shrink-0">
              <input
                type="number"
                value={config[defKey]}
                onChange={(e) => onChange({ ...config, [defKey]: Number(e.target.value) })}
                className={cn(NUM_INPUT, "w-12")}
              />
              <span className="text-[11px] text-muted-foreground">pts</span>
            </div>
            <span className="text-[11px] text-muted-foreground pt-1">
              everything else{defaultLabels.length ? ` (${defaultLabels.length} labels)` : ""}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[92vw] max-w-2xl max-h-[88vh] flex flex-col animate-in zoom-in-95 fade-in duration-150">
        <div className="flex items-center justify-between px-5 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-blue-500" />
            <h3 className="text-base font-semibold text-foreground">Priority Scoring</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          <p className="text-xs text-muted-foreground">
            Score = referral + insurance + days pressure (days pressure currently
            0). Pick the status labels for each tier; anything not assigned uses the
            "everything else" points. Options are pulled live from the Monday status columns.
          </p>
          {renderTierGroup("referralTiers", "Referral Type", "referralDefault", referralOptions)}
          {renderTierGroup("insuranceTiers", "Insurance", "insuranceDefault", insuranceOptions)}

          <div>
            <h4 className="text-sm font-bold text-foreground mb-2">Days Pressure</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DAY_BUCKETS_ORDERED.map((b) => (
                <div key={b} className="flex items-center gap-1.5">
                  <input
                    type="number"
                    value={config.daysPoints[b]}
                    onChange={(e) =>
                      onChange({
                        ...config,
                        daysPoints: { ...config.daysPoints, [b]: Number(e.target.value) },
                      })
                    }
                    className={cn(NUM_INPUT, "w-12 shrink-0")}
                  />
                  <span className="text-[11px] text-muted-foreground">{b}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-bold text-foreground mb-2">VIP Threshold</h4>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={config.threshold}
                onChange={(e) => onChange({ ...config, threshold: Number(e.target.value) })}
                className={cn(NUM_INPUT, "w-16 shrink-0")}
              />
              <span className="text-xs text-muted-foreground">
                Patients scoring this or higher are flagged.
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t shrink-0">
          <button
            onClick={onReset}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset to defaults
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
