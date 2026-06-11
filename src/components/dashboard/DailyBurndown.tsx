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
import { useEffect, useState, useRef, useMemo, useCallback } from "react";
import confetti from "canvas-confetti";
import { ROLES, type RoleConfig } from "@/lib/config";
import type { RoleCounts } from "@/hooks/useRoleCounts";
import { useServerBaseline } from "@/hooks/useServerBaseline";
import { cn } from "@/lib/utils";
import {
  Clock,
  Zap,
  ExternalLink,
  PartyPopper,
  CheckCircle2,
  ShieldAlert,
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
  /**
   * Manager mode: counts are escalated-patients-only. Skips the daily
   * baseline machinery entirely (no server baseline, no localStorage
   * snapshot writes) and links into role pages with ?manager=1.
   */
  managerMode?: boolean;
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
  "bg-fuchsia-500": "#d946ef",
  "bg-sky-500": "#0ea5e9",
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
  managerMode = false,
}: Props) {
  const navigate = useNavigate();
  const { baseline: serverBaseline, loading: serverLoading } = useServerBaseline();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [animateIn, setAnimateIn] = useState(false);
  const initializedRef = useRef(false);

  // Resolve baseline: prefer server, fall back to localStorage
  useEffect(() => {
    if (initializedRef.current) return;

    // Manager mode: no baseline concept — bars are live escalated counts.
    // Never write the localStorage snapshot here (it belongs to the
    // processor burndown), and an all-zero day is meaningful (all clear).
    if (managerMode) {
      if (countsLoading) return;
      initializedRef.current = true;
      setSnapshot({
        dateKey: getEasternDateKey(),
        counts: {},
        takenAt: new Date().toISOString(),
        source: "local",
      });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimateIn(true));
      });
      return;
    }

    if (countsLoading || serverLoading) return;
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
  }, [roleCounts, countsLoading, serverBaseline, serverLoading, managerMode]);

  // Ad-hoc TASK roles — not a queue the processor "burns down" but work that
  // can land on any patient at any time. Rendered as a task tile below the
  // bars instead of a burndown bar.
  const TASK_ROLE_IDS = new Set(["updateClinicals", "subscription"]);

  const roles = ROLES.filter(
    (r) => visibleRoleIds.includes(r.id) && !TASK_ROLE_IDS.has(r.id),
  );
  const taskRoles = ROLES.filter(
    (r) => visibleRoleIds.includes(r.id) && TASK_ROLE_IDS.has(r.id),
  );

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
  const maxSqrt = Math.max(...barData.map((d) => sqrtScale(d.current)), 1);

  /* Fire confetti scoped to a bar's bounding rect */
  const fireBarConfetti = useCallback((el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const x = (rect.left + rect.width / 2) / window.innerWidth;
    const y = (rect.top + rect.height / 2) / window.innerHeight;
    confetti({
      particleCount: 40,
      spread: 60,
      startVelocity: 18,
      gravity: 0.8,
      ticks: 80,
      origin: { x, y },
      colors: ["#10b981", "#34d399", "#6ee7b7", "#a7f3d0"],
    });
  }, []);

  /* Track which bars already celebrated so confetti fires once */
  const celebratedRef = useRef<Set<string>>(new Set());

  if (!snapshot || (barData.length === 0 && taskRoles.length === 0)) {
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

  const allClear =
    managerMode &&
    !countsLoading &&
    barData.every((d) => d.current === 0) &&
    taskRoles.every((r) => (roleCounts[r.id] ?? 0) === 0);

  return (
    <div className="space-y-6">
      {/* Manager mode banner */}
      {managerMode && (
        <div
          className={cn(
            "flex items-center gap-3 rounded-xl border px-4 py-3",
            allClear
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-red-500/25 bg-red-500/5",
          )}
        >
          {allClear ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          ) : (
            <ShieldAlert className="w-5 h-5 text-red-500 shrink-0" />
          )}
          <div>
            <p className={cn("text-sm font-bold", allClear ? "text-emerald-600" : "text-red-600")}>
              {allClear ? "All clear — no escalated patients" : "Escalated patients only"}
            </p>
            <p className="text-xs text-muted-foreground">
              {allClear
                ? "Nothing in these roles is flagged for escalation right now."
                : "Bars show patients flagged for escalation in each role — not the full queue."}
            </p>
          </div>
        </div>
      )}

      {/* Burndown bars */}
      <div className="space-y-3">
        {barData.map((d, i) => {
          const hex = COLOR_MAP[d.role.color] ?? "#6366f1";
          const currentPct =
            maxSqrt > 0
              ? Math.max(
                  (sqrtScale(d.current) / maxSqrt) * 100,
                  d.current > 0 ? 4 : 0
                )
              : 0;
          const hasRoute = d.role.route && d.role.id !== "authDenied";
          const isDone = !countsLoading && d.current === 0;

          return (
            <button
              key={d.role.id}
              className={cn(
                "w-full text-left group",
                hasRoute ? "cursor-pointer" : "cursor-default"
              )}
              onClick={() => {
                if (hasRoute)
                  navigate(managerMode ? `${d.role.route}?manager=1` : d.role.route);
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
                {isDone ? (
                  <span className="text-sm font-bold text-emerald-500 flex items-center gap-1.5">
                    {managerMode ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Clear
                      </>
                    ) : (
                      <>
                        <PartyPopper className="h-3.5 w-3.5" />
                        Done!
                      </>
                    )}
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-foreground tabular-nums">
                    {countsLoading ? "…" : d.current}
                  </span>
                )}
              </div>

              <div
                className="relative h-8 w-full rounded-lg overflow-hidden bg-muted/30"
                ref={(el) => {
                  if (!managerMode && isDone && animateIn && el && !celebratedRef.current.has(d.role.id)) {
                    celebratedRef.current.add(d.role.id);
                    requestAnimationFrame(() => fireBarConfetti(el));
                  }
                }}
              >
                {isDone ? (
                  /* Celebration shimmer */
                  <div
                    className="absolute inset-0 rounded-lg animate-pulse"
                    style={{ background: "linear-gradient(90deg, rgba(16,185,129,0.08), rgba(52,211,153,0.15), rgba(16,185,129,0.08))" }}
                  />
                ) : (
                  <div
                    className="absolute inset-y-0 left-0 rounded-lg transition-all duration-1000 ease-out"
                    style={{
                      width: animateIn ? `${currentPct}%` : "0%",
                      background: `linear-gradient(90deg, ${hex}, ${hexToRgba(hex, 0.75)})`,
                      transitionDelay: `${i * 60 + 200}ms`,
                    }}
                  />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Ad-hoc task tiles — distinct from the burndown bars: these aren't
          queues to empty, they're tasks that can hit any patient anytime. */}
      {taskRoles.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Ad-hoc tasks
          </p>
          {taskRoles.map((role) => {
            const count = roleCounts[role.id] ?? 0;
            return (
              <div key={role.id} className="flex items-center gap-3">
                <button
                  onClick={() =>
                    role.route &&
                    navigate(managerMode ? `${role.route}?manager=1` : role.route)
                  }
                  title={`Open ${role.label}`}
                  className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                  style={{ background: "var(--mm-teal, #3f5c63)" }}
                >
                  <Zap className="w-4 h-4" />
                  {role.label}
                  {count > 0 && (
                    <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-full bg-white/25 text-xs font-bold tabular-nums">
                      {countsLoading ? "…" : count}
                    </span>
                  )}
                  <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                </button>
                <span className="text-[11px] text-muted-foreground">
                  As-needed task — can apply to any patient, not a queue to clear
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-6 pt-1 text-xs text-muted-foreground/60">
        <span className="flex items-center gap-1">
          <Zap className="w-3 h-3" />
          Refreshes every 60s
        </span>
        <span className="ml-auto">
          {managerMode
            ? "Click a bar to open that role's escalated patients"
            : "Click a bar to open that role's dashboard"}
        </span>
      </div>
    </div>
  );
}
