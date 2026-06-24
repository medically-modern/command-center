import { createContext, useContext } from "react";
import { useAccess, resolveAccess, type Access, type AccessConfig, type RoleFilter } from "@/lib/accessStore";
import { authRequired, getUser, signOut } from "@/lib/shared/auth";
import { Loader2, Lock, LogOut } from "lucide-react";

interface AccessCtxValue {
  access: Access;
  email: string;
  config: AccessConfig;
  addManager: (email: string) => void;
  setManager: (email: string, isManager: boolean) => void;
  removeEmail: (email: string) => void;
  addProcessor: (email: string, name: string) => void;
  setProcessorName: (email: string, name: string) => void;
  toggleProcessorRole: (email: string, roleId: string) => void;
  setRoleFilter: (email: string, roleId: string, filter: RoleFilter) => void;
  setRoleOrder: (email: string, roleId: string, order: number | null) => void;
}

const Ctx = createContext<AccessCtxValue | null>(null);

export function useAccessContext(): AccessCtxValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAccessContext must be used within <AccessProvider>");
  return c;
}

/**
 * Gates the whole app by the signed-in email:
 *   manager   → full app
 *   processor → app renders, Index shows their stripped view
 *   none      → blocked (no access until a manager assigns them)
 * When Google auth is OFF (no client id) everyone is treated as a manager,
 * so behavior is unchanged until login is enabled.
 */
export default function AccessProvider({ children }: { children: React.ReactNode }) {
  const acc = useAccess(); // hooks run unconditionally
  const email = getUser()?.email || "";

  const value = (access: Access): AccessCtxValue => ({
    access,
    email,
    config: acc.config,
    addManager: acc.addManager,
    setManager: acc.setManager,
    removeEmail: acc.removeEmail,
    addProcessor: acc.addProcessor,
    setProcessorName: acc.setProcessorName,
    toggleProcessorRole: acc.toggleProcessorRole,
    setRoleFilter: acc.setRoleFilter,
    setRoleOrder: acc.setRoleOrder,
  });

  if (!authRequired()) {
    return <Ctx.Provider value={value({ type: "manager" })}>{children}</Ctx.Provider>;
  }
  if (acc.loading) {
    return (
      <Splash>
        <Loader2 className="w-6 h-6 animate-spin text-white/70" />
        <p className="text-sm text-white/60">Checking your access…</p>
      </Splash>
    );
  }
  const access = resolveAccess(email, acc.config);
  if (access.type === "none") {
    return (
      <Splash>
        <div className="w-14 h-14 rounded-2xl bg-white/10 flex items-center justify-center">
          <Lock className="w-7 h-7 text-white/70" />
        </div>
        <h1 className="text-lg font-semibold text-white">No access yet</h1>
        <p className="text-sm text-white/60 max-w-xs text-center">
          <b className="text-white/80">{email}</b> isn't set up in the Command Center.
          Ask a manager to grant you access.
        </p>
        <button
          onClick={signOut}
          className="mt-2 inline-flex items-center gap-2 text-sm text-white/70 hover:text-white border border-white/15 rounded-lg px-4 py-2"
        >
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </Splash>
    );
  }
  return <Ctx.Provider value={value(access)}>{children}</Ctx.Provider>;
}

function Splash({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#0f1115" }} className="flex flex-col items-center justify-center gap-4 p-8">
      {children}
    </div>
  );
}
