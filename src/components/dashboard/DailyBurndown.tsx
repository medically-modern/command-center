/**
 * DailyBurndown — shows start-of-day vs. current patient counts per role.
 *
 * At first load each day (Eastern time), snapshots current counts to localStorage.
 * Every subsequent load compares live counts against that baseline, showing
 * progress (bars shrinking) and incoming work (bars growing).
 */
import { useEffect, useState, useRef, useMemo } from "react";
import { ROLES, type RoleConfig } from "@/lib/config";
import type { RoleCounts } from "@/hooks/useRoleCounts";
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
} from "lucide-react";
import { useNavigate } from "react-router-dom";

/* ── localStorage helpers ─────────────────────────────────── */

const LS_KEY = "daily-burndown-snapshot";

interface Snapshot {
  /** YYYY-MM-DD in Eastern time */
  dateKey: string;
  /** roleId → count at snapshot time */
  counts: RoleCounts;
  /** ISO timestamp of when the snapshot was taken */
  takenAt: string;
}

function getEasternDateKey(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  }); // YYYY-MM-DD
}

function getEasternTimeStr(): string {
  return new Date().toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
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

/* ── Component ────────────────────────────────────────────── */

interface Props {
  roleCounts: RoleCounts;
  countsLoading: boolean;
  /** Which role IDs to show (the user's assigned roles) */
  visibleRoleIds: string[];
}

// Hex colors that match the Tailwind classes on RoleConfig.color
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

export function DailyBurndown({
  roleCounts,
  countsLoading,
  visibleRoleIds,
}: Props) {
  const navigate = useNavigate();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [animateIn, setAnimateIn] = useState(false);
  const initializedRef = useRef(false);

  // On mount / when counts arrive, manage snapshot
  useEffect(() => {
    if (countsLoading || initializedRef.current) return;
    // Only snapshot once we actually have data
    const hasData = Object.values(roleCounts).some((v) => v > 0);
    if (!hasData) return;

    initializedRef.current = true;
    const todayKey = getEasternDateKey();
    const existing = loadSnapshot();

    if (existing && existing.dateKey === todayKey) {
      // Same day — use existing snapshot as baseline
      setSnapshot(existing);
    } else {
      // New day or no snapshot — take a fresh one
      const newSnap = saveSnapshot(roleCounts);
      setSnapshot(newSnap);
    }

    // Trigger entrance animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimateIn(true));
    });
  }, [roleCounts, countsLoading]);

  // Compute bar data
  const roles = ROLES.filter((r) => visibleRoleIds.includes(r.id));

  const barData = useMemo(() => {
    if (!snapshot) return [];
    return roles.map((role) => {
      const baseline = snapshot.counts[role.id] ?? 0;
      const current = roleCounts[role.id] ?? 0;
      const delta = current - baseline;
      // "full" is the max of baseline and current — bars can grow
      const full = Math.max(baseline, current);
      return { role, baseline, current, delta, full };
    });
  }, [roles, snapshot, roleCounts]);

  const maxFull = Math.max(...barData.map((d) => d.full), 1);

  // Summary stats
  const totalProcessed = barData
    .filter((d) => d.delta < 0)
    .reduce((sum, d) => sum + Math.abs(d.delta), 0);
  const totalIncoming = barData
    .filter((d) => d.delta > 0)
    .reduce((sum, d) => sum + d.delta, 0);
  const netChange = barData.reduce((sum, d) => sum + d.delta, 0);

  const snapshotTime = snapshot
    ? new Date(snapshot.takenAt).toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "";

  if (!snapshot || barData.length === 0) {
    if (countsLoading) {
      return (
        <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
          <Clock className="w-4 h-4 animate-pulse" />
          Loading daily progress...
        </div>
      );
    }
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Today's Progress
          </h3>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            Baseline set at {snapshotTime} ET · Live at {getEasternTimeStr()} ET
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-1.5 rounded-full bg-muted-foreground/15" />
            Start of day
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-3 h-1.5 rounded-full bg-primary" />
            Current
          </span>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
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
                : "bg-muted/50 border-border"
          )}
        >
          <div
            className={cn(
              "flex items-center gap-1.5 text-xs font-medium mb-1",
              netChange < 0
                ? "text-emerald-600 dark:text-emerald-400"
                : netChange > 0
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
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
                  : "text-muted-foreground"
            )}
          >
            {netChange > 0 ? "+" : ""}
            {netChange}
          </span>
        </div>
      </div>

      {/* Burndown bars */}
      <div className="space-y-3">
        {barData.map((d, i) => {
          const hex = COLOR_MAP[d.role.color] ?? "#6366f1";
          const ghostPct =
            maxFull > 0 ? Math.max((d.full / maxFull) * 100, 4) : 0;
          const currentPct =
            maxFull > 0
              ? Math.max(
                  (d.current / maxFull) * 100,
                  d.current > 0 ? 4 : 0
                )
              : 0;
          const hasRoute = d.role.route && d.role.id !== "authDenied";

          return (
            <button
              key={d.role.id}
              className={cn(
                "w-full text-left group",
                hasRoute ? "cursor-pointer" : "cursor-default"
              )}
              onClick={() => {
                if (hasRoute) navigate(d.role.route);
              }}
              title={
                hasRoute
                  ? `Open ${d.role.label}`
                  : `${d.role.label}`
              }
            >
              {/* Label row */}
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-foreground flex items-center gap-2">
                  <div
                    className={cn(
                      "w-2.5 h-2.5 rounded-full shrink-0",
                      d.role.color
                    )}
                  />
                  {d.role.label}
                  {hasRoute && (
                    <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-40 transition-opacity" />
                  )}
                </span>
                <div className="flex items-center gap-2">
                  {/* Baseline → Current */}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {d.baseline}
                  </span>
                  <span className="text-xs text-muted-foreground/50">→</span>
                  <span className="text-sm font-semibold text-foreground tabular-nums">
                    {countsLoading ? "…" : d.current}
                  </span>
                  {/* Delta badge */}
                  {d.delta !== 0 && (
                    <span
                      className={cn(
                        "text-xs font-medium px-1.5 py-0.5 rounded-md tabular-nums",
                        d.delta < 0
                          ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"
                          : "text-amber-600 dark:text-amber-400 bg-amber-500/10"
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
              <div className="relative h-8 w-full rounded-lg overflow-hidden bg-muted/30">
                {/* Ghost bar — baseline or "full" extent */}
                <div
                  className="absolute inset-y-0 left-0 rounded-lg transition-all duration-700 ease-out"
                  style={{
                    width: animateIn ? `${ghostPct}%` : "0%",
                    background: hexToRgba(hex, 0.12),
                    transitionDelay: `${i * 60}ms`,
                  }}
                />
                {/* Solid bar — current count */}
                <div
                  className="absolute inset-y-0 left-0 rounded-lg transition-all duration-1000 ease-out"
                  style={{
                    width: animateIn ? `${currentPct}%` : "0%",
                    background: `linear-gradient(90deg, ${hex}, ${hexToRgba(hex, 0.75)})`,
                    transitionDelay: `${i * 60 + 200}ms`,
                  }}
                />
                {/* Subtle shimmer on the solid bar edge */}
                <div
                  className="absolute inset-y-0 rounded-lg transition-all duration-1000 ease-out opacity-30"
                  style={{
                    left: animateIn
                      ? `calc(${currentPct}% - 8px)`
                      : "0%",
                    width: "8px",
                    background: `linear-gradient(90deg, transparent, ${hexToRgba(hex, 0.5)})`,
                    transitionDelay: `${i * 60 + 200}ms`,
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Footer hint */}
      <div className="flex items-center gap-6 pt-1 text-xs text-muted-foreground/60">
        <span className="flex items-center gap-1">
          <Zap className="w-3 h-3" />
          Refreshes every 60s
        </span>
        <span className="ml-auto">
          Click a bar to open that role's dashboard
        </span>
      </div>
    </div>
  );
}
