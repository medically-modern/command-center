/**
 * mmKit — shared visual primitives for the June 2026 masheke redesign
 * (send-request / confirm-receipt mockup aesthetic). Pure presentation:
 * no Monday writes, no workflow logic.
 */
import { useState, useEffect, useRef } from "react";
import type { Patient } from "@/lib/masheke/workflow";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileText,
  Loader2,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
} from "lucide-react";
import type { MondayFileEntry } from "@/lib/masheke/mondayApi";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { ConfirmDeleteDialog } from "@/components/shared/ConfirmDeleteDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
// Sends go through the gateway (not RingCentral directly) so WHO sent the text
// is recorded from the verified token. This popup is behind every Text button in
// the app, so routing it here is what makes the attribution log complete.
import { fetchConversation, sendMessage, type ConversationMessage as SmsMessage } from "@/lib/assignedPatients/messagingApi";
// TCPA/CTIA guard, shared with the Assigned Patients inbox — nothing upstream
// stops a send to someone who replied STOP, so every composer needs it.
import { consentState } from "@/lib/assignedPatients/optOut";

// =====================================================================
// Step shell
// =====================================================================

/** Step card — white, 1px border, 4px left border in mm-green, numbered
 *  36px circle (green-12% bg, teal text, mint ring).
 *
 *  Pass `collapsible` to make the whole header a toggle (chevron on the
 *  right); `defaultOpen={false}` starts it collapsed — used by the
 *  manager views to tuck "Review the Request" behind a dropdown. */
export function MmStep({
  num,
  title,
  sub,
  rightAccessory,
  children,
  collapsible = false,
  defaultOpen = true,
}: {
  num: number;
  title: string;
  sub?: string;
  rightAccessory?: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = !collapsible || open;
  return (
    <section
      className="rounded-2xl bg-card border border-l-4 p-6 shadow-sm"
      style={{ borderColor: "var(--mm-card-border)", borderLeftColor: "var(--mm-green)" }}
    >
      <header
        className={`flex items-center justify-between gap-3 flex-wrap ${expanded ? "mb-5" : "mb-0"} ${collapsible ? "cursor-pointer select-none" : ""}`}
        onClick={collapsible ? () => setOpen((v) => !v) : undefined}
        aria-expanded={collapsible ? open : undefined}
        role={collapsible ? "button" : undefined}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="grid place-items-center h-9 w-9 rounded-full text-base font-bold shrink-0"
            style={{
              background: "var(--mm-green-12)",
              color: "var(--mm-teal)",
              boxShadow: "inset 0 0 0 1px var(--mm-mint-ring)",
            }}
          >
            {num}
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight truncate">{title}</h2>
            {sub && expanded && <p className="text-sm text-muted-foreground mt-0.5">{sub}</p>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {rightAccessory}
          {collapsible && (
            <ChevronDown
              className={`h-[22px] w-[22px] text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
            />
          )}
        </div>
      </header>
      {expanded && children}
    </section>
  );
}

// =====================================================================
// Method hero — badge + "Request goes to" (+ optional doctor editing)
// =====================================================================

export function MethodHero({
  patient,
  method,
  label = "Request goes to",
  where,
  right,
  editHint = "Edits are saved to Monday when you Mark as Complete (or via the Save button above).",
  onDoctorEdit,
}: {
  patient: Patient;
  /** Display method — caller decides the fallback (Send Request uses
   *  `?? "Fax"` to match its send logic; Confirm Receipt uses `?? "—"`). */
  method: string;
  /** Eyebrow above the doctor name (e.g. "Confirm receipt with"). */
  label?: string;
  /** Override the third line (defaults to clinic + fax/email). */
  where?: string;
  /** Optional right-aligned accessory (e.g. the Call box). */
  right?: React.ReactNode;
  /** Footnote under the edit grid describing when edits persist. */
  editHint?: string;
  /** Provide to show the inline Edit affordance (Send Request — its
   *  header card is read-only). Omit when the page's profile card
   *  already handles doctor editing. */
  onDoctorEdit?: (patch: Partial<Patient>) => void;
}) {
  const isParachute = method === "Parachute";
  const isFax = method === "Fax";
  const isEmail = method === "Email";
  const known = isParachute || isFax || isEmail;
  const [editOpen, setEditOpen] = useState(false);

  const whereParts: string[] = [patient.clinicName || "—"];
  if (isFax && patient.doctorFax) whereParts.push(`Fax: ${patient.doctorFax}`);
  if (isEmail && patient.doctorEmail) whereParts.push(`Email: ${patient.doctorEmail}`);
  const whereLine = where ?? whereParts.join(" · ");

  return (
    <section
      className="rounded-2xl bg-card border border-l-4 p-6 shadow-sm"
      style={{ borderColor: "var(--mm-card-border)", borderLeftColor: "var(--mm-green)" }}
    >
      <div className="flex items-center gap-5 flex-wrap">
        <div
          className={`inline-flex items-center gap-2.5 rounded-xl px-5 py-3.5 text-xl font-extrabold tracking-tight shrink-0 ${
            known ? "text-white" : "bg-muted text-muted-foreground"
          }`}
          style={known ? { background: isParachute ? "var(--mm-green)" : "var(--mm-teal)" } : undefined}
        >
          {isParachute ? <ChuteIcon /> : isEmail ? <Mail className="h-[22px] w-[22px]" /> : isFax ? <FaxIcon /> : null}
          {method}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="text-xl font-bold mt-0.5">
            {patient.doctorName || "—"}{" "}
            <span className="font-medium text-muted-foreground">· NPI {patient.doctorNpi || "—"}</span>
          </p>
          <p className="text-base text-muted-foreground">{whereLine}</p>
        </div>
        <div className="ml-auto shrink-0 flex items-center gap-4">
          {right}
          {onDoctorEdit && (
            <button
              onClick={() => setEditOpen((o) => !o)}
              className="shrink-0 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors underline underline-offset-4"
              title="Edit doctor info"
            >
              <Pencil className="h-3.5 w-3.5" />
              {editOpen ? "Done" : "Edit"}
            </button>
          )}
        </div>
      </div>

      {onDoctorEdit && editOpen && (
        <div
          className="mt-5 border-t pt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          style={{ borderColor: "var(--mm-card-border)" }}
        >
          <HeroField label="Doctor Name" value={patient.doctorName} onChange={(v) => onDoctorEdit({ doctorName: v })} />
          <HeroField label="Doctor NPI" value={patient.doctorNpi} onChange={(v) => onDoctorEdit({ doctorNpi: v })} />
          <HeroField label="Doctor Phone" value={patient.doctorPhone} onChange={(v) => onDoctorEdit({ doctorPhone: v })} />
          <HeroField label="Doctor Fax" value={patient.doctorFax} onChange={(v) => onDoctorEdit({ doctorFax: v })} />
          <HeroField label="Doctor Email" value={patient.doctorEmail} onChange={(v) => onDoctorEdit({ doctorEmail: v })} />
          <HeroField label="Clinic Name" value={patient.clinicName} onChange={(v) => onDoctorEdit({ clinicName: v })} />
          <p className="sm:col-span-2 lg:col-span-3 text-xs text-muted-foreground">
            {editHint}
          </p>
        </div>
      )}
    </section>
  );
}

function HeroField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
      <Input value={value ?? ""} onChange={(e) => onChange(e.target.value)} className="h-9 text-sm" />
    </div>
  );
}

// =====================================================================
// Doctor edit grid — the six doctor inputs revealed by the header
// card's Edit toggle. Display rows stay untouched; this strip appears
// below them while editing. Same persistence model as the profile
// card: edits go to the local overlay via onDoctorEdit and are written
// to Monday by the page's existing save action.
// =====================================================================

export function DoctorEditGrid({
  patient,
  onDoctorEdit,
  editHint,
}: {
  patient: Patient;
  onDoctorEdit: (patch: Partial<Patient>) => void;
  /** Describes when edits persist to Monday. */
  editHint?: string;
}) {
  return (
    <div
      className="mt-5 border-t pt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      style={{ borderColor: "var(--mm-card-border)" }}
    >
      <HeroField label="Doctor Name" value={patient.doctorName} onChange={(v) => onDoctorEdit({ doctorName: v })} />
      <HeroField label="Doctor NPI" value={patient.doctorNpi} onChange={(v) => onDoctorEdit({ doctorNpi: v })} />
      <HeroField label="Doctor Phone" value={patient.doctorPhone} onChange={(v) => onDoctorEdit({ doctorPhone: v })} />
      <HeroField label="Doctor Fax" value={patient.doctorFax} onChange={(v) => onDoctorEdit({ doctorFax: v })} />
      <HeroField label="Doctor Email" value={patient.doctorEmail} onChange={(v) => onDoctorEdit({ doctorEmail: v })} />
      <HeroField label="Clinic Name" value={patient.clinicName} onChange={(v) => onDoctorEdit({ clinicName: v })} />
      {editHint && (
        <p className="sm:col-span-2 lg:col-span-3 text-xs text-muted-foreground">{editHint}</p>
      )}
    </div>
  );
}

/** Small pencil Edit/Done toggle used on the header cards. */
export function EditToggle({
  editing,
  onToggle,
}: {
  editing: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted shrink-0"
      title={editing ? "Done editing" : "Edit doctor info"}
    >
      {editing ? <Check className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
      <span>{editing ? "Done" : "Edit"}</span>
    </button>
  );
}

// =====================================================================
// Chips
// =====================================================================

export function MnStatusChip({ established }: { established: boolean }) {
  return established ? (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shrink-0 text-[color:var(--mm-teal)] shadow-[inset_0_0_0_1px_var(--mm-mint-ring)]"
      style={{ background: "var(--mm-mint)" }}
    >
      <Check className="h-3.5 w-3.5" />
      Medical Necessity: Established
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shrink-0 border"
      style={{
        background: "var(--mm-rose-soft)",
        color: "var(--mm-rose)",
        borderColor: "oklch(0.62 0.13 18 / 0.35)",
      }}
    >
      <AlertTriangle className="h-3.5 w-3.5" />
      Medical Necessity: Not Established
    </span>
  );
}

export function SentChip() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold text-[color:var(--mm-teal)] shadow-[inset_0_0_0_1px_var(--mm-mint-ring)]"
      style={{ background: "oklch(0.94 0.02 175 / 0.7)" }}
    >
      <Check className="h-4 w-4" />
      Request Sent
    </span>
  );
}

// =====================================================================
// Ask-for rows (consolidated "ask the doctor for" roll-up)
// =====================================================================

export function AskForList({ patient }: { patient: Patient }) {
  const established = patient.medicalNecessity === "Established";
  const asks = splitDropdownText(patient.mnRequestConsolidated);
  const allClean = established && asks.length === 0;

  if (allClean) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No outstanding reasons — patient is ready.
      </p>
    );
  }
  if (asks.length === 0) {
    return (
      <p className="text-sm text-amber-700 italic">
        MN is not established but no consolidated ask list yet — go back to the
        Evaluate tab and Send to Monday so the new column populates.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {asks.map((a) => (
        <div
          key={a}
          className="flex items-center gap-3.5 rounded-[10px] border px-4 py-3.5"
          style={{
            background: "var(--mm-rose-soft)",
            borderColor: "oklch(0.62 0.13 18 / 0.35)",
          }}
        >
          <XCircle className="h-5 w-5 shrink-0" style={{ color: "var(--mm-rose)" }} />
          <span className="text-[1.05rem] font-bold leading-snug">{a}</span>
        </div>
      ))}
    </div>
  );
}

// =====================================================================
// File rows
// =====================================================================

export function LoadingRow() {
  return (
    <div
      className="flex items-center gap-2 px-4 h-10 rounded-[10px] border border-dashed bg-muted/20 text-sm text-muted-foreground"
      style={{ borderColor: "var(--mm-card-border)" }}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
    </div>
  );
}

export interface TaggedFile {
  file: MondayFileEntry;
  /** Optional small uppercase tag rendered before the filename
   *  (e.g. the file-column group on Confirm Receipt). */
  tag?: string;
}

/** Mint file rows with View and optional Delete.
 *  `onView` defaults to the in-app file viewer modal (PDF/image, rotate + zoom). */
export function FileList({
  files,
  tagged,
  onDelete,
  deleteLabel,
  onView,
}: {
  files?: MondayFileEntry[];
  tagged?: TaggedFile[];
  onDelete?: (assetId: string) => void | Promise<void>;
  deleteLabel?: string;
  onView?: (url: string, name?: string) => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Non-blocking delete confirmation (never window.confirm — see ConfirmDeleteDialog).
  const [pendingDelete, setPendingDelete] = useState<MondayFileEntry | null>(null);
  const rows: TaggedFile[] =
    tagged ?? (files ?? []).map((f) => ({ file: f }));

  const handleDelete = async (file: MondayFileEntry) => {
    if (!onDelete) return;
    setPendingDelete(null);
    setDeletingId(file.assetId);
    try {
      await onDelete(file.assetId);
    } finally {
      setDeletingId(null);
    }
  };

  if (rows.length === 0) return null;
  const view =
    onView ?? ((url: string, name?: string) => openFileViewer({ url, name }));

  return (
    <div className="flex flex-col gap-2.5">
      {rows.map(({ file: f, tag }) => {
        const url = f.public_url || f.url;
        return (
          <div
            key={f.assetId}
            className="flex items-center gap-3 rounded-[10px] border px-4 py-3"
            style={{ background: "var(--mm-mint)", borderColor: "var(--mm-mint-ring)" }}
          >
            <FileText className="h-[18px] w-[18px] shrink-0 text-[color:var(--mm-teal)]" />
            {tag && (
              <span className="text-[10px] uppercase tracking-wider font-semibold shrink-0 text-[color:var(--mm-teal)] opacity-70">
                {tag}
              </span>
            )}
            <span className="flex-1 min-w-0 truncate text-[0.95rem] font-semibold">{f.name}</span>
            <button
              disabled={!url}
              onClick={() => url && view(url, f.name)}
              className="text-sm font-semibold shrink-0 text-[color:var(--mm-teal)] hover:underline underline-offset-4 disabled:opacity-50 disabled:no-underline disabled:cursor-not-allowed"
            >
              View
            </button>
            {onDelete && (
              <button
                onClick={() => setPendingDelete(f)}
                disabled={deletingId !== null}
                title={`Delete "${f.name}" from Monday`}
                className="shrink-0 p-1.5 rounded-md text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 transition-colors"
                aria-label={`Delete ${deleteLabel ?? f.name}`}
              >
                {deletingId === f.assetId ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
        );
      })}
      <ConfirmDeleteDialog
        open={pendingDelete !== null}
        name={pendingDelete?.name ?? ""}
        onConfirm={() => pendingDelete && handleDelete(pendingDelete)}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
      />
    </div>
  );
}

// =====================================================================
// Icons (from mockup)
// =====================================================================

export function ChuteIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z" />
      <path d="M3 11l9 11 9-11" />
      <path d="M12 22V11" />
    </svg>
  );
}

export function FaxIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  );
}

export function ExtIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

// =====================================================================
// Helpers
// =====================================================================

export function splitDropdownText(text?: string): string[] {
  if (!text) return [];
  return text
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Open a Monday file URL in Google Docs Viewer (no download). */
export function openInGoogleViewer(url: string) {
  const viewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(url)}&embedded=true`;
  window.open(viewerUrl, "_blank");
}

/** Format raw phone digits as (xxx)-xxx-xxxx / +1 (xxx)-xxx-xxxx. */
function formatPhoneNice(raw?: string): string {
  if (!raw) return "—";
  const d = raw.replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)})-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `+1 (${d.slice(1, 4)})-${d.slice(4, 7)}-${d.slice(7)}`;
  return raw;
}

/** Days-in-stage pill — shown right-aligned with the patient name, with a
 *  "Days in Stage:" label in front. */
export function DaysInStagePill({ value }: { value?: string }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-2 shrink-0">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Days in Stage:
      </span>
      <span
        className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider text-[color:var(--mm-teal)] shadow-[inset_0_0_0_1px_var(--mm-mint-ring)]"
        style={{ background: "var(--mm-mint)" }}
      >
        {value}
      </span>
    </span>
  );
}

/** Patient phone shown as a Call button (with the number) + a Text button.
 *  Uses tel:/sms: so the rep's device handles it. */
export function PatientContact({
  phone, textPrefill, textOpen, onTextOpenChange,
}: {
  phone?: string;
  /** Seeds the composer the first time it opens — e.g. an insurance follow-up
   *  template. Never overwrites something the rep has already typed. */
  textPrefill?: string;
  /** Lets a button elsewhere on the page open the composer (Patient Intake's
   *  "Start Insurance Follow-Up"). Optional: omitted, the Text button is the
   *  only way in, exactly as before. */
  textOpen?: boolean;
  onTextOpenChange?: (open: boolean) => void;
}) {
  const tel = (phone ?? "").replace(/[^\d+]/g, "");
  if (!tel) return <span className="text-base text-muted-foreground">No phone on file</span>;
  const display = formatPhoneNice(phone);
  return (
    <span className="inline-flex items-center gap-2">
      <a
        href={`tel:${tel}`}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold text-white shadow-sm transition-opacity hover:opacity-90 bg-[color:var(--mm-teal)]"
      >
        <Phone className="h-3.5 w-3.5 shrink-0" /> {display}
      </a>
      <TextCompose
        tel={tel}
        display={display}
        prefill={textPrefill}
        openSignal={textOpen}
        onOpenChange={onTextOpenChange}
      />
    </span>
  );
}

/** "Text" → opens the full SMS conversation (pulled from RingCentral) in a
 *  scrollable pop-up, with a reply box at the bottom. Sending refreshes the
 *  thread so the new message shows immediately. */
function TextCompose({
  tel, display, prefill, openSignal, onOpenChange,
}: {
  tel: string; display: string;
  prefill?: string;
  openSignal?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  /** Whether the whole history was readable. NOT cosmetic — the opt-out guard
   *  treats an incomplete history as consent UNKNOWN and blocks on it. */
  const [historyComplete, setHistoryComplete] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const c = await fetchConversation(tel);
      setMessages(c.messages);
      setHistoryComplete(c.complete);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      // A thread we couldn't read is NOT an empty thread. Leaving this true
      // would let the guard below fail open.
      setHistoryComplete(false);
    } finally {
      setLoading(false);
    }
  };

  /**
   * TCPA/CTIA opt-out. This composer had NO guard — the Assigned Patients
   * inbox blocked opted-out patients and this one didn't, so the same rep
   * could text them from Evaluate, Patient Questions, Doctor Appointments or
   * Patient Intake instead. Our sends go through the plain /sms endpoint, not
   * High Volume SMS, so nothing upstream stops it.
   */
  const consent = consentState(messages, historyComplete);

  // An outside button (Patient Intake's "Start Insurance Follow-Up") pushing
  // the composer open. One-way: the dialog still closes itself.
  useEffect(() => {
    if (openSignal) setOpen(true);
  }, [openSignal]);

  // Seed the draft once, and never over what the rep has already typed.
  useEffect(() => {
    if (open && prefill) setMsg((m) => m || prefill);
  }, [open, prefill]);

  // Pull the conversation each time the pop-up opens.
  useEffect(() => {
    if (open) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the newest message in view.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, loading]);

  const send = async () => {
    if (!msg.trim() || consent.optedOut) return;
    setSending(true);
    try {
      await sendMessage({ to: tel, text: msg.trim() });
      setMsg("");
      await load(); // refresh so the sent text appears in the thread
    } catch (e) {
      toast.error("Couldn't send text", { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSending(false);
    }
  };

  const fmtTime = (iso: string) => {
    if (!iso) return "";
    try {
      return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { setOpen(v); onOpenChange?.(v); }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-[color:var(--mm-teal)] transition-colors hover:bg-muted/40"
          style={{ boxShadow: "inset 0 0 0 1px var(--mm-card-border)" }}
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0" /> Text
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg p-0 gap-0 flex flex-col max-h-[80vh]">
        <DialogHeader className="px-4 py-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-[color:var(--mm-teal)]" />
            Text · {display}
          </DialogTitle>
        </DialogHeader>

        {/* Conversation (scrollable) */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-[220px] bg-muted/20">
          {loading && messages.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading conversation…
            </div>
          ) : err ? (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>Couldn't load the conversation. {err}</div>
            </div>
          ) : messages.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No messages yet. Send the first text below.</p>
          ) : (
            messages.map((m) => {
              const out = m.direction === "Outbound";
              return (
                <div key={m.id} className={cn("flex", out ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[78%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
                      out ? "bg-[color:var(--mm-teal)] text-white rounded-br-sm" : "bg-card border border-border rounded-bl-sm",
                    )}
                  >
                    <div>{m.text}</div>
                    <div className={cn("mt-1 text-[10px]", out ? "text-white/70" : "text-muted-foreground")}>{fmtTime(m.time)}</div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Reply box */}
        <div className="space-y-2 border-t p-3">
          {consent.optedOut && !loading && (
            <p className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">
              {consent.unknown
                ? "Can’t confirm this patient hasn’t opted out — the full text history didn’t load. Texting is blocked until it does. Call them instead."
                : `This patient opted out of texts${consent.keyword ? ` (“${consent.keyword}”)` : ""}. Call them instead.`}
            </p>
          )}
          <Textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            rows={2}
            disabled={consent.optedOut}
            placeholder={consent.optedOut ? "Texting is blocked for this patient" : `Reply to ${display}…`}
            className="resize-none text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
            </button>
            <Button
              size="sm"
              onClick={send}
              disabled={!msg.trim() || sending || consent.optedOut}
              className="gap-1.5 text-white bg-[color:var(--mm-teal)] hover:opacity-90 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
