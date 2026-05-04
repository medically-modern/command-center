import { ROLES, USERS, type UserName } from "@/lib/config";
import type { RoleAssignments } from "@/lib/config";
import { cn } from "@/lib/utils";
import { BarChart3, ExternalLink, LayoutDashboard, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { RoleCounts } from "@/hooks/useRoleCounts";

interface Props {
  selectedUser: UserName | null;
  assignments: RoleAssignments;
  getRolesForUser: (user: UserName) => string[];
  roleCounts: RoleCounts;
  countsLoading: boolean;
}

export function DashboardMainView({ selectedUser, assignments, getRolesForUser, roleCounts, countsLoading }: Props) {
  const navigate = useNavigate();

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
  const maxCount = Math.max(...assignedRoles.map((r) => roleCounts[r.id] ?? 0), 1);

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
        {countsLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />}
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
              Patients by Role
            </h3>

            {assignedRoles.map((role) => {
              const count = roleCounts[role.id] ?? 0;
              const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
              const hasRoute = role.route && role.id !== "profile" && role.id !== "authDenied";

              return (
                <button
                  key={role.id}
                  className={cn("w-full text-left group", hasRoute ? "cursor-pointer" : "cursor-default")}
                  onClick={() => {
                    if (hasRoute) navigate(role.route);
                  }}
                  title={hasRoute ? `Open ${role.label}` : `${role.label} (coming soon)`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-foreground flex items-center gap-2">
                      <div className={cn("w-3 h-3 rounded-full shrink-0", role.color)} />
                      {role.label}
                    </span>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {countsLoading ? "…" : count} patient{count !== 1 ? "s" : ""}
                      {hasRoute && (
                        <ExternalLink className="w-3.5 h-3.5 inline ml-1.5 opacity-0 group-hover:opacity-60 transition-opacity" />
                      )}
                    </span>
                  </div>
                  <div className="h-9 w-full bg-muted rounded-lg overflow-hidden relative">
                    <div
                      className={cn("h-full rounded-lg transition-all duration-500", role.color)}
                      style={{ width: `${Math.max(pct, count > 0 ? 4 : 0)}%` }}
                    />
                  </div>
                </button>
              );
            })}

            <div className="flex items-center gap-6 pt-4 text-xs text-muted-foreground">
              <span>Bar width = patient count in that stage</span>
              <span className="ml-auto">Click a bar to open that role&rsquo;s dashboard</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
