/**
 * Assigned Patients — a rep's texting inbox on the MM number, narrowed to the
 * patients a manager assigned to them, with click-to-call.
 *
 * ONE page serves both the processor and the manager view, because the manager
 * view is the processor view plus an employee picker and an assign control:
 *   /assigned-patients            → the signed-in rep's own conversations
 *   /assigned-patients?rep=<email> → that rep's, for a manager
 * Managers additionally get the employee rail, the unassigned folder, and the
 * assign dialog. Processors get their queue and nothing else.
 */
import { useMemo, useState } from "react";
import { ArrowLeft, MessagesSquare, RefreshCw, UserPlus, Users } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useAccessContext } from "@/components/AccessProvider";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { useAssignedThreads } from "@/hooks/assignedPatients/useAssignedThreads";
import { markThreadRead } from "@/lib/assignedPatients/assignmentsApi";
import ConversationSidebar from "@/components/assignedPatients/ConversationSidebar";
import ConversationThread from "@/components/assignedPatients/ConversationThread";
import AssignPatientDialog from "@/components/assignedPatients/AssignPatientDialog";
import { cn } from "@/lib/utils";

export default function AssignedPatientsPage() {
  const { goBack } = useBackNavigation();
  const { access, email, config } = useAccessContext();
  const [params, setParams] = useSearchParams();
  const isManager = access.type === "manager";

  // A manager can look at anyone's queue; a processor only ever sees their own,
  // whatever the URL says.
  const viewingRep = (isManager ? params.get("rep") : "") || email;

  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignPhone, setAssignPhone] = useState<string | undefined>();

  // The gateway decides what this caller may see — including whether the
  // Unassigned folder comes back at all — so nothing here needs a manager flag.
  const { threads, unassigned, loading, error, refresh, markReadLocally } = useAssignedThreads(viewingRep);

  const reps = useMemo(
    () =>
      Object.entries(config.processors || {})
        .map(([e, p]) => ({ email: e, name: p.name || e.split("@")[0] }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [config.processors],
  );

  const repPhone = useMemo(() => {
    const key = Object.keys(config.processors || {}).find((k) => k.toLowerCase() === viewingRep.toLowerCase());
    return (key && config.processors[key]?.phoneNumber) || "";
  }, [config.processors, viewingRep]);

  const openThread = (phone: string) => {
    setSelected(phone);
    const t = threads.find((x) => x.phone === phone);
    if (t?.unread) {
      markReadLocally(phone);
      // Best-effort: a failed stamp just means the dot returns next poll.
      void markThreadRead(phone, viewingRep).catch(() => {});
    }
  };

  const activeThread = threads.find((t) => t.phone === selected) || null;
  const viewingName = reps.find((r) => r.email.toLowerCase() === viewingRep.toLowerCase())?.name || viewingRep;

  return (
    <div className="h-screen bg-gradient-subtle flex flex-col">
      <header className="bg-gradient-navy text-navy-foreground border-b border-sidebar-border shrink-0">
        <div className="px-4 sm:px-6 py-4 flex items-center gap-3">
          <button onClick={goBack} className="p-1.5 rounded-md hover:bg-white/10 transition-colors" title="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="h-9 w-9 rounded-lg bg-gradient-primary flex items-center justify-center shadow-elevate">
            <MessagesSquare className="h-5 w-5 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.2em] opacity-70">Medically Modern · RingCentral</p>
            <h1 className="text-xl font-bold truncate">
              Assigned Patients
              {isManager && viewingRep.toLowerCase() !== email.toLowerCase() && (
                <span className="text-sm font-normal opacity-80"> · {viewingName}</span>
              )}
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {isManager && (
              <button
                onClick={() => {
                  setAssignPhone(undefined);
                  setAssignOpen(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/15 px-3 py-1.5 text-sm font-medium"
              >
                <UserPlus className="h-4 w-4" /> Assign
              </button>
            )}
            <button
              onClick={() => void refresh()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/15 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="px-4 py-2 text-sm bg-destructive/10 text-destructive border-b border-destructive/20 shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {isManager && (
          <nav className="hidden md:flex w-52 shrink-0 flex-col border-r border-border bg-card min-h-0">
            <p className="px-3 pt-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
              <Users className="h-3 w-3" /> Employees
            </p>
            <div className="flex-1 overflow-y-auto min-h-0">
              {reps.map((r) => (
                <button
                  key={r.email}
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.set("rep", r.email);
                    setParams(next, { replace: true });
                    setSelected(null);
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b border-border/60",
                    r.email.toLowerCase() === viewingRep.toLowerCase() && "bg-muted font-semibold",
                  )}
                >
                  <span className="block truncate">{r.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{r.email}</span>
                </button>
              ))}
            </div>
          </nav>
        )}

        <ConversationSidebar
          threads={threads}
          unassigned={unassigned}
          selected={selected}
          onSelect={openThread}
          onAssign={
            isManager
              ? (phone) => {
                  setAssignPhone(phone);
                  setAssignOpen(true);
                }
              : undefined
          }
          loading={loading}
          search={search}
          onSearch={setSearch}
          showUnreadOnly={unreadOnly}
          onToggleUnread={setUnreadOnly}
        />

        {selected ? (
          <ConversationThread
            key={selected}
            phone={selected}
            patient={activeThread?.patient ?? null}
            repPhone={repPhone}
            rep={viewingRep}
            onSent={() => void refresh()}
          />
        ) : (
          <section className="flex-1 hidden sm:flex flex-col items-center justify-center gap-1 text-center p-8">
            <h2 className="text-lg font-semibold">Text details</h2>
            <p className="text-sm text-muted-foreground">
              Select a conversation on the left to see it in full.
            </p>
          </section>
        )}
      </div>

      <AssignPatientDialog
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        onAssigned={() => void refresh()}
        reps={reps}
        defaultRep={viewingRep}
        presetPhone={assignPhone}
      />
    </div>
  );
}
