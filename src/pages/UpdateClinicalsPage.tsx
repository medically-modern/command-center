/**
 * Update Clinicals — simplified view for uploading new clinical documents.
 * Reads from the same Subscription board (18407459988) but shows only
 * patient identity + MN Docs upload panel.
 */
import { useEffect, useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/subscription/useMondayPatients";
import type { Patient } from "@/lib/subscription/workflow";
import { formatDateMDY } from "@/lib/subscription/workflow";
import { MnDocsPanel } from "@/components/subscription/MnDocsPanel";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { ArrowLeft, FileUp, Loader2, RefreshCw, Search, User, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";

/* ── Simplified Sidebar ─────────────────────────────────────── */

function ClinicalsSidebar({
  patients,
  selectedId,
  onSelect,
  loading,
  error,
  onRefresh,
}: {
  patients: Patient[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = searchQuery.trim()
    ? patients.filter((p) =>
        p.name.toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : patients;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Monday · Clinicals
              </p>
              <p className="text-sm font-semibold truncate">
                Patients ({patients.length})
              </p>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh from Monday"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>

        {!collapsed && (
          <div className="relative mt-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search patients…"
              className="w-full pl-8 pr-8 py-1.5 rounded-md border border-border bg-white text-gray-900 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-ring"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </SidebarHeader>

      <SidebarContent>
        {error && !collapsed && (
          <div className="m-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
            {error}
          </div>
        )}

        <SidebarGroup>
          {!collapsed && (
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              All Patients ({filtered.length})
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {filtered.map((p) => (
                <SidebarMenuItem key={p.id}>
                  <SidebarMenuButton
                    isActive={selectedId === p.id}
                    onClick={() => onSelect(p.id)}
                    className={cn(
                      "flex items-start gap-2 py-2 h-auto",
                      selectedId === p.id && "bg-sidebar-accent"
                    )}
                  >
                    <User className="h-4 w-4 mt-0.5 shrink-0" />
                    {!collapsed && (
                      <div className="min-w-0 text-left">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {p.mr || "—"}
                        </p>
                      </div>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {!loading && patients.length === 0 && !error && !collapsed && (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            No patients found.
          </p>
        )}
      </SidebarContent>
    </Sidebar>
  );
}

/* ── Simplified Patient Card ────────────────────────────────── */

function PatientClinicalsCard({ patient }: { patient: Patient }) {
  const isValid = patient.mr === "MR Valid";
  const isExpired =
    patient.mr === "MR Expired" || patient.mr === "MR Invalid";
  const mrColor = isValid
    ? "text-green-600"
    : isExpired
      ? "text-red-600"
      : "text-amber-600";

  return (
    <div className="space-y-4">
      {/* Patient identity */}
      <Card className="p-4 flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
            Patient Name
          </p>
          <p className="text-lg font-semibold">{patient.name}</p>
        </div>
        {patient.dob && (
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              DOB
            </p>
            <p className="text-lg font-semibold">{patient.dob}</p>
          </div>
        )}
        {patient.mr && (
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Medical Records
            </p>
            <p className={`text-sm font-semibold ${mrColor}`}>{patient.mr}</p>
            {patient.mnExpiry && (
              <p className="text-[10px] text-muted-foreground">
                Expires: {formatDateMDY(patient.mnExpiry)}
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Upload Clinicals — the main action */}
      <Card className="p-5 border-l-4 border-l-fuchsia-500">
        <MnDocsPanel itemId={patient.id} />
      </Card>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────── */

const UpdateClinicalsPage = () => {
  const navigate = useNavigate();
  const { patients, loading, error, refetch } = useMondayPatients();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId && patients.length > 0) setSelectedId(patients[0].id);
  }, [patients, selectedId]);

  const selected: Patient | undefined = useMemo(
    () => patients.find((p) => p.id === selectedId),
    [patients, selectedId]
  );

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-gradient-subtle">
        <ClinicalsSidebar
          patients={patients}
          selectedId={selectedId}
          onSelect={setSelectedId}
          loading={loading}
          error={error}
          onRefresh={refetch}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border">
            <div className="px-6 py-5 flex items-center gap-3">
              <SidebarTrigger className="text-navy-foreground hover:bg-white/10" />
              <button
                onClick={() => navigate("/?tab=dashboard")}
                className="p-1.5 rounded-md hover:bg-white/10 transition-colors"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div className="h-10 w-10 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
                <FileUp className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">
                  Medically Modern
                </p>
                <h1 className="text-2xl font-bold">Update Clinicals</h1>
                {selected && (
                  <p className="text-sm opacity-80 mt-0.5">{selected.name}</p>
                )}
              </div>
            </div>
          </header>

          <main className="flex-1 px-6 py-6 overflow-y-auto">
            <section className="max-w-3xl mx-auto space-y-5">
              {!selected && (
                <div className="rounded-xl bg-card border shadow-card p-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    {loading
                      ? "Loading patients from Monday…"
                      : error
                        ? error
                        : "Select a patient from the sidebar to begin."}
                  </p>
                </div>
              )}

              {selected && <PatientClinicalsCard patient={selected} />}
            </section>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default UpdateClinicalsPage;
