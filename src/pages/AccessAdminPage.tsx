import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccessContext } from "@/components/AccessProvider";
import { ROLES } from "@/lib/config";
import { cn } from "@/lib/utils";
import { ArrowLeft, Shield, UserCog, X, Plus } from "lucide-react";

/** Managers-only UI to assign each email a view: Manager (full) or
 *  Processor (only their assigned bars). Unlisted emails get no access. */
export default function AccessAdminPage() {
  const navigate = useNavigate();
  const { access, email: me, config, addManager, removeEmail, addProcessor, setProcessorName, toggleProcessorRole } =
    useAccessContext();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

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
  const procEmails = Object.keys(config.processors);

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
          <p className="text-xs text-muted-foreground">Assign each email a view. Changes sync across devices.</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-8">
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
        </section>

        {/* Managers */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Shield className="w-4 h-4" /> Managers <span className="text-muted-foreground font-normal">— full access</span>
          </h2>
          {config.managers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No managers yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {config.managers.map((m) => {
                const isSelf = norm(m) === norm(me);
                return (
                  <span key={m} className="inline-flex items-center gap-2 rounded-full bg-card border border-border px-3 py-1.5 text-sm">
                    {m}{isSelf && <span className="text-[10px] text-muted-foreground">(you)</span>}
                    <button
                      onClick={() => !isSelf && removeEmail(m)}
                      disabled={isSelf}
                      title={isSelf ? "You can't remove your own access" : "Remove"}
                      className={cn("rounded p-0.5", isSelf ? "opacity-30 cursor-not-allowed" : "hover:bg-muted")}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
        </section>

        {/* Processors */}
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <UserCog className="w-4 h-4" /> Processors <span className="text-muted-foreground font-normal">— only the bars you check</span>
          </h2>
          {procEmails.length === 0 ? (
            <p className="text-sm text-muted-foreground">No processors yet. Add one above, then check which bars they see.</p>
          ) : (
            <div className="space-y-4">
              {procEmails.map((pe) => {
                const p = config.processors[pe];
                return (
                  <div key={pe} className="bg-card border border-border rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="font-medium text-sm">{pe}</div>
                      <input
                        value={p.name}
                        onChange={(e) => setProcessorName(pe, e.target.value)}
                        placeholder="Display name"
                        className="w-40 rounded-lg border border-border bg-background px-2 py-1 text-sm"
                      />
                      <span className="text-xs text-muted-foreground">{p.roles.length} bar{p.roles.length !== 1 ? "s" : ""}</span>
                      <button onClick={() => removeEmail(pe)} className="ml-auto inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600">
                        <X className="w-3.5 h-3.5" /> Remove
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                      {ROLES.map((role) => {
                        const on = p.roles.includes(role.id);
                        return (
                          <label key={role.id} className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm cursor-pointer", on ? "border-primary/40 bg-primary/5" : "border-border hover:bg-muted/40")}>
                            <input type="checkbox" checked={on} onChange={() => toggleProcessorRole(pe, role.id)} className="accent-primary" />
                            <span className={cn("w-2 h-2 rounded-full shrink-0", role.color)} />
                            <span className="truncate">{role.label}</span>
                          </label>
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
