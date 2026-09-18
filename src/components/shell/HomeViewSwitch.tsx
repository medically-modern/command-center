/**
 * The home screen's view toggle, and the "Viewing: <person>" dropdown (§5.39c).
 *
 * Brandon's model: a person's home is a CUSTOM VIEW rather than one fixed
 * screen — `bars` (today's role bars), `coordinator` ("My Patients"), or
 * `oversight`. Two or more puts a toggle on top; the `viewOthers` ability adds
 * a dropdown for looking at somebody else's.
 *
 * ⚠️ **WITH ONE VIEW AND NO ABILITY THIS RENDERS NOTHING AT ALL** — not an
 * empty bar, not a spacer. Every access.json today has no `homeView`, which
 * reads as `["bars"]` (§5.39c), so on the deploy that ships this the home page
 * is untouched for everybody. That is what makes the model additive; the day
 * somebody is given a second view, the toggle appears for them alone.
 *
 * ⚠️ **Borrowing somebody's view runs with YOUR permissions, not theirs.** The
 * banner says so, because the alternative reading — that you are acting as that
 * person — is how somebody does something they are not allowed to do and
 * believes the app let them on purpose.
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
}) {
  const showToggle = views.length > 1;
  const showPicker = people.length > 0;
  if (!showToggle && !showPicker && !borrowedName) return null;

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

      {borrowedName && (
        <div className="mx-6 mb-2.5 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs">
          <b>You're looking at {borrowedName}'s view.</b> Anything you do here runs with{" "}
          <i>your</i> permissions, not theirs.{" "}
          <button
            type="button"
            className="font-semibold text-primary hover:underline"
            onClick={() => onViewing("")}
          >
            Back to my view
          </button>
        </div>
      )}
    </div>
  );
}
