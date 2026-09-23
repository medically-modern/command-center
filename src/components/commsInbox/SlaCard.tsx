/**
 * The *Communications SLA · 24 hours* card (COMMS_INBOX_PLAN.md §1.2, Josh's D8:
 * *"4A"*) — on Reports & Metrics in place of *"No reports available yet"*, once
 * the Inbox is switched on.
 *
 * As drawn: Unresolved now (and how many are over 24h) · the share resolved
 * within 24h · the median time to resolve · how items were resolved · a per-rep
 * table · an *Open breaches* link. Every number is the gateway's
 * (`commsInboxRules.slaReport`), counted on the one clock the Inbox shows — so
 * a Friday-evening text answered Monday morning is inside the 24 hours here
 * exactly as it was on the Inbox (Josh's D7).
 *
 * ⚠️⚠️ **Left voicemail is an ATTEMPT and never a resolution** (Josh's D6). It
 * keeps the item open with its clock running, so it is counted beside the
 * resolutions and in its own table column — never in *Resolved*, never in
 * *within 24h*, never in the median. Folding it in would make the team's worst
 * case (a patient we keep missing) read as its best.
 *
 * ⚠️ **A failed read is not an empty report.** The card says it could not load
 * rather than drawing zeros, because *"0 unresolved"* is the one wrong answer a
 * manager acts on by doing nothing (§9's StaleDataNotice rule).
 *
 * ⚠️ **Read on open, never polled.** One Postgres read — the gateway's
 * `/comms/sla`, which touches RingCentral not at all — plus the Refresh button.
 * A report is not a queue; the Inbox is where the queue is watched.
 *
 * ⚠️ *Open breaches* goes to the Communications hub, which is behind the
 * `comms` ability at the route. Somebody who may read Reports but not work the
 * Inbox sees the link SHOWN and inert, with the reason — hiding it is the dead
 * end §5.39h records (`AbilityLock`'s rule). It reads the SIGNED-IN person.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Lock, RefreshCw, Voicemail } from "lucide-react";
import { useAccessContext } from "@/components/AccessProvider";
import { useAbility } from "@/components/shell/AbilityLock";
import { fetchSla, type SlaReport } from "@/lib/commsInbox/api";
import { formatShort } from "@/lib/commsInbox/rules";
import { SLA_DAYS, howBreakdown, howLabels, medianLabel, pct, repName, repNames } from "@/lib/commsInbox/sla";
import { cn } from "@/lib/utils";

/** The hub's Inbox, opened on its *Over 24h* view (read once by the hub). */
export const OPEN_BREACHES_HREF = "/assigned-patients?inbox=over";

type Tone = "neutral" | "amber" | "green" | "blue";

const TONE: Record<Tone, string> = {
  neutral: "border-border bg-muted/30",
  amber: "border-amber-300/70 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
  green: "border-emerald-300/70 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10",
  blue: "border-sky-300/70 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10",
};

function Tile({
  label,
  value,
  sub,
  tone = "neutral",
  children,
}: {
  label: string;
  value?: string;
  sub: ReactNode;
  tone?: Tone;
  children?: ReactNode;
}) {
  return (
    <div className={cn("min-w-0 rounded-lg border px-3 py-2.5", TONE[tone])} data-sla-tile={label}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      {children ?? (
        <div className="mt-0.5 text-2xl font-bold tabular-nums text-foreground">{value}</div>
      )}
      <div className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

export default function SlaCard() {
  const { config } = useAccessContext();
  const canWork = useAbility("comms");
  const names = useMemo(() => repNames(config), [config]);

  const [report, setReport] = useState<SlaReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const want = useRef(0);

  const load = useCallback(async () => {
    const token = ++want.current;
    setLoading(true);
    setError(null);
    try {
      const r = await fetchSla(SLA_DAYS);
      if (token !== want.current) return;
      setReport(r);
    } catch (e) {
      if (token !== want.current) return;
      // Keep nothing from before: a stale report under an error line still
      // reads as current, and the whole point of the error is that it isn't.
      setReport(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === want.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const breakdown = report ? howBreakdown(report.byHow) : [];

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5" aria-label="Communications SLA">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">Communications SLA · 24 hours</div>
          <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
            Every inbound text, missed call and voicemail should be resolved within 24 hours. Built from the
            Inbox&rsquo;s resolve log (who · how · when)
            {report ? (
              <>
                {" "}
                · last {SLA_DAYS} days, since {formatShort(report.since, report.now)}
              </>
            ) : null}
            .
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60"
            title="Read the report again"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
          </button>
          {canWork ? (
            <Link
              to={OPEN_BREACHES_HREF}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
            >
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /> Open breaches
            </Link>
          ) : (
            <span
              role="link"
              aria-disabled="true"
              title="Communications isn't assigned to you — an admin turns it on for you on the Users page."
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs font-medium text-muted-foreground"
            >
              <Lock className="h-3.5 w-3.5" /> Open breaches
            </span>
          )}
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">Couldn&rsquo;t load the report, so nothing here is counted. {error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-amber-400/60 px-2 py-0.5 text-xs font-semibold"
          >
            Try again
          </button>
        </div>
      ) : !report ? (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[74px] animate-pulse rounded-lg border border-border bg-muted/40" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Tile
              label="Unresolved now"
              value={String(report.open)}
              tone={report.over > 0 ? "amber" : "neutral"}
              sub={`${report.over} over 24h`}
            />
            <Tile
              label="Resolved within 24h"
              value={pct(report.withinPct)}
              tone="green"
              sub={report.resolved ? `${report.within} of ${report.resolved} in this period` : "Nothing resolved yet"}
            />
            <Tile label="Median time to resolve" value={medianLabel(report.medianMs)} sub="first inbound → resolved" />
            <Tile
              label="How it was resolved"
              tone="blue"
              sub={
                <>
                  <div>{report.resolved} resolved</div>
                  {/* Beside the resolutions, never among them (Josh's D6). */}
                  <div className="flex items-center gap-1" data-sla-attempts>
                    <Voicemail className="h-3 w-3 shrink-0" />
                    {report.attempts} left voicemail (attempts)
                  </div>
                </>
              }
            >
              <div className="mt-1 text-[13px] leading-snug text-foreground">
                {breakdown.length ? (
                  breakdown.map((b, i) => (
                    <span key={b.how}>
                      {/* The separator sits OUTSIDE the no-wrap span, so the
                          line can break between entries rather than clip. */}
                      {i > 0 && <span className="text-muted-foreground"> · </span>}
                      <span className="whitespace-nowrap">
                        {b.label} <b className="tabular-nums">{b.n}</b>
                      </span>
                    </span>
                  ))
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
            </Tile>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[620px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="py-1.5 pr-3 font-semibold">Rep</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Resolved</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Within 24h</th>
                  <th className="py-1.5 pr-3 text-right font-semibold">Median time</th>
                  <th className="py-1.5 pr-3 font-semibold">How</th>
                  <th className="py-1.5 text-right font-semibold" title="Left voicemail — an attempt, never a resolution">
                    Left voicemail
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.reps.length ? (
                  report.reps.map((r) => (
                    <tr key={r.who} className="border-b border-border/60 last:border-0" data-sla-rep={r.who}>
                      <td className="py-1.5 pr-3 font-medium text-foreground" title={r.who}>
                        {repName(r.who, names)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{r.resolved}</td>
                      <td
                        className="py-1.5 pr-3 text-right tabular-nums"
                        title={r.resolved ? `${r.within} of ${r.resolved}` : undefined}
                      >
                        {pct(r.withinPct)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{medianLabel(r.medianMs)}</td>
                      <td className="py-1.5 pr-3 text-xs text-muted-foreground">{howLabels(r.hows) || "—"}</td>
                      <td className="py-1.5 text-right tabular-nums">{r.attempts || "—"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="py-3 text-center text-sm text-muted-foreground">
                      Nothing resolved yet. The report fills in as the team resolves items in the Inbox.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ul className="mt-3 space-y-0.5 text-[11px] text-muted-foreground">
        <li>
          Time to resolve runs from the first inbound message to the resolve. Saturday and Sunday (Eastern) don&rsquo;t
          count — the same clock the Inbox shows.
        </li>
        <li>
          Left voicemail is an attempt: the item stays open with its clock running, so it is never counted as resolved.
        </li>
        <li>By week, by stage and a trend line come later, from this same log — they need weeks of history first.</li>
      </ul>
    </section>
  );
}
