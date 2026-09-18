/**
 * Per-person abilities and home view, on the Access page (§5.39c) — Brandon's
 * "User management" card, added beside the role grid rather than replacing it.
 *
 * ⚠️ **Purely additive: the role grid, the manager toggle and the call-answerer
 * roster are all untouched.** This adds two rows to a card that already exists,
 * which is what "we'll trim together after" needs — nothing here has to be
 * unwound to go back.
 *
 * ⚠️ **Every ability renders ON until somebody turns it off**, because that is
 * what the config means (§5.39c): absent is granted. A checkbox that started
 * unchecked would tell an admin the opposite of what the app does.
 *
 * ⚠️ **A manager's abilities are shown as ON and DISABLED.** Managers hold every
 * ability whatever `perms` says, so an editable checkbox there would write a
 * value nothing reads — an admin unticks it, nothing changes, and they conclude
 * the page is broken.
 */
import { Check, Eye, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ABILITY_HINT,
  ABILITY_LABEL,
  HOME_VIEW_HINT,
  HOME_VIEW_LABEL,
  HOME_VIEW_TAB,
  hasAbility,
  homeViewsOf,
  isAdmin,
} from "@/lib/shell/abilities";
import { ABILITIES, HOME_VIEWS, type AccessConfig, type Ability, type HomeView } from "@/lib/accessStore";

export function AbilitiesEditor({
  email,
  config,
  isManager,
  onAbility,
  onHomeView,
  onAdmin,
}: {
  email: string;
  config: AccessConfig;
  isManager: boolean;
  onAbility: (ability: Ability, on: boolean) => void;
  onHomeView: (view: HomeView, on: boolean) => void;
  onAdmin: (on: boolean) => void;
}) {
  const views = homeViewsOf(email, config);
  const admin = isAdmin(email, config);
  const adminListEmpty = (config.admins ?? []).length === 0;

  return (
    <div className="grid gap-3 rounded-lg border border-border/70 bg-muted/20 p-3 lg:grid-cols-2">
      {/* ── Home view ─────────────────────────────────────────── */}
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Home view
        </div>
        <div className="flex flex-wrap gap-1.5">
          {HOME_VIEWS.map((v) => {
            const on = views.includes(v);
            const last = on && views.length === 1;
            return (
              <button
                key={v}
                type="button"
                disabled={!!isManager || last}
                onClick={() => onHomeView(v, !on)}
                title={
                  isManager
                    ? "Managers land on the manager dashboard"
                    : last
                      ? "Everyone needs at least one view"
                      : HOME_VIEW_HINT[v]
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
                  on ? "border-primary/40 bg-primary/10 text-primary" : "border-border hover:bg-muted/40",
                  (isManager || last) && "cursor-not-allowed opacity-60",
                )}
              >
                {on && <Check className="h-3 w-3" />}
                {HOME_VIEW_LABEL[v]}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {isManager
            ? "Managers get the manager dashboard."
            : views.length > 1
              ? `Gets a ${views.map((v) => HOME_VIEW_TAB[v]).join(" | ")} toggle on top of the home screen.`
              : HOME_VIEW_HINT[views[0]]}
        </p>
      </div>

      {/* ── Abilities ─────────────────────────────────────────── */}
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Abilities
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ABILITIES.map((a) => {
            const on = hasAbility(email, config, a);
            return (
              <button
                key={a}
                type="button"
                disabled={isManager}
                onClick={() => onAbility(a, !on)}
                title={isManager ? "Managers have every ability" : ABILITY_HINT[a]}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
                  on ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : "border-border hover:bg-muted/40",
                  isManager && "cursor-not-allowed opacity-60",
                )}
              >
                {on && <Check className="h-3 w-3" />}
                {ABILITY_LABEL[a]}
              </button>
            );
          })}

          {/* Admin is separate: it is about THIS page, not about the app. */}
          <button
            type="button"
            onClick={() => onAdmin(!admin)}
            title={
              adminListEmpty
                ? "No admins are named yet, so every manager is one. Naming the first admin makes the list the rule."
                : "Can open this page and change anyone's bars, abilities and home view."
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
              admin ? "border-amber-400/50 bg-amber-400/10 text-amber-600" : "border-border hover:bg-muted/40",
            )}
          >
            <KeyRound className="h-3 w-3" /> Admin
            {adminListEmpty && admin && <span className="opacity-70">(by default)</span>}
          </button>
        </div>
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] text-muted-foreground">
          <Eye className="mt-[1px] h-3 w-3 shrink-0" />
          Abilities unlock buttons; they never hide a patient. Anything not turned off is on.
        </p>
      </div>
    </div>
  );
}
