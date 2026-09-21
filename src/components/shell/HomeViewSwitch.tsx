/**
 * The home screen's view toggle, and the "Viewing: <person>" dropdown (§5.39c).
 *
 * Brandon's model: a person's home is a CUSTOM VIEW rather than one fixed
 * screen — `bars` (today's role bars), `coordinator` ("My Patients"), or
 * `oversight`. Two or more puts a toggle on top; the `viewOthers` ability adds
 * a dropdown for looking at somebody else's.
 *
 * ⚠️ **`viewOthers` is OPT-IN (§5.39c), so the dropdown is off unless granted.**
 * It is not the manager blanket that turns it on — an admin ticks it per person
 * (Josh and Brandon today). Everybody else sees no picker at all.
 *
 * ⚠️ **WITH ONE VIEW AND NO ABILITY THIS RENDERS NOTHING AT ALL** — not an
 * empty bar, not a spacer. Every access.json today has no `homeView`, which
 * reads as `["bars"]` (§5.39c), so on the deploy that ships this the home page
 * is untouched for everybody. That is what makes the model additive; the day
 * somebody is given a second view, the toggle appears for them alone.
 *
 * ⚠️ **The "you're looking at X's view" banner is NOT here — it is
 * `ViewAsBanner`, in the shell (§5.39h).** The borrow follows you off this
 * page, so the say-so has to as well; this component kept a second copy, and
 * rendering a borrow showed two strips saying overlapping things.
 */
import { Eye, Grid3x3, LineChart, Users } from "lucide-react";
import type { HomeView } from "@/lib/accessStore";
import { HOME_VIEW_TAB } from "@/lib/shell/abilities";

const ICON: Record<HomeView, typeof Grid3x3> = {
  bars: Grid3x3,
  coordinator: Users,
  oversight: LineChart,
};

export function HomeViewSwitch({
  views,
  active,
  onView,
  people,
  viewingKey,
  onViewing,
  borrowedName,
  missingViewing,
  onClearViewing,
}: {
  views: HomeView[];
  active: HomeView;
  onView: (v: HomeView) => void;
  /** Whose views can be borrowed. Empty when the ability is off. */
  people: { key: string; name: string }[];
  viewingKey: string;
  onViewing: (key: string) => void;
  /** Set when the screen is showing somebody else's view. */
  borrowedName: string | null;
  /**
   * Set when `?viewing=` names somebody the config no longer has.
   *
   * ⚠️ It is SAID rather than swallowed. Quietly falling back to your own screen
   * while the URL still names them is the one failure this dropdown must not
   * have: you would be looking at yourself believing you were looking at them.
   */
  missingViewing?: string | null;
  onClearViewing?: () => void;
}) {
  const showToggle = views.length > 1;
  const showPicker = people.length > 0;
  if (!showToggle && !showPicker && !borrowedName && !missingViewing) return null;

  return (
    <div className="border-b bg-card/60">
      <div className="flex flex-wrap items-center gap-3 px-6 py-2.5">
        {showToggle && (
          <div className="inline-flex rounded-lg border bg-muted p-0.5">
            {views.map((v) => {
              const Icon = ICON[v];
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => onView(v)}
                  className={[
                    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                    v === active
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {HOME_VIEW_TAB[v]}
                </button>
              );
            })}
          </div>
        )}

        {showPicker && (
          <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Eye className="h-3.5 w-3.5" />
            Viewing
            <select
              value={viewingKey}
              onChange={(e) => onViewing(e.target.value)}
              className="max-w-[220px] rounded-md border bg-card px-2 py-1 text-xs"
              aria-label="Whose view to show"
            >
              <option value="">My view</option>
              {people.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {missingViewing && (
        <div className="mx-6 mb-2.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
          <b>Showing your own view.</b> “{missingViewing}” isn't in the access list any more, so
          there is no view of theirs to show.{" "}
          {onClearViewing && (
            <button
              type="button"
              className="font-semibold text-primary hover:underline"
              onClick={onClearViewing}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* ⚠️ The "you're looking at X's view" banner used to live HERE, and no
          longer does (§5.39h): `ViewAsBanner` says it above every page now,
          because the borrow follows you off this one. Two strips saying
          overlapping things is what rendering it showed, and the old sentence
          had also stopped being wholly true. `borrowedName` stays a prop so
          this component still knows to render at all with one view and no
          toggle — the dropdown must survive so there is a way back. */}
    </div>
  );
}
