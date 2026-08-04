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
  { id: "profile",         label: "Verified Referrals", color: "bg-blue-500",    icon: "UserCircle",     route: "/profile"          },
  { id: "unverifiedReferrals", label: "Unverified Referrals", color: "bg-sky-500", icon: "UserSearch",   route: "/unverified-referrals" },
  { id: "inSystemReferrals", label: "Already In System", color: "bg-red-600",   icon: "UserRoundCheck", route: "/in-system-referrals" },
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
