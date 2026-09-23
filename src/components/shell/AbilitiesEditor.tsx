/**
 * Per-person abilities and home view, on the Access page (§5.39c) — Brandon's
 * "User management" card, added beside the role grid rather than replacing it.
 *
 * ⚠️ **"Answers calls" lives ONLY here** since 2026-09-23 — the page's
 * separate "Answer calls in the browser" roster was a second control onto the
 * same `callAnswerers[]` list and was removed (Josh). The N-of-5 count moved
 * onto the chip. The role grid is untouched. This adds two rows to a card that already exists,
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
 *
 * ⚠️⚠️ **EXCEPT an OPT-IN ability, which stays EDITABLE for a manager and starts
 * OFF.** `viewOthers` and `stageManager` are the two today (§5.39c, §5.41), and
 * everybody who holds either is a manager — so disabling them here would make
 * the only grants the app reads unclickable, on the only page that can set
 * them. Their chips render from the real stored value rather than from the
 * manager blanket, so what an admin sees is what the app does.
 *
 * ⚠️ The footer sentence is BUILT from `OPT_IN_ABILITIES`, never a hardcoded
 * name: it said "except View others\' views" while `stageManager` was opt-in
 * too, which is a page describing a rule it no longer implements.
 */
import { Check, Eye, Headphones, KeyRound, Shield } from "lucide-react";
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
  OPT_IN_ABILITIES,
  isOptInAbility,
} from "@/lib/shell/abilities";
import { ABILITIES, HOME_VIEWS, MAX_CALL_ANSWERERS, type AccessConfig, type Ability, type HomeView } from "@/lib/accessStore";

export function AbilitiesEditor({
  email,
  config,
  isManager,
  isSelf,
  answersCalls,
  answerSlotsFull,
  answerCount,
  onAbility,
  onHomeView,
  onAdmin,
  onManager,
  onAnswersCalls,
}: {
  email: string;
  config: AccessConfig;
  isManager: boolean;
  /** You cannot demote or un-admin yourself — the self-lockout guard. */
  isSelf: boolean;
  answersCalls: boolean;
  /** All five RingCentral slots are taken and this person holds none (§5.13b). */
  answerSlotsFull: boolean;
  /** How many of the MAX_CALL_ANSWERERS slots are taken, company-wide. */
  answerCount: number;
  onAbility: (ability: Ability, on: boolean) => void;
  onHomeView: (view: HomeView, on: boolean) => void;
  onAdmin: (on: boolean) => void;
  onManager: (on: boolean) => void;
  onAnswersCalls: (on: boolean) => void;
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
                // ⚠️ **Editable for a MANAGER too, from §5.39g.** The home is the
                // signed-in person's own view now, manager or not, so disabling
                // this for managers made the one control that sets their screen
                // unclickable — on the only page that sets it.
                disabled={last}
                // ⚠️ An ON view that is NOT the landing one promotes on click
                // (the writer prepends), so "click a view to move it to the
                // front" is true. Only the landing view itself toggles off —
                // otherwise there is no way to remove one at all.
                onClick={() => onHomeView(v, !on || v !== views[0])}
                title={
                  last
                    ? "Everyone needs at least one view"
                    : on && v !== views[0]
                      ? `Make ${HOME_VIEW_TAB[v]} the screen they land on`
                      : HOME_VIEW_HINT[v]
                }
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
                  on ? "border-primary/40 bg-primary/10 text-primary" : "border-border hover:bg-muted/40",
                  last && "cursor-not-allowed opacity-60",
                )}
              >
                {on && <Check className="h-3 w-3" />}
                {HOME_VIEW_LABEL[v]}
              </button>
            );
          })}
        </div>
        {/* ⚠⚠ **NAME THE LANDING VIEW.** `views[0]` is the screen this person
            actually opens on, and with two views on there was nothing anywhere
            saying which — so ticking a second one read as doing nothing
            (§5.39h, Josh's Madeline report). Turning one ON now makes it the
            landing view; this line is what says so. */}
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          {views.length > 1 ? (
            <>
              Lands on <b className="font-semibold text-foreground">{HOME_VIEW_TAB[views[0]]}</b>, with a{" "}
              {views.map((v) => HOME_VIEW_TAB[v]).join(" | ")} toggle on top. Click a view to move it to the front.
            </>
          ) : (
            HOME_VIEW_HINT[views[0]]
          )}
        </p>
      </div>

      {/* ── Abilities ─────────────────────────────────────────── */}
      <div>
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Abilities
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ABILITIES.map((a) => {
            // ⚠️ `hasAbility` already knows the opt-in rule, so the chip reads
            // the real answer for BOTH kinds — never the manager blanket.
            const on = hasAbility(email, config, a);
            const optIn = isOptInAbility(a);
            /* ⚠⚠ **NOTHING IS LOCKED ANY MORE** (§5.39h). These chips rendered
               ON and DISABLED for a manager, because `hasAbility` used to
               return true for them whatever `perms` said — so an editable
               checkbox would have written a value nothing read. It IS read
               now: an explicit `false` is honoured for a manager too, which is
               what Josh asked for pointing at his own row. The variable stays
               so the shape of this is obvious if a future rule brings a lock
               back; today nothing sets it. */
            const locked = false;
            return (
              <button
                key={a}
                type="button"
                disabled={locked}
                onClick={() => onAbility(a, !on)}
                title={locked ? "Managers have every ability" : ABILITY_HINT[a]}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
                  on ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : "border-border hover:bg-muted/40",
                  locked && "cursor-not-allowed opacity-60",
                )}
              >
                {on && <Check className="h-3 w-3" />}
                {ABILITY_LABEL[a]}
              </button>
            );
          })}

          {/* ⚠️⚠️ **"Answers calls" and "Manager" are on this row because
              Brandon's own card has them there**, and Josh sent that card with
              *"i want everything on this list functional"* (2026-09-19). They
              are NOT `perms` keys — they write `callAnswerers[]` and
              `managers[]` — so they take their own handlers rather than
              widening `Ability`, and they go through the SAME writers the
              sections above use. A second door onto one writer is fine; a
              second opinion about one value is not (§5.31c), and both of these
              render straight from the config. */}
          <button
            type="button"
            // ⚠️ aria-disabled, not disabled: a disabled button shows no tooltip
            // in most browsers, and the tooltip is the only thing saying WHY.
            onClick={() => {
              if (!answerSlotsFull) onAnswersCalls(!answersCalls);
            }}
            aria-disabled={answerSlotsFull}
            title={
              answerSlotsFull
                ? `All ${MAX_CALL_ANSWERERS} browser-answering slots are taken — turn somebody else off first`
                : "Only people with this on are shown incoming patient calls, and they answer them in the browser. RingCentral allows five devices on the main line, and every browser this person opens counts as one."
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
              answersCalls ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" : "border-border hover:bg-muted/40",
              answerSlotsFull && "cursor-not-allowed opacity-60",
            )}
          >
            {answersCalls && <Check className="h-3 w-3" />}
            <Headphones className="h-3 w-3" /> Answers calls
            <span className="tabular-nums opacity-70">
              {answerCount}/{MAX_CALL_ANSWERERS}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onManager(!isManager)}
            disabled={isSelf}
            title={
              isSelf
                ? "You can't remove your own manager access"
                : "Full access to the whole Command Center. Turning it off leaves the person here with no bars — it does not remove them."
            }
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs",
              isManager ? "border-amber-400/50 bg-amber-400/10 text-amber-600" : "border-border hover:bg-muted/40",
              isSelf && "cursor-not-allowed opacity-60",
            )}
          >
            <Shield className="h-3 w-3" /> Manager
          </button>

          {/* Admin is separate: it is about THIS page, not about the app. */}
          <button
            type="button"
            disabled={isSelf && admin}
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
          Abilities unlock buttons; they never hide a patient. Anything not turned off is on —
          managers included — except{" "}
          {OPT_IN_ABILITIES.map((a, i) => (
            <span key={a}>
              {i > 0 && (i === OPT_IN_ABILITIES.length - 1 ? " and " : ", ")}
              <b>{ABILITY_LABEL[a]}</b>
            </span>
          ))}
          , which {OPT_IN_ABILITIES.length === 1 ? "is" : "are"} off until granted.
        </p>
      </div>
    </div>
  );
}
