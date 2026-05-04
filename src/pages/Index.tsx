import { useState } from "react";
import { useAssignments } from "@/lib/assignmentsStore";
import { RolesPanel } from "@/components/dashboard/RolesPanel";
import { DashboardPanel } from "@/components/dashboard/DashboardPanel";
import { cn } from "@/lib/utils";
import { Shield, LayoutDashboard, Stethoscope } from "lucide-react";

type Tab = "roles" | "dashboard";

const Index = () => {
  const [activeTab, setActiveTab] = useState<Tab>("roles");
  const { assignments, toggle, getRolesForUser } = useAssignments();

  return (
    <div className="min-h-screen bg-gradient-subtle flex">
      {/* ── Main content area (left, stretches) ──────────────── */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <header className="bg-gradient-navy text-white px-6 py-4 flex items-center gap-3 shadow-md">
          <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
            <Stethoscope className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Command Center</h1>
            <p className="text-xs text-white/60">Medically Modern</p>
          </div>
        </header>

        {/* Center placeholder — will hold embedded dashboards later */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="text-center space-y-4 max-w-md">
            <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <LayoutDashboard className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">
              Welcome to Command Center
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Assign team members to roles using the{" "}
              <span className="font-medium text-primary">Roles</span> tab, then
              switch to{" "}
              <span className="font-medium text-primary">Dashboard</span> to
              see each person&rsquo;s workload at a glance.
            </p>
          </div>
        </div>
      </div>

      {/* ── Right sidebar with tabs ──────────────────────────── */}
      <aside className="w-[380px] border-l border-border bg-card flex flex-col shadow-lg">
        {/* Tab bar */}
        <div className="flex border-b border-border">
          <TabButton
            active={activeTab === "roles"}
            onClick={() => setActiveTab("roles")}
            icon={<Shield className="w-4 h-4" />}
            label="Roles"
          />
          <TabButton
            active={activeTab === "dashboard"}
            onClick={() => setActiveTab("dashboard")}
            icon={<LayoutDashboard className="w-4 h-4" />}
            label="Dashboard"
          />
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-4">
          {activeTab === "roles" ? (
            <RolesPanel assignments={assignments} onToggle={toggle} />
          ) : (
            <DashboardPanel
              assignments={assignments}
              getRolesForUser={getRolesForUser}
            />
          )}
        </div>
      </aside>
    </div>
  );
};

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export default Index;
