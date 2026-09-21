/**
 * The other half of `AbilityGate` (§5.39h) — a control that is SHOWN and
 * cannot be pressed, with one line saying why.
 *
 * ⚠️⚠️ **This is what "abilities unlock buttons; they never hide information"
 * means in practice** (§5.39c, Brandon's own rule). A page nobody may open
 * gets the wall; a page everybody reads but not everybody may SAVE gets this —
 * the profile still renders in full, the Save is inert, and the note names the
 * switch. Hiding the control instead is the dead end §5.10 · §5.20 · §5.31c ·
 * §5.32c each record reversing: a rep who cannot see the button concludes the
 * page is broken and goes looking for a way round it.
 *
 * ⚠️ **It reads the SIGNED-IN person, never a borrowed one** — same rule as
 * `AbilityGate`, and the opposite of the header's. This answers *may I write
 * this*, and looking at somebody else's screen must never hand me their write
 * (`viewAsScope.test.ts` pins it).
 *
 * ⚠️ **`disabled`, never removed, and never a click that fails afterwards.**
 * The Subscription send is ~20 columns and the visit-date save fires a board
 * automation; both are transactions whose refusal a rep would read as a bug.
 */
import { Lock } from "lucide-react";
import { useAccessContext } from "@/components/AccessProvider";
import { ABILITY_LABEL, hasAbility } from "@/lib/shell/abilities";
import type { Ability } from "@/lib/accessStore";
import { cn } from "@/lib/utils";

/** Whether the SIGNED-IN person holds this ability. */
export function useAbility(ability: Ability): boolean {
  const { email, config } = useAccessContext();
  return hasAbility(email, config, ability);
}

export function AbilityLockNote({ ability, className }: { ability: Ability; className?: string }) {
  const label = ABILITY_LABEL[ability];
  return (
    <p
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground",
        className,
      )}
    >
      <Lock className="h-3 w-3 shrink-0" />
      Read-only — an admin turns on <b className="font-semibold text-foreground">{label}</b> for you on the Users page.
    </p>
  );
}
