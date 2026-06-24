import { ROLES } from "@/lib/config";
import type { Person } from "@/lib/people";
import { BarChart3, Eye, LayoutDashboard, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { DailyBurndown } from "./DailyBurndown";
import { useFilteredRoleCounts } from "@/hooks/useFilteredRoleCounts";
import { orderedRoleIds } from "@/lib/roleView";

interface Props {
  person: Person | null;
}

/**
 * Manager's view of one processor's workload. Bars reflect that processor's
 * per-role filter (all / non-escalated / escalated) and SOP order — the same
 * thing the processor sees. System Management lives in the upper-right.
 */
export function DashboardMainView({ person }: Props) {
  const navigate = useNavigate();
  // Hooks run unconditionally (before the no-person early return).
  const { counts, loading } = useFilteredRoleCounts(person?.profile);
  const order = orderedRoleIds(person?.profile);

  const SysMgmtButton = (
    <button
      onClick={() => navigate("/system-mgmt")}
      title="Open System Management"
      className="inline-flex items-center gap-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 text-sm font-semibold shadow-sm transition-colors"
    >
      <Eye className="w-4 h-4" />
      System Management
    </button>
  );

  if (!person) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="border-b border-border bg-card px-8 py-4 flex items-center justify-end">
          {SysMgmtButton}
        </div>
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-4 max-w-md">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <LayoutDashboard className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">Dashboard</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Select a team member from the sidebar to view their assigned roles and workload.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const roleIds = person.roleIds;
  const assignedRoles = ROLES.filter((r) => roleIds.includes(r.id));

  return (
    <div className="flex-1 flex flex-col overflow-y-auto">
      {/* Header bar */}
      <div className="border-b border-border bg-card px-8 py-5 flex items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-gradient-primary flex items-center justify-center text-white font-bold text-lg shrink-0">
          {person.name[0]}
        </div>
        <div>
          <h2 className="text-lg font-semibold text-foreground">{person.name}</h2>
          <p className="text-sm text-muted-foreground">
            {person.isManager
              ? assignedRoles.length === 0
                ? "Manager — full access"
                : `Manager + ${assignedRoles.length} role${assignedRoles.length !== 1 ? "s" : ""}`
              : assignedRoles.length === 0
                ? "No roles assigned"
                : `${assignedRoles.length} role${assignedRoles.length !== 1 ? "s" : ""} assigned`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
          {SysMgmtButton}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-8">
        {assignedRoles.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-30" />
            <p className="text-base font-medium mb-1">No roles assigned</p>
            <p className="text-sm">
              Use <span className="font-medium text-primary">Manage Access</span> to
              choose which queues {person.name} sees.
            </p>
          </div>
        ) : (
          <div className="max-w-3xl xl:max-w-5xl 2xl:max-w-6xl">
            <DailyBurndown
              roleCounts={counts}
              countsLoading={loading}
              visibleRoleIds={roleIds}
              order={order}
              roleFilters={person.profile?.roleFilters}
            />
          </div>
        )}
      </div>
    </div>
  );
}
