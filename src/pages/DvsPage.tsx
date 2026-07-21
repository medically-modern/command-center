/**
 * DVS — the fully-automatic Medicaid verification stage
 * (HANDOFF-Josh-DVS.md v2, 2026-07-20; dvs-redesign.html is the visual spec).
 *
 * READ-ONLY MONITOR: the Stage Advancer flipping to "DVS" is the bot
 * trigger; this page writes nothing in the normal flow. It polls the board
 * and narrates what the automation did. The only writes are the Re-run
 * buttons on the manual-review path (§4), which flip the existing
 * Trigger DVS / Trigger Pump DVS columns the automate-dvs bots listen to.
 *
 * ⚠ COARSE READ MODEL (§10 open item): the per-code columns the v2 handoff
 * wants (auth + claim result, paid amount, retry-queue state PER HCPC) do
 * not exist on the board yet — the bot writes one status per run (Supplies
 * DVS / Pump DVS / Claims / Retry Count). This page renders that per-run
 * granularity; wire the per-code columns into `runSteps()` when Josh's bot
 * defines them.
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDvsPatients } from "@/hooks/dvs/useDvsPatients";
import type { Patient } from "@/lib/samantha/workflow";
import { PatientProfileCard } from "@/components/samantha/PatientProfileCard";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { ReportIssueButton } from "@/components/shared/ReportIssueButton";
import { Button } from "@/components/ui/button";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { resolveHcpcs, isAutoFilledMedicaidSupply, PRODUCT_LABELS, type ProductId } from "@/lib/samantha/hcpcRules";
import { isStraightMedicaidPrimary } from "@/lib/samantha/dvsRouting";
import { writeStatusIndex, COL } from "@/lib/samantha/mondayApi";
import { TRIGGER_DVS_INDEX, TRIGGER_PUMP_DVS_INDEX } from "@/lib/samantha/mondayMapping";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowLeft, Bot, Loader2, RefreshCw, RotateCw, Search, User, Zap } from "lucide-react";

/* ── status-chip tone mapping (coarse bot labels) ─────────────────── */

type Tone = "mint" | "rose" | "sky" | "amber" | "gray";

function toneFor(label: string | undefined): Tone {
  const l = (label ?? "").toLowerCase();
  if (!l) return "gray";
  if (l.includes("success") || l.includes("paid") || l.includes("approved")) return "mint";
  if (l.includes("denied") || l.includes("failed") || l.includes("error") || l.includes("manual") || l.includes("mltc")) return "rose";
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
    <span className={cn("inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border", TONE_CLASS[toneFor(label)])}>
      {text}
    </span>
  );
}

const isFailedish = (label: string | undefined) => toneFor(label) === "rose";

/* ── page ─────────────────────────────────────────────────────────── */

const DvsPage = () => {
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const { patients, loading, initialLoading, error, refetch } = useDvsPatients(searchParams.get("patientId"));
  const [selectedId, setSelectedId] = useState<string | null>(searchParams.get("patientId"));
  const [search, setSearch] = useState("");
  const [rerunning, setRerunning] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? patients.filter((p) => p.name.toLowerCase().includes(q)) : patients;
  }, [patients, search]);

  const selected: Patient | undefined = useMemo(() => {
    const byId = patients.find((p) => p.id === selectedId);
    return byId ?? visible[0];
  }, [patients, selectedId, visible]);

  const straight = selected ? isStraightMedicaidPrimary(selected) : false;
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
  const servesPump = resolved.some((r) => r.product === "insulin_pump");
  const pumpDvses = straight && servesPump;
  const suppliesDvs = resolved.some((r) => dvsProducts.has(r.product) && (r.product === "infusion_set" || r.product === "cartridge"));

  const handleRerun = async (kind: "supplies" | "pump") => {
    if (!selected || rerunning) return;
    setRerunning(kind);
    try {
      if (kind === "supplies") {
        await writeStatusIndex(selected.id, COL.triggerDvs, TRIGGER_DVS_INDEX.triggerDvs);
      } else {
        await writeStatusIndex(selected.id, COL.triggerPumpDvs, TRIGGER_PUMP_DVS_INDEX.triggerPumpDvs);
      }
      toast.success(`${kind === "supplies" ? "Supplies" : "Pump"} DVS re-triggered — the bot picks it up from here`);
      refetch();
    } catch (e) {
      toast.error("Re-run failed", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setRerunning(null);
    }
  };

  /* banner narration (§7) */
  const banner = useMemo(() => {
    if (!selected) return null;
    const paid = (selected.claimsStatus ?? "").toLowerCase().includes("paid");
    const manual =
      selected.escalated || isFailedish(selected.dvsStatus) || isFailedish(selected.pumpDvsStatus) || isFailedish(selected.claimsStatus);
    if (manual) {
      return {
        tone: "rose" as Tone,
        text: "Manual review — the bot flags this patient for the Auth Denial bucket (Stage → Auth Denied + Escalation Required). Fix the underlying issue, then Re-run the failed step below.",
      };
    }
    if (paid) {
      return {
        tone: "mint" as Tone,
        text: "Paid — the bot writes Stage → Complete and the patient auto-moves to the Welcome Call board. Nothing to do here.",
      };
    }
    if ((selected.retryCount ?? 0) > 0) {
      return {
        tone: "amber" as Tone,
        text: `In the retry queue — re-runs once a day automatically (attempt ${selected.retryCount}). Stage stays at DVS until it clears; the queue is monitored from the Insurance manager view.`,
      };
    }
    return {
      tone: "sky" as Tone,
      text: "DVS running — the Stage Advancer flipping to DVS triggered the bot. Results stream in below as it writes them to the board.",
    };
  }, [selected]);

  return (
    <div className="min-h-screen flex w-full bg-gradient-subtle">
      <PageLoadingOverlay show={initialLoading} />

      {/* lite patient rail — read-only monitor list */}
      <aside className="w-72 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground hidden md:flex flex-col">
        <div className="p-3 border-b border-sidebar-border">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Monday · DVS</p>
          <p className="text-sm font-semibold">Patients ({patients.length})</p>
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
          {visible.map((p) => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              className={cn(
                "w-full flex items-start gap-2 p-2 rounded-lg text-left transition-colors",
                selected?.id === p.id ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/50",
              )}
            >
              <User className="h-4 w-4 mt-0.5 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-medium truncate">{p.name}</span>
                <span className="block text-[11px] text-muted-foreground truncate">
                  {p.primaryInsurance || "—"} · {isStraightMedicaidPrimary(p) ? "Straight to DVS" : "Via payer rail"}
                </span>
                {(p.retryCount ?? 0) > 0 && (
                  <span className="block text-[10px] font-medium text-amber-400 mt-0.5">
                    Retry queue · attempt {p.retryCount}
                  </span>
                )}
              </span>
            </button>
          ))}
          {!loading && visible.length === 0 && (
            <p className="px-3 py-4 text-xs text-muted-foreground">
              {error ? error : "No patients at the DVS stage."}
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
                <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern</p>
                <h1 className="text-2xl font-bold">DVS</h1>
                {selected && <p className="text-sm opacity-80 mt-0.5">{selected.name}</p>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => refetch()} disabled={loading} className="gap-2 bg-white text-navy hover:bg-white/90 shadow-elevate">
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
              </Button>
              <ReportIssueButton />
            </div>
          </div>
        </header>

        <main className="flex-1 px-3 sm:px-6 py-6">
          <section className="max-w-5xl xl:max-w-7xl mx-auto space-y-5">
            {!selected && (
              <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                <p className="text-sm text-muted-foreground">
                  {loading ? "Loading patients from Monday…" : error ? error : "No patients at the DVS stage."}
                </p>
              </div>
            )}
            {selected && banner && (
              <>
                {/* automation status banner (§7) — the page's whole job */}
                <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-3", TONE_CLASS[banner.tone])}>
                  <Bot className="h-5 w-5 mt-0.5 shrink-0" />
                  <p className="text-sm font-medium leading-relaxed">{banner.text}</p>
                </div>

                <PatientProfileCard patient={selected} onUpdate={() => { /* read-only monitor */ }} />

                {/* entry-path cards (§1) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <PathCard
                    active={straight}
                    title="Straight to DVS"
                    body="Everything bills NY Medicaid — skips Benefits / Submit Auth / Auth Outstanding entirely. DVS runs on Member ID 1."
                  />
                  <PathCard
                    active={!straight}
                    title="Pump approved via primary payer"
                    body="Managed Medicaid dual — the pump rode the payer auth rail; only the supplies DVS here, on the Medicaid ID (Member ID 2)."
                  />
                </div>

                {/* DVS status by product (§8) */}
                <div className="rounded-xl bg-card border shadow-card p-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">DVS Status by Product</p>
                  <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
                    {(["monitor", "sensors", "insulin_pump", "infusion_set", "cartridge"] as ProductId[]).map((pid) => {
                      const r = resolved.find((x) => x.product === pid);
                      const isDvs = dvsProducts.has(pid);
                      const viaPayer = !!r && !isDvs && pid === "insulin_pump";
                      const authLabel = selected.insurance?.codes?.pump?._mondayAuthLabel ?? "";
                      const supplies = pid === "infusion_set" || pid === "cartridge";
                      const approved =
                        isDvs &&
                        (supplies || pid === "insulin_pump") &&
                        toneFor(supplies ? selected.dvsStatus : selected.pumpDvsStatus) === "mint";
                      return (
                        <div
                          key={pid}
                          className={cn(
                            "rounded-lg border p-3 flex flex-col gap-2",
                            !r && "opacity-50",
                            isDvs && !approved && "border-sky-300 bg-sky-50/70 dark:border-sky-800 dark:bg-sky-950/30",
                            approved && "border-emerald-300 bg-emerald-50/70 dark:border-emerald-800 dark:bg-emerald-950/30",
                          )}
                        >
                          <div>
                            <p className="text-sm font-bold font-mono">{r?.hcpc ?? "—"}</p>
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{PRODUCT_LABELS[pid]}</p>
                          </div>
                          <span className={cn(
                            "mt-auto self-start inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border",
                            !r && "bg-muted text-muted-foreground border-border",
                            r && viaPayer && "bg-emerald-100 text-emerald-800 border-emerald-300",
                            r && !viaPayer && !isDvs && "bg-muted text-muted-foreground border-border",
                            r && isDvs && !approved && "bg-sky-100 text-sky-800 border-sky-300",
                            r && isDvs && approved && "bg-emerald-100 text-emerald-800 border-emerald-300",
                          )}>
                            {!r
                              ? "Not Serving"
                              : viaPayer
                                ? `Auth Valid · via ${selected.primaryInsurance || "payer"}${authLabel && authLabel !== "Auth Valid" ? ` (${authLabel})` : ""}`
                                : !isDvs
                                  ? "Payer rail"
                                  : approved
                                    ? "DVS Approved"
                                    : "DVS Required"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* run steps — per-run granularity (per-code pending §10) */}
                <div className="rounded-xl bg-card border shadow-card p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">Automation Steps</p>
                    <p className="text-[11px] text-muted-foreground">
                      Per-code auth/claim detail arrives when the bot's per-code columns land (DVS handoff §10).
                    </p>
                  </div>

                  {pumpDvses && (
                    <RunStep
                      title="Pump DVS (E0784)"
                      note="Submits first. Supplies wait until the pump claim is fully paid."
                      chip={<StatusChip label={selected.pumpDvsStatus} />}
                      action={
                        isFailedish(selected.pumpDvsStatus) && (
                          <Button size="sm" variant="outline" disabled={rerunning !== null} onClick={() => handleRerun("pump")} className="gap-1.5">
                            {rerunning === "pump" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                            Re-run Pump DVS
                          </Button>
                        )
                      }
                    />
                  )}
                  {suppliesDvs && (
                    <RunStep
                      title="Supplies DVS (A4230 + A4232)"
                      note={
                        pumpDvses && toneFor(selected.pumpDvsStatus) !== "mint"
                          ? "Waiting on pump — submits automatically once the pump claim is fully paid."
                          : "Submits automatically on stage entry."
                      }
                      chip={<StatusChip label={selected.dvsStatus} fallback={pumpDvses && toneFor(selected.pumpDvsStatus) !== "mint" ? "Waiting on pump" : undefined} />}
                      action={
                        isFailedish(selected.dvsStatus) && (
                          <Button size="sm" variant="outline" disabled={rerunning !== null} onClick={() => handleRerun("supplies")} className="gap-1.5">
                            {rerunning === "supplies" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
                            Re-run Supplies DVS
                          </Button>
                        )
                      }
                    />
                  )}
                  <RunStep title="Claims" note="Each code's claim submits automatically once its authorization clears." chip={<StatusChip label={selected.claimsStatus} />} />
                  {(selected.retryCount ?? 0) > 0 && (
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                      IN RETRY QUEUE — attempt {selected.retryCount}; re-runs once a day. Only unpaid codes are resubmitted (§5).
                    </p>
                  )}
                </div>
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
};

function PathCard({ active, title, body }: { active: boolean; title: string; body: string }) {
  return (
    <div className={cn(
      "rounded-xl border p-4",
      active
        ? "border-sky-400 bg-sky-50/70 ring-1 ring-sky-300 dark:border-sky-700 dark:bg-sky-950/30"
        : "border-border bg-card opacity-60",
    )}>
      <p className={cn("text-sm font-bold", active ? "text-sky-800 dark:text-sky-200" : "text-foreground/70")}>
        {title}
        {active && <span className="ml-2 text-[10px] font-bold uppercase tracking-wide bg-sky-600 text-white rounded-full px-2 py-0.5">This patient</span>}
      </p>
      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{body}</p>
    </div>
  );
}

function RunStep({ title, note, chip, action }: { title: string; note: string; chip: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 flex-wrap rounded-lg border bg-muted/20 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
      {chip}
      {action}
    </div>
  );
}

export default DvsPage;
