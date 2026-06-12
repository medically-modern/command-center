/**
 * Update Clinicals — simplified view for uploading new clinical documents.
 *
 * Pulls patients from BOTH boards (June 2026):
 *   - Subscription board (18407459988) — all patients, labeled with their
 *     subscription status (Active / Paused / …)
 *   - Medical Necessity board (18406060017) — all patients EXCEPT the
 *     Completed stage, labeled with their Stage Advancer value
 * Each row shows a "board · stage" label so the user knows where the
 * patient lives. Uploads + visit-date writes target the right board.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/subscription/useMondayPatients";
import { formatDateMDY } from "@/lib/subscription/workflow";
import { MnDocsPanel } from "@/components/subscription/MnDocsPanel";
import { COL, writeDate, writeText, fetchItemColumnText } from "@/lib/subscription/mondayApi";
// Medical Necessity (masheke) board — second patient source
import {
  COL as MN_COL,
  fetchGroupItems as mnFetchGroupItems,
  writeStatusIndex as mnWriteStatusIndex,
  hasToken as mnHasToken,
} from "@/lib/masheke/mondayApi";
import { SUB_STAGE_INDEX as MN_SUB_STAGE_INDEX } from "@/lib/masheke/mondayMapping";
import { mondayItemToPatient as mnItemToPatient } from "@/lib/masheke/mondayMapping";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { ArrowLeft, CalendarDays, CheckCircle2, FileUp, Loader2, RefreshCw, Search, User, X } from "lucide-react";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { cn } from "@/lib/utils";

/* ── Unified patient row (both boards) ──────────────────────── */

export interface ClinicalsRow {
  id: string;
  name: string;
  dob?: string;
  board: "subscription" | "mn";
  /** Short board label shown to the user. */
  boardLabel: "Subscription" | "Med Necessity";
  /** Stage on that board — subscription status (Active/Paused/…) or the
   *  MN board's Stage Advancer (Evaluate MN / Send Request / …). */
  stage: string;
  mr?: string;
  mnExpiry?: string;
}

/** Patients from the Medical Necessity board, EXCLUDING the Completed
 *  stage. Light inline hook — the masheke useMondayPatients hook is
 *  tab-scoped, and Update Clinicals needs every active MN patient. */
function useMnBoardRows() {
  const [rows, setRows] = useState<ClinicalsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refetch = useCallback(async () => {
    if (!mnHasToken()) {
      setError("VITE_MONDAY_API_TOKEN is not set.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const items = await mnFetchGroupItems();
      const mapped = (Array.isArray(items) ? items : [])
        .map(mnItemToPatient)
        // "excluding the completed stage" — Completed patients are done with
        // Medical Necessity and shouldn't be offered here.
        .filter((p) => (p.subStage ?? "") !== "Completed")
        .map<ClinicalsRow>((p) => ({
          id: p.id,
          name: p.name,
          dob: p.dob || undefined,
          board: "mn",
          boardLabel: "Med Necessity",
          stage: p.subStage || "—",
          mr: p.mrsClinicals || undefined,
          mnExpiry: p.mrExpiryDate || undefined,
        }));
      setRows(mapped);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load MN board patients");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refetch();
  }, [refetch]);
  return { rows, loading, error, refetch };
}

/* ── Simplified Sidebar ─────────────────────────────────────── */

function ClinicalsSidebar({
  patients,
  selectedId,
  onSelect,
  loading,
  error,
  onRefresh,
}: {
  patients: ClinicalsRow[];
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
                        {/* board · stage label so the user knows where this
                            patient lives (Subscription vs Medical Necessity) */}
                        <p
                          className={cn(
                            "text-[11px] truncate font-medium",
                            p.board === "mn" ? "text-violet-500" : "text-teal-600",
                          )}
                        >
                          {p.boardLabel} · {p.stage}
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

/* ── Visit Date updater — SUBSCRIPTION BOARD ONLY ──
      MN Expiry (date_mkp09gra) = Visit Date + 6 months. Restored June 2026;
      only rendered for subscription rows. ─────────────────── */

function VisitDateCard({ patient, onSaved }: { patient: ClinicalsRow; onSaved: () => void }) {
  const [visitDate, setVisitDate] = useState("");
  const [saving, setSaving] = useState(false);

  const previewExpiry = useMemo(() => {
    if (!visitDate) return null;
    const d = new Date(visitDate + "T00:00:00");
    d.setMonth(d.getMonth() + 6);
    return d.toISOString().slice(0, 10);
  }, [visitDate]);

  const handleSave = async () => {
    if (!visitDate || !previewExpiry) return;
    setSaving(true);
    try {
      await writeDate(patient.id, COL.mnExpiry, previewExpiry);
      toast.success(`MN Expiry updated to ${formatDateMDY(previewExpiry)}`);
      setVisitDate("");
      onSaved();
    } catch (e) {
      toast.error("Failed to update MN Expiry", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-5 border-l-4 border-l-fuchsia-500">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1.5">
        <CalendarDays className="h-3.5 w-3.5" />
        Update Visit Date
      </p>
      <p className="text-[11px] text-muted-foreground mb-3">
        Enter the most recent appointment / visit date — MN Expiry is set to that date + 6 months.
      </p>
      <div className="flex items-end gap-3 flex-wrap">
        <div>
          <Input
            type="date"
            value={visitDate}
            onChange={(e) => setVisitDate(e.target.value)}
            className="h-9 w-48 bg-background"
          />
          <p className="text-[11px] text-muted-foreground mt-1 h-4">
            {previewExpiry ? `New MN Expiry: ${formatDateMDY(previewExpiry)}` : ""}
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!visitDate || saving}
          className="h-9 gap-2 bg-blue-600 hover:bg-blue-700 text-white mb-5"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
          {saving ? "Saving…" : "Save Visit Date"}
        </Button>
      </div>
    </Card>
  );
}

/* ── Submit — board-specific finalize action ──────────────────
      Subscription board: appends "MM/DD/YYYY, h:mm AM/PM ET" to the
      MN Update TEXT column (text_mm48gn5w) — an append-only log, one
      entry per submission.
      Medical Necessity board: flips Stage Advancer → "Evaluate MN",
      whatever stage the patient is currently in — the patient lands
      back in Evaluate's main bucket for re-evaluation. ────────── */

/** "06/12/2026, 2:41 PM ET" — submission stamp for the MN Update log. */
function mnUpdateStamp(): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${fmt.format(new Date())} ET`;
}

function SubmitCard({ patient, onDone }: { patient: ClinicalsRow; onDone: () => void }) {
  const [submitting, setSubmitting] = useState(false);
  const isMn = patient.board === "mn";

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (isMn) {
        await mnWriteStatusIndex(patient.id, MN_COL.subStage, MN_SUB_STAGE_INDEX.evaluate);
        toast.success(`${patient.name} sent back to Evaluate`);
      } else {
        // Append this submission to the MN Update log (never overwrite).
        const existing = (await fetchItemColumnText(patient.id, COL.mnUpdate)).trim();
        const next = existing ? `${existing}; ${mnUpdateStamp()}` : mnUpdateStamp();
        await writeText(patient.id, COL.mnUpdate, next);
        toast.success("Submitted — update logged to MN Update");
      }
      onDone();
    } catch (e) {
      toast.error("Submit failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="p-5 border-l-4 border-l-emerald-500">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1 flex items-center gap-1.5">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Submit
      </p>
      <p className="text-[11px] text-muted-foreground mb-3">
        {isMn
          ? "Submitting sends this patient back to Evaluate — their Stage Advancer is set to \"Evaluate MN\" no matter which stage they're in now."
          : "Logs this update (date + time) to the MN Update column on the Subscription board — entries append, nothing is overwritten."}
      </p>
      <Button
        onClick={handleSubmit}
        disabled={submitting}
        className="h-10 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white min-w-[160px]"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        {submitting ? "Submitting…" : isMn ? "Submit — back to Evaluate" : "Submit"}
      </Button>
    </Card>
  );
}

/* ── Simplified Patient Card ────────────────────────────────── */

function PatientClinicalsCard({ patient }: { patient: ClinicalsRow }) {
  // Subscription board: MR Valid / MR Expired / MR Invalid.
  // MN board: MR Received / Collect.
  const isValid = patient.mr === "MR Valid" || patient.mr === "MR Received";
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
          {/* board · stage badge */}
          <span
            className={cn(
              "inline-block mt-1 text-[11px] font-semibold rounded-full px-2.5 py-0.5 border",
              patient.board === "mn"
                ? "text-violet-700 bg-violet-50 border-violet-200"
                : "text-teal-700 bg-teal-50 border-teal-200",
            )}
          >
            {patient.boardLabel} · {patient.stage}
          </span>
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

      {/* Upload Clinicals — the main action (column + board picked by row) */}
      <Card className="p-5 border-l-4 border-l-fuchsia-500">
        <MnDocsPanel itemId={patient.id} board={patient.board} />
      </Card>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────── */

const UpdateClinicalsPage = () => {
  const { goBack } = useBackNavigation();
  // Subscription board (all patients) + Medical Necessity board (everything
  // except Completed) — merged into one searchable list with board labels.
  const { patients: subPatients, loading: subLoading, error: subError, refetch: refetchSub } = useMondayPatients();
  const { rows: mnRows, loading: mnLoading, error: mnError, refetch: refetchMn } = useMnBoardRows();

  const patients = useMemo<ClinicalsRow[]>(() => {
    const subRows = subPatients.map<ClinicalsRow>((p) => ({
      id: p.id,
      name: p.name,
      dob: p.dob || undefined,
      board: "subscription",
      boardLabel: "Subscription",
      stage: p.status || "—",
      mr: p.mr || undefined,
      mnExpiry: p.mnExpiry || undefined,
    }));
    return [...subRows, ...mnRows].sort((a, b) => a.name.localeCompare(b.name));
  }, [subPatients, mnRows]);

  const loading = subLoading || mnLoading;
  const error = subError && mnError ? `${subError} / ${mnError}` : subError || mnError;
  const refetch = useCallback(() => {
    refetchSub();
    refetchMn();
  }, [refetchSub, refetchMn]);

  // No auto-select — the page opens to a patient search so the user
  // explicitly picks who they're updating.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mainSearch, setMainSearch] = useState("");

  const selected: ClinicalsRow | undefined = useMemo(
    () => patients.find((p) => p.id === selectedId),
    [patients, selectedId]
  );

  const searchResults = useMemo(() => {
    const q = mainSearch.trim().toLowerCase();
    if (!q) return [];
    return patients.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 25);
  }, [patients, mainSearch]);

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
                onClick={() => goBack()}
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
                <div className="rounded-xl bg-card border shadow-card p-8">
                  <p className="text-base font-semibold mb-1">Find a patient</p>
                  <p className="text-sm text-muted-foreground mb-4">
                    Search any patient to update their clinical docs or visit date.
                  </p>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                      type="text"
                      autoFocus
                      value={mainSearch}
                      onChange={(e) => setMainSearch(e.target.value)}
                      placeholder="Search patients by name…"
                      className="w-full pl-10 pr-4 h-11 rounded-lg border border-border bg-background text-base focus:outline-none focus:ring-2 focus:ring-fuchsia-400"
                    />
                  </div>
                  {loading && patients.length === 0 ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground mt-4">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading patients from Monday…
                    </p>
                  ) : error ? (
                    <p className="text-sm text-destructive mt-4">{error}</p>
                  ) : mainSearch.trim() ? (
                    searchResults.length > 0 ? (
                      <ul className="mt-3 divide-y divide-border rounded-lg border border-border overflow-hidden">
                        {searchResults.map((p) => (
                          <li key={p.id}>
                            <button
                              onClick={() => {
                                setSelectedId(p.id);
                                setMainSearch("");
                              }}
                              className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors"
                            >
                              <User className="h-4 w-4 text-muted-foreground shrink-0" />
                              <span className="text-sm font-medium flex-1 truncate">{p.name}</span>
                              <span
                                className={cn(
                                  "text-[11px] font-semibold shrink-0 rounded-full px-2 py-0.5 border",
                                  p.board === "mn"
                                    ? "text-violet-700 bg-violet-50 border-violet-200"
                                    : "text-teal-700 bg-teal-50 border-teal-200",
                                )}
                              >
                                {p.boardLabel} · {p.stage}
                              </span>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {p.dob || ""}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground mt-4">
                        No patients match “{mainSearch.trim()}”.
                      </p>
                    )
                  ) : null}
                </div>
              )}

              {selected && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedId(null)}
                    className="gap-1.5 text-xs -mb-2"
                  >
                    <Search className="h-3.5 w-3.5" />
                    Search another patient
                  </Button>
                  <PatientClinicalsCard patient={selected} />
                  {/* Visit date — Subscription board only */}
                  {selected.board === "subscription" && (
                    <VisitDateCard patient={selected} onSaved={refetch} />
                  )}
                  <SubmitCard
                    patient={selected}
                    onDone={() => {
                      setSelectedId(null);
                      refetch();
                    }}
                  />
                </>
              )}
            </section>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
};

export default UpdateClinicalsPage;
