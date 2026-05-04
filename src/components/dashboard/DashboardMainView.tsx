import { ROLES, USERS, type UserName } from "@/lib/config";
import type { RoleAssignments } from "@/lib/config";
import { cn } from "@/lib/utils";
import { BarChart3, ExternalLink, LayoutDashboard } from "lucide-react";

interface Props {
  selectedUser: UserName | null;
  assignments: RoleAssignments;
  getRolesForUser: (user: UserName) => string[];
}

export function DashboardMainView({ selectedUser, assignments, getRolesForUser }: Props) {
  if (!selectedUser) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-4 max-w-md">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
            <LayoutDashboard className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground">Dashboard</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Select a team member from the sidebar to view their assigned roles
            and workload.
          </p>
        </div>
      </div>
    );
  }

  const roleIds = getRolesForUser(selectedUser);
  const assignedRoles = ROLES.filter((r) => roleIds.includes(r.id));

  // Placeholder stats — will be wired to real Monday data later
  // Using a seeded approach so they don't change on every render
  const stats = assignedRoles.map((role, i) => {
    const seed = selectedUser.charCodeAt(0) + role.id.length + i;
    const pending = (seed * 7 + 3) % 18 + 2;
    const completed = (seed * 13 + 5) % 35 + 8;
    const total = pending + completed;
    return { role, pending, completed, total };
  });
  const maxTotal = Math.max(...stats.map((s) => s.total), 1);

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      {/* Header bar */}
      <div className="border-b border-border bg-card px-8 py-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-gradient-primary flex items-center justify-center text-white font-bold text-lg shrink-0">
          {selectedUser[0]}
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">{selectedUser}</h2>
          <p className="text-sm text-muted-foreground">
            {assignedRoles.length === 0
              ? "No roles assigned"
              : `${assignedRoles.length} role${assignedRoles.length !== 1 ? "s" : ""} assigned`}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-8">
        {assignedRoles.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-base font-medium mb-1">No roles assigned</p>
            <p className="text-sm">
              Switch to the <span className="font-medium text-primary">Roles</span> tab
              to assign roles to {selectedUser}.
            </p>
          </div>
        ) : (
          <div className="max-w-3xl space-y-5">
            <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
              Workload by Role
            </h3>

            {stats.map(({ role, pending, completed, total }) => {
              const pct = (total / maxTotal) * 100;
              const completedPct = total > 0 ? (completed / total) * 100 : 0;
              return (
                <button
                  key={role.id}
                  className="w-full text-left group"
                  onClick={() => {
                    // TODO: navigate to role dashboard
                  }}
                  title={`${role.label} — click to open (coming soon)`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-foreground flex items-center gap-2">
                      <div
                        className={cn(
                          "w-3 h-3 rounded-full shrink-0",
                          role.color,
                        )}
                      />
                      {role.label}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {completed} / {total}
                      <ExternalLink className="w-3.5 h-3.5 inline ml-1.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                    </span>
                  </div>
                  {/* Stacked bar */}
                  <div className="h-9 w-full bg-muted rounded-lg overflow-hidden relative">
                    <div
                      className="h-full rounded-lg flex transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    >
                      <div
                        className={cn("h-full transition-all duration-500", role.color)}
                        style={{ width: `${completedPct}%` }}
                      />
                      <div
                        className={cn(
                          "h-full opacity-30 transition-all duration-500",
                          role.color,
                        )}
                        style={{ width: `${100 - completedPct}%` }}
                      />
                    </div>
                  </div>
                </button>
              );
            })}

            <div className="flex items-center gap-6 pt-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-primary" /> Completed
              </span>
              <span className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-primary/30" /> Pending
              </span>
              <span className="ml-auto">Click a bar to open that role&rsquo;s dashboard</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
