import { useSearchParams, useNavigate } from "react-router-dom";
import { useAccessContext } from "@/components/AccessProvider";
import ProcessorView from "@/pages/ProcessorView";
import { DashboardMainView } from "@/components/dashboard/DashboardMainView";
import { ThemePickerButton } from "@/components/ThemePicker";
import { cn } from "@/lib/utils";
import { Shield, LayoutDashboard, Stethoscope, KeyRound } from "lucide-react";
import { processorPeople, type Person } from "@/lib/people";

const Index = () => {
  /**
   * Manager landing. The roster lists processors (including dual
   * manager+processors); selecting one shows their assigned-role workload with
   * that person's per-role filters + SOP order. "Managers" opens the
   * full-screen Oversight grid (/oversight). Managers themselves are configured
   * on the Manage Access page, not listed here.
   *
   * The selected-person key (email local part) lives in the URL so role pages'
   * back navigation restores the exact prior screen.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { access, email, config } = useAccessContext();

  const visiblePeople = processorPeople(config);

  const userParam = searchParams.get("user");
  const selectedPerson: Person | null =
    (userParam && visiblePeople.find((p) => p.key === userParam)) || null;

  const setSelectedKey = (key: string) => {
    const next = new URLSearchParams(searchParams);
    if (key) next.set("user", key);
    else next.delete("user");
    setSearchParams(next, { replace: true });
  };

  // Processors get a stripped, no-sidebar view of only their assigned bars.
  if (access.type === "processor") {
    return <ProcessorView profile={access.profile} email={email} />;
  }

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
          {/* "Managers" opens the full-screen Oversight grid. */}
          <TabButton active={false} onClick={() => navigate("/oversight")} icon={<Shield className="w-4 h-4" />} label="Managers" />
          <TabButton active onClick={() => {}} icon={<LayoutDashboard className="w-4 h-4" />} label="Processors" />
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <UserList
            people={visiblePeople}
            selectedKey={selectedPerson?.key ?? null}
            onSelect={setSelectedKey}
            emptyLabel="No processors yet."
          />
        </div>

        <div className="border-t border-border p-3 space-y-2">
          <button
            onClick={() => navigate("/access")}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            title="Add people and choose which role bars each one sees"
          >
            <KeyRound className="w-4 h-4" /> Manage Access
          </button>
          <ThemePickerButton />
        </div>
      </aside>

      {/* ── Main content area ────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        <DashboardMainView person={selectedPerson} />
      </div>
    </div>
  );
};

function UserList({ people, selectedKey, onSelect, emptyLabel }: { people: Person[]; selectedKey: string | null; onSelect: (key: string) => void; emptyLabel: string }) {
  if (people.length === 0) {
    return <p className="text-sm text-muted-foreground px-1 py-2">{emptyLabel}</p>;
  }
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Team Members</p>
      {people.map((person) => {
        const active = selectedKey === person.key;
        const n = person.roleIds.length;
        const roleNote = person.isManager
          ? n > 0
            ? `Manager · ${n} role${n > 1 ? "s" : ""}`
            : "Full access"
          : n === 0
            ? "No roles"
            : `${n} role${n > 1 ? "s" : ""}`;
        return (
          <button
            key={person.key}
            onClick={() => onSelect(person.key)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors",
              active ? "bg-primary/10 text-primary font-medium border border-primary/20" : "hover:bg-muted/50 text-foreground border border-transparent",
            )}
          >
            <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-xs shrink-0", active ? "bg-primary" : "bg-gradient-primary")}>
              {person.name[0]}
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm flex items-center gap-1.5">
                {person.name}
                {person.isManager && <Shield className="w-3 h-3 text-amber-500" aria-label="Also a manager" />}
              </div>
              <div className="text-[11px] text-muted-foreground">{roleNote}</div>
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
