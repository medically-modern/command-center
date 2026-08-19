/**
 * Profile Status badge — the one status chip every role page wears.
 *
 * The rule lives in `lib/shared/profileStatus.ts`; this file is only how it
 * looks. Colour follows the app's existing severity language: rose for the
 * escalation rungs, slate for parked work, amber for a date not yet due, and
 * emerald for a patient somebody can pick up right now.
 *
 * ⚠️ It renders NOTHING for a null status. That is deliberate and load-bearing:
 * completed items and un-escalated Auth Denied patients have no honest status
 * (see the rule's header), and a placeholder chip would read as one. Callers can
 * therefore drop `<ProfileStatusBadge>` into a header unconditionally.
 */
import { AlertTriangle, CheckCircle2, Clock, Flag, PauseCircle, XOctagon } from "lucide-react";
import { cn } from "@/lib/utils";
import { PROFILE_STATUS_LABEL, type ProfileStatus } from "@/lib/shared/profileStatus";

type IconType = typeof Clock;

const STYLES: Record<ProfileStatus, { chip: string; Icon: IconType; hint: string }> = {
  stuck: {
    chip: "bg-red-100 text-red-900 border-red-300 dark:bg-red-950 dark:text-red-100 dark:border-red-800",
    Icon: XOctagon,
    hint: "In a Stuck group — out of the pipeline until a manager moves them back.",
  },
  proposedStuck: {
    chip: "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-100 dark:border-rose-800",
    Icon: Flag,
    hint: "Final escalation — a stuck proposal awaiting a decision in Oversight's Final Decisions.",
  },
  escalated: {
    chip: "bg-orange-100 text-orange-900 border-orange-300 dark:bg-orange-950 dark:text-orange-100 dark:border-orange-800",
    Icon: AlertTriangle,
    hint: "Manager escalation — this patient is a manager's work, not the rep's.",
  },
  paused: {
    chip: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600",
    Icon: PauseCircle,
    hint: "Parked with no date that will bring them back on its own.",
  },
  waiting: {
    chip: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:border-amber-800",
    Icon: Clock,
    hint: "Snoozed — the next action date is in the future.",
  },
  active: {
    chip: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-800",
    Icon: CheckCircle2,
    hint: "In the pipeline and workable today.",
  },
};

export function ProfileStatusBadge({
  status,
  className,
  size = "md",
  showIcon = true,
}: {
  /** Null renders nothing — see the file header. */
  status: ProfileStatus | null | undefined;
  className?: string;
  /** `sm` for dense rows (sidebar), `md` for patient headers. */
  size?: "sm" | "md";
  showIcon?: boolean;
}) {
  if (!status) return null;
  const { chip, Icon, hint } = STYLES[status];
  const sm = size === "sm";
  return (
    <span
      title={`Profile Status: ${PROFILE_STATUS_LABEL[status]} — ${hint}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border font-semibold leading-none whitespace-nowrap",
        sm ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
        chip,
        className,
      )}
    >
      {showIcon && <Icon className={cn("shrink-0", sm ? "h-2.5 w-2.5" : "h-3.5 w-3.5")} aria-hidden />}
      {PROFILE_STATUS_LABEL[status]}
    </span>
  );
}
