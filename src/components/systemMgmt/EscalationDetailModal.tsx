/**
 * "Details" on an Escalations-tab row — why is this patient escalated?
 *
 * Replaces the old `components/shared/EscalationDetailModal`, which rendered a
 * retired structured form out of the per-board "Escalation Notes" column. That
 * column is populated for 3 of 58 currently-escalated patients (audited against
 * the live boards 2026-08-14), so the modal told 35 of the 38 patients that
 * reached it "No escalation form data found" — while the real answer sat in the
 * stage's notes column the whole time.
 *
 * What it shows instead, in the order a manager needs it (see
 * `lib/systemMgmt/escalationDetail.ts` for where each piece comes from):
 *   1. the rung — Manager Intervention vs Final Decisions,
 *   2. the rep's Propose Stuck reason, or a note that a rule raised this,
 *   3. the manager decisions so far,
 *   4. the attempt log — which IS the explanation for an auto-escalation,
 *   5. everything else recent from the notes column,
 *   6. a legacy `[ESCALATION FORM]` block, when one exists.
 */
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle,
  Clock,
  FileText,
  Gavel,
  MessageSquare,
  Bot,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SystemPatient } from "@/lib/systemMgmt/mondayApi";
import {
  buildEscalationDetail,
  LEVEL_BADGE,
  LEVEL_LABEL,
  RECENT_NOTES_SHOWN,
  type StampKind,
} from "@/lib/systemMgmt/escalationDetail";
import { parseEscalation } from "@/lib/shared/escalation";

const STAMP_STYLE: Record<StampKind, { icon: typeof Gavel; cls: string }> = {
  propose:  { icon: AlertTriangle, cls: "text-amber-600 dark:text-amber-400" },
  approve:  { icon: Gavel,         cls: "text-red-600 dark:text-red-400" },
  escalate: { icon: AlertTriangle, cls: "text-orange-600 dark:text-orange-400" },
  return:   { icon: Undo2,         cls: "text-emerald-600 dark:text-emerald-400" },
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: SystemPatient | null;
}

export function EscalationDetailModal({ open, onOpenChange, patient }: Props) {
  const detail = buildEscalationDetail(
    patient?.escalationLevel ?? null,
    patient?.notes,
  );
  // The three patients still carrying the retired structured form. Rendered so
  // that replacing the reader loses nothing that was already written.
  const legacy = parseEscalation(patient?.escalationNotes);
  const recent = detail.recentNotes.slice(0, RECENT_NOTES_SHOWN);
  const hiddenNotes = detail.recentNotes.length - recent.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
            <span className="truncate">Escalation — {patient?.name ?? ""}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Rung + stage */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {detail.level && (
              <span className={cn("px-2 py-1 rounded font-semibold", LEVEL_BADGE[detail.level])}>
                {LEVEL_LABEL[detail.level]}
              </span>
            )}
            <span className="text-muted-foreground">
              {patient?.boardName} · {patient?.pipelineStage}
            </span>
          </div>

          {/* 1. The reason */}
          <Section icon={FileText} title="Reason">
            {detail.reason ? (
              <p className="text-sm whitespace-pre-wrap">{detail.reason}</p>
            ) : (
              <div className="flex items-start gap-2">
                <Bot className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                <p className="text-sm text-muted-foreground">
                  No rep-stated reason — raised automatically by a rule
                  {detail.attempts.length > 0
                    ? ". The attempt log below is the history behind it."
                    : " (attempt count, days outstanding, a denial, or a DVS run)."}
                </p>
              </div>
            )}
          </Section>

          {/* 2. Manager decisions */}
          {detail.timeline.length > 0 && (
            <Section icon={Gavel} title={`Decisions (${detail.timeline.length})`}>
              <div className="space-y-2">
                {detail.timeline.map((e, i) => {
                  const style = STAMP_STYLE[e.kind];
                  const Icon = style.icon;
                  return (
                    <div key={i} className="rounded-lg border bg-muted/30 p-3 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("text-xs font-semibold flex items-center gap-1.5", style.cls)}>
                          <Icon className="h-3.5 w-3.5" />
                          {e.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {[e.date, e.initials].filter(Boolean).join(" · ")}
                        </span>
                      </div>
                      {e.body && <p className="text-sm whitespace-pre-wrap">{e.body}</p>}
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* 3. Attempts */}
          {detail.attempts.length > 0 && (
            <Section icon={MessageSquare} title={`Attempts (${detail.attempts.length})`}>
              <div className="space-y-2">
                {detail.attempts.map((a, i) => (
                  <div
                    key={i}
                    className={cn(
                      "rounded-lg border p-3 space-y-1",
                      i === detail.attempts.length - 1
                        ? "bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-800"
                        : "bg-muted/30",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{a.label}</span>
                      {a.timestamp && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1 shrink-0">
                          <Clock className="h-3 w-3" />
                          {a.timestamp}
                        </span>
                      )}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">
                      {a.body || <span className="text-muted-foreground italic">No notes recorded</span>}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* 4. Recent notes */}
          {recent.length > 0 && (
            <Section icon={FileText} title="Recent notes">
              <div className="space-y-2">
                {recent.map((n, i) => (
                  <div key={i} className="rounded-lg border bg-muted/30 p-3 space-y-0.5">
                    {n.header && (
                      <div className="text-[10px] text-primary font-semibold">{n.header}</div>
                    )}
                    <p className="text-sm whitespace-pre-wrap">{n.body}</p>
                  </div>
                ))}
                {hiddenNotes > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    …and {hiddenNotes} older note{hiddenNotes !== 1 ? "s" : ""} — open the row&rsquo;s
                    notes panel from the Search tab for the full log.
                  </p>
                )}
              </div>
            </Section>
          )}

          {/* 5. Legacy structured form, for the few patients that have one */}
          {legacy && (
            <Section icon={FileText} title="Legacy escalation form">
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2 text-sm">
                <p className="text-[10px] text-muted-foreground">
                  Submitted {legacy.submittedAt}
                  {legacy.repName ? ` · ${legacy.repName}` : ""} · urgency {legacy.urgency}
                </p>
                {legacy.issueSummary && <Field label="Issue" value={legacy.issueSummary} />}
                {legacy.whatTried && <Field label="Tried" value={legacy.whatTried} />}
                {legacy.managerAsk && <Field label="Manager ask" value={legacy.managerAsk} />}
              </div>
            </Section>
          )}

          {/* Genuinely nothing on the item — distinct from "auto-escalated". */}
          {detail.empty && !legacy && (
            <p className="text-xs text-muted-foreground">
              The notes column on this item is empty, so there is no record here of why
              they were escalated. The board&rsquo;s activity log will show who set it.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Gavel;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        <Icon className="h-3 w-3" />
        {title}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <p className="whitespace-pre-wrap">{value}</p>
    </div>
  );
}
