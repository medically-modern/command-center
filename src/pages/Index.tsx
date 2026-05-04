import { useState } from "react";
import { useAssignments } from "@/lib/assignmentsStore";
import { RolesPanel } from "@/components/dashboard/RolesPanel";
import { DashboardMainView } from "@/components/dashboard/DashboardMainView";
import { cn } from "@/lib/utils";
import { Shield, LayoutDashboard, Stethoscope } from "lucide-react";
import { USERS, type UserName } from "@/lib/config";
import { useRoleCounts } from "@/hooks/useRoleCounts";

type Tab = "roles" | "dashboard";

const Index = () => {
  const [activeTab, setActiveTab] = useState<Tab>("roles");
  const [selectedUser, setSelectedUser] = useState<UserName | null>(null);
  const { assignments, toggle, getRolesForUser } = useAssignments();
  const { counts, loading: countsLoading } = useRoleCounts();

  return (
    <div className="min-h-screen bg-gradient-subtle flex">
      {/* ── Left sidebar with tabs ───────────────────────────── */}
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
          <TabButton active={activeTab === "roles"} onClick={() => setActiveTab("roles")} icon={<Shield className="w-4 h-4" />} label="Roles" />
          <TabButton active={activeTab === "dashboard"} onClick={() => setActiveTab("dashboard")} icon={<LayoutDashboard className="w-4 h-4" />} label="Dashboard" />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "roles" ? (
            <RolesPanel assignments={assignments} onToggle={toggle} />
          ) : (
            <UserList selectedUser={selectedUser} onSelect={setSelectedUser} getRolesForUser={getRolesForUser} />
          )}
        </div>
      </aside>

      {/* ── Main content area ────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {activeTab === "dashboard" ? (
          <DashboardMainView
            selectedUser={selectedUser}
            assignments={assignments}
            getRolesForUser={getRolesForUser}
            roleCounts={counts}
            countsLoading={countsLoading}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center space-y-4 max-w-md">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
                <Shield className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">Role Assignments</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Use the sidebar to assign team members to each role. Multiple people can share the same role. Switch to{" "}
                <span className="font-medium text-primary">Dashboard</span> to see workload at a glance.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

function UserList({ selectedUser, onSelect, getRolesForUser }: { selectedUser: UserName | null; onSelect: (user: UserName) => void; getRolesForUser: (user: UserName) => string[] }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Team Members</p>
      {USERS.map((user) => {
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
