/**
 * OperationsTab — global daily burndown for all roles.
 *
 * Shows every role's patient count movement during 9 AM – 5 PM ET.
 * Baseline snapshots at first load after 9 AM ET each day.
 * After 5 PM ET the view freezes as "end of day" summary.
 *
 * Uses useRoleCounts hook for live data, separate localStorage key
 * from the per-user DailyBurndown.
 */
import { useEffect, useState, useRef, useMemo } from "react";
import { ROLES } from "@/lib/config";
import { useRoleCounts, type RoleCounts } from "@/hooks/useRoleCounts";
import { cn } from "@/lib/utils";
import {
  TrendingDown,
  TrendingUp,
  Minus,
  Clock,
  Zap,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Sun,
  Moon,
  Sunrise,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

/* ── Time helpers (Eastern) ───────────────────────────────── */

function getEasternNow(): Date {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/New_York" }),
  );
}

function getEasternDateKey(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}

function getEasternTimeStr(): string {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function getEasternHour(): number {
  return getEasternNow().getHours();
}

type TimeWindow = "before" | "during" | "after";

function getTimeWindow(): TimeWindow {
  const h = getEasternHour();
  if (h < 9) return "before";
  if (h >= 17) return "after";
  return "during";
}

/* ── localStorage snapshot ────────────────────────────────── */

const LS_KEY = "ops-burndown-snapshot";

interface Snapshot {
  dateKey: string;
  counts: RoleCounts;
  takenAt: string;
}

function loadSnapshot(): Snapshot | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}

function saveSnapshot(counts: RoleCounts): Snapshot {
  const snap: Snapshot = {
    dateKey: getEasternDateKey(),
    counts: { ...counts },
    takenAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
  return snap;
}

/* ── Color mapping ────────────────────────────────────────── */

const COLOR_MAP: Record<string, string> = {
  "bg-blue-500": "#3b82f6",
  "bg-violet-500": "#8b5cf6",
  "bg-cyan-500": "#06b6d4",
  "bg-emerald-500": "#10b981",
  "bg-amber-500": "#f59e0b",
  "bg-pink-500": "#ec4899",
  "bg-indigo-500": "#6366f1",
  "bg-orange-500": "#f97316",
  "bg-teal-500": "#14b8a6",
  "bg-lime-500": "#84cc16",
  "bg-rose-500": "#f43f5e",
  "bg-red-500": "#ef4444",
  "bg-slate-700": "#334155",
};

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ── Component ────────────────────────────────────────────── */

export function OperationsTab() {
  const navigate = useNavigate();
  const { counts: roleCounts, loading: countsLoading } = useRoleCounts();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [animateIn, setAnimateIn] = useState(false);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(getTimeWindow);
  const initializedRef = useRef(false);

  // Update time window every minute
  useEffect(() => {
    const interval = setInterval(() => setTimeWindow(getTimeWindow()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Manage snapshot
  useEffect(() => {
    if (countsLoading || initializedRef.current) return;
    const hasData = Object.values(roleCounts).some((v) => v > 0);
    if (!hasData) return;

    initializedRef.current = true;
    const todayKey = getEasternDateKey();
    const existing = loadSnapshot();

    if (existing && existing.dateKey === todayKey) {
      setSnapshot(existing);
    } else if (timeWindow !== "before") {
      // New day + within or after business hours → snapshot
      const newSnap = saveSnapshot(roleCounts);
      setSnapshot(newSnap);
    }
    // If before 9 AM and no snapshot for today, we wait

    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimateIn(true));
    });
  }, [roleCounts, countsLoading, timeWindow]);

  // All roles (exclude authDenied which has no real data)
  const allRoles = ROLES.filter((r) => r.id !== "authDenied");

  const barData = useMemo(() => {
    if (!snapshot) return [];
    return allRoles
      .map((role) => {
        const baseline = snapshot.counts[role.id] ?? 0;
        const current = roleCounts[role.id] ?? 0;
        const delta = current - baseline;
        const full = Math.max(baseline, current);
        return { role, baseline, current, delta, full };
      })
      .filter((d) => d.full > 0 || d.baseline > 0); // hide roles with no patients at all
  }, [allRoles, snapshot, roleCounts]);

  // Sqrt scale
  const sqrtScale = (v: number) => Math.sqrt(Math.max(v, 0));
  const maxSqrt = Math.max(...barData.map((d) => sqrtScale(d.full)), 1);

  // Summary stats
  const totalProcessed = barData
    .filter((d) => d.delta < 0)
    .reduce((sum, d) => sum + Math.abs(d.delta), 0);
  const totalIncoming = barData
    .filter((d) => d.delta > 0)
    .reduce((sum, d) => sum + d.delta, 0);
  const netChange = barData.reduce((sum, d) => sum + d.delta, 0);
  const totalPatients = barData.reduce((sum, d) => sum + d.current, 0);

  const snapshotTime = snapshot
    ? new Date(snapshot.takenAt).toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "";

  // Before 9 AM — show waiting state
  if (timeWindow === "before" && !snapshot) {
    return (
      <div className="rounded-xl bg-card border shadow-card p-16 text-center space-y-4">
        <Sunrise className="w-10 h-10 mx-auto text-amber-400" />
        <h3 className="text-lg font-semibold text-foreground">
          Operations tracking starts at 9:00 AM ET
        </h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          The daily baseline will be captured at the first load after 9 AM.
          Check back then to see your team's progress throughout the day.
        </p>
        <p className="text-xs text-muted-foreground">
          Current time: {getEasternTimeStr()} ET
        </p>
      </div>
    );
  }

  // Loading state
  if (!snapshot || barData.length === 0) {
    if (countsLoading) {
      return (
        <div className="rounded-xl bg-card border shadow-card p-16 text-center space-y-3">
          <Clock className="w-8 h-8 animate-pulse mx-auto text-primary" />
          <p className="text-sm text-muted-foreground">
            Loading operations data…
          </p>
        </div>
      );
    }
    return null;
  }

  const isAfterHours = timeWindow === "after";

  return (
    <div className="space-y-6">
      {/* After-hours banner */}
      {isAfterHours && (
        <div className="flex items-center gap-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20 px-4 py-3">
          <Moon className="w-4 h-4 text-indigo-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
              End of day summary
            </p>
            <p className="text-xs text-indigo-600/70 dark:text-indigo-400/70">
              Business hours ended at 5:00 PM ET. This shows the final state
              of today's operations. Resets tomorrow at 9:00 AM ET.
            </p>
          </div>
        </div>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
            <Sun className="w-4 h-4 text-amber-500" />
            Daily operations
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Baseline: {snapshotTime} ET · {isAfterHours ? "Closed" : `Live: ${getEasternTimeStr()} ET`}
            {" · "}{totalPatients} total patients
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-1.5 rounded-full bg-muted-foreground/15" />
            9 AM baseline
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-1.5 rounded-full bg-primary" />
            Current
          </span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium mb-1">
            <ArrowDown className="w-3.5 h-3.5" />
            Processed out
          </div>
          <span className="text-2xl font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
            {totalProcessed}
          </span>
        </div>
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-medium mb-1">
            <ArrowUp className="w-3.5 h-3.5" />
            Incoming
          </div>
          <span className="text-2xl font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
            {totalIncoming}
          </span>
        </div>
        <div
          className={cn(
            "rounded-lg px-4 py-3 border",
            netChange < 0
              ? "bg-emerald-500/10 border-emerald-500/20"
              : netChange > 0
                ? "bg-amber-500/10 border-amber-500/20"
                : "bg-muted/50 border-border",
          )}
        >
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium mb-1",
              netChange < 0
                ? "text-emerald-600 dark:text-emerald-400"
                : netChange > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground",
            )}
          >
            {netChange < 0 ? (
              <TrendingDown className="w-3.5 h-3.5" />
            ) : netChange > 0 ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : (
              <Minus className="w-3.5 h-3.5" />
            )}
            Net change
          </div>
          <span
            className={cn(
              "text-2xl font-semibold tabular-nums",
              netChange < 0
                ? "text-emerald-600 dark:text-emerald-400"
                : netChange > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground",
            )}
          >
            {netChange > 0 ? "+" : ""}
            {netChange}
          </span>
        </div>
        <div className="rounded-lg bg-primary/5 border border-primary/10 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-primary font-medium mb-1">
            <Clock className="w-3.5 h-3.5" />
            Business hours
          </div>
          <span className="text-lg font-semibold text-primary tabular-nums">
            9a – 5p ET
          </span>
        </div>
      </div>

      {/* Burndown bars — all roles */}
      <div className="space-y-2.5">
        {barData.map((d, i) => {
          const hex = COLOR_MAP[d.role.color] ?? "#6366f1";
          const ghostPct =
            maxSqrt > 0
              ? Math.max((sqrtScale(d.full) / maxSqrt) * 100, 4)
              : 0;
          const currentPct =
            maxSqrt > 0
              ? Math.max(
                  (sqrtScale(d.current) / maxSqrt) * 100,
                  d.current > 0 ? 4 : 0,
                )
              : 0;
          const hasRoute = d.role.route && d.role.id !== "authDenied";

          return (
            <button
              key={d.role.id}
              className={cn(
                "w-full text-left group rounded-lg px-3 py-2 -mx-3 hover:bg-muted/30 transition-colors",
                hasRoute ? "cursor-pointer" : "cursor-default",
              )}
              onClick={() => {
                if (hasRoute) navigate(d.role.route);
              }}
              title={hasRoute ? `Open ${d.role.label}` : d.role.label}
            >
              {/* Label row */}
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium text-foreground flex items-center gap-2">
                  <div
                    className={cn(
                      "w-2.5 h-2.5 rounded-full shrink-0",
                      d.role.color,
                    )}
                  />
                  {d.role.label}
                  {hasRoute && (
                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-40 transition-opacity" />
                  )}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {d.baseline}
                  </span>
                  <span className="text-xs text-muted-foreground/50">→</span>
                  <span className="text-sm font-semibold text-foreground tabular-nums">
                    {countsLoading ? "…" : d.current}
                  </span>
                  {d.delta !== 0 && (
                    <span
                      className={cn(
                        "text-xs font-medium px-1.5 py-0.5 rounded-md tabular-nums",
                        d.delta < 0
                          ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                          : "text-amber-600 dark:text-amber-400 bg-amber-500/10",
                      )}
                    >
                      {d.delta > 0 ? "+" : ""}
                      {d.delta}
                    </span>
                  )}
                  {d.delta === 0 && (
                    <span className="text-xs text-muted-foreground/40 px-1.5 py-0.5">
                      —
                    </span>
                  )}
                </div>
              </div>

              {/* Bar */}
              <div className="relative h-7 w-full rounded-md overflow-hidden bg-muted/30">
                <div
                  className="absolute inset-y-0 left-0 rounded-md transition-all duration-700 ease-out"
                  style={{
                    width: animateIn ? `${ghostPct}%` : "0%",
                    background: hexToRgba(hex, 0.12),
                    transitionDelay: `${i * 50}ms`,
                  }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-md transition-all duration-1000 ease-out"
                  style={{
                    width: animateIn ? `${currentPct}%` : "0%",
                    background: `linear-gradient(90deg, ${hex}, ${hexToRgba(hex, 0.75)})`,
                    transitionDelay: `${i * 50 + 150}ms`,
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center gap-6 pt-1 text-xs text-muted-foreground/60">
        <span className="flex items-center gap-1">
          <Zap className="w-3 h-3" />
          {isAfterHours ? "Frozen at close" : "Refreshes every 60s"}
        </span>
        <span className="ml-auto">
          Click a bar to open that role's dashboard
        </span>
      </div>
    </div>
  );
}
