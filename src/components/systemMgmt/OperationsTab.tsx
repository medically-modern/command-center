/**
 * OperationsTab — global daily burndown for all roles.
 *
 * Shows every role's patient count movement during 9 AM – 5 PM ET.
 * Baseline priority:
 * 1. Server baseline (public/data/baseline.json) from GitHub Actions cron
 * 2. localStorage fallback (ops-burndown-snapshot)
 *
 * After 5 PM ET the view freezes as "end of day" summary.
 */
import { useEffect, useState, useRef, useMemo } from "react";
import { ROLES } from "@/lib/config";
// The stage grouping + its fallback live in lib so they are testable without
// rendering this component — see operationsGroups.test.ts.
import { groupRoleRows } from "@/lib/systemMgmt/operationsGroups";
import { useRoleCounts, type RoleCounts, type RolePatientIds } from "@/hooks/useRoleCounts";
import { useServerBaseline } from "@/hooks/useServerBaseline";
import { cn } from "@/lib/utils";
import {
  Zap,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Sun,
  Moon,
  Sunrise,
  Server,
  HardDrive,
  Clock,
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

/* ── localStorage snapshot (fallback) ─────────────────────── */

const LS_KEY = "ops-burndown-snapshot";

interface Snapshot {
  dateKey: string;
  counts: RoleCounts;
  patientIds?: RolePatientIds;
  takenAt: string;
  source?: "server" | "local";
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

function saveSnapshot(counts: RoleCounts, pIds?: RolePatientIds): Snapshot {
  const snap: Snapshot = {
    dateKey: getEasternDateKey(),
    counts: { ...counts },
    patientIds: pIds ? { ...pIds } : undefined,
    takenAt: new Date().toISOString(),
    source: "local",
  };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(snap));
  } catch { /* ignore */ }
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
  const { counts: roleCounts, patientIds: currentPatientIds, loading: countsLoading } = useRoleCounts();
  const { baseline: serverBaseline, loading: serverLoading } = useServerBaseline();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [animateIn, setAnimateIn] = useState(false);
  const [timeWindow, setTimeWindow] = useState<TimeWindow>(getTimeWindow);
  const initializedRef = useRef(false);

  // Update time window every minute
  useEffect(() => {
    const interval = setInterval(() => setTimeWindow(getTimeWindow()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Resolve baseline: server first, then localStorage
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
        patientIds: serverBaseline.patientIds,
        takenAt: serverBaseline.takenAt,
        source: "server",
      });
    } else {
      // 2. Fall back to localStorage
      const existing = loadSnapshot();
      if (existing && existing.dateKey === todayKey) {
        setSnapshot(existing);
      } else if (timeWindow !== "before") {
        const newSnap = saveSnapshot(roleCounts, currentPatientIds);
        setSnapshot(newSnap);
      }
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimateIn(true));
    });
  }, [roleCounts, countsLoading, serverBaseline, serverLoading, timeWindow]);

  // EVERY role in the registry, authDenied included (Josh, 2026-08-20 — "make
  // sure this tab has all of the roles"). It used to be filtered out here
  // because the stage is unbuilt (§7), but this tab is the manager's inventory
  // of where patients are, and a denied patient is still a patient somebody
  // has to work — on the board, since there's no page. It stays unclickable
  // below; `hasRoute` is what governs that, not membership.
  const allRoles = ROLES;

  /** Can we do ID-level movement tracking? */
  const hasIdTracking = !!(snapshot?.patientIds && Object.keys(currentPatientIds).length > 0);

  const barData = useMemo(() => {
    if (!snapshot) return [];
    return allRoles
      .map((role) => {
        // A role with no key in the snapshot has no baseline to burn down
        // against (e.g. the baseline generator predates the role, or the
        // role's count isn't captured — fax / patient questions). Render it
        // as "not connected" instead of a fake "0 → N" with phantom +in.
        const connected = snapshot.counts[role.id] !== undefined;
        const baseline = snapshot.counts[role.id] ?? 0;
        const current = roleCounts[role.id] ?? 0;
        const delta = current - baseline;
        const full = Math.max(baseline, current);

        // Compute actual in/out using patient IDs when available
        let inCount = 0;
        let outCount = 0;
        const baselineIds = snapshot.patientIds?.[role.id];
        const currentIds = currentPatientIds[role.id];

        if (!connected) {
          // no baseline — no movement to report
        } else if (baselineIds && currentIds) {
          const baseSet = new Set(baselineIds);
          const currSet = new Set(currentIds);
          inCount = currentIds.filter((id) => !baseSet.has(id)).length;
          outCount = baselineIds.filter((id) => !currSet.has(id)).length;
        } else {
          // Fallback: estimate from net delta
          if (delta > 0) inCount = delta;
          else if (delta < 0) outCount = Math.abs(delta);
        }

        return { role, connected, baseline, current, delta, full, inCount, outCount };
      });
    // NO empty-bar filter (Josh, 2026-08-20). It used to drop any role sitting
    // at 0 with no baseline, which is why roles kept "missing" from this tab —
    // an empty queue and a role that isn't wired up looked identical, i.e. the
    // reader could not tell "nobody is waiting" from "this bar is lying".
    // A zero row now renders like any other; where there is also no baseline it
    // carries the existing "not connected" chip, which is the honest reading.
  }, [allRoles, snapshot, roleCounts, currentPatientIds]);

  /**
   * Bars sorted into their pipeline-stage sections. The table, the fallback
   * that keeps an unlisted role visible, and the flat stagger index all live
   * in lib/systemMgmt/operationsGroups.ts so they can be tested without
   * rendering this component.
   */
  const groupedBars = useMemo(() => groupRoleRows(barData), [barData]);

  const sqrtScale = (v: number) => Math.sqrt(Math.max(v, 0));
  const maxSqrt = Math.max(...barData.map((d) => sqrtScale(d.full)), 1);

  const totalProcessed = barData.reduce((sum, d) => sum + d.outCount, 0);
  const totalIncoming = barData.reduce((sum, d) => sum + d.inCount, 0);
  const totalPatients = barData.reduce((sum, d) => sum + d.current, 0);

  const snapshotTime = snapshot
    ? new Date(snapshot.takenAt).toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "";

  const isServerSource = snapshot?.source === "server";

  // Before 9 AM — show waiting state (only if no server baseline for today)
  if (timeWindow === "before" && !snapshot) {
    return (
      <div className="rounded-xl bg-card border shadow-card p-16 text-center space-y-4">
        <Sunrise className="w-10 h-10 mx-auto text-amber-400" />
        <h3 className="text-lg font-semibold text-foreground">
          Operations tracking starts at 9:00 AM ET
        </h3>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          The daily baseline is captured automatically by the server at 9 AM.
          Check back then to see your team's progress throughout the day.
        </p>
        <p className="text-xs text-muted-foreground">
          Current time: {getEasternTimeStr()} ET
        </p>
      </div>
    );
  }

  if (!snapshot || barData.length === 0) {
    if (countsLoading || serverLoading) {
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
          <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            {isServerSource ? (
              <Server className="w-3 h-3 inline" />
            ) : (
              <HardDrive className="w-3 h-3 inline" />
            )}
            Baseline: {snapshotTime} ET
            {isServerSource ? " (server)" : " (local)"}
            {" · "}{isAfterHours ? "Closed" : `Live: ${getEasternTimeStr()} ET`}
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

      {/* Burndown bars, grouped by pipeline stage — see lib/systemMgmt/operationsGroups.
          Each stage is a BOUNDED CARD rather than bars under a heading: with 23
          rows a bare label just floats above the list and the eye still reads
          one long column. The border is what actually separates them; the
          tinted header bar gives the title something to sit on, and the count
          on the right anchors the group as a unit. Chrome stays neutral on
          purpose — every bar already carries its own role colour, so tinting
          the sections too would be two colour systems fighting. */}
      <div className="space-y-3">
        {groupedBars.map((group) => {
          // Sum of the CURRENT column for this stage. ⚠️ "Other" mixes units —
          // `fax` counts unread faxes, not patients — which is why the label is
          // a bare number with a tooltip rather than "N patients". The global
          // total in the header above has always had the same mix.
          const groupTotal = group.bars.reduce((sum, b) => sum + b.current, 0);
          return (
        <section
          key={group.title}
          className="rounded-xl border border-border/70 bg-card/40 overflow-hidden"
        >
          <header className="flex items-baseline justify-between gap-3 px-3.5 py-2 border-b border-border/60 bg-muted/40">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.16em] text-foreground/75">
              {group.title}
            </h3>
            <span
              className="text-[11px] font-medium tabular-nums text-muted-foreground/80"
              title={`Current total across ${group.title}`}
            >
              {countsLoading ? "…" : groupTotal}
            </span>
          </header>
          <div className="p-2 space-y-2">
        {group.bars.map((d) => {
          // Flat index across every group, so the cascade runs down the whole
          // page instead of restarting at each heading.
          const i = d.i;
          const hex = COLOR_MAP[d.role.color] ?? "#6366f1";
          // The 4% floor keeps a 1-patient role visible, but it must not apply
          // to a role at zero: that painted a small coloured nub on a "0 → 0"
          // row, reading as "a little something" where there is nothing. Only
          // visible since empty rows started rendering (they were filtered out
          // before), so the floor and the empty case have to be separated.
          const ghostPct =
            maxSqrt > 0 && d.full > 0
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
                // No negative margin any more: `w-full` plus `-mx-3` overflowed
                // the row 12px to the right, which the section card's
                // `overflow-hidden` would clip straight through the counts.
                // The card's own padding gives the hover its inset instead.
                "w-full text-left group rounded-lg px-2.5 py-2 hover:bg-muted/40 transition-colors",
                hasRoute ? "cursor-pointer" : "cursor-default",
              )}
              onClick={() => {
                if (hasRoute) navigate(`${d.role.route}?from=system-mgmt`);
              }}
              title={hasRoute ? `Open ${d.role.label}` : d.role.label}
            >
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
                  {d.connected ? (
                    <>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {d.baseline}
                      </span>
                      <span className="text-xs text-muted-foreground/50">→</span>
                    </>
                  ) : (
                    <span
                      className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60 border border-border rounded-md px-1.5 py-0.5"
                      title="No baseline captured for this role — the bar shows the live count only"
                    >
                      not connected
                    </span>
                  )}
                  <span className="text-sm font-semibold text-foreground tabular-nums">
                    {countsLoading ? "…" : d.current}
                  </span>
                  {!d.connected ? null : (d.inCount > 0 || d.outCount > 0) ? (
                    <span className="flex items-center gap-1">
                      {d.inCount > 0 && (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded-md tabular-nums text-amber-600 dark:text-amber-400 bg-amber-500/10">
                          +{d.inCount}
                        </span>
                      )}
                      {d.outCount > 0 && (
                        <span className="text-xs font-medium px-1.5 py-0.5 rounded-md tabular-nums text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
                          -{d.outCount}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground/40 px-1.5 py-0.5">
                      —
                    </span>
                  )}
                </div>
              </div>

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
        </section>
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
