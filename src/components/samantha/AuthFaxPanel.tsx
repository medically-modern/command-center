import { useMemo, useState } from "react";
import type { Patient } from "@/lib/samantha/workflow";
import { EMPTY_INSURANCE } from "@/lib/samantha/workflow";
import { productCodeId, submitAuthCards } from "@/lib/samantha/submitAuthRules";
import { AddressChipsInput } from "@/components/shared/AddressChipsInput";
import { sendViaWorker, SendValidationError } from "@/lib/shared/sendViaWorker";
import { buildAuthFaxSubject, buildAuthFaxBody } from "@/lib/samantha/authFaxTemplate";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, FileText, Loader2, Send, Upload, X } from "lucide-react";
import { toast } from "sonner";

/**
 * AuthFaxPanel — the Submit-Auth "Fax to Payer" tab. Shown only when at least
 * one product's Auth Submission Method is Fax (SubmitAuthPage gates it).
 * Composes + transmits a prior-authorization fax to the payer through the
 * shared sendViaWorker transport (bare number → <digits>@rcfax.com →
 * RingCentral), the same path Send Request uses.
 *
 * Deliberately SEND-ONLY (Josh, 2026-07): it does NOT write to Monday or
 * advance the stage — the rep still records the submission + advances via the
 * Authorizations tab's Submit. So there is no verified write here.
 */
export function AuthFaxPanel({ patient }: { patient: Patient }) {
  const ins = patient.insurance ?? EMPTY_INSURANCE;

  // Products the rep marked as Fax — these drive the prefill + template.
  const faxProducts = useMemo(
    () =>
      submitAuthCards(patient).filter(
        (r) => ins.codes[productCodeId(r.product)]?.authSubmissionMethod === "Fax",
      ),
    [patient, ins],
  );

  // Prefill the fax number from the number the rep already entered on a Fax card.
  const prefillFax = useMemo(
    () =>
      faxProducts
        .map((r) => ins.codes[productCodeId(r.product)]?.callFaxNumber)
        .find((v) => (v ?? "").trim()) ?? "",
    [faxProducts, ins],
  );

  const [recipients, setRecipients] = useState<string[]>(prefillFax ? [prefillFax] : []);
  const [recipInput, setRecipInput] = useState("");
  const [cc, setCc] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState("");
  const [subject, setSubject] = useState(() => buildAuthFaxSubject(patient));
  const generatedBody = useMemo(() => buildAuthFaxBody(patient, faxProducts), [patient, faxProducts]);
  const [draft, setDraft] = useState<string | null>(null);
  const body = draft ?? generatedBody;
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const [showNoFile, setShowNoFile] = useState(false);

  const doSend = async () => {
    // Include still-typed (uncommitted) text in either address box.
    const withPending = (list: string[], pending: string) =>
      pending.trim() ? [...list, pending.trim()] : list;
    setSending(true);
    try {
      const result = await sendViaWorker({
        recipients: withPending(recipients, recipInput),
        cc: withPending(cc, ccInput),
        subject,
        body,
        files,
      });
      const count = (result.results ?? []).length;
      toast.success(`Auth fax sent${count ? ` (${count} recipient${count > 1 ? "s" : ""})` : ""}`, {
        description: "Record the submission and advance from the Authorizations tab.",
      });
    } catch (e) {
      if (e instanceof SendValidationError) {
        toast.error(e.message);
      } else {
        toast.error("Fax failed to send", {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      setSending(false);
    }
  };

  // Almost every auth fax should carry the script + clinicals — a missing
  // attachment pops a confirmation modal instead of an easy-to-miss note.
  const trySend = () => {
    if (files.length === 0) {
      setShowNoFile(true);
      return;
    }
    void doSend();
  };

  return (
    <section className="card step-card">
      <header className="step-head">
        <span className="step-num">
          <Send className="h-4 w-4" />
        </span>
        <h2>Fax to Payer</h2>
      </header>
      <p className="step-sub">
        Send the prior-authorization request by fax to {patient.primaryInsurance || "the payer"}
        {faxProducts.length ? ` for ${faxProducts.map((r) => r.hcpc).join(", ")}` : ""}. This only
        sends the fax — record the submission and advance from the Authorizations tab.
      </p>

      <div className="rounded-2xl border border-input p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">To</p>
            {/* A bare number is sent as <number>@rcfax.com (→ fax); an email is
                sent as an email. Prefilled from the Fax Number the rep entered. */}
            <AddressChipsInput
              values={recipients}
              setValues={setRecipients}
              input={recipInput}
              setInput={setRecipInput}
              placeholder="Fax number or email"
            />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Cc</p>
            <AddressChipsInput
              values={cc}
              setValues={setCc}
              input={ccInput}
              setInput={setCcInput}
              placeholder="Cc email (optional)"
            />
          </div>
          <div className="sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Subject</p>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full rounded-xl border border-input p-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Request template — auto-filled, edit before sending
          </p>
          <textarea
            value={body}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
            className="w-full rounded-xl border border-input p-4 text-sm leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
            Attachments — sent with the fax
          </p>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const dropped = Array.from(e.dataTransfer?.files ?? []);
              if (dropped.length) setFiles((prev) => [...prev, ...dropped]);
            }}
            className={`flex items-center gap-2 cursor-pointer rounded-xl border border-dashed border-input p-4 text-sm transition-colors ${
              dragOver ? "text-foreground bg-emerald-50 dark:bg-emerald-950/30" : "text-muted-foreground hover:bg-muted/30"
            }`}
          >
            <Upload className="h-4 w-4 shrink-0" />
            <span>{dragOver ? "Drop files to attach" : "Click to add files or drag & drop"}</span>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
            />
          </label>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li
                  key={`${f.name}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-input px-3 py-2 text-sm"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{f.name}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    className="hover:opacity-70"
                    aria-label={`Remove ${f.name}`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {files.length === 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          No attachment added yet — most auth requests should include the signed script + clinicals.
        </div>
      )}

      <div className="mt-4 flex items-center justify-end gap-3 border-t pt-4">
        <Button
          onClick={trySend}
          disabled={sending}
          className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm"
        >
          {sending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Sending…
            </>
          ) : (
            <>
              <Send className="h-4 w-4" /> Send fax
            </>
          )}
        </Button>
      </div>

      {/* No-attachment confirmation — a clear modal instead of an easy-to-miss banner */}
      <Dialog open={showNoFile} onOpenChange={setShowNoFile}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Send without an attachment?
            </DialogTitle>
            <DialogDescription>
              No file is attached. Most auth requests should include the signed script and supporting
              clinicals. Send it anyway?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setShowNoFile(false)}>
              Go back &amp; attach
            </Button>
            <Button
              onClick={() => {
                setShowNoFile(false);
                void doSend();
              }}
              className="gap-2 text-white bg-amber-600 hover:bg-amber-700"
            >
              <Send className="h-4 w-4" /> Send without attachment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
