import { ROLES, USERS, type UserName } from "@/lib/config";
import type { RoleAssignments } from "@/lib/config";
import { cn } from "@/lib/utils";
import { BarChart3, Eye, LayoutDashboard, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { RoleCounts } from "@/hooks/useRoleCounts";
import { DailyBurndown } from "./DailyBurndown";

interface Props {
  selectedUser: UserName | null;
  assignments: RoleAssignments;
  getRolesForUser: (user: UserName) => string[];
  roleCounts: RoleCounts;
  countsLoading: boolean;
  /** Managers › Dashboards: counts/bars reflect ESCALATED patients only */
  managerMode?: boolean;
}

export function DashboardMainView({ selectedUser, assignments, getRolesForUser, roleCounts, countsLoading, managerMode = false }: Props) {
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
            {managerMode
              ? "Select a team member from the sidebar to view escalated patients in their assigned roles."
              : "Select a team member from the sidebar to view their assigned roles and workload."}
          </p>
        </div>
      </div>
    );
  }

  const roleIds = getRolesForUser(selectedUser);
  const assignedRoles = ROLES.filter((r) => roleIds.includes(r.id));

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
        {managerMode && (
          <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-red-500/10 text-red-600 border border-red-500/20 px-3 py-1 text-xs font-semibold">
            Escalated patients only
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          {countsLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          {managerMode && (
            <button
              onClick={() => navigate("/system-mgmt")}
              title="Open System Management"
              className="inline-flex items-center gap-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 text-sm font-semibold shadow-sm transition-colors"
            >
              <Eye className="w-4 h-4" />
              System Management
            </button>
          )}
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
          <div className="max-w-3xl xl:max-w-5xl 2xl:max-w-6xl">
            <DailyBurndown
              roleCounts={roleCounts}
              countsLoading={countsLoading}
              visibleRoleIds={roleIds}
              managerMode={managerMode}
            />
          </div>
        )}
      </div>
    </div>
  );
}
