/**
 * mmKit — shared visual primitives for the June 2026 masheke redesign
 * (send-request / confirm-receipt mockup aesthetic). Pure presentation:
 * no Monday writes, no workflow logic.
 */
import { useState } from "react";
import type { Patient } from "@/lib/masheke/workflow";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Trash2,
  XCircle,
} from "lucide-react";
import type { MondayFileEntry } from "@/lib/masheke/mondayApi";
import { openFileViewer } from "@/components/shared/FileViewerModal";

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
  const rows: TaggedFile[] =
    tagged ?? (files ?? []).map((f) => ({ file: f }));

  const handleDelete = async (file: MondayFileEntry) => {
    if (!onDelete) return;
    if (!window.confirm(`Delete "${file.name}" from Monday? This can't be undone.`)) {
      return;
    }
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
                onClick={() => handleDelete(f)}
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
