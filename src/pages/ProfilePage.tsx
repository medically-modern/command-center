/**
 * Profile Checklist — standalone view from jenelle-profile-checklist repo.
 */
import { useEffect, useMemo, useState, useCallback } from "react";
import { useMondayPatients } from "@/hooks/profile/useMondayPatients";
import { fetchClinicLabels, createClinicLabel } from "@/lib/profile/mondayApi";
import { sendPatientToMonday } from "@/lib/profile/mondayWrite";
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
import { FollowUpModal } from "@/components/profile/FollowUpModal";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ClipboardCheck, Send, AlertTriangle, Loader2, ArrowLeft, Clock , Save} from "lucide-react";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";

const ProfilePage = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isEscalated = searchParams.get("escalated") === "1";
  const { patients, loading, error, refetch, updateLocal, clearOverlay, removeOverlayKeys , saveOverlay, hasOverlay } = useMondayPatients(searchParams.get("patientId"));
  const [selectedId, setSelectedId] = useState<string | null>(
    searchParams.get("patientId") ?? null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [clinicLabels, setClinicLabels] = useState<{ id: number; name: string }[]>([]);
  const [selectedClinicId, setSelectedClinicId] = useState<number | null>(null);
  const [referralEmailOpen, setReferralEmailOpen] = useState(false);
  const [followUpOpen, setFollowUpOpen] = useState(false);

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

  const handleSubmit = async (action: "advance" | "needsInfo") => {
    if (!selected) return;
    if (selected.clinicAddress && !hasValidZip(selected.clinicAddress)) {
      toast.error("Clinic address must include a valid 5-digit zip code");
      return;
    }
    setSubmitting(true);
    try {
      await sendPatientToMonday(selected, action, selectedClinicId);
      clearOverlay(selected.id);
      toast.success(
        action === "advance"
          ? `${selected.name} advanced to MN`
          : `${selected.name} marked as needs more info`,
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

  return (
    <SidebarProvider>
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
        />

        <div className="flex-1 flex flex-col min-w-0">
          <header className={`${isEscalated ? "bg-red-700" : "bg-gradient-navy"} text-navy-foreground border-b border-sidebar-border`}>
            <div className="px-3 sm:px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
                <button onClick={() => navigate("/?tab=dashboard")} className="p-1.5 rounded-md hover:bg-white/10 transition-colors">
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
                  <Button
                    onClick={() => setFollowUpOpen(true)}
                    variant="ghost"
                    className="gap-2 text-navy-foreground hover:bg-white/10"
                  >
                    <Clock className="h-4 w-4" /> Follow Up
                  </Button>
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
                  <PatientProfileCard
                    patient={selected}
                    onUpdate={handleUpdate}
                    referralEmailOpen={referralEmailOpen}
                    onToggleReferralEmail={() => setReferralEmailOpen((o) => !o)}
                  />

                  {/* 1. Serving */}
                  <ServingPanel patient={selected} onUpdate={handleUpdate} />

                  {/* 2. Stedi */}
                  <StediPanel
                    patient={selected}
                    onRefresh={refetch}
                    onUpdate={handleUpdate}
                    onRemoveOverlayKeys={(keys) =>
                      selected && removeOverlayKeys(selected.id, keys)
                    }
                  />

                  {/* 3. Doctor */}
                  <DoctorPanel
                    patient={selected}
                    onUpdate={handleUpdate}
                    clinicLabels={clinicLabels}
                    onClinicSelect={handleClinicSelect}
                    onClinicCreate={handleClinicCreate}
                  />

                  {/* 4. Notes */}
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

                  {/* Submit */}
                  <div className="rounded-xl bg-card border shadow-card p-5">
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="text-sm text-muted-foreground">
                        <p className="font-medium text-foreground">Ready to send off?</p>
                        <p className="text-xs">All edits will be saved to Monday when you submit.</p>
                      </div>
                      <div className="flex gap-3">
                        <Button
                          variant="outline"
                          onClick={() => handleSubmit("needsInfo")}
                          disabled={submitting}
                          className="gap-2 border-blue-300 text-blue-700 hover:bg-purple-100 hover:text-blue-700"
                        >
                          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
                          Need More Info
                        </Button>
                        <Button
                          onClick={() => handleSubmit("advance")}
                          disabled={submitting}
                          className="gap-2 bg-green-600 hover:bg-green-700 text-white shadow-elevate"
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
