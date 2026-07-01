/**
 * Profile Checklist — standalone view from jenelle-profile-checklist repo.
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { useMondayPatients } from "@/hooks/profile/useMondayPatients";
import { fetchClinicLabels, createClinicLabel, moveItemToGroup, GROUPS } from "@/lib/profile/mondayApi";
import { sendPatientToMonday, sendBackToPatientIntake } from "@/lib/profile/mondayWrite";
import { writeText, COL } from "@/lib/profile/mondayApi";
import type { Patient } from "@/lib/profile/workflow";
import { hasValidZip } from "@/lib/profile/workflow";
import { StediPanel } from "@/components/profile/StediPanel";
import { DoctorPanel } from "@/components/profile/DoctorPanel";
import { ServingPanel } from "@/components/profile/ServingPanel";
import { PatientsSidebar } from "@/components/profile/PatientsSidebar";
import { PatientProfileCard } from "@/components/profile/PatientProfileCard";
import { ReferralEmailPanel } from "@/components/profile/ReferralEmailPanel";
import { NotesPanel } from "@/components/profile/NotesPanel";
import { OopCard } from "@/components/profile/OopCard";
import { ReadinessChecklist } from "@/components/profile/ReadinessChecklist";
import { FollowUpModal } from "@/components/profile/FollowUpModal";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { ClipboardCheck, Send, AlertTriangle, Loader2, ArrowLeft, Clock, Save, Ban } from "lucide-react";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useBackNavigation } from "@/hooks/useBackNavigation";

const ProfilePage = () => {
  const navigate = useNavigate();
  const { goBack } = useBackNavigation();
  const [searchParams] = useSearchParams();
  const isEscalated = searchParams.get("escalated") === "1";
  const { patients, loading, initialLoading, error, refetch, updateLocal, clearOverlay, removeOverlayKeys , saveOverlay, hasOverlay } = useMondayPatients(searchParams.get("patientId"));
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("patientId") ?? null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [clinicLabels, setClinicLabels] = useState<{ id: number; name: string }[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState<number | null>(null);
  const [referralEmailOpen, setReferralEmailOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [stuckSending, setStuckSending] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchClinicLabels().then(setClinicLabels).catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedId && patients.length > 0) setSelectedId(patients[0].id);
  }, [patients, selectedId]);

  const selected: Patient | undefined = useMemo(
    () => patients.find((p) => p.id === selectedId),
    [patients, selectedId],
  );

  // Send-off checklist — the redesign requirements as an ordered pass/fail list.
  // Device type + coverage path are required only for the product(s) served;
  // Member ID 2 only when the secondary is NY Medicaid.
  const checklist = useMemo(() => {
    if (!selected) return [] as { label: string; ok: boolean }[];
    const serv = (selected.serving || "").toLowerCase();
    const items: { label: string; ok: boolean }[] = [
      { label: "Name", ok: !!selected.name?.trim() },
      { label: "DOB", ok: !!selected.dob?.trim() },
      { label: "Phone", ok: !!selected.ptPhone?.trim() },
      { label: "Gender", ok: !!selected.gender?.trim() },
      { label: "Primary Insurance", ok: !!selected.primaryInsurance?.trim() },
      { label: "Member ID 1", ok: !!(selected.memberId1?.trim() || selected.workingMemberId?.trim()) },
      { label: "Secondary Insurance", ok: !!selected.secondaryInsurance?.trim() },
    ];
    if (selected.secondaryInsurance === "NY Medicaid") {
      items.push({ label: "Member ID 2 (NY Medicaid)", ok: !!selected.memberId2?.trim() });
    }
    items.push({ label: "Benefits verified active", ok: (selected.stediEligibilityActive || "").toLowerCase().trim() === "yes" });
    items.push({ label: "Serving", ok: !!selected.serving?.trim() });
    if (serv.includes("cgm")) {
      items.push({ label: "CGM Type", ok: !!selected.cgmType?.trim() });
      items.push({ label: "CGM Coverage Path", ok: !!selected.cgmCoveragePath?.trim() });
    }
    if (serv.includes("insulin pump")) {
      items.push({ label: "Pump Type", ok: !!selected.pumpType?.trim() });
      items.push({ label: "IP Coverage Path", ok: !!selected.insulinPumpCoveragePath?.trim() });
    }
    if (selected.clinicalsMethod === "Fax") {
      items.push({ label: "Doctor Fax", ok: !!selected.doctorFax?.trim() });
    }
    return items;
  }, [selected]);

  const missingRequired = useMemo(() => checklist.filter((i) => !i.ok).map((i) => i.label), [checklist]);
  const canSubmit = missingRequired.length === 0;

  const handleUpdate = useCallback((patch: Partial<Patient>) => {
    if (!selected) return;
    updateLocal(selected.id, patch);
  }, [selected, updateLocal]);

  const handleClinicSelect = useCallback((id: number, name: string) => {
    setSelectedClinicId(id);
    if (selected) updateLocal(selected.id, { clinicName: name });
  }, [selected, updateLocal]);

  const handleClinicCreate = useCallback(async (name: string) => {
    try {
      const newId = await createClinicLabel(name);
      setClinicLabels((prev) => [...prev, { id: newId, name }]);
      setSelectedClinicId(newId);
      if (selected) updateLocal(selected.id, { clinicName: name });
      toast.success(`Clinic "${name}" added`);
    } catch (e) {
      toast.error("Failed to create clinic", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [selected, updateLocal]);

  const handleSave = useCallback(() => {
    if (!selected) return;
    setSaving(true);
    try {
      saveOverlay(selected.id);
      toast.success(`Progress saved for ${selected.name}`, {
        description: "Your edits are saved locally — you can navigate away and come back.",
      });
    } catch (e) {
      toast.error("Failed to save progress", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  }, [selected, saveOverlay]);

  const handleSubmit = async (action: "advance" | "needsInfo") => {
    if (!selected) return;
    if (selected.clinicAddress && !hasValidZip(selected.clinicAddress)) {
      toast.error("Clinic address must include a valid 5-digit zip code");
      return;
    }
    setSubmitting(true);
    try {
      if (action === "advance") {
        await sendPatientToMonday(selected, selectedClinicId);
      } else {
        await sendBackToPatientIntake(selected, selectedClinicId);
      }
      clearOverlay(selected.id);
      toast.success(
        action === "advance"
          ? `${selected.name} advanced to MN`
          : `${selected.name} sent back to Patient Intake`,
      );
      setTimeout(refetch, 1500);
    } catch (e) {
      toast.error("Failed to submit", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleStuck = async () => {
    if (!selected) return;
    setStuckSending(true);
    try {
      await moveItemToGroup(selected.id, GROUPS.stuck);
      toast.success(`${selected.name} moved to Stuck`);
      // Select next patient or clear selection
      const remaining = patients.filter((p) => p.id !== selected.id);
      setSelectedId(remaining.length > 0 ? remaining[0].id : null);
      setTimeout(refetch, 1500);
    } catch (e) {
      toast.error("Failed to move to Stuck", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setStuckSending(false);
    }
  };

  return (
    <SidebarProvider>
      <PageLoadingOverlay show={initialLoading} />
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <PatientsSidebar
          patients={patients}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setSelectedClinicId(null);
          }}
          loading={loading}
          error={error}
          onRefresh={refetch}
          hasOverlay={hasOverlay}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <header className={`${isEscalated ? "bg-red-700" : "bg-gradient-navy"} text-navy-foreground border-b border-sidebar-border`}>
            <div className="px-3 sm:px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
                <button onClick={() => goBack()} className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                  <ClipboardCheck className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern · Profile Tool</p>
                  <div className="flex items-center gap-3">
                    <h1 className="text-xl font-semibold">
                      {selected ? selected.name : "Profile Send Off"}
                    </h1>
                    {selected?.alreadyInSystem?.toLowerCase() === "yes" && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-red-600 text-white text-xs font-semibold uppercase tracking-wide shadow-sm">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Already In System
                      </span>
                    )}
                  </div>
                </div>
                {selected && (
                  <>
                    <Button
                      onClick={() => setFollowUpOpen(true)}
                      variant="ghost"
                      className="gap-2 text-navy-foreground hover:bg-white/10"
                    >
                      <Clock className="h-4 w-4" /> Follow Up
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={saving || !hasOverlay(selected.id)}
                      className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700 shadow-elevate"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Save
                    </Button>
                  </>
                )}
              </div>
            </div>
          </header>

          <main className="flex-1 px-3 sm:px-6 py-6">
            <section className="max-w-5xl xl:max-w-7xl 2xl:max-w-[1800px] mx-auto space-y-5">
              {!selected && (
                <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    {loading ? "Loading patients from Monday…" : error ? error : "Select a patient from the sidebar to begin."}
                  </p>
                </div>
              )}

              {selected && (
                <>
                  {/* 1. Patient Demographics */}
                  <PatientProfileCard
                    patient={selected}
                    onUpdate={handleUpdate}
                    referralEmailOpen={referralEmailOpen}
                    onToggleReferralEmail={() => setReferralEmailOpen((o) => !o)}
                  />

                  {/* 2. Referral — rendered via ServingPanel (referral-only mode) */}
                  <ServingPanel patient={selected} onUpdate={handleUpdate} hideReferral={false} referralOnly />

                  {/* 3. Benefits — Stedi */}
                  <StediPanel
                    patient={selected}
                    onRefresh={refetch}
                    onUpdate={handleUpdate}
                    onRemoveOverlayKeys={(keys) =>
                      selected && removeOverlayKeys(selected.id, keys)
                    }
                  />

                  {/* 4. Request, Cross-Sell, Serving, Coverage (no referral) */}
                  <ServingPanel patient={selected} onUpdate={handleUpdate} hideReferral />

                  {/* 4b. OOP estimate — compute + write after Serving is chosen */}
                  <OopCard patient={selected} onUpdate={handleUpdate} />

                  {/* 5. Doctor */}
                  <DoctorPanel
                    patient={selected}
                    onUpdate={handleUpdate}
                    clinicLabels={clinicLabels}
                    onClinicSelect={handleClinicSelect}
                    onClinicCreate={handleClinicCreate}
                  />

                  {/* 5. Notes */}
                  <NotesPanel
                    notes={selected.notes}
                    onNotesChange={(v) => updateLocal(selected.id, { notes: v })}
                    onSaveToMonday={(v) => writeText(selected.id, COL.notes, v)}
                  />

                  {/* Follow Up Modal */}
                  <FollowUpModal
                    open={followUpOpen}
                    onOpenChange={setFollowUpOpen}
                    patientId={selected.id}
                    patientName={selected.name}
                    onSuccess={refetch}
                  />

                  {/* Send-off — checklist + routes */}
                  <div className="rounded-xl bg-card border shadow-card p-5 space-y-4">
                    <ReadinessChecklist items={checklist} />
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t pt-4">
                      <div className="text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">
                          {canSubmit ? "Everything checks out — ready to advance." : "Complete the checklist above to advance."}
                        </p>
                        <p className="text-xs">Advancing saves all edits to Monday; sending back moves the patient to Patient Intake.</p>
                      </div>
                      <div className="flex gap-3">
                        <Button
                          variant="outline"
                          onClick={handleStuck}
                          disabled={stuckSending || submitting}
                          className="gap-2 border-orange-300 text-orange-700 hover:bg-orange-100 hover:text-orange-800"
                        >
                          {stuckSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}
                          Stuck
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => handleSubmit("needsInfo")}
                          disabled={submitting || stuckSending}
                          className="gap-2 border-blue-300 text-blue-700 hover:bg-purple-100 hover:text-blue-700"
                        >
                          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                          Send back to Patient Intake
                        </Button>
                        <Button
                          onClick={() => handleSubmit("advance")}
                          disabled={submitting || stuckSending || !canSubmit}
                          title={!canSubmit ? `Missing: ${missingRequired.join(", ")}` : undefined}
                          className="gap-2 bg-green-600 hover:bg-green-700 text-white shadow-elevate disabled:opacity-50"
                        >
                          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                          Advance to MN
                        </Button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </section>
          </main>
        </div>

        {/* Side-by-side referral email panel — sibling of the main
            column, NOT a modal. The user can scroll/interact with both
            simultaneously. */}
        {referralEmailOpen && selected && (
          <ReferralEmailPanel
            itemId={selected.id}
            patientName={selected.name}
            onClose={() => setReferralEmailOpen(false)}
          />
        )}
      </div>
    </SidebarProvider>
  );
};

export default ProfilePage;
