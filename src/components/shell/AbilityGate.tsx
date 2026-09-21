/**
 * "Inventory is assigned." — the wall a page shows somebody who has not been
 * given the ability that opens it (§5.39g), ported from Brandon's mockup, which
 * renders exactly this for `/inventory` without the `inventory` ability.
 *
 * ⚠️⚠️ **A GATE ON THE TAB IS NOT A GATE ON THE PAGE.** The header only stops
 * somebody CLICKING there; the route still answers a typed URL, a bookmark and
 * a Back. Josh, 2026-09-19: *"i want everything on this list functional"* — so
 * the ability has to reach the page too, or it is decoration.
 *
 * ⚠️⚠️ **IT READS THE SIGNED-IN PERSON, NEVER THE BORROWED ONE**, and that is
 * the opposite of the header's rule. The tabs answer for whoever's view is on
 * show, because the question there is *what does their screen look like*. This
 * answers *may I open this*, and borrowing somebody's view must never take away
 * my own access — nor hand me theirs. `viewAsScope.test.ts` pins both halves.
 *
 * ⚠️ **It names the fix.** A wall with no stated way past it is the dead end
 * §5.10 · §5.20 · §5.31c · §5.32c each record reversing; this one says which
 * switch, on which page, and who can flip it.
 */
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import { useAccessContext } from "@/components/AccessProvider";
import { ABILITY_LABEL, hasAbility, isAdmin } from "@/lib/shell/abilities";
import type { Ability } from "@/lib/accessStore";

export function AbilityGate({ ability, children }: { ability: Ability; children: React.ReactNode }) {
  const { email, config } = useAccessContext();
  if (hasAbility(email, config, ability)) return <>{children}</>;
  return <AbilityWall ability={ability} canFixIt={isAdmin(email, config)} />;
}

function AbilityWall({ ability, canFixIt }: { ability: Ability; canFixIt: boolean }) {
  const label = ABILITY_LABEL[ability];
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-subtle p-8">
      <div className="max-w-md space-y-3 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
          <Lock className="h-5 w-5 text-muted-foreground" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{label} is assigned.</h2>
        <p className="text-sm text-muted-foreground">
          An admin turns on the <b>{label}</b> ability for you on the Users page.
        </p>
        <div className="flex items-center justify-center gap-2 pt-1">
          <Link to="/" className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted/50">
            Back to my dashboard
          </Link>
          {canFixIt && (
            <Link
              to="/access"
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Open Users
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
