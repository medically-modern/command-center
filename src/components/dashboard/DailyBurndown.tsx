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
import { filterQuery } from "@/lib/roleView";
import type { RoleFilter } from "@/lib/accessStore";
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
  /** Explicit role order (orderedRoleIds(profile)). When provided, bars render
   *  in this sequence and show their 1..N position number. */
  order?: string[];
  /** Per-role filter — builds each bar's role-page link and tells the page
   *  which escalation scope to show. Defaults per role to escalated
   *  (managerMode) or nonEscalated. */
  roleFilters?: Record<string, RoleFilter>;
  /**
   * `"stages"` draws Brandon's Stages view (pixel-match Phase 7, §5.52): his
   * `.bar` / `.track` / `.fill` markup under `pages/home/home.css`'s `.cc-bars`
   * scope. Everything else — the baseline, the counts, which bar opens what,
   * the confetti — is the same code either way; only the markup differs.
   *
   * ⚠️ Absent, the component is BYTE-IDENTICAL to what it was, which is what
   * keeps the "as today" layout (`Index.tsx`, `DashboardMainView`) untouched —
   * §5.39b's escape hatch. Only `ProcessorView` inside the redesign passes it.
   */
  look?: "stages";
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
  order,
  roleFilters,
  look,
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
  // Patient Texting belongs here for a stronger reason than the other two: it
  // has no Monday stage at all — no board, no group, no queue — so its bar
  // would always render empty and read as "nothing to do today" rather than as
  // a tool you open when you need it.
  // Orders joins them for the Subscription reason: one item per order on a
  // board of ~1,480, opened to look a patient's order up. Its badge is the
  // orders waiting to be placed (§5.35) — a real number, but not a queue the
  // processor works from here while the role is observation-only.
  const TASK_ROLE_IDS = new Set(["updateClinicals", "subscription", "assignedPatients", "orders"]);

  // When an explicit order is provided (processor SOP sequence), sort by it and
  // show position numbers; otherwise keep canonical config order.
  const numbered = !!order;
  const bySequence = (a: RoleConfig, b: RoleConfig) =>
    (order ? order.indexOf(a.id) : 0) - (order ? order.indexOf(b.id) : 0);

  const roles = ROLES.filter(
    (r) => visibleRoleIds.includes(r.id) && !TASK_ROLE_IDS.has(r.id),
  );
  if (order) roles.sort(bySequence);
  const taskRoles = ROLES.filter(
    (r) => visibleRoleIds.includes(r.id) && TASK_ROLE_IDS.has(r.id),
  );
  if (order) taskRoles.sort(bySequence);

  // Role-page link honoring each role's filter (falls back to managerMode).
  const linkFor = (id: string, route: string) => {
    const f = roleFilters?.[id] ?? (managerMode ? "escalated" : "nonEscalated");
    return `${route}${filterQuery(f)}`;
  };

  // The FAX bar has no route — clicking it opens the in-app Fax Inbox.
  const barClickable = (id: string, route: string) => id === "fax" || (!!route && id !== "authDenied");
  const openBar = (id: string, route: string) => {
    if (id === "fax") return navigate("/fax-inbox");
    if (route && id !== "authDenied") navigate(linkFor(id, route));
  };

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

  const allClear =
    managerMode &&
    !countsLoading &&
    barData.every((d) => d.current === 0) &&
    taskRoles.every((r) => (roleCounts[r.id] ?? 0) === 0);

  // ── Brandon's Stages look (pixel-match Phase 7, §5.52) ─────────────────
  // Same computed bars, same handlers, his markup. The skeleton state and the
  // "nothing to draw" state are decided exactly as the default look decides
  // them below; only what is rendered differs.
  if (look === "stages") {
    const skeleton = !snapshot || (barData.length === 0 && taskRoles.length === 0);
    if (skeleton && !(countsLoading || serverLoading)) return null;

    const barRow = (role: RoleConfig, i: number, d: { current: number; full: number } | null) => {
      const hex = COLOR_MAP[role.color] ?? "#6366f1";
      const hasRoute = barClickable(role.id, role.route);
      const isDone = !!d && !countsLoading && d.current === 0;
      const pct =
        d && maxSqrt > 0 ? Math.max((sqrtScale(d.current) / maxSqrt) * 100, d.current > 0 ? 4 : 0) : 0;
      return (
        <button
          key={role.id}
          type="button"
          className={cn("bar", !hasRoute && "inert")}
          onClick={() => {
            if (hasRoute) openBar(role.id, role.route);
          }}
          title={hasRoute ? `Open ${role.label}` : role.id === "authDenied" ? "Auth Denied has no page yet" : role.label}
        >
          <div className="lbl">
            <span className="row">
              {numbered && <span className="n">{i + 1}</span>}
              <span className={cn("dot", role.color)} />
              {role.label}
              {hasRoute && <ExternalLink className="ext" />}
            </span>
            {!d ? (
              <span className="tn muted">…</span>
            ) : isDone ? (
              <span className="done-lbl">
                {managerMode ? (
                  <>
                    <CheckCircle2 style={{ width: 13, height: 13 }} />
                    Clear
                  </>
                ) : (
                  "🎉 Done!"
                )}
              </span>
            ) : (
              <span className="tn">{countsLoading ? "…" : d.current}</span>
            )}
          </div>
          <div
            className={cn("track", isDone && "done")}
            ref={(el) => {
              if (!managerMode && isDone && animateIn && el && !celebratedRef.current.has(role.id)) {
                celebratedRef.current.add(role.id);
                requestAnimationFrame(() => fireBarConfetti(el));
              }
            }}
          >
            {!d ? (
              <div
                className="absolute inset-y-0 w-1/3 burndown-shimmer"
                style={{
                  background: `linear-gradient(90deg, transparent, ${hexToRgba(hex, 0.35)}, transparent)`,
                  animationDelay: `${i * 120}ms`,
                }}
              />
            ) : isDone ? null : (
              <div
                className="fill"
                style={{
                  width: animateIn ? `${pct}%` : "0%",
                  background: `linear-gradient(90deg, ${hex}, ${hexToRgba(hex, 0.75)})`,
                  transitionDelay: `${i * 60 + 200}ms`,
                }}
              />
            )}
          </div>
        </button>
      );
    };

    return (
      <div className="cc-bars">
        {managerMode && !skeleton && (
          <div className={cn("notice", allClear ? "green" : "red")} style={{ marginBottom: 14 }} role="status">
            {allClear ? <CheckCircle2 style={{ width: 16, height: 16 }} /> : <ShieldAlert style={{ width: 16, height: 16 }} />}
            <div>
              <b>{allClear ? "All clear — no escalated patients" : "Escalated patients only"}</b>
              <div className="xs">
                {allClear
                  ? "Nothing in these roles is flagged for escalation right now."
                  : "Bars show patients flagged for escalation in each role — not the full queue."}
              </div>
            </div>
          </div>
        )}

        <div className="bars">
          {skeleton
            ? roles.map((role, i) => barRow(role, i, null))
            : barData.map((d, i) => barRow(d.role, i, d))}
        </div>

        {/* ⚠️ His redesign draws NO ad-hoc tiles on the Stages view; ours keeps
            them because Subscription, Update Clinicals and Orders have no other
            door from the home screen (§5.39f's lossless rule — the tiles are
            built from the role registry, and `lossless.test.ts` says so).
            ⚠️ COMMUNICATIONS is the one tile dropped HERE (Josh, 2026-09-25:
            "remove communications from here but obviously leave it in top
            bar, that's where it lands when we assign it") — in this layout
            the header's Communications tab is its door, so the tile was the
            same destination twice on one screen. The "as today" look keeps
            its tile: no top bar there. */}
        {taskRoles.some((r) => r.id !== "assignedPatients") && (
          <div className="adhoc">
            <div className="eyebrow">Ad-hoc tasks</div>
            {taskRoles.filter((r) => r.id !== "assignedPatients").map((role) => {
              const count = roleCounts[role.id] ?? 0;
              return (
                <button
                  key={role.id}
                  type="button"
                  className="btn teal"
                  onClick={() => role.route && navigate(linkFor(role.id, role.route))}
                  title={`Open ${role.label}`}
                >
                  <Zap style={{ width: 16, height: 16 }} />
                  {role.label}
                  {(skeleton || count > 0) && (
                    <span className="count-badge tn">{skeleton || countsLoading ? "…" : count}</span>
                  )}
                  <ExternalLink className="ext" />
                </button>
              );
            })}
          </div>
        )}

        <div className="foot-note">
          {skeleton ? (
            <span className="row">
              <Clock style={{ width: 12, height: 12 }} className="animate-pulse" />
              Pulling live counts…
            </span>
          ) : (
            <>
              <span className="row">
                <Zap style={{ width: 12, height: 12 }} />
                Refreshes every 60s
              </span>
              <span>
                {managerMode ? "Click a bar to open that role's escalated patients" : "Click a bar to open that role's dashboard"}
              </span>
            </>
          )}
        </div>
      </div>
    );
  }

  if (!snapshot || (barData.length === 0 && taskRoles.length === 0)) {
    if (countsLoading || serverLoading) {
      // Skeleton bars: while live counts are being fetched, show a shimmer
      // animation per role instead of numbers (stale cached zeros used to
      // briefly render as "Done!" here).
      return (
        <div className="space-y-6">
          <div className="space-y-3">
            {roles.map((role, i) => {
              const hex = COLOR_MAP[role.color] ?? "#6366f1";
              const hasRoute = barClickable(role.id, role.route);
              return (
                <button
                  key={role.id}
                  className={cn(
                    "w-full text-left group",
                    hasRoute ? "cursor-pointer" : "cursor-default",
                  )}
                  onClick={() => {
                    if (hasRoute) openBar(role.id, role.route);
                  }}
                  title={hasRoute ? `Open ${role.label}` : role.label}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-foreground flex items-center gap-2">
                      {numbered && (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted text-[11px] font-bold text-muted-foreground tabular-nums shrink-0">{i + 1}</span>
                      )}
                      <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", role.color)} />
                      {role.label}
                      {hasRoute && (
                        <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-40 transition-opacity" />
                      )}
                    </span>
                    <span className="text-sm font-semibold text-muted-foreground tabular-nums">…</span>
                  </div>
                  <div className="relative h-8 w-full rounded-lg overflow-hidden bg-muted/30">
                    <div
                      className="absolute inset-y-0 w-1/3 burndown-shimmer"
                      style={{
                        background: `linear-gradient(90deg, transparent, ${hexToRgba(hex, 0.35)}, transparent)`,
                        animationDelay: `${i * 120}ms`,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
          {taskRoles.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                Ad-hoc tasks
              </p>
              {taskRoles.map((role) => (
                <div key={role.id} className="flex items-center gap-3">
                  <button
                    onClick={() =>
                      role.route &&
                      navigate(linkFor(role.id, role.route))
                    }
                    title={`Open ${role.label}`}
                    className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                    style={{ background: "var(--mm-teal, #3f5c63)" }}
                  >
                    <Zap className="w-4 h-4" />
                    {role.label}
                    <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-1.5 rounded-full bg-white/25 text-xs font-bold tabular-nums">
                      …
                    </span>
                    <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 pt-1 text-xs text-muted-foreground/60">
            <Clock className="w-3 h-3 animate-pulse" />
            Pulling live counts…
          </div>
        </div>
      );
    }
    return null;
  }

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
          const hasRoute = barClickable(d.role.id, d.role.route);
          const isDone = !countsLoading && d.current === 0;

          return (
            <button
              key={d.role.id}
              className={cn(
                "w-full text-left group",
                hasRoute ? "cursor-pointer" : "cursor-default"
              )}
              onClick={() => {
                if (hasRoute) openBar(d.role.id, d.role.route);
              }}
              title={hasRoute ? `Open ${d.role.label}` : d.role.label}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-foreground flex items-center gap-2">
                  {numbered && (
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted text-[11px] font-bold text-muted-foreground tabular-nums shrink-0">{i + 1}</span>
                  )}
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
                    navigate(linkFor(role.id, role.route))
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
