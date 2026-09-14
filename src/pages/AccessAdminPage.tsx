import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAccessContext } from "@/components/AccessProvider";
import { ROLES } from "@/lib/config";
import { MAX_CALL_ANSWERERS, type RoleFilter } from "@/lib/accessStore";
import { roleFilterFor, roleOrderNumber } from "@/lib/roleView";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowLeft, Headphones, Shield, UserCog, X, Plus } from "lucide-react";

/** Managers-only UI. Every person can be a Manager (full access), a Processor
 *  (only their checked bars), or BOTH. Each assigned role carries a filter
 *  (All / Non-escalated / Escalated) and an optional SOP order number. */
const FILTER_OPTS: { value: RoleFilter; label: string }[] = [
  { value: "nonEscalated", label: "Non-escalated" },
  { value: "all", label: "All" },
  { value: "escalated", label: "Escalated" },
];

export default function AccessAdminPage() {
  const navigate = useNavigate();
  const {
    access,
    email: me,
    config,
    addManager,
    setManager,
    removeEmail,
    addProcessor,
    setProcessorName,
    setProcessorPhone,
    toggleProcessorRole,
    setRoleFilter,
    setRoleOrder,
    setCallAnswerer,
  } = useAccessContext();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  // Self-lockout guard: whoever is managing access is made an explicit manager
  // on open, so adding others (or a wrong first manager) can never lock them out.
  useEffect(() => {
    if (
      access.type === "manager" &&
      me &&
      !config.managers.some((m) => m.trim().toLowerCase() === me.trim().toLowerCase())
    ) {
      addManager(me);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (access.type !== "manager") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-subtle p-8">
        <div className="text-center space-y-3">
          <p className="text-sm text-muted-foreground">Managers only.</p>
          <button onClick={() => navigate("/")} className="text-sm text-primary underline">Back to home</button>
        </div>
      </div>
    );
  }

  const norm = (e: string) => e.trim().toLowerCase();

  // Unified people list: union of managers[] and processors{}.
  const allEmails = Array.from(
    new Set([...config.managers.map(norm), ...Object.keys(config.processors).map(norm)]),
  ).sort();

  const answerers = (config.callAnswerers || []).map(norm);

  const onAddManager = () => {
    if (!norm(email)) return;
    addManager(email);
    setEmail("");
    setName("");
  };
  const onAddProcessor = () => {
    if (!norm(email)) return;
    addProcessor(email, name || email.split("@")[0]);
    setEmail("");
    setName("");
  };

  return (
    <div className="min-h-screen bg-gradient-subtle">
      <header className="bg-card border-b border-border px-6 py-4 flex items-center gap-3">
        <button onClick={() => navigate("/")} className="p-2 rounded-lg hover:bg-muted/50" title="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-lg font-semibold text-foreground">Access Management</h1>
          <p className="text-xs text-muted-foreground">
            Managers see everything. Processors see their checked bars — each with a filter and order. Changes sync across devices.
          </p>
        </div>
      </header>

      <main className="max-w-5xl xl:max-w-7xl mx-auto p-6 space-y-8">
        {/* Add a person */}
        <section className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Plus className="w-4 h-4" /> Add a person
          </h2>
          <div className="flex flex-wrap gap-2">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@medicallymodern.com"
              className="flex-1 min-w-[220px] rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name (optional)"
              className="w-44 rounded-lg border border-border bg-background px-3 py-2 text-sm"
            />
            <button onClick={onAddManager} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700 text-white px-3 py-2 text-sm font-medium hover:bg-slate-600">
              <Shield className="w-4 h-4" /> Add as Manager
            </button>
            <button onClick={onAddProcessor} className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:opacity-90">
              <UserCog className="w-4 h-4" /> Add as Processor
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            A person can be both — toggle <b>Manager</b> on their card and still assign them processor roles.
          </p>
        </section>

        {/* Browser call answerers (§5.13b): who the main line rings in the
            Command Center. Capped at RingCentral's five devices per
            extension — the sixth checkbox is refused here, and RingCentral
            itself refuses a sixth browser with "603 Too Many Contacts". */}
        <section className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Headphones className="w-4 h-4" /> Answer calls in the browser
            <span className="ml-auto text-xs font-normal text-muted-foreground tabular-nums">
              {answerers.length} of {MAX_CALL_ANSWERERS}
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">
            Only the people checked here are shown incoming calls, and they answer them in the
            Command Center. RingCentral allows five devices on the main line, and every browser a
            person opens the app in counts as one — so keep this to the people who actually pick
            up, and have them use one machine.
          </p>
          {allEmails.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add a person first.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {allEmails.map((pe) => {
                const on = answerers.includes(pe);
                const full = !on && answerers.length >= MAX_CALL_ANSWERERS;
                return (
                  <label
                    key={pe}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm",
                      on ? "border-emerald-500/40 bg-emerald-500/5" : "border-border",
                      full ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
                    )}
                    title={full ? `All ${MAX_CALL_ANSWERERS} slots are taken — uncheck somebody first` : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={full}
                      onChange={() => {
                        if (!setCallAnswerer(pe, !on)) {
                          toast.error(`All ${MAX_CALL_ANSWERERS} browser-answering slots are taken. Uncheck somebody first.`);
                        }
                      }}
                      className="accent-emerald-600"
                    />
                    <span className="truncate">{config.processors[pe]?.name || pe}</span>
                    <span className="ml-auto text-[11px] text-muted-foreground truncate">{pe}</span>
                  </label>
                );
              })}
            </div>
          )}
        </section>

        {/* People */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <UserCog className="w-4 h-4" /> People
          </h2>
          {allEmails.length === 0 ? (
            <p className="text-sm text-muted-foreground">No one added yet. Add a person above.</p>
          ) : (
            <div className="space-y-4">
              {allEmails.map((pe) => {
                const isManager = config.managers.some((m) => norm(m) === pe);
                const profile = config.processors[pe];
                const roles = profile?.roles ?? [];
                const isSelf = pe === norm(me);
                return (
                  <div key={pe} className="bg-card border border-border rounded-xl p-4 space-y-3">
                    {/* Header row */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="font-medium text-sm">
                        {pe}
                        {isSelf && <span className="ml-1 text-[10px] text-muted-foreground">(you)</span>}
                      </div>
                      {profile ? (
                        <>
                          <input
                            value={profile.name}
                            onChange={(e) => setProcessorName(pe, e.target.value)}
                            placeholder="Display name"
                            className="w-40 rounded-lg border border-border bg-background px-2 py-1 text-sm"
                          />
                          {/* Click-to-call: the number RingCentral rings to reach
                              this person. NOT what the patient sees — patients
                              always see the MM number. Blank falls back to the
                              main line, which rings whoever is on it. */}
                          <input
                            value={profile.phoneNumber ?? ""}
                            onChange={(e) => setProcessorPhone(pe, e.target.value)}
                            placeholder="Call-me-at number"
                            title="Number RingCentral rings to reach this person on a click-to-call. Patients always see the MM number."
                            className="w-40 rounded-lg border border-border bg-background px-2 py-1 text-sm"
                          />
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">{pe.split("@")[0]}</span>
                      )}

                      {/* Manager toggle (full access) */}
                      <label
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
                          isSelf ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
                          isManager ? "border-amber-400/50 bg-amber-400/10 text-amber-600" : "border-border hover:bg-muted/40",
                        )}
                        title={isSelf ? "You can't remove your own manager access" : "Full access to the whole Command Center"}
                      >
                        <input
                          type="checkbox"
                          checked={isManager}
                          disabled={isSelf}
                          onChange={() => setManager(pe, !isManager)}
                          className="accent-amber-500"
                        />
                        <Shield className="w-3.5 h-3.5" /> Manager
                      </label>

                      <span className="text-xs text-muted-foreground">{roles.length} bar{roles.length !== 1 ? "s" : ""}</span>
                      <button
                        onClick={() => !isSelf && removeEmail(pe)}
                        disabled={isSelf}
                        className={cn(
                          "ml-auto inline-flex items-center gap-1 text-xs",
                          isSelf ? "text-muted-foreground/40 cursor-not-allowed" : "text-red-500 hover:text-red-600",
                        )}
                      >
                        <X className="w-3.5 h-3.5" /> Remove
                      </button>
                    </div>

                    {/* Roles: checkbox + filter + SOP order */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {ROLES.map((role) => {
                        const on = roles.includes(role.id);
                        return (
                          <div
                            key={role.id}
                            className={cn(
                              "flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm",
                              on ? "border-primary/40 bg-primary/5" : "border-border",
                            )}
                          >
                            <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggleProcessorRole(pe, role.id)}
                                className="accent-primary"
                              />
                              <span className={cn("w-2 h-2 rounded-full shrink-0", role.color)} />
                              <span className="truncate">{role.label}</span>
                            </label>
                            {on && (
                              <>
                                <select
                                  value={roleFilterFor(profile, role.id)}
                                  onChange={(e) => setRoleFilter(pe, role.id, e.target.value as RoleFilter)}
                                  className="rounded border border-border bg-background px-1 py-0.5 text-[11px]"
                                  title="Which patients this rep sees for this role"
                                >
                                  {FILTER_OPTS.map((o) => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  min={1}
                                  value={roleOrderNumber(profile, role.id) ?? ""}
                                  onChange={(e) =>
                                    setRoleOrder(pe, role.id, e.target.value === "" ? null : parseInt(e.target.value, 10))
                                  }
                                  placeholder="#"
                                  className="w-11 rounded border border-border bg-background px-1 py-0.5 text-[11px] tabular-nums"
                                  title="SOP order (1 = first)"
                                />
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
