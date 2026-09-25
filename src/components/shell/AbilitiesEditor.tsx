/**
 * Per-person abilities and custom view, on the Access page (§5.39c) — the two
 * boxes of Brandon's "User management" card (`.ugrid`, pixel-match Phase 6c,
 * 2026-09-25). It renders inside `AccessAdminPage`'s `.cc-us` scope, which is
 * where its classes are styled (`pages/access/users.css`).
 *
 * ⚠️ **"Answers calls" lives ONLY here** since 2026-09-23 — the page's
 * separate "Answer calls in the browser" roster was a second control onto the
 * same `callAnswerers[]` list and was removed (Josh). The N-of-5 count moved
 * onto the chip. The role grid is untouched.
 *
 * ⚠️ **Every ability renders ON until somebody turns it off**, because that is
 * what the config means (§5.39c): absent is granted. A chip that started off
 * would tell an admin the opposite of what the app does.
 *
 * ⚠️⚠️ **An OPT-IN ability starts OFF and stays editable for a manager.**
 * `viewOthers` and `stageManager` are the two today (§5.39c, §5.41), and
 * everybody who holds either is a manager — so their chips render from the real
 * stored value rather than from the manager blanket, so what an admin sees is
 * what the app does. Since §5.39h an explicit `false` is honoured for a manager
 * on EVERY ability, so nothing on this row is locked any more.
 *
 * ⚠️ The footer sentence is BUILT from `OPT_IN_ABILITIES`, never a hardcoded
 * name: it said "except View others' views" while `stageManager` was opt-in
 * too, which is a page describing a rule it no longer implements.
 */
import {
  ArrowLeftRight, BarChart3, Check, Eye, KeyRound, LayoutGrid, MessageSquare, Package, Pencil, Phone,
  Route, Shield, Users,
} from "lucide-react";
import type { ComponentType, SVGProps } from "react";
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
} from "@/lib/shell/abilities";
import { ABILITIES, HOME_VIEWS, MAX_CALL_ANSWERERS, type AccessConfig, type Ability, type HomeView } from "@/lib/accessStore";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;
const ICON = { width: 12, height: 12 } as const;

/** Brandon's glyph per chip. Decoration only — the label is the meaning. */
const VIEW_ICON: Record<HomeView, Icon> = { bars: LayoutGrid, coordinator: Users, oversight: BarChart3 };
const ABILITY_ICON: Record<Ability, Icon> = {
  comms: MessageSquare, adjustOrders: ArrowLeftRight, viewOthers: Eye, reports: BarChart3,
  stageManager: Route, inventory: Package, editProfile: Pencil,
};

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
    <div className="ugrid">
      {/* ── Custom view ───────────────────────────────────────── */}
      <div>
        <div className="eyebrow">Custom view</div>
        <div className="row wrap" style={{ gap: 6 }}>
          {HOME_VIEWS.map((v) => {
            const on = views.includes(v);
            const last = on && views.length === 1;
            const VIcon = VIEW_ICON[v];
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
                className={cn("mgr-toggle", on && "on")}
                aria-pressed={on}
              >
                <VIcon style={ICON} />
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
        <div className="xs muted" style={{ marginTop: 6 }}>
          {views.length > 1 ? (
            <>
              Lands on <b>{HOME_VIEW_TAB[views[0]]}</b>, with a {views.map((v) => HOME_VIEW_TAB[v]).join(" | ")} toggle on
              top of the home screen. Click a view to move it to the front.
            </>
          ) : (
            <>{HOME_VIEW_HINT[views[0]]} Pick two or more to give this person a toggle between views.</>
          )}
        </div>
      </div>

      {/* ── Abilities ─────────────────────────────────────────── */}
      <div>
        <div className="eyebrow">Abilities</div>
        <div className="row wrap" style={{ gap: 6 }}>
          {ABILITIES.map((a) => {
            // ⚠️ `hasAbility` already knows the opt-in rule, so the chip reads
            // the real answer for BOTH kinds — never the manager blanket.
            const on = hasAbility(email, config, a);
            const AIcon = ABILITY_ICON[a];
            return (
              <button
                key={a}
                type="button"
                onClick={() => onAbility(a, !on)}
                title={ABILITY_HINT[a]}
                className={cn("mgr-toggle", on && "on")}
                aria-pressed={on}
              >
                <AIcon style={ICON} />
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
            aria-pressed={answersCalls}
            title={
              answerSlotsFull
                ? `All ${MAX_CALL_ANSWERERS} browser-answering slots are taken — turn somebody else off first`
                : "Only people with this on are shown incoming patient calls, and they answer them in the browser. RingCentral allows five devices on the main line, and every browser this person opens counts as one."
            }
            className={cn("mgr-toggle", answersCalls && "on")}
          >
            {answersCalls && <Check style={ICON} />}
            <Phone style={ICON} /> Answers calls
            <span className="cnt">{answerCount}/{MAX_CALL_ANSWERERS}</span>
          </button>

          <button
            type="button"
            onClick={() => onManager(!isManager)}
            disabled={isSelf}
            aria-pressed={isManager}
            title={
              isSelf
                ? "You can't remove your own manager access"
                : "Full access to the whole Command Center. Turning it off leaves the person here with no bars — it does not remove them."
            }
            className={cn("mgr-toggle warn", isManager && "on")}
          >
            <Shield style={ICON} /> Manager
          </button>

          {/* Admin is separate: it is about THIS page, not about the app. */}
          <button
            type="button"
            disabled={isSelf && admin}
            onClick={() => onAdmin(!admin)}
            aria-pressed={admin}
            title={
              adminListEmpty
                ? "No admins are named yet, so every manager is one. Naming the first admin makes the list the rule."
                : "Can open this page and change anyone's bars, abilities and home view."
            }
            className={cn("mgr-toggle adm", admin && "on")}
          >
            <KeyRound style={ICON} /> Admin
            {adminListEmpty && admin && <span className="cnt">(by default)</span>}
          </button>
        </div>
        <div className="xs muted" style={{ marginTop: 6 }}>
          Abilities unlock buttons; they never hide information. Anything not turned off is on — managers included —
          except{" "}
          {OPT_IN_ABILITIES.map((a, i) => (
            <span key={a}>
              {i > 0 && (i === OPT_IN_ABILITIES.length - 1 ? " and " : ", ")}
              <b>{ABILITY_LABEL[a]}</b>
            </span>
          ))}
          , which {OPT_IN_ABILITIES.length === 1 ? "is" : "are"} off until granted.
        </div>
      </div>
    </div>
  );
}
