/**
 * mmKit — shared visual primitives for the June 2026 masheke redesign
 * (send-request / confirm-receipt mockup aesthetic). Pure presentation:
 * no Monday writes, no workflow logic.
 */
import { useState, useEffect } from "react";
import type { Patient } from "@/lib/masheke/workflow";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Phone,
  Trash2,
  XCircle,
} from "lucide-react";
import type { MondayFileEntry } from "@/lib/masheke/mondayApi";
import { openFileViewer } from "@/components/shared/FileViewerModal";
import { CommunicationsButton } from "@/components/comms/CommunicationsButton";
import { DialPatientDialog } from "@/components/shared/DialPatientDialog";
import { ConfirmDeleteDialog } from "@/components/shared/ConfirmDeleteDialog";
import { cn } from "@/lib/utils";
import { formatPhoneNice } from "@/lib/shared/phoneDisplay";

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
// below them while editing. Edits go to the local overlay via
// onDoctorEdit; `onSave` (the header card's Save provider) writes them
// to Monday now, and the stage's own advance still writes whatever is
// left unsaved.
// =====================================================================

export function DoctorEditGrid({
  patient,
  onDoctorEdit,
  editHint,
  onSave,
  saving = false,
  dirty = false,
}: {
  patient: Patient;
  onDoctorEdit: (patch: Partial<Patient>) => void;
  /** Describes when edits persist to Monday. */
  editHint?: string;
  /** Writes the changed fields to Monday now (the header card's Save
   *  provider). Absent → no button, the grid is overlay-only as before. */
  onSave?: () => void;
  saving?: boolean;
  /** Something was changed and not yet saved. */
  dirty?: boolean;
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
      {(editHint || onSave) && (
        <div className="sm:col-span-2 lg:col-span-3 flex items-center gap-3 flex-wrap">
          {editHint && <p className="text-xs text-muted-foreground flex-1 min-w-[200px]">{editHint}</p>}
          {onSave && (
            <Button
              type="button"
              size="sm"
              onClick={onSave}
              disabled={saving || !dirty}
              className="ml-auto gap-1.5 text-white bg-[color:var(--mm-green)] hover:bg-[oklch(0.56_0.10_175)] disabled:bg-[oklch(0.85_0.01_200)]"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {saving ? "Saving…" : "Save provider to Monday"}
            </Button>
          )}
        </div>
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
            <span className="flex-1 min-w-0 truncate text-[0.95rem] font-semibold" title={f.name}>{f.name}</span>
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

/**
 * Copy the patient's number to the clipboard.
 *
 * ⚠️ **OPT-IN, and the opt-in IS the fix** (Josh, 2026-09-18: "welcome call
 * only should have it not care cordinator"). Katie asked for this on the
 * **Welcome Call stage page** (§5.31f) — the number renders as the label of a
 * `tel:` link, so dragging across it starts a link drag rather than a
 * selection and there is nothing to copy from. It shipped 2026-09-17 inside
 * this shared component, which put it on all ten headers; Brandon then asked
 * for it off the **Care Coordinator card** (§5.30e), where it was a fourth
 * control on a crowded row, and deleting it here took it off the stage page
 * too, undoing her fix. Two different screens — §5.30's table.
 *
 * So it is a prop. `showCopy` absent ⇒ byte-identical to the row every other
 * header has had; only `welcomeCall/PatientActivityCard` passes it. A future
 * screen that wants it opts in and says so, rather than inheriting it.
 *
 * ⚠️ It copies the DIGITS **as displayed**, not `tel:`'s stripped form — a rep
 * is pasting into RingCentral, a payer portal or a note, and `+15555550100` is
 * not what any of them want back.
 *
 * ⚠️ A clipboard refusal (insecure origin, a permissions policy, an old
 * browser) SAYS SO rather than silently doing nothing: a copy button that
 * quietly fails is worse than no button, because the rep pastes whatever was
 * on the clipboard before.
 */
function CopyPhoneButton({ display }: { display: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const t = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      type="button"
      title={state === "failed" ? "Couldn't copy — select the number and copy it manually" : `Copy ${display}`}
      aria-label={`Copy ${display}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(display);
          setState("copied");
        } catch {
          setState("failed");
        }
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm font-semibold shadow-sm transition-colors",
        state === "failed"
          ? "border-rose-300 bg-rose-50 text-rose-700"
          : state === "copied"
            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
            : "border-border bg-background text-foreground hover:bg-muted",
      )}
    >
      <Copy className="h-3.5 w-3.5 shrink-0" />
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy"}
    </button>
  );
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

/**
 * The patient's number as a Call button, and the Communications button beside
 * it. Rendered in every patient header in the app.
 *
 * Josh, 2026-09-24 (CLAUDE.md §5.50):
 *  · *"the phone number throughout the command center doesnt call … it should
 *    NOT open ring central and should call directly from the app"* — so the
 *    number is a <button> that dials through the browser's ONE softphone
 *    registration (§5.13b) in a small popup (`DialPatientDialog`). It used to
 *    be an `<a href="tel:">`, which hands the call to whatever the operating
 *    system has registered — the RingCentral desktop app, or nothing at all,
 *    which is the "clicked call and nothing happened" report.
 *  · *"all of the text / calls buttons … need to be replaces with this new …
 *    button. lets call it Communications"* — the Text and Calls buttons are
 *    gone; `CommunicationsButton` opens the patient's whole back-and-forth
 *    full screen, with a composer.
 *
 * ⚠️ **A screen that owns its own attempt step passes `onCall`** (Patient
 * Intake's dial-then-log flow, the Care Coordinator card's CallPatientDialog):
 * its dialog dials instead of this one, so a page never grows two attempt
 * forms onto one write (§5.30e, §5.30h).
 *
 * ⚠️ **Both buttons carry their base look INLINE.** The Insurance pages' `.bnr`
 * and the Profile pages' `.pf-root` reset `background`, `color` and `font` on
 * every <button> beneath them, beating any single-class Tailwind utility (§9) —
 * and this row renders inside `.bnr` on Benefits / Submit Auth / Auth
 * Outstanding. An inline style is the one thing no stylesheet rule beats.
 */
export function PatientContact({
  phone, altPhone, patientName, mondayItemId, canText,
  textPrefill, textOpen, onTextOpenChange, onTextSent,
  commsTone, commsPresentation, commsPanelSide, showCopy, onCall, callLabel,
}: {
  phone?: string;
  /**
   * "panel" opens Communications as a right-hand side panel instead of the
   * full-screen pop-up.
   *
   * ⚠️ **The Care Coordinator card passes this and nothing else does** (Josh,
   * 2026-09-24: that page only). Same shape as `showCopy` below: a note about
   * one screen must not quietly change the other ten headers that render this
   * row (§5.30's two-screens rule). `commsPanelScope.test.ts` fails the build
   * if another caller picks it up.
   */
  commsPresentation?: "popup" | "panel";
  /** With the panel, which edge it docks to (default right). The Care
   *  Coordinator's Welcome Call cards dock it LEFT, over Patient Intake, so
   *  it never covers the column the rep is working in. */
  commsPanelSide?: "left" | "right";
  /**
   * The Call button's text when the number is ALREADY on screen beside it —
   * the Insurance header shows it in its DOB line, with the edit pencil — so
   * the row does not print it twice. Absent, the button IS the number, which
   * is what every other header has always rendered. The number stays in the
   * button's title either way.
   */
  callLabel?: string;
  /** The patient's other number, when the page holds one — the popup shows
   *  and can text both. */
  altPhone?: string;
  /**
   * Ring them through the page's OWN dialog instead of the dial-only one here.
   *
   * ⚠️ Only for a screen with its own attempt step — Patient Intake and the
   * Care Coordinator card. Absent (every other header), the Call button opens
   * `DialPatientDialog`, which dials and offers nothing to log.
   */
  onCall?: () => void;
  /**
   * Who the number belongs to — shown in the call popup and the
   * Communications popup's title bar (Brandon, 2026-09-17: the number alone
   * does not say who is about to be texted, and a text sent to the wrong
   * patient is not recoverable).
   */
  patientName?: string;
  /** The board record an outbound text from the popup is about (§5.28). */
  mondayItemId?: string | null;
  /** The primary line's Can Text answer, when the page reads it (§5.31d). */
  canText?: "yes" | "no" | "unknown";
  /** "green" — the Care Coordinator card's light-green button (Brandon,
   *  2026-09-14, carried over from the Text button it replaced). */
  commsTone?: "green";
  /** Render the Copy-number button after Communications.
   *
   *  ⚠️ **Welcome Call passes this and nothing else does** (Josh, 2026-09-18).
   *  See `CopyPhoneButton` above: the ask was for the Welcome Call stage page,
   *  the removal came from a note about the Care Coordinator card, and this
   *  prop is what keeps the two screens apart. `copyPhoneScope.test.ts` fails
   *  the build if another caller picks it up. */
  showCopy?: boolean;
  /** Seeds the Communications popup's composer the first time it opens — e.g.
   *  an insurance follow-up template. Never overwrites something the rep has
   *  already typed. */
  textPrefill?: string;
  /** Lets a button elsewhere on the page open the popup (Patient Intake's
   *  "Start Insurance Follow-Up"). Optional: omitted, the Communications
   *  button is the only way in. */
  textOpen?: boolean;
  onTextOpenChange?: (open: boolean) => void;
  /** Fired after a text is actually sent from the popup, with its body.
   *  Patient Intake stamps the Call Log from this; omit it and nothing is
   *  written. */
  onTextSent?: (body: string) => void;
}) {
  // ⚠️ Before the early return: hooks may not be conditional.
  const [dialOpen, setDialOpen] = useState(false);
  const tel = (phone ?? "").replace(/[^\d+]/g, "");
  if (!tel) return <span className="text-base text-muted-foreground">No phone on file</span>;
  const display = formatPhoneNice(phone);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onCall ?? (() => setDialOpen(true))}
        title={`Call ${display} from the Command Center`}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 shadow-sm transition-opacity hover:opacity-90"
        style={CALL_STYLE}
      >
        <Phone className="h-3.5 w-3.5 shrink-0" /> {callLabel || display}
      </button>
      <CommunicationsButton
        phone={phone}
        altPhone={altPhone}
        patientName={patientName}
        mondayItemId={mondayItemId}
        canText={canText}
        textPrefill={textPrefill}
        open={textOpen}
        onOpenChange={onTextOpenChange}
        onTextSent={onTextSent}
        tone={commsTone}
        presentation={commsPresentation}
        panelSide={commsPanelSide}
      />
      {showCopy && <CopyPhoneButton display={display} />}
      {/* Mounted only while open: it subscribes to the softphone, and a page of
          fifty cards must not re-render fifty dialogs every second of a call. */}
      {!onCall && dialOpen && (
        <DialPatientDialog open phone={tel} name={patientName ?? ""} onClose={() => setDialOpen(false)} />
      )}
    </span>
  );
}

/** The Call button's base look, inline for the `.bnr` / `.pf-root` reason in
 *  `PatientContact`'s header. */
const CALL_STYLE: React.CSSProperties = {
  background: "var(--mm-teal)",
  color: "var(--mm-on-teal, #fff)",
  fontSize: "0.875rem",
  lineHeight: "1.25rem",
  fontWeight: 700,
};
