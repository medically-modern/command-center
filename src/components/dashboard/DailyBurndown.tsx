/**
 * DailyBurndown — shows start-of-day vs. current patient counts per role.
 *
 * Baseline priority:
 * 1. Server baseline (public/data/baseline.json) — written by GitHub Actions at 9 AM ET
 * 2. localStorage fallback — captured on first browser load if server baseline unavailable
 *
 * Every subsequent load compares live counts against that baseline, showing
 * progress (bars shrinking) and incoming work (bars growing).
 */
import { useEffect, useState, useRef, useMemo } from "react";
import { ROLES, type RoleConfig } from "@/lib/config";
import type { RoleCounts } from "@/hooks/useRoleCounts";
import { useServerBaseline } from "@/hooks/useServerBaseline";
import { cn } from "@/lib/utils";
import {
  Clock,
  Zap,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Server,
  HardDrive,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

/* ── localStorage helpers (fallback) ──────────────────────── */

const LS_KEY = "daily-burndown-snapshot";

interface Snapshot {
  dateKey: string;
  counts: RoleCounts;
  takenAt: string;
  source?: "server" | "local";
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
    source: "local",
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(snap));
  } catch { /* ignore */ }
  return snap;
}

/* ── Component ────────────────────────────────────────────── */

interface Props {
  roleCounts: RoleCounts;
  countsLoading: boolean;
  visibleRoleIds: string[];
}

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
  const { baseline: serverBaseline, loading: serverLoading } = useServerBaseline();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [animateIn, setAnimateIn] = useState(false);
  const initializedRef = useRef(false);

  // Resolve baseline: prefer server, fall back to localStorage
  useEffect(() => {
    if (countsLoading || serverLoading || initializedRef.current) return;
    const hasData = Object.values(roleCounts).some((v) => v > 0);
    if (!hasData) return;

    initializedRef.current = true;
    const todayKey = getEasternDateKey();

    // 1. Try server baseline for today
    if (serverBaseline && serverBaseline.dateKey === todayKey) {
      setSnapshot({
        dateKey: serverBaseline.dateKey,
        counts: serverBaseline.counts,
        takenAt: serverBaseline.takenAt,
        source: "server",
      });
    } else {
      // 2. Fall back to localStorage
      const existing = loadSnapshot();
      if (existing && existing.dateKey === todayKey) {
        setSnapshot(existing);
      } else {
        const newSnap = saveSnapshot(roleCounts);
        setSnapshot(newSnap);
      }
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimateIn(true));
    });
  }, [roleCounts, countsLoading, serverBaseline, serverLoading]);

  const roles = ROLES.filter((r) => visibleRoleIds.includes(r.id));

  const barData = useMemo(() => {
    if (!snapshot) return [];
    return roles.map((role) => {
      const baseline = snapshot.counts[role.id] ?? 0;
      const current = roleCounts[role.id] ?? 0;
      const delta = current - baseline;
      const full = Math.max(baseline, current);
      return { role, baseline, current, delta, full };
    });
  }, [roles, snapshot, roleCounts]);

  const sqrtScale = (v: number) => Math.sqrt(Math.max(v, 0));
  const maxSqrt = Math.max(...barData.map((d) => sqrtScale(d.full)), 1);

  const totalProcessed = barData
    .filter((d) => d.delta < 0)
    .reduce((sum, d) => sum + Math.abs(d.delta), 0);
  const totalIncoming = barData
    .filter((d) => d.delta > 0)
    .reduce((sum, d) => sum + d.delta, 0);

  const snapshotTime = snapshot
    ? new Date(snapshot.takenAt).toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "";

  const isServerSource = snapshot?.source === "server";

  if (!snapshot || barData.length === 0) {
    if (countsLoading || serverLoading) {
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
          <p className="text-xs text-muted-foreground/60 mt-0.5 flex items-center gap-1">
            {isServerSource ? (
              <Server className="w-3 h-3 inline" />
            ) : (
              <HardDrive className="w-3 h-3 inline" />
            )}
            Baseline: {snapshotTime} ET
            {isServerSource ? " (server)" : " (local)"}
            {" · "}Live: {getEasternTimeStr()} ET
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
      </div>

      {/* Burndown bars */}
      <div className="space-y-3">
        {barData.map((d, i) => {
          const hex = COLOR_MAP[d.role.color] ?? "#6366f1";
          const ghostPct =
            maxSqrt > 0 ? Math.max((sqrtScale(d.full) / maxSqrt) * 100, 4) : 0;
          const currentPct =
            maxSqrt > 0
              ? Math.max(
                  (sqrtScale(d.current) / maxSqrt) * 100,
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
              title={hasRoute ? `Open ${d.role.label}` : d.role.label}
            >
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

              <div className="relative h-8 w-full rounded-lg overflow-hidden bg-muted/30">
                <div
                  className="absolute inset-y-0 left-0 rounded-lg transition-all duration-700 ease-out"
                  style={{
                    width: animateIn ? `${ghostPct}%` : "0%",
                    background: hexToRgba(hex, 0.12),
                    transitionDelay: `${i * 60}ms`,
                  }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-lg transition-all duration-1000 ease-out"
                  style={{
                    width: animateIn ? `${currentPct}%` : "0%",
                    background: `linear-gradient(90deg, ${hex}, ${hexToRgba(hex, 0.75)})`,
                    transitionDelay: `${i * 60 + 200}ms`,
                  }}
                />
                <div
                  className="absolute inset-y-0 rounded-lg transition-all duration-1000 ease-out opacity-30"
                  style={{
                    left: animateIn ? `calc(${currentPct}% - 8px)` : "0%",
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

      {/* Footer */}
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
