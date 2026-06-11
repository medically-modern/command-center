import { useSearchParams } from "react-router-dom";
import { useAssignments } from "@/lib/assignmentsStore";
import { RolesPanel } from "@/components/dashboard/RolesPanel";
import { DashboardMainView } from "@/components/dashboard/DashboardMainView";
import { ThemePickerButton } from "@/components/ThemePicker";
import { cn } from "@/lib/utils";
import { Shield, LayoutDashboard, Stethoscope } from "lucide-react";
import { USERS, type UserName } from "@/lib/config";
import { useRoleCounts } from "@/hooks/useRoleCounts";
import { useEscalatedCounts } from "@/hooks/useEscalatedCounts";

type Tab = "roles" | "dashboard";
type ManagersSubTab = "assignments" | "dashboards";

/** Processors tab shows only the two processing roles' users. */
const PROCESSOR_USERS: UserName[] = ["Masheke", "Samantha"];

const Index = () => {
  /**
   * View state (tab / sub-tab / selected user) lives in the URL so that:
   * 1. role pages' back navigation restores the EXACT prior screen
   *    (e.g. /?tab=roles&sub=dashboards&user=Janelle), and
   * 2. a browser refresh keeps you where you were.
   * All writes use { replace: true } so clicking around the sidebar never
   * stacks history entries — "back" from a role page is always one step.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab: Tab = searchParams.get("tab") === "dashboard" ? "dashboard" : "roles";
  const managersSub: ManagersSubTab =
    searchParams.get("sub") === "dashboards" ? "dashboards" : "assignments";
  const { assignments, toggle, getRolesForUser } = useAssignments();
  const { counts, loading: countsLoading } = useRoleCounts();

  const showDashboards =
    activeTab === "dashboard" || (activeTab === "roles" && managersSub === "dashboards");
  // Managers › Dashboards = escalations-only view of each role
  const managerMode = activeTab === "roles" && managersSub === "dashboards";
  const { counts: escCounts, loading: escLoading } = useEscalatedCounts(managerMode);
  // Processors → just the processors; Managers › Dashboards → everyone else.
  const visibleUsers =
    activeTab === "dashboard"
      ? PROCESSOR_USERS
      : USERS.filter((u) => !PROCESSOR_USERS.includes(u));

  // Selected user comes from the URL; ignore names that don't belong to the
  // active tab's list (e.g. a processor name while on the Managers tab).
  const userParam = searchParams.get("user");
  const selectedUser: UserName | null =
    userParam && visibleUsers.includes(userParam as UserName)
      ? (userParam as UserName)
      : null;

  const updateView = (patch: { tab?: Tab; sub?: ManagersSubTab; user?: UserName | null }) => {
    const next = new URLSearchParams(searchParams);
    const tab = patch.tab ?? activeTab;
    next.set("tab", tab);
    if (tab === "roles") {
      next.set("sub", patch.sub ?? managersSub);
    } else {
      next.delete("sub");
    }
    const user = patch.user !== undefined ? patch.user : selectedUser;
    // Changing tabs switches user lists, so a carried-over selection never
    // applies — drop it unless this patch explicitly sets one.
    if (patch.tab && patch.tab !== activeTab && patch.user === undefined) {
      next.delete("user");
    } else if (user) {
      next.set("user", user);
    } else {
      next.delete("user");
    }
    setSearchParams(next, { replace: true });
  };

  const setActiveTab = (tab: Tab) => updateView({ tab });
  const setManagersSub = (sub: ManagersSubTab) => updateView({ sub });
  const setSelectedUser = (user: UserName) => updateView({ user });

  return (
    <div className="min-h-screen bg-gradient-subtle flex">
      {/* ── Left sidebar ─────────────────────────────────────── */}
      <aside className="w-[340px] border-r border-border bg-card flex flex-col shadow-lg shrink-0">
        <header className="bg-gradient-navy text-white px-5 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
            <Stethoscope className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">Command Center</h1>
            <p className="text-[11px] text-white/60">Medically Modern</p>
          </div>
        </header>

        <div className="flex border-b border-border">
          <TabButton active={activeTab === "roles"} onClick={() => setActiveTab("roles")} icon={<Shield className="w-4 h-4" />} label="Managers" />
          <TabButton active={activeTab === "dashboard"} onClick={() => setActiveTab("dashboard")} icon={<LayoutDashboard className="w-4 h-4" />} label="Processors" />
        </div>

        {/* Managers sub-tabs */}
        {activeTab === "roles" && (
          <div className="flex gap-1 px-4 pt-3">
            <SubTabButton
              active={managersSub === "assignments"}
              onClick={() => setManagersSub("assignments")}
              label="Role Assignments"
            />
            <SubTabButton
              active={managersSub === "dashboards"}
              onClick={() => setManagersSub("dashboards")}
              label="Dashboards"
            />
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {showDashboards && (
            <UserList
              users={visibleUsers}
              selectedUser={selectedUser}
              onSelect={setSelectedUser}
              getRolesForUser={getRolesForUser}
            />
          )}
          {activeTab === "roles" && managersSub === "assignments" && (
            <div className="text-center py-8 space-y-3">
              <div className="mx-auto w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                <Shield className="w-6 h-6 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">
                Manage role assignments in the main panel.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-border p-3">
          <ThemePickerButton />
        </div>
      </aside>

      {/* ── Main content area ────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {showDashboards ? (
          <DashboardMainView
            selectedUser={selectedUser}
            assignments={assignments}
            getRolesForUser={getRolesForUser}
            roleCounts={managerMode ? escCounts : counts}
            countsLoading={managerMode ? escLoading : countsLoading}
            managerMode={managerMode}
          />
        ) : (
          <div className="flex-1 overflow-y-auto p-8">
            <div className="max-w-3xl xl:max-w-5xl 2xl:max-w-6xl mx-auto space-y-6">
              <div>
                <h2 className="text-xl font-semibold text-foreground">Managers</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Assign team members to each role. Changes sync across all devices.
                </p>
              </div>
              <RolesPanel assignments={assignments} onToggle={toggle} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function UserList({ users, selectedUser, onSelect, getRolesForUser }: { users: UserName[]; selectedUser: UserName | null; onSelect: (user: UserName) => void; getRolesForUser: (user: UserName) => string[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Team Members</p>
      {users.map((user) => {
        const roleIds = getRolesForUser(user);
        const active = selectedUser === user;
        return (
          <button
            key={user}
            onClick={() => onSelect(user)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
              active ? "bg-primary/10 text-primary font-medium border border-primary/20" : "hover:bg-muted/50 text-foreground border border-transparent",
            )}
          >
            <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0", active ? "bg-primary" : "bg-gradient-primary")}>
              {user[0]}
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm">{user}</div>
              <div className="text-[11px] text-muted-foreground">{roleIds.length === 0 ? "No roles" : `${roleIds.length} role${roleIds.length > 1 ? "s" : ""}`}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SubTabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 py-1.5 px-2 rounded-md text-xs font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary border border-primary/20"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-transparent",
      )}
    >
      {label}
    </button>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
        active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export default Index;
