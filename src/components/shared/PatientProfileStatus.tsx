/**
 * Per-board Profile Status badges — what role pages actually render.
 *
 * ── Why these wrappers exist ──
 * Twelve patient headers across eleven roles need the same badge, and each one
 * would otherwise have to remember two things: which adapter its board uses,
 * and that a page opened from a Search completion badge is reviewing finished
 * work (§7) and must show no status. Getting either wrong is silent — the badge
 * still renders, it just says the wrong thing. So both decisions live here, and
 * a header is a one-line change:
 *
 *   <MashekeProfileStatus patient={patient} />
 *
 * The board→adapter mapping below is the whole keep-in-agreement surface. Add a
 * role, and the only question is which of these five its board is.
 *
 * `lib/shared/profileStatus.ts` holds the rule; `ProfileStatusBadge` holds the
 * looks; neither knows about React Router or completed-stage review.
 */
import type { Patient as MashekePatient } from "@/lib/masheke/workflow";
import type { Patient as InsurancePatient } from "@/lib/samantha/workflow";
import type { Patient as IntakePatient } from "@/lib/profile/workflow";
import type { Patient as WelcomeCallPatient } from "@/lib/welcomeCall/workflow";
import type { Patient as FinalConfirmPatient } from "@/lib/finalConfirm/workflow";
import type { Patient as SubscriptionPatient } from "@/lib/subscription/workflow";
import {
  insuranceProfileStatus,
  intakeProfileStatus,
  mashekeProfileStatus,
  subscriptionProfileStatus,
  welcomeCallProfileStatus,
} from "@/lib/shared/profileStatus";
import { useCompletedStageReview } from "@/components/shared/CompletedStageBanner";
import { ProfileStatusBadge } from "@/components/shared/ProfileStatusBadge";

type Size = "sm" | "md";

/**
 * Is this page reviewing a finished stage rather than live work?
 *
 * The group id normally answers this on its own — a completed item sits in its
 * board's Completed group. This covers the gap where it hasn't moved yet, and
 * costs one URL read.
 */
function useReviewing(patientId?: string | null): boolean {
  return !!useCompletedStageReview(patientId);
}

/** Medical Evaluation — Evaluate · Send Request · Confirm Receipt · both Chase roles · Doctor Appointments. */
export function MashekeProfileStatus({
  patient,
  size = "md",
  className,
}: { patient: MashekePatient; size?: Size; className?: string }) {
  const completed = useReviewing(patient.id);
  return (
    <ProfileStatusBadge
      status={mashekeProfileStatus(patient, { completed })}
      size={size}
      className={className}
    />
  );
}

/** Insurance — Benefits · Submit Auth · Auth Outstanding · DVS. */
export function InsuranceProfileStatus({
  patient,
  size = "md",
  className,
}: { patient: InsurancePatient; size?: Size; className?: string }) {
  const completed = useReviewing(patient.id);
  return (
    <ProfileStatusBadge
      status={insuranceProfileStatus(patient, { completed })}
      size={size}
      className={className}
    />
  );
}

/**
 * Profile Send Off — Verified Referrals · Patient Intake · Already In System ·
 * Scheduled Calls.
 *
 * ⚠️ `ignoreFollowUp` must be set on the **Patient Intake** queue, and only
 * there — that queue's Follow Up pair is a one-way door nothing reads (§5.10),
 * so honouring it would report Paused for a patient sitting in everyone's
 * sidebar. It mirrors the flag the page already passes to `sidebarSections`.
 */
export function IntakeProfileStatus({
  patient,
  ignoreFollowUp = false,
  size = "md",
  className,
}: { patient: IntakePatient; ignoreFollowUp?: boolean; size?: Size; className?: string }) {
  const completed = useReviewing(patient.id);
  return (
    <ProfileStatusBadge
      status={intakeProfileStatus(patient, { completed, ignoreFollowUp })}
      size={size}
      className={className}
    />
  );
}

/** Welcome Call board — Welcome Call · Final Profile Confirmation. */
export function WelcomeCallProfileStatus({
  patient,
  size = "md",
  className,
}: {
  patient: WelcomeCallPatient | FinalConfirmPatient;
  size?: Size;
  className?: string;
}) {
  const completed = useReviewing(patient.id);
  return (
    <ProfileStatusBadge
      status={welcomeCallProfileStatus(patient, { completed })}
      size={size}
      className={className}
    />
  );
}

/** Subscription board. */
export function SubscriptionProfileStatus({
  patient,
  size = "md",
  className,
}: { patient: SubscriptionPatient; size?: Size; className?: string }) {
  const completed = useReviewing(patient.id);
  return (
    <ProfileStatusBadge
      status={subscriptionProfileStatus(patient, { completed })}
      size={size}
      className={className}
    />
  );
}
