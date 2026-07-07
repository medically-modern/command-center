/**
 * Full-screen blocking overlay shown while a role panel's save is in flight.
 *
 * Exists because a rep who switches patients (or re-saves) while a send is
 * still in flight can corrupt the next transaction — the July 2026 Chase
 * Clinicals incident: the in-flight save's completion cleared the panel's
 * next-action-date state after the rep had already moved to the next patient,
 * so that patient's save went out without a follow-up date and they never
 * left the due queue. This overlay holds the whole screen (sidebar included)
 * until the transaction is CONFIRMED written in Monday — gateway job done, or
 * client-path read-back verified — and warns on tab close while pending.
 */
import { useEffect } from "react";
import { Check, Loader2 } from "lucide-react";
import type { WriteProgressPhase } from "@/lib/shared/verifiedWrite";

type StepState = "done" | "active" | "todo";

function stepStates(phase: WriteProgressPhase): { server: StepState; monday: StepState } {
  switch (phase) {
    case "posting":
      return { server: "active", monday: "todo" };
    case "accepted":
      return { server: "done", monday: "active" };
    // Client fallback path — the browser writes Monday directly, so there is
    // no separate server hop to show; jump straight to the Monday step.
    case "writing":
    case "verifying":
      return { server: "done", monday: "active" };
    case "confirmed":
      return { server: "done", monday: "done" };
  }
}

function StepRow({ state, label, activeHint }: { state: StepState; label: string; activeHint?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"
        style={{
          borderColor: state === "todo" ? "var(--mm-card-border, #d8dee2)" : "var(--mm-green, #14957f)",
          background: state === "done" ? "var(--mm-green, #14957f)" : "transparent",
        }}
      >
        {state === "done" ? (
          <Check className="h-3.5 w-3.5 text-white" />
        ) : state === "active" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: "var(--mm-green, #14957f)" }} />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
        )}
      </span>
      <div className="min-w-0 text-left">
        <p className={`text-sm font-semibold ${state === "todo" ? "text-muted-foreground/60" : ""}`}>{label}</p>
        {state === "active" && activeHint && (
          <p className="text-xs text-muted-foreground">{activeHint}</p>
        )}
      </div>
    </div>
  );
}

export function SaveProgressOverlay({ open, phase }: { open: boolean; phase: WriteProgressPhase }) {
  // While a save is pending, closing/reloading the tab gets a browser warning.
  // (If the job already reached the gateway it completes server-side anyway —
  // this mainly protects the brief posting window.)
  useEffect(() => {
    if (!open) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [open]);

  if (!open) return null;

  const steps = stepStates(phase);
  const mondayHint =
    phase === "writing" ? "Writing columns…" : phase === "verifying" ? "Verifying the data landed…" : "Waiting for Monday to confirm…";

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/45 backdrop-blur-[2px]"
      role="alertdialog"
      aria-modal="true"
      aria-label="Saving to Monday"
    >
      <div className="mx-4 w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-xl" style={{ borderColor: "var(--mm-card-border, #d8dee2)" }}>
        <p className="text-base font-bold tracking-tight">Saving — please wait</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Stay on this patient until every field is confirmed in Monday.
        </p>
        <div className="mt-5 flex flex-col gap-3">
          <StepRow state={steps.server} label="Data in server" activeHint="Sending to the secure server…" />
          <StepRow state={steps.monday} label="Data in Monday" activeHint={mondayHint} />
        </div>
      </div>
    </div>
  );
}
