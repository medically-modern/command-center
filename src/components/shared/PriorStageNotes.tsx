import type { ReactNode } from "react";

/** One earlier-stage notes block carried into a later stage's notes section. */
export interface PriorStage {
  /** Stage label, e.g. "Profile Send-Off Notes". */
  label: string;
  /** The stage's notes text (may be empty/undefined — empty stages are skipped). */
  text?: string | null;
  /** Optional custom body renderer (e.g. the masheke attempt-note bolding). */
  render?: (text: string) => ReactNode;
}

/**
 * Read-only notes carried forward from earlier pipeline stages, rendered
 * inline ABOVE the current stage's editable notes (oldest stage first — e.g.
 * Profile Send-Off, then MN Workflow). Each block is muted + labeled so it
 * reads as history, not something the rep edits here, and bounds its own
 * height so a long upstream note can't blow out the notes rail. Renders
 * nothing when no stage has any text.
 */
export function PriorStageNotes({ stages, className }: { stages: PriorStage[]; className?: string }) {
  const present = stages.filter((s) => s.text && s.text.trim());
  if (present.length === 0) return null;
  return (
    <div className={`space-y-2${className ? ` ${className}` : ""}`}>
      {present.map((s) => (
        <div key={s.label} className="rounded-md border border-dashed border-border bg-muted/40">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold px-3 pt-2 pb-1">
            {s.label} <span className="normal-case font-normal opacity-70">· read-only</span>
          </p>
          <div className="text-sm whitespace-pre-wrap leading-relaxed text-foreground/75 px-3 pb-2 max-h-40 overflow-y-auto">
            {s.render ? s.render(s.text!) : s.text}
          </div>
        </div>
      ))}
    </div>
  );
}
