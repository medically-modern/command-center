import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAccessContext } from "@/components/AccessProvider";
import { ROLES } from "@/lib/config";
import { MAX_CALL_ANSWERERS, type RoleFilter } from "@/lib/accessStore";
import { AbilitiesEditor } from "@/components/shell/AbilitiesEditor";
import { CROSS_SELL_FILTER_ROLES, roleFilterFor, roleOrderNumber } from "@/lib/roleView";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowLeft, Shield, UserCog, X, Plus } from "lucide-react";

/** Managers-only UI. Every person can be a Manager (full access), a Processor
 *  (only their checked bars), or BOTH. Each assigned role carries a filter
 *  (All / Non-escalated / Escalated, plus the two cross-sell scopes on Welcome
 *  Call) and an optional SOP order number. */
const FILTER_OPTS: { value: RoleFilter; label: string }[] = [
  { value: "nonEscalated", label: "Non-escalated" },
  { value: "all", label: "All" },
  { value: "escalated", label: "Escalated" },
];

/** Welcome Call only — Katie + Brandon, 2026-09-21: Corey takes the cross-sell
 *  calls, somebody else takes the rest. Two scopes that SPLIT the one queue, so
 *  assigning them to two people covers it exactly once with nobody orphaned.
 *  ⚠️ Offered only for CROSS_SELL_FILTER_ROLES: `isCrossSell` is a Welcome Call
 *  rule, so on any other role this would store a filter nothing reads. */
const CROSS_SELL_OPTS: { value: RoleFilter; label: string }[] = [
  { value: "crossSell", label: "Cross-sells only" },
  { value: "nonCrossSell", label: "Everything but cross-sells" },
];

const filterOptsFor = (roleId: string) =>
  CROSS_SELL_FILTER_ROLES.has(roleId) ? [...FILTER_OPTS, ...CROSS_SELL_OPTS] : FILTER_OPTS;

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
    setAbility,
    setHomeView,
    setAdmin,
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

        {/* ⚠️ The "Answer calls in the browser" section is GONE (Josh,
            2026-09-23): it was a second control onto `callAnswerers[]`, the
            same list the "Answers calls" chip on each person's Abilities row
            writes. That chip is now the only one, and the count lives on it. */}

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

                      {/* ⚠️ The Manager toggle moved INTO the abilities row below
                          (Brandon's own card has it there, §5.39g). One control,
                          one writer — a checkbox here and a chip there would be
                          two doors onto `managers[]` sitting 40px apart. */}
                      {isManager && (
                        <span className="inline-flex items-center gap-1 rounded-lg border border-amber-400/50 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-600">
                          <Shield className="w-3 h-3" /> Manager
                        </span>
                      )}

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

                    {/* ⚠️ Brandon's abilities + home view (§5.39c), ADDED beside
                        the role grid rather than replacing it. Everything below
                        is exactly as it was, so there is nothing to unwind. */}
                    <AbilitiesEditor
                      email={pe}
                      config={config}
                      isManager={isManager}
                      isSelf={isSelf}
                      answersCalls={answerers.includes(pe)}
                      answerSlotsFull={!answerers.includes(pe) && answerers.length >= MAX_CALL_ANSWERERS}
                      answerCount={answerers.length}
                      onAbility={(a, on) => setAbility(pe, a, on)}
                      onHomeView={(v, on) => setHomeView(pe, v, on)}
                      onAdmin={(on) => setAdmin(pe, on)}
                      onManager={(on) => setManager(pe, on)}
                      onAnswersCalls={(on) => {
                        if (!setCallAnswerer(pe, on)) {
                          toast.error(`All ${MAX_CALL_ANSWERERS} browser-answering slots are taken. Turn somebody else off first.`);
                        }
                      }}
                    />

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
                                  {filterOptsFor(role.id).map((o) => (
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
