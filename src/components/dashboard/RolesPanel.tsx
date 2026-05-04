import { useState } from "react";
import { ROLES, USERS, type UserName, type RoleConfig } from "@/lib/config";
import type { RoleAssignments } from "@/lib/config";
import { cn } from "@/lib/utils";
import {
  UserCircle,
  ClipboardCheck,
  Send,
  CheckCircle,
  Phone,
  PhoneCall,
  FileCheck,
  Clock,
  XCircle,
  ChevronRight,
  Check,
} from "lucide-react";

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  UserCircle,
  ClipboardCheck,
  Send,
  CheckCircle,
  Phone,
  PhoneCall,
  FileCheck,
  Clock,
  XCircle,
};

interface Props {
  assignments: RoleAssignments;
  onToggle: (roleId: string, user: UserName) => void;
}

export function RolesPanel({ assignments, onToggle }: Props) {
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {ROLES.map((role) => (
        <RoleRow
          key={role.id}
          role={role}
          assigned={assignments[role.id] ?? []}
          expanded={expandedRole === role.id}
          onExpand={() =>
            setExpandedRole(expandedRole === role.id ? null : role.id)
          }
          onToggle={(user) => onToggle(role.id, user)}
        />
      ))}
    </div>
  );
}

function RoleRow({
  role,
  assigned,
  expanded,
  onExpand,
  onToggle,
}: {
  role: RoleConfig;
  assigned: UserName[];
  expanded: boolean;
  onExpand: () => void;
  onToggle: (user: UserName) => void;
}) {
  const Icon = ICON_MAP[role.icon] ?? UserCircle;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden shadow-sm">
      {/* Role header */}
      <button
        onClick={onExpand}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
      >
        <div
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center text-white shrink-0",
            role.color,
          )}
        >
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 text-left">
          <div className="font-medium text-sm text-foreground">
            {role.label}
          </div>
          <div className="text-xs text-muted-foreground">
            {assigned.length === 0
              ? "No one assigned"
              : assigned.join(", ")}
          </div>
        </div>
        {/* Assigned count badge */}
        {assigned.length > 0 && (
          <span className="text-xs font-semibold bg-primary/10 text-primary rounded-full px-2 py-0.5">
            {assigned.length}
          </span>
        )}
        <ChevronRight
          className={cn(
            "w-4 h-4 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
      </button>

      {/* User selection (expanded) */}
      {expanded && (
        <div className="border-t border-border bg-muted/30 px-4 py-2 space-y-1">
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wider">
            Assign users
          </p>
          {USERS.map((user) => {
            const isAssigned = assigned.includes(user);
            return (
              <button
                key={user}
                onClick={() => onToggle(user)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
                  isAssigned
                    ? "bg-primary/10 text-primary font-medium"
                    : "hover:bg-muted text-foreground",
                )}
              >
                <div
                  className={cn(
                    "w-5 h-5 rounded border-2 flex items-center justify-center transition-colors",
                    isAssigned
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/40",
                  )}
                >
                  {isAssigned && <Check className="w-3 h-3 text-white" />}
                </div>
                {user}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
