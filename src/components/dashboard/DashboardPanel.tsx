import { useState } from "react";
import { ROLES, USERS, type UserName, type RoleConfig } from "@/lib/config";
import type { RoleAssignments } from "@/lib/config";
import { cn } from "@/lib/utils";
import { BarChart3, ArrowLeft, ExternalLink } from "lucide-react";

interface Props {
  assignments: RoleAssignments;
  getRolesForUser: (user: UserName) => string[];
}

export function DashboardPanel({ assignments, getRolesForUser }: Props) {
  const [selectedUser, setSelectedUser] = useState<UserName | null>(null);

  if (selectedUser) {
    return (
      <UserDashboard
        user={selectedUser}
        roleIds={getRolesForUser(selectedUser)}
        onBack={() => setSelectedUser(null)}
      />
    );
  }

  return (
    <div className="space-y-2">
      {USERS.map((user) => {
        const roleIds = getRolesForUser(user);
        return (
          <button
            key={user}
            onClick={() => setSelectedUser(user)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors shadow-sm"
          >
            <div className="w-9 h-9 rounded-full bg-gradient-primary flex items-center justify-center text-white font-bold text-sm shrink-0">
              {user[0]}
            </div>
            <div className="flex-1 text-left">
              <div className="font-medium text-sm text-foreground">{user}</div>
              <div className="text-xs text-muted-foreground">
                {roleIds.length === 0
                  ? "No roles assigned"
                  : `${roleIds.length} role${roleIds.length > 1 ? "s" : ""} assigned`}
              </div>
            </div>
            {/* Mini role dots */}
            <div className="flex gap-1">
              {roleIds.map((rid) => {
                const role = ROLES.find((r) => r.id === rid);
                return (
                  <div
                    key={rid}
                    className={cn("w-2.5 h-2.5 rounded-full", role?.color ?? "bg-gray-400")}
                    title={role?.label}
                  />
                );
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* ── Per-user dashboard with bar charts ───────────────────── */

function UserDashboard({
  user,
  roleIds,
  onBack,
}: {
  user: UserName;
  roleIds: string[];
  onBack: () => void;
}) {
  const assignedRoles = ROLES.filter((r) => roleIds.includes(r.id));

  // Placeholder stats — will be wired to real data later
  const stats = assignedRoles.map((role) => ({
    role,
    pending: Math.floor(Math.random() * 20) + 1,
    completed: Math.floor(Math.random() * 40) + 5,
    total: 0,
  }));
  stats.forEach((s) => (s.total = s.pending + s.completed));
  const maxTotal = Math.max(...stats.map((s) => s.total), 1);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md hover:bg-muted transition-colors"
        >
          <ArrowLeft className="w-4 h-4 text-muted-foreground" />
        </button>
        <div className="w-8 h-8 rounded-full bg-gradient-primary flex items-center justify-center text-white font-bold text-sm">
          {user[0]}
        </div>
        <div>
          <h3 className="font-semibold text-foreground">{user}</h3>
          <p className="text-xs text-muted-foreground">
            {assignedRoles.length} role{assignedRoles.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {assignedRoles.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          No roles assigned yet.
          <br />
          Switch to the <span className="font-medium text-primary">Roles</span>{" "}
          tab to assign roles.
        </div>
      ) : (
        <div className="space-y-3">
          {stats.map(({ role, pending, completed, total }) => {
            const pct = (total / maxTotal) * 100;
            const completedPct = (completed / total) * 100;
            return (
              <button
                key={role.id}
                className="w-full text-left group"
                onClick={() => {
                  // TODO: navigate to role dashboard
                }}
                title={`${role.label} — click to open (coming soon)`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <div
                      className={cn(
                        "w-2.5 h-2.5 rounded-full shrink-0",
                        role.color,
                      )}
                    />
                    {role.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {completed}/{total}
                    <ExternalLink className="w-3 h-3 inline ml-1 opacity-0 group-hover:opacity-60 transition-opacity" />
                  </span>
                </div>
                {/* Stacked bar */}
                <div className="h-7 w-full bg-muted rounded-md overflow-hidden relative">
                  <div
                    className="h-full rounded-md flex"
                    style={{ width: `${pct}%` }}
                  >
                    <div
                      className={cn("h-full transition-all", role.color)}
                      style={{ width: `${completedPct}%` }}
                    />
                    <div
                      className={cn(
                        "h-full opacity-35 transition-all",
                        role.color,
                      )}
                      style={{ width: `${100 - completedPct}%` }}
                    />
                  </div>
                </div>
              </button>
            );
          })}

          <p className="text-[11px] text-muted-foreground mt-4 px-1">
            Solid = completed &middot; Light = pending &middot; Click a bar to
            open that role&rsquo;s dashboard (coming soon)
          </p>
        </div>
      )}
    </div>
  );
}
