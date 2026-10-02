/**
 * Onboarding Oversight (DESIGN INTENT v2, Brandon CR-14/15). Overview: four tiles, then By Stage or By Employee.
 * Every number opens a Tandem-style patient list; a patient opens the existing Command Center profile.
 * Read-only; managers only; hidden from navigation.
 */
import type { Dict } from "@/lib/onboardingOversight/types";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Settings2 } from "lucide-react";
import { useAccessContext } from "@/components/AccessProvider";
import { useOnboardingOversight } from "@/hooks/useOnboardingOversight";
import { accessViewFromConfig } from "@/lib/onboardingOversight/people/owners";
import { OO_FLAGS } from "@/lib/onboardingOversight/flags";
import { OO_CONFIG } from "@/lib/onboardingOversight/config";
import { buildV2 } from "@/lib/onboardingOversight/v2/model";
import { listFor } from "@/lib/onboardingOversight/v2/lists";
import { DEFAULT_STEPS, loadSteps, saveSteps, loadDueSoon, saveDueSoon, loadHealth, saveHealth, type HealthCfg, type DueSoonCfg, type StepDef } from "@/lib/onboardingOversight/v2/steps";
import WorkingList from "@/components/onboardingOversight/v2/WorkingList";
import Breakdown, { type BreakdownKind } from "@/components/onboardingOversight/v2/Breakdown";
import { OOPage } from "@/components/onboardingOversight/v2/Layout";
import { Ranked } from "@/components/onboardingOversight/v2/FirstScreen";
import { FlowStrip, StuckBreakdown } from "@/components/onboardingOversight/v2/Flow";
import { fetchStaffCalls, type StaffCalls } from "@/lib/onboardingOversight/v2/calls";
import { Tiles, ByStage, ByEmployee } from "@/components/onboardingOversight/v2/Overview";
import PatientTable from "@/components/onboardingOversight/v2/PatientTable";
import Settings from "@/components/onboardingOversight/v2/Settings";
import "@/components/onboardingOversight/v2/v2.css";

export default function OnboardingOversightPage() {
  const navigate = useNavigate();
  const { access, config } = useAccessContext();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") === "employee" ? "employee" : sp.get("tab") === "stage" ? "stage" : "overview";
  const listId = sp.get("list");
  const stageId = sp.get("stage");
  const personId = sp.get("person");
  const workId = sp.get("work");
  const fw = (sp.get("fw") === "7" ? 7 : 28) as 7 | 28;
  const stuckView = sp.get("stuck") === "1";
  const brkId = sp.get("brk") as BreakdownKind | null;
  const set = (patch: Record<string, string | null>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) { if (v == null) n.delete(k); else n.set(k, v); } setSp(n); };
  const accessView = useMemo(() => accessViewFromConfig(config as Dict), [config]);
  const { snapshot, status, progress, error, refresh, fixture, exportMode, itemsOnly } = useOnboardingOversight(accessView, OO_CONFIG.periodDays);
  const [steps, setSteps] = useState<StepDef[]>(() => loadSteps());
  const [dueSoon, setDueSoon] = useState<DueSoonCfg>(() => loadDueSoon());
  const [hc, setHc] = useState<HealthCfg>(() => loadHealth());
  const customTimes = steps.some((x) => { const d = DEFAULT_STEPS.find((y) => y.id === x.id); return !d || d.normal !== x.normal || d.owner !== x.owner; }); // coo-ops r16: counts differ from Brandon's defaults
  const [showSettings, setShowSettings] = useState(sp.get("settings") === "1");
  const live = !fixture && !exportMode;
  // v2 needs the history (lateness, reasons, bars), so it waits for the full snapshot rather than showing items-only numbers (spec §0.8).
  const m = useMemo(() => (snapshot && !itemsOnly ? buildV2(snapshot, steps, { names: live ? "live" : "fake", dueSoon }) : null), [snapshot, itemsOnly, steps, live, dueSoon]);
  const [calls, setCalls] = useState<StaffCalls | null>(null);
  useEffect(() => {
    if (!live) { setCalls({ status: "unavailable", source: null, reason: "Call logs are read live inside Command Center (not in this offline snapshot).", perDay: {} }); return; }
    let on = true; void fetchStaffCalls(28).then((c) => { if (on) setCalls(c); }); return () => { on = false; };
  }, [live]);
  useEffect(() => { document.body.classList.add("oo-route"); return () => document.body.classList.remove("oo-route"); }, []);

  if (access.type !== "manager") return <div className="min-h-screen flex items-center justify-center p-8"><p className="text-sm text-muted-foreground">Managers only.</p></div>;
  const when = snapshot ? new Date(snapshot.snapshotAt) : null;
  const ageH = snapshot ? (Date.now() - snapshot.snapshotAt) / 3600000 : 0;
  const list = m && listId ? listFor(m, listId) : null;
  const changeSteps = (s: StepDef[]) => { setSteps(s); saveSteps(s); };
  return (
    <div className="v2-root">
      {OO_FLAGS.draftBanner && <div className="v2-draft" role="note">{OO_FLAGS.draftBanner}</div>}
      <header className="v2-head"><div className="oo-wrap oo-headrow">
        <button type="button" className="v2-icon" onClick={() => (listId ? navigate(-1) : window.history.length > 1 ? navigate(-1) : navigate("/"))} aria-label="Back"><ArrowLeft size={18} /></button>
        <h1 className="v2-h1" onClick={() => set({ list: null, brk: null, work: null, person: null, tab: null })}>Onboarding Oversight</h1>
        <span className="v2-asof" role="status">
          {when ? `As of ${when.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : status === "error" ? `Problem: ${error}` : progress || "Loading…"}
          {ageH > OO_CONFIG.patientFlags.snapshotStaleHours && <span className="v2-old"> · old data</span>}
          {m && m.notOnStep.length > 0 && <span className="v2-old" title="Open patients whose current status matches no step in Normal times. They are in no count."> · {m.notOnStep.length} not on a step</span>}
        </span>
        <span className="v2-spacer" />
        <button type="button" className="v2-btn" onClick={() => void refresh()}>{error ? "Retry" : "Refresh"}</button>
        {!listId && <button type="button" className={`v2-btn ${showSettings ? "v2-btn-on" : ""}`} aria-expanded={showSettings} onClick={() => setShowSettings(!showSettings)}><Settings2 size={15} aria-hidden /> Normal times{customTimes && <span className="v2-custom"> · custom</span>}</button>}
      </div></header>
      <main className="v2-main oo-wrap">
        {!m ? <p className="v2-muted">{status === "error" ? `Problem: ${error}` : progress || "Loading…"}</p>
          : list ? <OOPage back={{ label: "Back", onClick: () => navigate(-1) }}><PatientTable key={listId!} title={list.title} rows={list.rows} hideUntouched={list.hideUntouched} escOwners={{ mgr: m.escOwners[0]?.name ?? "Janelle", final: m.escOwners[1]?.name ?? "Katie" }} /></OOPage>
          : stuckView ? <OOPage back={{ label: "Overview", onClick: () => set({ stuck: null }) }}><StuckBreakdown m={m} w={fw} open={(id) => set({ list: id })} /></OOPage>
          : brkId ? <OOPage back={{ label: "Overview", onClick: () => set({ brk: null }) }}><Breakdown key={brkId} m={m} kind={brkId} hc={hc} open={(id) => set({ list: id })} /></OOPage>
          : workId ? <OOPage back={{ label: "Overview", onClick: () => set({ work: null, grp: null }) }}>
              <WorkingList key={workId} m={m} name={workId} calls={calls} grouped={sp.get("grp") === "1"} onByStep={m.people.some((p) => p.name === workId && p.hasSteps) ? () => set({ work: null, person: workId }) : undefined} /></OOPage>
          : personId ? <OOPage back={{ label: "Overview", onClick: () => set({ person: null }) }}><ByEmployee m={m} hc={hc} open={(id) => set({ list: id })} calls={calls} person={personId} /></OOPage>
          : <OOPage>
            {showSettings && <Settings steps={steps} onChange={changeSteps} dueSoon={dueSoon} onDueSoon={(c) => { setDueSoon(c); saveDueSoon(c); }} health={hc} onHealth={(c) => { setHc(c); saveHealth(c); }} />}
            <Tiles m={m} hc={hc} open={(id) => { const k = ({ "tile:procPastDue": "procPastDue", "tile:escPastDue": "escPastDue", "tile:pipeline": "pipeline" } as Record<string, BreakdownKind>)[id]; set(k ? { brk: k } : { list: id }); }} />
            <FlowStrip m={m} w={fw} setW={(d) => set({ fw: d === 28 ? null : "7" })} open={(id) => set({ list: id })} openStuck={() => set({ stuck: "1" })} />
            <div className="v2-tabs oo-block" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "overview"} onClick={() => set({ tab: null })}>Overview</button>
              <button type="button" role="tab" aria-selected={tab === "stage"} onClick={() => set({ tab: "stage" })}>By Stage detail</button>
              <button type="button" role="tab" aria-selected={tab === "employee"} onClick={() => set({ tab: "employee" })}>By Employee</button>
            </div>
            {tab === "overview" ? <Ranked m={m} open={(id) => set({ list: id })} />
              : tab === "stage" ? <ByStage m={m} hc={hc} open={(id) => set({ list: id })} />
              : <ByEmployee m={m} hc={hc} open={(id) => set({ list: id })} calls={calls} openPerson={(p) => set({ work: p })} />}
          </OOPage>}
      </main>
    </div>
  );
}
