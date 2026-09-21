/**
 * The Update Clinicals WORK PANE — the body of `/update-clinicals`, extracted
 * so the Fax bar's right pane can render the same thing (§5.39c4).
 *
 * Brandon's handoff moves this whole flow into the Fax bar: *"Pick a fax on
 * the left, find the patient it belongs to, then attach it, set the visit date,
 * record what the office said, or send the patient back to Evaluate."*
 *
 * ⚠️⚠️ **ONE IMPLEMENTATION, TWO SCREENS — and here that matters more than
 * usual, because this pane WRITES.** The visit-date save writes MN Expiry AND
 * the MR rung behind read-back verification (§5.36), the reply card writes the
 * records-reply columns, and Submit sets the Stage Advancer that board
 * automations fire on. A second copy of any of those in the Fax bar is two
 * writers for one column — §5.31c · §5.31d, with a stage move attached. The
 * page keeps its sidebar, header and search; everything below the header is
 * this file, rendered by both.
 *
 * ⚠️ **`editProfile` gates the visit date** (§5.39h) and is checked inside the
 * card, so it holds wherever the pane is mounted. Notes and the MN docs panel
 * are deliberately not gated — a running record is not the profile.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMondayPatients } from "@/hooks/subscription/useMondayPatients";
import { formatDateMDY } from "@/lib/subscription/workflow";
import { MnDocsPanel } from "@/components/subscription/MnDocsPanel";
import { saveVisitDateVerified, recordRecordsReplyVerified } from "@/lib/subscription/mondayWrite";
import { AbilityLockNote, useAbility } from "@/components/shell/AbilityLock";
import { mrRungForExpiry } from "@/lib/subscription/mrStatus";
import {
  RECORDS_REPLY_OPTIONS,
  EMPTY_RECORDS_REPLY,
  recordsReplyOption,
  recordsReplyProblems,
  recordsReplyNote,
  recordsReplyApptDate,
  canSaveRecordsReply,
  appointmentAlreadyPassed,
  type RecordsReplyDraft,
} from "@/lib/subscription/recordsReply";
import { etToday } from "@/lib/masheke/etDate";
// Medical Necessity (masheke) board — second patient source
import {
  fetchGroupItems as mnFetchGroupItems,
  hasToken as mnHasToken,
} from "@/lib/masheke/mondayApi";
import { returnToEvaluateVerified } from "@/lib/masheke/mondayWrite";
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
import { ArrowLeft, CalendarDays, CheckCircle2, ChevronRight, FileUp, Loader2, MessageSquareReply, RefreshCw, Search, User, X } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { ReportIssueButton } from "@/components/shared/ReportIssueButton";
import { PageLoadingOverlay } from "@/components/shared/PageLoadingOverlay";
import { cn } from "@/lib/utils";
import { ProfileStatusBadge } from "@/components/shared/ProfileStatusBadge";
import {
  mashekeProfileStatus,
  subscriptionProfileStatus,
  type ProfileStatus,
} from "@/lib/shared/profileStatus";
import { StaleDataNotice } from "@/components/shared/StaleDataNotice";
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
  /** Profile Status, resolved on the row's OWN board. Computed at map time
   *  because `ClinicalsRow` is a projection — by the time the view has it, the
   *  board-specific columns the rule needs are gone. */
  profileStatus?: ProfileStatus | null;
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
          profileStatus: mashekeProfileStatus(p),
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

/* ── Visit Date updater — SUBSCRIPTION BOARD ONLY ──
      MN Expiry (date_mkp09gra) = Visit Date + 6 months. Restored June 2026;
      only rendered for subscription rows.

      ⚠️ IT ALSO SETS THE MR STATUS NOW (2026-09-16). Until then this card
      wrote MN Expiry and nothing else, and the board's five MR automations
      only ever count DOWN — so refreshing a patient's records left MR reading
      "MR Expired" for the ~5 months until the −30-day rung fired, and it never
      passed through "MR Valid" at all. Brandon reported it on 2026-09-15 a
      minute after fixing one by hand. `mrStatus.mrRungForExpiry` picks the
      rung the new date implies and `mondayWrite.saveVisitDateVerified` writes
      both, MR last, behind read-back verification — see both files for why the
      order is load-bearing. ─────────────────── */

function VisitDateCard({ patient, onSaved }: { patient: ClinicalsRow; onSaved: () => void }) {
  const [visitDate, setVisitDate] = useState("");
  const [saving, setSaving] = useState(false);
  /* ⚠️⚠️ **`editProfile` is what saves this** (§5.39h). Brandon's own
     definition names *"visit date, MN docs"* in the same breath as the
     Subscription profile, and this write is both: MN Expiry plus the MR rung,
     behind read-back verification, and §5.36 is what a wrong one costs.
     ⚠️ The date input stays live and the preview line still computes — the
     ability unlocks the SAVE, it never hides what the page knows (§5.39c). */
  const canEditProfile = useAbility("editProfile");

  const previewExpiry = useMemo(() => {
    if (!visitDate) return null;
    const d = new Date(visitDate + "T00:00:00");
    d.setMonth(d.getMonth() + 6);
    return d.toISOString().slice(0, 10);
  }, [visitDate]);

  // Same rule the save writes, so the line under the input cannot promise a
  // status the write does not produce.
  const previewRung = useMemo(() => mrRungForExpiry(previewExpiry), [previewExpiry]);

  const handleSave = async () => {
    if (!visitDate || !previewExpiry) return;
    // Checked on the button AND here: the button is what a rep sees, this is
    // what stops the write (§5.39g, one level down).
    if (!canEditProfile) return;
    setSaving(true);
    try {
      await saveVisitDateVerified(patient.id, previewExpiry);
      // Name the status in the toast. It is the half a rep cannot predict —
      // the date is on screen already, the rung it lands on is the answer to
      // "did this actually un-expire them?".
      toast.success(
        `MN Expiry updated to ${formatDateMDY(previewExpiry)}`,
        previewRung ? { description: `Medical Records set to ${previewRung.label}.` } : undefined,
      );
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
        Enter the most recent appointment / visit date.
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
            {previewExpiry
              ? `New MN Expiry: ${formatDateMDY(previewExpiry)}${previewRung ? ` · MR → ${previewRung.label}` : ""}`
              : ""}
          </p>
        </div>
        <Button
          onClick={handleSave}
          disabled={!visitDate || saving || !canEditProfile}
          className="h-9 gap-2 bg-blue-600 hover:bg-blue-700 text-white mb-5"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
          {saving ? "Saving…" : "Save Visit Date"}
        </Button>
      </div>
      {!canEditProfile && <AbilityLockNote ability="editProfile" className="mt-1" />}
    </Card>
  );
}

/* ── The office replied, but sent no new records — SUBSCRIPTION ONLY ──
      The other ending to a records chase, and until 2026-09-17 it had nowhere
      to go (Brandon, 2026-09-16). The fax comes back saying the patient has
      not been seen since 2025, or has moved practice, and the only controls on
      this page were "upload the records" and "enter the visit date" — neither
      of which is true. So a real answer went unrecorded, nothing moved, and
      the same office was chased again.

      The three answers and the rules behind them live in
      lib/subscription/recordsReply.ts; the write is
      mondayWrite.recordRecordsReplyVerified. ─────────────────────────────── */

export function RecordsReplyCard({ patient, onSaved }: { patient: ClinicalsRow; onSaved: () => void }) {
  const [draft, setDraft] = useState<RecordsReplyDraft>(EMPTY_RECORDS_REPLY);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const option = recordsReplyOption(draft.choice);
  const problems = recordsReplyProblems(draft);
  const preview = recordsReplyNote(draft);
  const apptPassed = appointmentAlreadyPassed(draft, etToday());

  const handleSave = async () => {
    const noteLine = recordsReplyNote(draft);
    const apptDate = recordsReplyApptDate(draft);
    if (!noteLine) return;
    setSaving(true);
    try {
      await recordRecordsReplyVerified(patient.id, { noteLine, apptDate: apptDate || undefined });
      toast.success(
        "Reply recorded in MR Request Log",
        apptDate
          ? { description: `Next Doc Appt Date set to ${formatDateMDY(apptDate)}.` }
          : undefined,
      );
      setDraft(EMPTY_RECORDS_REPLY);
      onSaved();
    } catch (e) {
      toast.error("Could not record the reply", {
        description: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    // A drawer, shut by default. The everyday path is upload the records and
    // enter the visit date; this is the exception, so it stays out of the way
    // until a rep goes looking for it.
    <Collapsible open={open} onOpenChange={setOpen}>
      <Card className="p-5 border-l-4 border-l-amber-500">
        <CollapsibleTrigger className="w-full text-left group">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5 group-hover:text-foreground transition-colors">
            <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-200", open && "rotate-90")} />
            <MessageSquareReply className="h-3.5 w-3.5" />
            Office replied — no new records
          </p>
          <p className="text-[11px] text-muted-foreground mt-1 pl-5">
            Use this when the fax came back without new clinicals.
          </p>
        </CollapsibleTrigger>

        <CollapsibleContent className="pt-3">
        <div className="grid gap-2 sm:grid-cols-3 mb-3">
          {RECORDS_REPLY_OPTIONS.map((o) => {
            const active = draft.choice === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() =>
                  // Switching answers clears what belonged to the old one, so a
                  // half-typed detail can never ride along under a new heading.
                  setDraft(active ? EMPTY_RECORDS_REPLY : { ...EMPTY_RECORDS_REPLY, choice: o.id })
                }
                className={cn(
                  "text-left rounded-lg border p-3 transition-colors",
                  active
                    ? "border-amber-500 bg-amber-50 ring-1 ring-amber-400"
                    : "border-border bg-background hover:bg-muted/50",
                )}
              >
                <span className="block text-sm font-semibold">{o.label}</span>
                <span className="block text-[11px] text-muted-foreground mt-0.5">{o.hint}</span>
              </button>
            );
          })}
        </div>

        {option && (
          <div className="space-y-3">
            {option.detail && (
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  {option.detail.label}
                  {option.detail.required ? " *" : " (optional)"}
                </label>
                <textarea
                  value={draft.detail}
                  onChange={(e) => setDraft((d) => ({ ...d, detail: e.target.value }))}
                  placeholder={option.detail.placeholder}
                  rows={2}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            )}

            {option.takesAppointment && (
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  Next doctor appointment (optional)
                </label>
                <Input
                  type="date"
                  value={draft.apptDate}
                  onChange={(e) => setDraft((d) => ({ ...d, apptDate: e.target.value }))}
                  className="h-9 w-48 bg-background"
                />
                {/* Writing this date schedules a real fax. Say so — it is the one
                    control on this card with a consequence the rep cannot see. */}
                <p className="text-[11px] text-muted-foreground mt-1">
                  {draft.apptDate
                    ? apptPassed
                      ? "That date has already passed, so no follow-up will be scheduled from it. The reply is still recorded."
                      : "We'll ask the office again the day after this, unless the records have been updated by then."
                    : "Leave blank if they didn't give one."}
                </p>
              </div>
            )}

            {preview && (
              <p className="text-[11px] text-muted-foreground">
                Goes in as: <span className="font-medium text-foreground">{preview}</span>
              </p>
            )}

            {/* A disabled control with no stated reason is a dead end, so the
                button and the sentences under it read from one list. */}
            {problems.length > 0 && draft.choice && (
              <ul className="text-[11px] text-amber-700 list-disc pl-4">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}

            <Button
              onClick={handleSave}
              disabled={!canSaveRecordsReply(draft) || saving}
              className="h-9 gap-2 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageSquareReply className="h-4 w-4" />}
              {saving ? "Recording…" : "Record reply"}
            </Button>
          </div>
        )}
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

/* ── Submit — MEDICAL NECESSITY BOARD ONLY ────────────────────
      Returns the patient to "Evaluate MN" for re-review. This clears the
      Escalation flag (→ Done) and stamps Next Action Date = today BEFORE
      flipping the Stage Advancer, then advances last — so the patient lands
      in the rep's ACTIVE Evaluate queue instead of the hidden escalated /
      scheduled bucket. (A returning patient still carrying "Escalation
      Required" from a prior stage used to show "Evaluate MN" on this tab yet
      never appear in the MN Evaluation view.) See returnToEvaluateVerified.
      Subscription patients have no Submit button (uploads + visit date are the
      whole flow). ── */

function SubmitCard({ patient, onDone }: { patient: ClinicalsRow; onDone: () => void }) {
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await returnToEvaluateVerified(patient.id);
      toast.success(`${patient.name} sent back to Evaluate — due today`);
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
        Submitting sends this patient back to Evaluate — their Stage Advancer is set to "Evaluate MN" no matter which stage they're in now, any escalation or stuck-proposal flag is cleared, and their next action date is set to today, so they reappear in the MN Evaluation queue right away.
      </p>
      <Button
        onClick={handleSubmit}
        disabled={submitting}
        className="h-10 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white min-w-[160px]"
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
        {submitting ? "Submitting…" : "Submit — back to Evaluate"}
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
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-lg font-semibold">{patient.name}</p>
            <ProfileStatusBadge status={patient.profileStatus} size="sm" />
          </div>
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
        {/* MR status block hidden for Medical Necessity patients (June 2026) */}
        {patient.board === "subscription" && patient.mr && (
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


/* ── The merged patient list ────────────────────────────────── */

/**
 * Subscription (all) + Medical Necessity (everything but Completed), merged
 * and sorted, with the board label each row is worked on.
 *
 * ⚠️ **Two board reads, so mount it only where the pane is actually shown.**
 * The Fax bar renders the pane inside `FaxPane`, which exists only once a rep
 * has picked a fax — so a rep glancing at the inbox pays nothing, and the cost
 * lands exactly when they start working one. Same "on open, never on render"
 * posture as every other heavy read on these screens.
 */
export function useClinicalsPatients() {
  const {
    patients: subPatients,
    loading: subLoading,
    initialLoading: subInitialLoading,
    error: subError,
    refetch: refetchSub,
  } = useMondayPatients();
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
      profileStatus: subscriptionProfileStatus(p),
    }));
    return [...subRows, ...mnRows].sort((a, b) => a.name.localeCompare(b.name));
  }, [subPatients, mnRows]);

  const refetch = useCallback(() => {
    refetchSub();
    refetchMn();
  }, [refetchSub, refetchMn]);

  return {
    patients,
    loading: subLoading || mnLoading,
    initialLoading: subInitialLoading,
    // ⚠️ Only a DOUBLE failure is reported as one string; one board being down
    // still leaves the other's patients workable, which is what the notice says.
    error: subError && mnError ? `${subError} / ${mnError}` : subError || mnError,
    refetch,
  };
}

/* ── The pane ───────────────────────────────────────────────── */

/**
 * Everything below the page header: find a patient, then work them.
 *
 * ⚠️ **`selectedId` is the CALLER's**, so each screen keeps its own selection —
 * the page's sidebar and the Fax bar's per-fax pane are different journeys, and
 * sharing one would make picking a fax silently change the page's patient.
 */
export function ClinicalsWorkPane({
  patients,
  selectedId,
  onSelect,
  onRefresh,
  /** Rendered above the search — the Fax bar says which fax this is about. */
  context,
  /** The Fax bar's "attach this fax as clinicals", inside the patient block. */
  attachSlot,
  autoFocusSearch = true,
}: {
  patients: ClinicalsRow[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onRefresh: () => void;
  context?: React.ReactNode;
  attachSlot?: React.ReactNode;
  autoFocusSearch?: boolean;
}) {
  const [search, setSearch] = useState("");

  const selected = useMemo(() => patients.find((p) => p.id === selectedId), [patients, selectedId]);

  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return patients.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 25);
  }, [patients, search]);

  if (selected) {
    return (
      <>
        {context}
        <Button variant="ghost" size="sm" onClick={() => onSelect(null)} className="gap-1.5 text-xs -mb-2">
          <Search className="h-3.5 w-3.5" />
          Search another patient
        </Button>
        <PatientClinicalsCard patient={selected} />
        {attachSlot}
        {/* ⚠️ KEYED BY PATIENT. Both cards hold a typed draft in component
            state and this pane keeps the same instance across a selection
            change — so without the key a half-typed visit date or reply
            survives onto the next patient, one press from the wrong chart
            (§9's notes-box rule). */}
        {selected.board === "subscription" && (
          <>
            <VisitDateCard key={`visit-${selected.id}`} patient={selected} onSaved={onRefresh} />
            <RecordsReplyCard key={`reply-${selected.id}`} patient={selected} onSaved={onRefresh} />
          </>
        )}
        {selected.board === "mn" && (
          <SubmitCard
            patient={selected}
            onDone={() => {
              onSelect(null);
              onRefresh();
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      {context}
      <div className="rounded-xl bg-card border shadow-card p-6">
        <p className="text-base font-semibold mb-1">Find a patient</p>
        <p className="text-sm text-muted-foreground mb-4">
          Search any patient to update their clinical docs or visit date.
        </p>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            autoFocus={autoFocusSearch}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patients by name…"
            className="w-full rounded-lg border bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* ⚠️ No "likely matches" list here, deliberately: on the Fax bar the
            *Their patients* section directly above IS that list — the same
            `buildFaxDirectory` join — and offering it twice on one screen is
            the duplication a card stops being read for. That section selects
            into this pane instead. */}
        {search.trim() ? (
          results.length ? (
            <ul className="mt-4 space-y-1.5">
              {results.map((p) => (
                <ClinicalsResultRow key={`${p.board}:${p.id}`} row={p} onSelect={onSelect} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground mt-4">No patients match “{search.trim()}”.</p>
          )
        ) : null}
      </div>
    </>
  );
}

function ClinicalsResultRow({
  row,
  onSelect,
}: {
  row: ClinicalsRow;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        onClick={() => onSelect(row.id)}
        className="w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left hover:bg-muted/60"
      >
        <User className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.name}</span>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
            row.board === "subscription" ? "bg-primary/10 text-primary" : "bg-amber-500/10 text-amber-700",
          )}
        >
          {row.boardLabel} · {row.stage}
        </span>
        <span className="text-xs text-muted-foreground shrink-0">{row.dob || ""}</span>
      </button>
    </li>
  );
}
