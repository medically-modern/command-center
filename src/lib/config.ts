/* ── Role & user definitions ────────────────────────────────── */

export interface RoleConfig {
  id: string;
  label: string;
  color: string;
  icon: string;
  route: string;           // client-side route path
}

export const ROLES: RoleConfig[] = [
  // Profile Send Off split (July 2026): same board + group, THREE roles keyed
  // on Already In System, then Referral Type/Source (rule:
  // lib/profile/referralSplit.ts). "profile" kept its id (existing role
  // assignments in access.json stay valid) but now shows ONLY verified
  // referrals; Patient-type / CareCentrix-source patients moved to
  // unverifiedReferrals, and Already In System = "Yes" patients (whatever
  // their referral) moved to inSystemReferrals.
  // Relabelled "Referral Intake" (Brandon, 2026-08-19). The id stays `profile`
  // for the same reason as below — access.json role assignments key off the id,
  // never the label, so a rename is display-only.
  { id: "profile",         label: "Referral Intake",    color: "bg-blue-500",    icon: "UserCircle",     route: "/profile"          },
  // Label matches the page header. The id stays `unverifiedReferrals` so
  // existing access.json role assignments keep working — same reason `profile`
  // kept its id when it was relabelled (CLAUDE.md §5.10).
  // ⚠️ THE ID FOLLOWS THE QUEUE, NOT THE SCREEN (Josh, 2026-08-19). The DTC
  // intake stage split in two, and `unverifiedReferrals` stayed with the half
  // that kept reading the two DTC form groups — so every patient in the app
  // today stays in the same bucket with the same reps assigned, and existing
  // access.json assignments keep working. Profile Clean-Up is the NEW id
  // (`intakeCleanup`) even though it is the screen that looks like the old
  // page, because its group starts empty and an admin has to assign it.
  { id: "unverifiedReferrals", label: "Non-Referral Intake — Info Collection", color: "bg-sky-500", icon: "UserSearch",   route: "/unverified-referrals" },
  // The second sub-stage: left AND right pane, right pane already open. Its
  // queue is the Profile Clean-Up group; the Advance button on Info Collection
  // is the only way in. Rule: lib/profile/intakeSubStage.ts.
  { id: "intakeCleanup",   label: "Intake — Profile Clean-Up", color: "bg-sky-700", icon: "UserRoundCog", route: "/profile-cleanup" },
  { id: "inSystemReferrals", label: "Already In System", color: "bg-red-600",   icon: "UserRoundCheck", route: "/in-system-referrals" },
  // Scheduled Calls is the one role ordered by TIME OF DAY rather than a Next
  // Action Date: its count is "how many appointments are still ahead of you
  // today", falling by one as each start time passes. See
  // lib/scheduledCalls/workflow.ts `remainingToday` — the counting contract
  // (CLAUDE.md §5.8) points here rather than at a follow-up rule.
  { id: "scheduledCalls",  label: "Patient Intake — Scheduled Calls", color: "bg-sky-600", icon: "CalendarClock", route: "/scheduled-calls" },
  { id: "evaluate",        label: "Evaluate",           color: "bg-violet-500",  icon: "ClipboardCheck", route: "/evaluate"         },
  { id: "sendRequest",     label: "Send Request",       color: "bg-cyan-500",    icon: "Send",           route: "/send-request"     },
  { id: "confirmReceipt",  label: "Confirm Receipt",    color: "bg-emerald-500", icon: "CheckCircle",    route: "/confirm-receipt"  },
  // Chase Clinicals split into two roles (June 2026): fax (Fax/blank) and Email & Parachute
  { id: "chaseFax",        label: "Chase Clinicals — Fax",       color: "bg-amber-500",  icon: "PhoneCall", route: "/chase-fax"       },
  { id: "chaseParachute",  label: "Chase Clinicals — Email & Parachute", color: "bg-amber-600",  icon: "Send",      route: "/chase-parachute" },
  { id: "doctorAppointments", label: "Doctor Appointments", color: "bg-yellow-600", icon: "CalendarClock", route: "/doctor-appointments" },
  { id: "benefits",        label: "Benefits",           color: "bg-pink-500",    icon: "HeartPulse",     route: "/benefits"         },
  { id: "submitAuth",      label: "Submit Auth",        color: "bg-indigo-500",  icon: "FileCheck",      route: "/submit-auth"      },
  { id: "authOutstanding", label: "Auth Outstanding",   color: "bg-orange-500",  icon: "Clock",          route: "/auth-outstanding" },
  // DVS — fully-automatic Medicaid verification stage (HANDOFF-Josh-DVS v2).
  // The page is a read-only monitor; the bot does the work.
  { id: "dvs",             label: "DVS",                color: "bg-cyan-600",    icon: "Zap",            route: "/dvs"              },
  { id: "welcomeCall",    label: "Welcome Call",     color: "bg-teal-500",    icon: "Phone",          route: "/welcome-call"     },
  { id: "finalConfirm",   label: "Final Profile Confirmation", color: "bg-lime-500", icon: "ShieldCheck", route: "/final-confirm" },
  { id: "subscription",   label: "Subscription",       color: "bg-rose-500",    icon: "RefreshCw",      route: "/subscription"     },
  { id: "updateClinicals", label: "Update Clinicals",   color: "bg-fuchsia-500", icon: "FileUp",         route: "/update-clinicals" },
  // Patient Texting — look up ANY patient by name or number, read the
  // conversation, text or call them. Not a Monday stage: no board, no group and
  // no counting-contract entry, so the bar is an entry point rather than a
  // queue with a daily number. The id stays "assignedPatients" so existing
  // access.json role assignments keep working.
  { id: "assignedPatients", label: "Patient Texting",    color: "bg-emerald-600", icon: "MessagesSquare", route: "/assigned-patients" },
  { id: "authDenied",      label: "Auth Denied",        color: "bg-red-500",     icon: "XCircle",        route: "/auth-denied"      },
  { id: "patientQuestions", label: "Patient Questions", color: "bg-sky-500",     icon: "MessageCircleQuestion", route: "/patient-questions" },
  // FAX — count-only role: bar shows RingCentral unread faxes (0 → Done!).
  // No route on purpose: the card is not clickable.
  { id: "fax",             label: "FAX",                color: "bg-orange-600",  icon: "Printer",        route: ""                  },
  // systemMgmt intentionally NOT in ROLES — System Management is accessed via
  // the oversight button in the manager dashboards header, not role assignment.
];
