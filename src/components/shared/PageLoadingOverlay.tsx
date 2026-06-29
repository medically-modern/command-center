import { Loader2 } from "lucide-react";

/**
 * Full-screen blocking overlay shown while a role page loads its patients for
 * the first time (on mount / when you switch into the role). It covers the
 * whole viewport and captures pointer events, so you can't click the previous
 * role's stale list during the brief window before fresh data lands. It lifts
 * itself the moment that first fetch resolves (success OR error), so it never
 * stays stuck — and background polls don't re-raise it.
 */
export function PageLoadingOverlay({
  show,
  label = "Loading patients…",
}: {
  show: boolean;
  label?: string;
}) {
  if (!show) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background/75 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2 className="h-9 w-9 animate-spin text-[color:var(--mm-teal)]" />
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
    </div>
  );
}
