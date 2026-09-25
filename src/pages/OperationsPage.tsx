import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, BarChart3, ExternalLink, RefreshCw } from "lucide-react";
import SlaCard from "@/components/commsInbox/SlaCard";
import { useCommsConfig } from "@/hooks/commsInbox/useInbox";
import { useAccessContext } from "@/components/AccessProvider";
import { useSystemPatients } from "@/hooks/systemMgmt/useSystemPatients";
import { useRoleCounts } from "@/hooks/useRoleCounts";
import { useReportsData } from "@/hooks/reports/useReportsData";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { useShellLayout } from "@/hooks/shell/useShellLayout";
import { getUser } from "@/lib/shared/auth";
import {
  fmt, formLeadFacts, orderFacts, pipelineFacts, queueCards, stageTiles, subscriptionFacts, topStepsText,
  type QueueBar,
} from "@/lib/reports/reportsRules";
import { cn } from "@/lib/utils";
import "./reports/reports.css";

/**
 * Reports & Metrics — Brandon's `viewReports`, built from data the app already
 * reads (pixel-match Phase 6b, 2026-09-25; CLAUDE.md §5.52).
 *
 * The file keeps its name: `App.tsx` and `lossless.test.ts` know this route as
 * `OperationsPage`, and a rename is a change to every door for no reader's
 * benefit. What it renders is his page: Katie's Patient Pipeline Tracker, the
 * onboarding pipeline in tiles, the subscription and order tiles, and "Queues
 * today" — one bar per role, grouped by stage — plus the Communications SLA
 * card (Josh's D8) while the Inbox is switched on.
 *
 * ⚠️⚠️ **THE TRACKER LINKS OUT; IT IS NOT EMBEDDED, AND THAT WAS MEASURED, NOT
 * ASSUMED.** His handoff says *"in the live build it is embedded here as the
 * full-page app"*. It cannot be: Monday answers every page — the tracker's own
 * URL on `medicallymodern-force.monday.com` included, fetched 2026-09-24 — with
 * `Content-Security-Policy: frame-ancestors https://*.monday.com …` naming only
 * monday.com, Microsoft and a few partner hosts. A browser refuses to draw such
 * a page inside a frame on any other origin, and there is no header this app
 * could send to change that. So the dashed frame Brandon draws carries a
 * sentence saying so, and the button opens the tracker in its own tab, exactly
 * as his mockup does. Do not "fix" this with an `<iframe>` — it renders blank.
 *
 * ⚠️⚠️ **EVERY NUMBER IS A READING OF A RULE THAT ALREADY EXISTS** —
 * `lib/reports/reportsRules.ts` is the whole of the arithmetic and says which
 * rule each tile reads. The queue bars ARE `useRoleCounts`, grouped by
 * `operationsGroups` exactly as the Operations tab groups them, so this page
 * cannot disagree with the burndown (§5.8's counting contract). The pipeline
 * tiles read System Management's seven-board snapshot (`useSystemPatients`),
 * so "active" and "stuck" here are the folders the search box shows.
 *
 * ⚠️ **Read on open, never polled by this page.** The three slim reads behind
 * the subscription, lead and order tiles (`useReportsData`) run once and again
 * on Refresh. The snapshot hook keeps its own 90-second cadence and its own
 * IndexedDB cache — while that cache is what is on screen, the page says so
 * (`hydrating`), because a stale count read as live is the one wrong answer a
 * manager acts on by doing nothing.
 *
 * ⚠️ A failed read is REPORTED beside the tiles it feeds and never rendered as
 * zero. Each source fails on its own, so a Monday 503 on the order board takes
 * out one tile, not the page.
 *
 * ⚠️ The `reports` ability is enforced at the ROUTE in `App.tsx`, not here: a
 * gate on the tab is not a gate on the page (§5.39h), and this URL is
 * bookmarkable. Operations itself is still NOT this page and still has no door
 * in the chrome (§5.46b) — `lossless.test.ts` pins that this file never
 * borrows `<OperationsTab`.
 */

/** Katie's Patient Pipeline Tracker — the monday full-page app (board 18425649613,
 *  app feature 121528191, workspace "Katie Tyler Vibes"). Brandon's own URL. */
export const TRACKER_URL =
  "https://medicallymodern-force.monday.com/misc/vibe/full-page-app/object/v/?object-id=18425649613&app-feature-id=121528191";

/** "—" in a tile while its source has not answered (Brandon's `snapshotNA`). */
const DASH = "—";

export default function OperationsPage() {
  const comms = useCommsConfig();
  const { email, config } = useAccessContext();
  const snapshot = useSystemPatients();
  const counts = useRoleCounts();
  const reads = useReportsData();

  const me = getUser();
  const myName = me?.name || config.processors?.[email]?.name || email.split("@")[0] || "Signed in";

  const leadFacts = useMemo(() => (reads.formLeads.data ? formLeadFacts(reads.formLeads.data) : null), [reads.formLeads.data]);
  const tiles = useMemo(
    () => stageTiles(snapshot.patients, leadFacts?.leadIds),
    [snapshot.patients, leadFacts],
  );
  const facts = useMemo(() => pipelineFacts(snapshot.patients), [snapshot.patients]);
  const subs = useMemo(() => (reads.subscriptions.data ? subscriptionFacts(reads.subscriptions.data) : null), [reads.subscriptions.data]);
  const orders = useMemo(() => (reads.orders.data ? orderFacts(reads.orders.data) : null), [reads.orders.data]);
  const cards = useMemo(() => queueCards(counts.counts, counts.escalatedCounts), [counts.counts, counts.escalatedCounts]);

  // The snapshot has nothing to show until its first page lands (or its cache).
  const snapReady = snapshot.patients.length > 0 || !snapshot.loading;
  const n = (v: number | null | undefined, ready: boolean) => (ready && typeof v === "number" ? fmt(v) : DASH);
  const inPipeline = tiles.reduce((a, t) => a + t.count, 0) + (leadFacts?.leads ?? 0);

  const refresh = () => {
    void snapshot.refetch(true);
    void counts.refetch(true);
    reads.refetch();
  };
  const busy = snapshot.loading || snapshot.hydrating || counts.loading || reads.loading;

  return (
    <div className="cc-rp min-h-screen bg-gradient-subtle">
      <BackRow />
      <div className="rp">
        <div className="rp-title">
          <div>
            <h2>Reports &amp; Metrics</h2>
            <div className="small muted" style={{ marginTop: 2 }}>{myName} · the pipeline in numbers</div>
          </div>
          <button type="button" className="btn outline sm" onClick={refresh} disabled={busy} title="Read every number again">
            <RefreshCw style={{ width: 13, height: 13 }} className={cn(busy && "animate-spin")} />
            {busy ? "Reading…" : "Refresh"}
          </button>
        </div>

        {/* Katie's tracker — a link, for the reason in the header comment. */}
        <section className="card pad tracker">
          <div className="row wrap" style={{ gap: 12 }}>
            <span className="tile blue"><BarChart3 style={{ width: 18, height: 18 }} /></span>
            <div className="grow">
              <b>Patient Pipeline Tracker</b>
              <div className="xs muted">Katie's metrics app on Monday (workspace "Katie Tyler Vibes"). It opens in its own tab, signed in as you are on Monday.</div>
            </div>
            <a className="btn primary sm" href={TRACKER_URL} target="_blank" rel="noopener noreferrer">
              <ExternalLink style={{ width: 13, height: 13 }} /> Open the tracker
            </a>
          </div>
          <div className="tracker-frame">
            <BarChart3 style={{ width: 26, height: 26 }} />
            <div className="xs muted" style={{ maxWidth: 460, marginTop: 6 }}>
              Monday does not let its pages be shown inside another site (its frame policy names only monday.com),
              so the tracker can't be drawn here — the button above opens it. The numbers below come from the
              Command Center's own data so the two can be compared.
            </div>
          </div>
        </section>

        <div className="eyebrow">Onboarding pipeline</div>
        {snapshot.error && (
          <Notice>Couldn't read the pipeline boards — the tiles below show the last answer we have. {snapshot.error}</Notice>
        )}
        {!snapshot.error && snapshot.hydrating && (
          <div className="xs muted">Showing the cached snapshot — refreshing from Monday…</div>
        )}
        {!snapshot.error && !snapReady && <div className="xs muted">Reading the pipeline boards…</div>}
        <div className="tiles">
          {tiles.map((t) => (
            <Tile
              key={t.key}
              label={t.label}
              n={n(t.count, snapReady)}
              sub={[
                t.avgDays !== null ? `avg ${t.avgDays} days in stage` : "",
                t.key === "intake" && leadFacts?.imported ? `${fmt(leadFacts.imported)} are imported referral rows` : "",
              ].filter(Boolean).join(" · ")}
            />
          ))}
        </div>
        {reads.formLeads.error && (
          <Notice>Couldn't read the web-form groups, so Web-form leads and Total in pipeline are missing them. {reads.formLeads.error}</Notice>
        )}
        <div className="tiles">
          <Tile label="Stuck" n={n(facts.stuck, snapReady)} sub="board group Stuck, or a stuck proposal" cls={facts.stuck ? "red" : ""} />
          <Tile label="Escalated" n={n(facts.escalated, snapReady)} sub="escalation flagged on the board" cls={facts.escalated ? "red" : ""} />
          <Tile
            label="Web-form leads"
            n={n(leadFacts?.leads, !!leadFacts)}
            sub={leadFacts ? topStepsText(leadFacts) || "no drop-off steps recorded" : reads.formLeads.error ? "not read" : "reading…"}
          />
          <Tile
            label="Total in pipeline"
            n={n(inPipeline, snapReady && !!leadFacts)}
            sub={snapReady ? `${fmt(facts.known)} patients known` : ""}
          />
        </div>

        <div className="eyebrow">Subscriptions &amp; orders</div>
        {reads.subscriptions.error && (
          <Notice>Couldn't read the Subscription board. {reads.subscriptions.error}</Notice>
        )}
        {reads.orders.error && (
          <Notice>Couldn't read the order board. {reads.orders.error}</Notice>
        )}
        <div className="tiles">
          <Tile label="Active subscriptions" n={n(subs?.active, !!subs)} sub={subs ? `${fmt(subs.paused)} paused` : reads.subscriptions.error ? "not read" : "reading…"} />
          <Tile label="Late for an order" n={n(subs?.late, !!subs)} sub="days-to-order says Order Day Passed or Very Late" cls={subs?.late ? "red" : ""} />
          <Tile label="MR expired" n={n(subs?.mrExpired, !!subs)} sub="clinicals need refreshing" cls={subs?.mrExpired ? "red" : ""} />
          <Tile
            label="Open orders"
            n={n(orders?.open, !!orders)}
            sub={orders ? `${fmt(orders.hold)} on hold · ${fmt(orders.backordered)} backordered` : reads.orders.error ? "not read" : "reading…"}
          />
        </div>

        <div className="eyebrow">Queues today</div>
        <div className="stage-grid">
          {cards.map((c) => (
            <section key={c.title} className="card pad">
              <div className="eyebrow" style={{ marginBottom: 8 }}>{c.title}</div>
              {c.bars.map((b) => <MiniBar key={b.role.id} bar={b} />)}
            </section>
          ))}
        </div>

        {comms.ui && (
          <>
            <div className="eyebrow">Communications</div>
            <SlaCard />
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ label, n, sub, cls }: { label: string; n: string; sub?: string; cls?: string }) {
  return (
    <div className="tile-s">
      <div className="eyebrow">{label}</div>
      <div className={cn("n", n === DASH && "dim", cls)}>{n}</div>
      <div className="xs muted">{sub || " "}</div>
    </div>
  );
}

/**
 * One queue bar — Brandon's `.mini-bar`: label · track · count · esc chip.
 * A bar with a door is a Link; one without (Auth Denied, a role with no route)
 * is the same row, inert, so nothing reads as a broken link.
 */
function MiniBar({ bar }: { bar: QueueBar }) {
  const body = (
    <>
      <span className="lbl truncate">{bar.role.label}</span>
      <span className="track">
        <span className={cn("fill", bar.role.color)} style={{ width: `${bar.pct}%` }} />
      </span>
      <span className="tn">{bar.count === null ? DASH : fmt(bar.count)}</span>
      {bar.esc > 0 ? <span className="esc">{fmt(bar.esc)} esc</span> : <span />}
    </>
  );
  if (!bar.href) return <span className="mini-bar inert" title={bar.role.label}>{body}</span>;
  return <Link className="mini-bar" to={bar.href} title={`Open ${bar.role.label}`}>{body}</Link>;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice amber" role="status">
      <AlertTriangle style={{ width: 14, height: 14 }} />
      <span>{children}</span>
    </div>
  );
}

/** The way back OUTSIDE the redesign only — inside it the header is the way (§5.39d). */
function BackRow() {
  const { goBack } = useBackNavigation();
  const [layout] = useShellLayout();
  if (layout === "redesign") return null;
  return (
    <div style={{ padding: "10px 24px 0", maxWidth: 1280, margin: "0 auto" }}>
      <button type="button" onClick={goBack} className="btn outline sm">
        <ArrowLeft style={{ width: 13, height: 13 }} /> Back
      </button>
    </div>
  );
}
