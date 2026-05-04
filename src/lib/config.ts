/* ── Role & user definitions ────────────────────────────────── */

export interface RoleConfig {
  id: string;
  label: string;
  color: string;          // tailwind bg class
  icon: string;           // lucide icon name
  dashboardUrl?: string;  // future: link to the role's dashboard
}

export const ROLES: RoleConfig[] = [
  { id: "profile",         label: "Profile Checklist",  color: "bg-blue-500",    icon: "UserCircle"   },
  { id: "evaluate",        label: "Evaluate",           color: "bg-violet-500",  icon: "ClipboardCheck" },
  { id: "sendRequest",     label: "Send Request",       color: "bg-cyan-500",    icon: "Send"         },
  { id: "confirmReceipt",  label: "Confirm Receipt",    color: "bg-emerald-500", icon: "CheckCircle"  },
  { id: "chaseBenefits",   label: "Chase Benefits",     color: "bg-amber-500",   icon: "PhoneCall"    },
  { id: "submitAuth",      label: "Submit Auth",        color: "bg-indigo-500",  icon: "FileCheck"    },
  { id: "authOutstanding", label: "Auth Outstanding",   color: "bg-orange-500",  icon: "Clock"        },
  { id: "authDenied",      label: "Auth Denied",        color: "bg-red-500",     icon: "XCircle"      },
];

export const USERS = [
  "Corey",
  "Brandon",
  "Josh",
  "Mesheke",
  "Samantha",
  "Janelle",
] as const;

export type UserName = (typeof USERS)[number];

/** roleId → list of assigned user names */
export type RoleAssignments = Record<string, UserName[]>;

/* ── Default assignments (edit this to change who's assigned) ── */
export const DEFAULT_ASSIGNMENTS: RoleAssignments = {
  profile:         [],
  evaluate:        [],
  sendRequest:     [],
  confirmReceipt:  [],
  chaseBenefits:   [],
  submitAuth:      [],
  authOutstanding: [],
  authDenied:      [],
};
