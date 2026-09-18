/**
 * The patient screen's Onboarding view (§5.39) — the stage stepper, the info
 * strip, and one card per board the patient has a record on.
 *
 * ⚠️ **Read-only, and the per-stage panel is a LINK rather than an embedded
 * render** (Josh, 2026-09-18). Brandon's handoff asks for each stage tool to
 * render inline in a disabled state; that needs all 13 pages split into shell +
 * body and a review mode that disables every control rather than just the
 * advance — a refactor OF the stage tools, which is out of scope. The app
 * already has the behaviour: `?completedStage=` opens the real page in review
 * mode (§5.38 · §7), so the card links there. Embedding later is a decision with
 * a known price, not a blocker now.
 */
import { ArrowUpRight, Check, CircleDashed, CircleDot, TriangleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { PathStep, PatientDossier } from "@/lib/commsHub/dossier";
import { infoFacts, stepCaption, stepOpenHref } from "@/lib/patient/patientScreen";

export function OnboardingView({ dossier }: { dossier: PatientDossier }) {
  const facts = infoFacts(dossier);

  return (
    <div className="space-y-4">
      {facts.length > 0 && (
        <section className="rounded-xl border-l-4 border-l-teal-500 bg-card p-4 shadow-sm">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
            {facts.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{f.label}</dt>
                <dd
                  className={cn(
                    "truncate text-sm font-semibold",
                    f.missing && "font-normal text-muted-foreground",
                  )}
                  title={f.value}
                >
                  {f.value}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="rounded-xl border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold">Onboarding</h2>
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {dossier.path.map((step) => (
            <StepCard key={step.board.boardId} step={step} />
          ))}
        </ol>
      </section>

      {dossier.alsoOn.length > 0 && (
        <section className="rounded-xl border bg-card p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold">Also on</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {dossier.alsoOn.map((i) => (
              <li key={`${i.boardId}:${i.itemId}`}>
                {i.boardName} — {i.groupTitle}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StepIcon({ step }: { step: PathStep }) {
  if (step.state === "completed") return <Check className="h-4 w-4 text-emerald-600" />;
  if (step.state === "active") return <CircleDot className="h-4 w-4 text-sky-600" />;
  if (step.state === "parked")
    return step.item?.isStuck ? (
      <TriangleAlert className="h-4 w-4 text-rose-600" />
    ) : (
      <CircleDot className="h-4 w-4 text-muted-foreground" />
    );
  return <CircleDashed className="h-4 w-4 text-muted-foreground/60" />;
}

function StepCard({ step }: { step: PathStep }) {
  const href = stepOpenHref(step);
  const reached = step.state !== "notReached";

  return (
    <li
      className={cn(
        "rounded-lg border p-3",
        step.state === "active" && "border-sky-300 bg-sky-50/60 dark:bg-sky-950/20",
        step.state === "notReached" && "border-dashed opacity-60",
      )}
    >
      <div className="flex items-start gap-2">
        <StepIcon step={step} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{step.board.label}</div>
          <div className="truncate text-xs text-muted-foreground">{stepCaption(step)}</div>

          {/* ⚠️ A step with no page says so rather than offering a dead link —
              §7's rule for a Search row that cannot be worked. */}
          {reached &&
            (href ? (
              <Link
                to={href}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                {step.state === "completed" ? "View (read-only)" : `Open ${step.board.short}`}
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No page for this board — check Monday.</p>
            ))}
        </div>
      </div>
    </li>
  );
}
