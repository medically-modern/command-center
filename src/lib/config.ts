/* ── Role & user definitions ────────────────────────────────── */

export interface RoleConfig {
  id: string;
  label: string;
  color: string;
  icon: string;
  route: string;           // client-side route path
}

export const ROLES: RoleConfig[] = [
  { id: "profile",         label: "Profile Checklist",  color: "bg-blue-500",    icon: "UserCircle",     route: "/profile"          },
  { id: "evaluate",        label: "Evaluate",           color: "bg-violet-500",  icon: "ClipboardCheck", route: "/evaluate"         },
  { id: "sendRequest",     label: "Send Request",       color: "bg-cyan-500",    icon: "Send",           route: "/send-request"     },
  { id: "confirmReceipt",  label: "Confirm Receipt",    color: "bg-emerald-500", icon: "CheckCircle",    route: "/confirm-receipt"  },
  { id: "chaseBenefits",   label: "Chase Clinicals",     color: "bg-amber-500",   icon: "PhoneCall",      route: "/chase-benefits"   },
  { id: "benefits",        label: "Benefits",           color: "bg-pink-500",    icon: "HeartPulse",     route: "/benefits"         },
  { id: "submitAuth",      label: "Submit Auth",        color: "bg-indigo-500",  icon: "FileCheck",      route: "/submit-auth"      },
  { id: "authOutstanding", label: "Auth Outstanding",   color: "bg-orange-500",  icon: "Clock",          route: "/auth-outstanding" },
  { id: "welcomeCall",    label: "Welcome Call",     color: "bg-teal-500",    icon: "Phone",          route: "/welcome-call"     },
  { id: "finalConfirm",   label: "Final Profile Confirmation", color: "bg-lime-500", icon: "ShieldCheck", route: "/final-confirm" },
  { id: "subscription",   label: "Subscription",       color: "bg-rose-500",    icon: "RefreshCw",      route: "/subscription"     },
  { id: "authDenied",      label: "Auth Denied",        color: "bg-red-500",     icon: "XCircle",        route: "/auth-denied"      },
  { id: "systemMgmt",     label: "System Management",  color: "bg-slate-700",   icon: "Settings2",      route: "/system-mgmt"      },
];

export const USERS = [
  "Corey",
  "Brandon",
  "Josh",
  "Masheke",
  "Samantha",
  "Janelle",
] as const;

export type UserName = (typeof USERS)[number];

/** roleId → list of assigned user names */
export type RoleAssignments = Record<string, UserName[]>;

export const DEFAULT_ASSIGNMENTS: RoleAssignments = {
  profile:         [],
  evaluate:        [],
  sendRequest:     [],
  confirmReceipt:  [],
  chaseBenefits:   [],
  benefits:        [],
  submitAuth:      [],
  authOutstanding: [],
  welcomeCall:     [],
  finalConfirm:    [],
  subscription:    [],
  authDenied:      [],
  systemMgmt:      [],
};
