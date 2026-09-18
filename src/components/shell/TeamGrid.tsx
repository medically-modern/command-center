/**
 * The team, in the MAIN AREA — what "remove the managers processors view on the
 * left side bar" should have meant (Josh, 2026-09-18, then *"yeha the views are
 * super wrong"* when it didn't).
 *
 * ⚠️⚠️ **THE ROSTER WAS REMOVED AND NOTHING TOOK ITS PLACE.** `Index`'s
 * `rosterReplaced` branch dropped the 340px sidebar and rendered
 * `DashboardMainView person={null}` — which is an empty card reading *"Pick
 * somebody in Viewing, up in the top bar"*. So a manager's home page, the first
 * screen they open, became a blank screen pointing at a dropdown that shows
 * somebody ELSE's home. Everything the sidebar carried — who is on the team,
 * how many role bars each one has, who is also a manager — was simply gone, and
 * the one control left offered no way to see your own anything. Measured in a
 * browser: one 16px icon, a heading and two lines of text on 900px of empty
 * page.
 *
 * ⚠️ **He objected to the sidebar, not to the roster.** The list is the whole
 * content of that screen — it is how a manager sees who is carrying what — so
 * it moves into the space removing the rail freed up, which is Brandon's own
 * instinct everywhere else in the redesign (wide content, no left rail). Nothing
 * is added back to the left.
 *
 * ⚠️ **It selects with `?user=`, NOT `?viewing=`, and the two are different
 * questions.** `?user=` is what the sidebar always set: the MANAGER's view of
 * that person — their assigned bars, their filters, their workload, editable on
 * `/access`. `?viewing=` (§5.39c) renders that person's own home screen as they
 * see it. Both are useful and neither replaces the other; collapsing them would
 * lose whichever one the survivor is not.
 *
 * ⚠️ **Renders only inside the redesign**, because its only caller is the
 * `rosterReplaced` branch, which is already gated on the layout AND on
 * `viewOthers` (§5.39c). "As today" keeps the sidebar, untouched.
 *
 * Nothing here writes: every card is a selection, and the two buttons are links
 * to pages that already exist.
 */
import { KeyRound, Shield, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { Person } from "@/lib/people";

interface Props {
  people: Person[];
  onSelect: (key: string) => void;
}

/** The sidebar's own wording, so the two screens say the same thing. */
export function roleNoteFor(person: Person): string {
  const n = person.roleIds.length;
  if (person.isManager) return n > 0 ? `Manager · ${n} role${n > 1 ? "s" : ""}` : "Full access";
  return n === 0 ? "No roles" : `${n} role${n > 1 ? "s" : ""}`;
}

export function TeamGrid({ people, onSelect }: Props) {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="border-b border-border bg-card px-8 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Users className="w-4 h-4 text-primary shrink-0" />
            Your team
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Pick somebody to see the queues they work and how much is in them.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* ⚠️ Both of these were in the sidebar's chrome — the "Managers" tab
              and the "Manage Access" footer button. Dropping the rail dropped
              them too, so they come back here rather than nowhere. */}
          <button
            onClick={() => navigate("/oversight")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            title="The manager pipeline — every stage, every escalation"
          >
            <Shield className="w-3.5 h-3.5" /> Oversight
          </button>
          <button
            onClick={() => navigate("/access")}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
            title="Add people and choose which role bars each one sees"
          >
            <KeyRound className="w-3.5 h-3.5" /> Manage Access
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-8">
        {people.length === 0 ? (
          /* ⚠️ An empty roster is a real state (a fresh config), and it must not
             read like the blank screen this component exists to replace — so it
             names the move that fixes it. */
          <div className="text-center py-16 space-y-3">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Users className="w-7 h-7 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">
              Nobody is set up yet — add people on{" "}
              <button onClick={() => navigate("/access")} className="text-primary underline underline-offset-2">
                Manage Access
              </button>
              .
            </p>
          </div>
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">
            {people.map((person) => (
              <button
                key={person.key}
                onClick={() => onSelect(person.key)}
                className={cn(
                  "group flex items-center gap-3 rounded-xl border border-border bg-card p-4 text-left",
                  "transition-colors hover:border-primary/40 hover:bg-primary/[0.03]",
                )}
              >
                <div className="w-10 h-10 rounded-full bg-gradient-primary flex items-center justify-center text-white font-bold text-sm shrink-0">
                  {person.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground flex items-center gap-1.5 truncate">
                    <span className="truncate">{person.name}</span>
                    {person.isManager && (
                      <Shield className="w-3 h-3 text-amber-500 shrink-0" aria-label="Also a manager" />
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{roleNoteFor(person)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
