/**
 * DVS — the fully-automatic Medicaid verification stage
 * (JOSH_HANDOFF_DVS.md v2; dvs-redesign.html is the visual spec).
 *
 * READ-ONLY MONITOR: the Stage Advancer flipping to "DVS" is the trigger
 * (the app's sends also auto-flip the right Trigger DVS column for today's
 * bots — dvsRouting.dvsAutoTrigger). This page polls the board and narrates
 * what the automation did. The only writes here: the manual-review Re-run
 * buttons and Reference Notes. (The rail's +1d follow-up snooze was removed
 * 2026-07 — DVS is automated, so there is nothing for a rep to defer. The
 * due/snoozed split below is KEPT: a Follow Up Date set elsewhere still hides
 * a patient from the rail, matching useRoleCounts' dvs rule.)
 *
 * Read model (live bot columns, found 2026-07-21): Trigger Supplies DVS /
 * Trigger Pump DVS status labels (Running / Success / Failed / Manual
 * Review / Retry Queued / MLTC / Denied), Claims Status, per-code claim
 * text (A4230 Claim / A4232 Claim), Claims Paid Amount + Date, DVS Denial
 * Reason, Claims Error + Denial Reason, Retry Count + Retry Next Date.
 * Still missing per-code AUTH results and E0784 claim detail (§10).
 *
 * DVS runs on the CIN — the Medicaid ID in XX11111X format on Member ID 1
 * or Member ID 2 (nyMedicaidCin). UI language is always "Medicaid ID".
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDvsPatients } from "@/hooks/dvs/useDvsPatients";
import type { Patient } from "@/lib/samantha/workflow";
import { PatientProfileCard } from "@/components/samantha/PatientProfileCard";
import { NotesPanel } from "@/components/samantha/NotesPanel";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { EmptyPatientPane } from "@/components/shared/EmptyPatientPane";
import { ReportIssueButton } from "@/components/shared/ReportIssueButton";
import { StageActionBar } from "@/components/shared/StageActionBar";
import { Button } from "@/components/ui/button";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { managerChartFromParams, managerBucketFromParams } from "@/lib/shared/managerOrigin";
import { railFilterFor } from "@/lib/samantha/managerRail";
import { resolveHcpcs, isAutoFilledMedicaidSupply, PRODUCT_LABELS, type ProductId } from "@/lib/samantha/hcpcRules";
import { allProductsDvsRouted, isStraightMedicaidPrimary, nyMedicaidCin } from "@/lib/samantha/dvsRouting";
import { writeStatusIndex, writeLongText, COL } from "@/lib/samantha/mondayApi";
import { TRIGGER_DVS_INDEX, TRIGGER_PUMP_DVS_INDEX } from "@/lib/samantha/mondayMapping";
import { etTodayYmd, ymdToUs } from "@/lib/samantha/benefitsDerive";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Clock, Loader2, RefreshCw, RotateCw, Search, User, Zap } from "lucide-react";

/* ── status-chip tone mapping (live bot labels) ───────────────────── */

type Tone = "mint" | "rose" | "sky" | "amber" | "gray";

function toneFor(label: string | undefined): Tone {
  const l = (label ?? "").toLowerCase();
  if (!l) return "gray";
  if (l.includes("success") || l.includes("paid") || l.includes("approved")) return "mint";
  if (l.includes("denied") || l.includes("failed") || l.includes("error") || l.includes("manual") || l.includes("mltc") || l.includes("incorrect")) return "rose";
  if (l.includes("retry")) return "amber";
  if (l.includes("running") || l.includes("trigger") || l.includes("submit")) return "sky";
  return "gray";
}

const TONE_CLASS: Record<Tone, string> = {
  mint: "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
  rose: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800",
  sky: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800",
  amber: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
  gray: "bg-muted text-muted-foreground border-border",
};

function StatusChip({ label, fallback }: { label?: string; fallback?: string }) {
  const text = (label ?? "").trim() || (fallback ?? "Not started");
  return (
    <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border whitespace-nowrap", TONE_CLASS[toneFor(label)])}>
      {text}
    </span>
  );
}

const isFailedish = (label: string | undefined) => toneFor(label) === "rose";

/**
 * Needs a human: a rose Supplies/Pump DVS status (MLTC / Failed / Manual
 * Review / Denied) or a claims failure. STATUS-ONLY (Josh 2026-07-29): no
 * automation flips DVS patients to a manager escalation, so the Escalation
 * column is deliberately not consulted — a label carried in from an earlier
 * stage must not classify a patient as manual review. Mirrors the oversight
 * `dvs-manual-review` CHART_FILTER — `toneFor` maps exactly those labels to
 * "rose" — so the rail can match that chart.
 */
const isManualReview = (p: Patient) =>
  isFailedish(p.dvsStatus) ||
  isFailedish(p.pumpDvsStatus) ||
  // Both halves of the split claims family — "S Claims Status" (supplies) and
  // "IP Claims Status" (pump). The pump half went unread until 2026-08-02.
  isFailedish(p.claimsStatus) ||
  isFailedish(p.ipClaimsStatus);

/**
 * In the retry queue = the bot has literally parked the item there
 * (Supplies/Pump DVS = "Retry Queued"). Mirrors the oversight
 * `dvs-retry-queue` CHART_FILTER — keep the two in agreement.
 *
 * Deliberately NOT `retryCount > 0 || tone === "amber"` (the old rule): a retry
 * count LINGERS after an item leaves the queue, and "Manual Review" is amber
 * too, so manual-review patients were being labelled "Retry queue · attempt N"
 * in the rail when they aren't queued at all.
 */
const isQueued = (p: Patient) => p.dvsStatus === "Retry Queued" || p.pumpDvsStatus === "Retry Queued";

/* ── page ─────────────────────────────────────────────────────────── */

const DvsPage = () => {
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const { patients, loading, initialLoading, error, refetch } = useDvsPatients(searchParams.get("patientId"));
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("patientId"));
  const [search, setSearch] = useState("");
  const [rerunning, setRerunning] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const todayEt = etTodayYmd();
  // Daily bucket (same date-only rule as Auth Outstanding): a future
  // Follow Up Date hides the patient from the working list until it arrives.
  const snoozed = (p: Patient) => !!p.followUpDate && p.followUpDate > todayEt;

  // Narrow the rail to the oversight chart AND BAR this page was opened from,
  // so the list matches what the manager clicked (lib/samantha/managerRail —
  // shared with the Benefits / Submit Auth / Auth Outstanding pages). A
  // deep-linked patient (?patientId=) is always kept even when they don't
  // match, so a click can never open a page that doesn't list that patient.
  const railFilter = railFilterFor(
    managerChartFromParams(searchParams),
    managerBucketFromParams(searchParams),
  );
  const deepLinkedId = searchParams.get("patientId");
  const inRail = useMemo(
    () => (p: Patient) => !railFilter || p.id === deepLinkedId || railFilter(p),
    [railFilter, deepLinkedId],
  );

  const bySearch = useMemo(() => {
    const q = search.trim().toLowerCase();
    const scoped = patients.filter(inRail);
    return q ? scoped.filter((p) => p.name.toLowerCase().includes(q)) : scoped;
  }, [patients, search, inRail]);
  const duePatients = useMemo(() => bySearch.filter((p) => !snoozed(p)), [bySearch, todayEt]);
  const snoozedPatients = useMemo(() => bySearch.filter((p) => snoozed(p)), [bySearch, todayEt]);

  const selected: Patient | undefined = useMemo(() => {
    const byId = patients.find((p) => p.id === selectedId);
    // Nothing in the sidebar → open nothing, rather than falling back to a
    // patient the rail/search no longer lists (same rule as
    // useAutoSelectPatient). A deep-linked patient is exempt — managers open
    // those deliberately from off-queue.
    if (duePatients.length === 0 && snoozedPatients.length === 0) {
      return byId && byId.id === searchParams.get("patientId") ? byId : undefined;
    }
    return byId ?? duePatients[0] ?? snoozedPatients[0];
  }, [patients, selectedId, duePatients, snoozedPatients, searchParams]);

  const straight = selected ? isStraightMedicaidPrimary(selected) : false;
  const cin = selected ? nyMedicaidCin(selected) : null;
  const resolved = useMemo(
    () =>
      selected
        ? resolveHcpcs(selected.primaryInsurance || null, selected.serving || null, selected.secondaryInsurance ?? null)
        : [],
    [selected],
  );
  const dvsProducts = useMemo(
    () => new Set(resolved.filter((r) => straight || isAutoFilledMedicaidSupply(r)).map((r) => r.product)),
    [resolved, straight],
  );
  const pumpDvses = straight && resolved.some((r) => r.product === "insulin_pump");
  const suppliesDvs = resolved.some(
    (r) => dvsProducts.has(r.product) && (r.product === "infusion_set" || r.product === "cartridge"),
  );
  // "Everything here goes through NY Medicaid" — straight Medicaid OR a
  // supplies-only managed dual. Only pump-via-payer duals rode the rail.
  const skippedRail = selected ? allProductsDvsRouted(selected) : false;
  const pumpDvsApproved = toneFor(selected?.pumpDvsStatus) === "mint";
  // The supplies chain waits on the pump CLAIM being fully paid (§5), not
  // just the DVS approval. Claims Status is the bot's shared claims column —
  // while the pump is the only claim in flight, mint there = pump paid. Once
  // the bot starts writing a supplies DVS status, show that instead.
  const pumpClaimPaid = pumpDvsApproved && toneFor(selected?.claimsStatus) === "mint";
  const suppliesStarted = !!(selected?.dvsStatus ?? "").trim();
  const waitingOnPump = pumpDvses && !pumpClaimPaid && !suppliesStarted;

  const handleRerun = async (kind: "supplies" | "pump") => {
    if (!selected || rerunning) return;
    setRerunning(kind);
    try {
      if (kind === "supplies") {
        await writeStatusIndex(selected.id, COL.triggerDvs, TRIGGER_DVS_INDEX.triggerDvs);
      } else {
        await writeStatusIndex(selected.id, COL.triggerPumpDvs, TRIGGER_PUMP_DVS_INDEX.triggerPumpDvs);
      }
      toast.success(`${kind === "supplies" ? "Supplies" : "Pump"} DVS re-triggered — only the unpaid work re-runs (§5)`);
      refetch();
    } catch (e) {
      toast.error("Re-run failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRerunning(null);
    }
  };

  /* Top-of-page banner: GONE (Josh, 2026-07). The Manual-review, "Automation in
     progress" and "Fully paid" banners went earlier because the DVS Status by
     Product grid already shows those states; the retry-queue one is now gone
     too — the IN RETRY QUEUE strip below the Claims step already carries the
     attempt # and next-run date, so the banner only repeated it. */

  return (
    <div className="min-h-screen flex w-full bg-gradient-subtle">
      <PageLoadingOverlay show={initialLoading} />

      {/* lite patient rail — daily bucket with the +1d follow-up snooze */}
      <aside className="w-72 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground hidden md:flex flex-col">
        <div className="p-3 border-b border-sidebar-border">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Monday · DVS</p>
          <p className="text-sm font-semibold">Patients ({duePatients.length})</p>
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patients…"
              className="w-full pl-8 pr-2 py-1.5 rounded-md border border-border bg-white text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {duePatients.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={cn(
                "w-full min-w-0 flex items-start gap-2 p-2 rounded-lg text-left transition-colors",
                selected?.id === p.id ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
              )}
            >
              <User className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate">{p.name}</span>
                <span className="block text-[11px] text-muted-foreground truncate">
                  {p.primaryInsurance || "—"} · {isStraightMedicaidPrimary(p) ? "Straight to DVS" : "Via payer rail"}
                </span>
                {isQueued(p) && (
                  <span className="block text-[10px] font-medium text-amber-400 mt-0.5">
                    Retry queue{p.retryCount ? ` · attempt ${p.retryCount}` : ""}
                  </span>
                )}
              </span>
            </button>
          ))}
          {!loading && duePatients.length === 0 && (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {error ? error : "Bucket clear — nothing due today."}
            </p>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border">
          <div className="px-3 sm:px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <button onClick={() => goBack()} className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                <Zap className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern · NY Medicaid</p>
                <h1 className="text-2xl font-bold">DVS</h1>
                {selected && <p className="text-sm opacity-80 mt-0.5">{selected.name}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selected && (
                <StageActionBar
                  stage="dvs"
                  board="insurance"
                  patientId={selected.id}
                  patientName={selected.name}
                  escalationLabel={selected.escalationLabel}
                  onDone={() => refetch(true)}
                />
              )}
              <Button onClick={() => refetch()} disabled={loading} className="gap-2 bg-white text-navy hover:bg-white/90 shadow-elevate">
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
              </Button>
              <ReportIssueButton />
            </div>
          </div>
        </header>

        <main className="flex-1 px-3 sm:px-6 py-6">
          <section className="max-w-5xl xl:max-w-none 2xl:max-w-[1800px] mx-auto grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
            <div className="space-y-5 min-w-0">
              {!selected && (
                <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                  <EmptyPatientPane
                    loading={loading}
                    error={error}
                    queueEmpty={duePatients.length === 0 && snoozedPatients.length === 0}
                    hint="No patients are at the DVS stage right now."
                  />
                </div>
              )}
              {selected && (
                <>
                  {/* CIN — the ID everything runs on (never say "CIN" in UI) */}
                  {cin ? (
                    <div className="rounded-xl border border-l-4 border-[#0F4C5C]/30 border-l-[#0F4C5C] bg-[#0F4C5C]/5 px-4 py-3 flex items-center gap-3 flex-wrap">
                      <p className="text-sm text-[#0F4C5C] dark:text-teal-200">
                        <span className="text-[10px] font-bold uppercase tracking-wide bg-[#0F4C5C] text-white rounded-full px-2 py-0.5 mr-2">DVS runs on this</span>
                        Medicaid ID <b className="font-mono select-all">{cin.cin}</b>
                        <span className="text-muted-foreground"> · from {cin.source}</span>
                      </p>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/30 px-4 py-3">
                      <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-600" />
                      <p className="text-sm text-red-800 dark:text-red-300">
                        <b>No valid Medicaid ID</b> — neither Member ID matches the required format
                        (2 letters · 5 digits · 1 letter, e.g. KJ51074B). The bot can't run and new
                        sends won't route here until it's fixed on the profile.
                      </p>
                    </div>
                  )}

                  {/* no onUpdate — read-only monitor, so no Edit pencil */}
                  <PatientProfileCard patient={selected} />

                  {/* entry-path cards (§1) — a supplies-only managed dual
                      never rode the payer rail either, so it highlights the
                      skip path with straight Medicaid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <PathCard active={skippedRail} title="Straight to DVS" />
                    <PathCard active={!skippedRail} title="Pump Approved via Primary Payer" />
                  </div>

                  {/* DVS status by product (§8) */}
                  <div className="rounded-xl bg-card border shadow-card p-4">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">DVS Status by Product</p>
                    <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
                      {(["monitor", "sensors", "insulin_pump", "infusion_set", "cartridge"] as ProductId[]).map((pid) => {
                        const r = resolved.find((x) => x.product === pid);
                        const isDvs = dvsProducts.has(pid);
                        const pumpViaPayer = !!r && !isDvs && pid === "insulin_pump" &&
                          (selected.insurance?.codes?.pump?._mondayAuthLabel ?? "").toLowerCase() === "auth valid";
                        const supplies = pid === "infusion_set" || pid === "cartridge";
                        const approved =
                          isDvs && toneFor(supplies ? selected.dvsStatus : selected.pumpDvsStatus) === "mint";
                        return (
                          <div
                            key={pid}
                            className={cn(
                              "rounded-lg border p-3 flex flex-col gap-2",
                              !r && "opacity-50",
                              isDvs && !approved && "border-sky-300 bg-sky-50/70 dark:border-sky-800 dark:bg-sky-950/30",
                              (approved || pumpViaPayer) && "border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30",
                              r && !isDvs && !pumpViaPayer && "opacity-65 bg-muted/30",
                            )}
                          >
                            <div>
                              <p className="text-sm font-bold font-mono">{r?.hcpc ?? "—"}</p>
                              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{PRODUCT_LABELS[pid]}</p>
                            </div>
                            <span className={cn(
                              "mt-auto self-start inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border",
                              !r && "bg-muted text-muted-foreground border-border",
                              pumpViaPayer && "bg-emerald-100 text-emerald-800 border-emerald-300",
                              r && !isDvs && !pumpViaPayer && "bg-muted text-muted-foreground border-border",
                              r && isDvs && !approved && "bg-sky-100 text-sky-800 border-sky-300",
                              r && isDvs && approved && "bg-emerald-100 text-emerald-800 border-emerald-300",
                            )}>
                              {!r
                                ? "Not Serving"
                                : pumpViaPayer
                                  ? `Auth Valid · via ${selected.primaryInsurance || "payer"}`
                                  : !isDvs
                                    ? "Handled on the auth rail"
                                    : approved
                                      ? "DVS Approved"
                                      : "DVS Required"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* run steps — AUTO; per-code claim detail where the bot writes it */}
                  {pumpDvses && (
                    <StepCard
                      num={1}
                      title="Pump DVS"
                      codes={["E0784"]}
                      chip={<StatusChip label={selected.pumpDvsStatus} fallback="Submitting…" />}
                      action={
                        isFailedish(selected.pumpDvsStatus) && (
                          <Button size="sm" variant="outline" disabled={rerunning !== null} onClick={() => handleRerun("pump")} className="gap-1.5">
                            {rerunning === "pump" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                            Re-run Pump DVS
                          </Button>
                        )
                      }
                    >
                      {isFailedish(selected.pumpDvsStatus) && selected.dvsDenialReason && (
                        <ErrorNote label="Denial reason" text={selected.dvsDenialReason} />
                      )}
                    </StepCard>
                  )}
                  {suppliesDvs && (
                    <StepCard
                      num={pumpDvses ? 2 : 1}
                      title="Supplies DVS"
                      codes={["A4230", "A4232"]}
                      gateHint={waitingOnPump ? "Submits automatically once the Pump claim is fully paid" : undefined}
                      chip={
                        waitingOnPump
                          ? <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border bg-muted text-muted-foreground border-border"><Clock className="h-3 w-3" /> Waiting on pump</span>
                          : <StatusChip label={selected.dvsStatus} fallback="Submitting…" />
                      }
                      action={
                        isFailedish(selected.dvsStatus) && (
                          <Button size="sm" variant="outline" disabled={rerunning !== null} onClick={() => handleRerun("supplies")} className="gap-1.5">
                            {rerunning === "supplies" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                            Re-run Supplies DVS
                          </Button>
                        )
                      }
                    >
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                        <CodeTile hcpc="A4230" name="Infusion Sets" authLabel={selected.dvsStatus} claimText={selected.a4230Claim} />
                        <CodeTile hcpc="A4232" name="Cartridges" authLabel={selected.dvsStatus} claimText={selected.a4232Claim} />
                      </div>
                      {isFailedish(selected.dvsStatus) && selected.dvsDenialReason && (
                        <ErrorNote label="Denial reason" text={selected.dvsDenialReason} />
                      )}
                    </StepCard>
                  )}

                  {/* claims — bot-driven, shared columns */}
                  <StepCard
                    num={(pumpDvses ? 1 : 0) + (suppliesDvs ? 1 : 0) + 1}
                    title="Claims"
                    codes={[]}
                    chip={<StatusChip label={selected.claimsStatus} fallback="Waits on authorization" />}
                  >
                    <div className="flex items-center gap-4 flex-wrap text-sm">
                      {selected.claimsPaidAmount && (
                        <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                          ✓ Paid · <span className="font-mono select-all">{selected.claimsPaidAmount}</span>
                          {selected.claimsPaidDate && <span className="text-muted-foreground font-normal"> on {ymdToUs(selected.claimsPaidDate)}</span>}
                        </p>
                      )}
                    </div>
                    {selected.claimsError && <ErrorNote label="Claims error" text={selected.claimsError} />}
                    {selected.claimsDenialReason && <ErrorNote label="Claims denial reason" text={selected.claimsDenialReason} />}

                    {/* Insulin-pump claims — the board's second claims family
                        ("IP …"). Rendered whenever the bot has written anything
                        here, so a patient pulled into DVS Manual Review by a
                        PUMP claim failure shows the reason rather than an
                        unexplained classification. Hidden while empty, which is
                        every patient until the bot starts populating it. */}
                    {(selected.ipClaimsStatus || selected.ipClaimsPaidAmount || selected.ipClaimsError || selected.ipClaimsDenialReason) && (
                      <div className="mt-3 pt-3 border-t border-dashed">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                            Insulin pump claim
                          </span>
                          <StatusChip label={selected.ipClaimsStatus} fallback="Not started" />
                        </div>
                        {selected.ipClaimsPaidAmount && (
                          <p className="mt-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                            ✓ Paid · <span className="font-mono select-all">{selected.ipClaimsPaidAmount}</span>
                            {selected.ipClaimsPaidDate && <span className="text-muted-foreground font-normal"> on {ymdToUs(selected.ipClaimsPaidDate)}</span>}
                          </p>
                        )}
                        {selected.ipClaimsError && <ErrorNote label="Pump claims error" text={selected.ipClaimsError} />}
                        {selected.ipClaimsDenialReason && <ErrorNote label="Pump claims denial reason" text={selected.ipClaimsDenialReason} />}
                      </div>
                    )}
                  </StepCard>

                  {isQueued(selected) && (
                    <div className="rounded-xl border border-amber-300 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30 px-4 py-3 text-sm font-semibold text-amber-800 dark:text-amber-300">
                      IN RETRY QUEUE{selected.retryCount ? ` — attempt ${selected.retryCount}` : ""}
                      {selected.retryNextDate ? ` · next run ${ymdToUs(selected.retryNextDate)}` : ""}
                      {" · re-runs once a day automatically. Only unpaid codes are resubmitted."}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* notes rail — same Call Reference Notes column as the auth rail */}
            {selected && (
              <div className="xl:sticky xl:top-4">
                <NotesPanel
                  notes={noteDrafts[selected.id] ?? selected.notes}
                  profileSendOffNotes={selected.profileSendOffNotes}
                  mnWorkflowNotes={selected.mnWorkflowNotes}
                  onNotesChange={(v) => setNoteDrafts((prev) => ({ ...prev, [selected.id]: v }))}
                  onSaveToMonday={(v) => writeLongText(selected.id, COL.callReferenceNotes, v)}
                  notePrefix="DVS"
                  description="Carries over from the earlier stages. DVS reference numbers, ePACES notes…"
                  placeholder="DVS reference numbers, ePACES notes, follow-ups…"
                />
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
};

function PathCard({ active, title, body }: { active: boolean; title: string; body?: string }) {
  return (
    <div className={cn(
      "rounded-xl border p-4",
      active
        ? "border-[#0F4C5C]/50 bg-[#0F4C5C]/5 ring-1 ring-[#0F4C5C]/20"
        : "border-border bg-card opacity-50",
    )}>
      <p className={cn("text-sm font-bold", active ? "text-[#0F4C5C] dark:text-teal-200" : "text-foreground/70")}>
        {title}
        {active && <span className="ml-2 text-[10px] font-bold uppercase tracking-wide bg-[#0F4C5C] text-white rounded-full px-2 py-0.5">This patient</span>}
      </p>
      {body && <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{body}</p>}
    </div>
  );
}

function StepCard({
  num,
  title,
  codes,
  chip,
  gateHint,
  action,
  children,
}: {
  num: number;
  title: string;
  codes: string[];
  chip: React.ReactNode;
  gateHint?: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-card border border-l-4 border-l-primary shadow-card p-4 space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="grid place-items-center h-8 w-8 rounded-full bg-primary/10 text-sm font-bold text-primary shrink-0">{num}</span>
        <h2 className="text-base font-bold">{title}</h2>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold tracking-wide bg-emerald-100 text-emerald-800 border border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300">AUTO</span>
        {codes.map((c) => (
          <span key={c} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-bold bg-muted border border-border">{c}</span>
        ))}
        <span className="ml-auto flex items-center gap-2 flex-wrap">
          {gateHint && <span className="text-xs text-muted-foreground">{gateHint}</span>}
          {chip}
          {action}
        </span>
      </div>
      {children}
    </section>
  );
}

function CodeTile({ hcpc, name, authLabel, claimText }: { hcpc: string; name: string; authLabel?: string; claimText?: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 overflow-hidden">
      <div className="flex items-baseline gap-2 px-3 py-2 bg-muted/40 border-b">
        <span className="font-mono font-bold text-sm">{hcpc}</span>
        <span className="text-xs text-muted-foreground">{name}</span>
      </div>
      <div className="px-3 py-2 space-y-1.5">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Authorization</p>
          <StatusChip label={authLabel} fallback="Not run yet" />
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Claim</p>
          <p className={cn("text-sm", claimText ? "font-medium" : "text-muted-foreground")}>{claimText || "— waits on authorization"}</p>
        </div>
      </div>
    </div>
  );
}

function ErrorNote({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-lg border border-red-300 bg-red-50/70 dark:border-red-800 dark:bg-red-950/30 px-3 py-2 text-xs text-red-800 dark:text-red-300">
      <b className="uppercase tracking-wide text-[10px]">{label}:</b> {text}
    </div>
  );
}

export default DvsPage;
