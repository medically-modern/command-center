/**
 * Patient Questions — read-only inbox view.
 * Aggregates patient messages from the Subscription board ("Patient Help Message")
 * and Secondary Claims board ("Patient Message").
 */
import { useEffect, useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/patientQuestions/useMondayPatients";
import type { PatientQuestion } from "@/lib/patientQuestions/types";
import { PatientsSidebar } from "@/components/patientQuestions/PatientsSidebar";
import { PatientDetailCard } from "@/components/patientQuestions/PatientDetailCard";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { ArrowLeft, MessageCircleQuestion } from "lucide-react";
import { useBackNavigation } from "@/hooks/useBackNavigation";

const PatientQuestionsPage = () => {
  const { goBack } = useBackNavigation();
  const { patients, loading, error, refetch } = useMondayPatients();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"all" | "subscription" | "claims">("all");

  const filtered = useMemo(
    () => activeTab === "all" ? patients : patients.filter((p) => p.source === activeTab),
    [patients, activeTab],
  );

  // Auto-select first patient when data loads
  useEffect(() => {
    if (!selectedId && filtered.length > 0) setSelectedId(filtered[0].id);
  }, [filtered, selectedId]);

  // If selected patient not in current tab filter, reset selection
  useEffect(() => {
    if (selectedId && !filtered.some((p) => p.id === selectedId) && filtered.length > 0) {
      setSelectedId(filtered[0].id);
    }
  }, [filtered, selectedId]);

  const selected: PatientQuestion | undefined = useMemo(
    () => patients.find((p) => p.id === selectedId),
    [patients, selectedId],
  );

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <PatientsSidebar
          patients={patients}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={loading}
          error={error}
          onRefresh={() => refetch()}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border">
            <div className="px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
                <button
                  onClick={() => goBack()}
                  className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                  <MessageCircleQuestion className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern</p>
                  <h1 className="text-2xl font-bold">Patient Questions</h1>
                  {selected && <p className="text-sm opacity-80 mt-0.5">{selected.name}</p>}
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm opacity-80">
                <span>{filtered.length} message{filtered.length !== 1 ? "s" : ""}</span>
              </div>
            </div>
          </header>

          <main className="flex-1 px-6 py-6 overflow-y-auto">
            <section className="max-w-4xl mx-auto space-y-5">
              {!selected && (
                <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                  <MessageCircleQuestion className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {loading
                      ? "Loading patient messages from Monday…"
                      : error
                        ? error
                        : patients.length === 0
                          ? "No patient messages found. Messages will appear here when patients submit questions via the reorder form or co-pay portal."
                          : "Select a patient from the sidebar to view their message."}
                  </p>
                </div>
              )}

              {selected && <PatientDetailCard patient={selected} />}
            </section>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default PatientQuestionsPage;
