import { useSearchParams, useNavigate } from "react-router-dom";
import { useAccessContext } from "@/components/AccessProvider";
import ProcessorView from "@/pages/ProcessorView";
import { DashboardMainView } from "@/components/dashboard/DashboardMainView";
import { ThemePickerButton } from "@/components/ThemePicker";
import { cn } from "@/lib/utils";
import { Shield, LayoutDashboard, Stethoscope, KeyRound, ArrowLeft } from "lucide-react";
import { processorPeople, type Person } from "@/lib/people";
import CallConnectionBadge from "@/components/inboundCalls/CallConnectionBadge";
import { useShellLayout } from "@/hooks/shell/useShellLayout";
import { hasAbility } from "@/lib/shell/abilities";
import { TeamGrid } from "@/components/shell/TeamGrid";

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
  const [layout] = useShellLayout();

  /**
   * ⚠️⚠️ **THE ROSTER SIDEBAR COMES OFF FOR WHOEVER HAS THE THING THAT REPLACES
   * IT** (Josh, 2026-09-18: "remove the managers processors view on the left
   * side bar (we have per patient views set up right?)").
   *
   * The replacement is the redesign shell's "Viewing: <person>" dropdown
   * (§5.39c), which shows a person's home screen properly rather than their
   * bars in a pane. So the condition is BOTH — the shell is on, and this person
   * holds `viewOthers`:
   *
   *   · `layout === "current"` keeps the sidebar, so the escape hatch stays a
   *     real escape hatch (§5.39b) and turning the shell off restores today's
   *     screen exactly;
   *   · `viewOthers` is opt-in and granted to two people, so removing the
   *     roster for every manager would take the only way Corey, Janelle and
   *     Katie have of looking at somebody's workload and give them nothing
   *     back. Nobody loses a capability they were not handed a better one for.
   *
   * ⚠️ To take it off the other managers too, grant them `viewOthers` on
   * `/access` — do NOT widen this condition, or they are stranded.
   */
  const rosterReplaced = layout === "redesign" && hasAbility(email, config, "viewOthers");

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

  if (rosterReplaced) {
    return (
      <div className="min-h-screen bg-gradient-subtle flex">
        <div className="flex-1 flex flex-col min-w-0">
          {/* ⚠️⚠️ **WITHOUT `TeamGrid` THIS BRANCH IS A BLANK SCREEN.** It used
              to render `DashboardMainView person={null}` whenever nobody was
              selected — an empty card reading "Pick somebody in Viewing, up in
              the top bar", which is a manager's ENTIRE home page and which
              offers no way to see anything of their own. Removing the 340px
              roster rail was the ask; removing the roster was not, and the list
              is the whole content of this screen. It moves into the space the
              rail freed (§ TeamGrid's header). */}
          {selectedPerson ? (
            <>
              <div className="border-b border-border bg-card px-8 pt-3">
                <button
                  onClick={() => setSelectedKey("")}
                  className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Team
                </button>
              </div>
              <DashboardMainView person={selectedPerson} />
            </>
          ) : (
            <TeamGrid people={visiblePeople} onSelect={setSelectedKey} />
          )}
        </div>
        {/* ⚠️ THE THEME BUTTON IS ALSO SIGN-OUT, and the sidebar was the only
            place it lived on this screen — dropping the sidebar without it
            would leave a manager with no way to sign out at all. Same fixed
            bottom-left spot `ProcessorView` already uses, so the two home
            screens agree about where it is. */}
        <div className="fixed bottom-4 left-4 z-40">
          <ThemePickerButton />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-subtle flex">
      {/* ── Left sidebar ─────────────────────────────────────── */}
      <aside className="w-[340px] border-r border-border bg-card flex flex-col shadow-lg shrink-0">
        <header className="bg-gradient-navy text-white px-5 py-4 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
            <Stethoscope className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            {/* ⚠️ `data-cc-brand` is a hook for the redesign shell ONLY (§5.39):
                inside it the global header already carries the wordmark, so this
                one is hidden to stop two "Command Center" blocks stacking. The
                call badge below is NOT hidden — it is the softphone status and
                the global header has no equivalent. With the shell off nothing
                reads this attribute and the sidebar renders exactly as before. */}
            <div data-cc-brand>
              <h1 className="text-base font-bold tracking-tight">Command Center</h1>
              <p className="text-[11px] text-white/60">Medically Modern</p>
            </div>
            {/* Renders only for assigned call answerers (§5.13b). */}
            <CallConnectionBadge className="mt-1.5 max-w-full" />
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
