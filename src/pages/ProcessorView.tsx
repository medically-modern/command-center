import { useFilteredRoleCounts } from "@/hooks/useFilteredRoleCounts";
import { DailyBurndown } from "@/components/dashboard/DailyBurndown";
import type { ProcessorProfile } from "@/lib/accessStore";
import { orderedRoleIds } from "@/lib/roleView";
import CallConnectionBadge from "@/components/inboundCalls/CallConnectionBadge";
import { Stethoscope } from "lucide-react";
import "@/pages/home/home.css";

/**
 * Stripped, no-sidebar view: only this person's assigned role bars.
 *
 * ⚠️ From §5.39g this is EVERY signed-in person's home in the redesign — not
 * just a processor's — and it is what the "Viewing" dropdown renders for a
 * borrowed person, because it reads no identity of its own. Everything it draws
 * comes from the `profile` it is handed, which is what makes the borrow honest.
 *
 * ⚠️ **`stages` is Brandon's look (pixel-match Phase 7, §5.52)** — his
 * `barsHome`: "<name>'s stages", `.proc-main`, and the bars in his `.bar`
 * markup. `HomeViewHost` passes it inside the redesign and nothing else does,
 * so `Index.tsx` ("as today") renders this file exactly as it always has.
 */
export default function ProcessorView({
  profile,
  email,
  /** True when `profile` is the all-roles stand-in for a manager with no
   *  assigned bars (§5.39g) — said on screen, because "every queue" and
   *  "somebody chose these queues for me" are different facts. */
  allRoles = false,
  /** False while borrowing, so the heading names whose work this is. */
  mine = true,
  /** Brandon's Stages look — the redesign's home only. */
  stages = false,
}: {
  profile: ProcessorProfile;
  email: string;
  allRoles?: boolean;
  mine?: boolean;
  stages?: boolean;
}) {
  const { counts, loading } = useFilteredRoleCounts(profile);
  const order = orderedRoleIds(profile);
  const name = profile.name || email.split("@")[0];
  return (
    <div className="min-h-screen bg-gradient-subtle">
      {/* ⚠️ `data-cc-chrome` is a hook for the redesign shell ONLY (§5.39c):
          inside it the global header already carries the wordmark AND the
          softphone badge, so this bar would be a second navy strip saying the
          same thing — the "two designs stapled together" look §5.39b exists to
          avoid. Nothing is lost when it is hidden: whose screen this is comes
          from the "<name>'s work" heading directly below (and, on a borrowed
          view, from the banner above). With the shell off nothing reads this
          attribute and the page renders exactly as before. */}
      <header
        data-cc-chrome
        className="bg-gradient-navy text-white px-6 py-4 flex items-center gap-3 shadow-lg"
      >
        <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
          <Stethoscope className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-bold tracking-tight">Command Center</h1>
          <p className="text-[11px] text-white/60 truncate">{profile.name || email}</p>
        </div>
        {/* Renders only for assigned call answerers (§5.13b). */}
        <CallConnectionBadge className="shrink-0" />
      </header>

      {stages ? (
        // His `barsHome`: the owner's NAME even when it is mine (his mockup
        // says "Josh's stages" to Josh), the one-line hint, and — while
        // borrowing — his "You are looking at X's bars." tail. The shell's
        // banner says the same above every page (§5.39h); this is the line his
        // page carries, kept because the bars are what it is about.
        <main className="cc-bars proc-main">
          <div style={{ marginBottom: 20 }}>
            <h2 className="ttl">{name}'s stages</h2>
            <div className="small muted" style={{ marginTop: 4 }}>
              {allRoles
                ? "Every queue — you have no assigned bars, so this is all of them."
                : "Click a bar to open that queue."}
              {!mine && ` You are looking at ${name}'s bars.`}
            </div>
          </div>
          {profile.roles.length === 0 ? (
            <p className="small muted">No stages assigned yet — an admin adds them in Users.</p>
          ) : (
            <DailyBurndown
              look="stages"
              roleCounts={counts}
              countsLoading={loading}
              visibleRoleIds={profile.roles}
              order={order}
              roleFilters={profile.roleFilters}
            />
          )}
        </main>
      ) : (
        <main className="p-6 sm:p-8">
          <div className="max-w-3xl xl:max-w-5xl 2xl:max-w-7xl mx-auto space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                {mine ? "Your work" : `${profile.name || email.split("@")[0]}'s work`}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {allRoles
                  ? "Every queue — you have no assigned bars, so this is all of them."
                  : "Click a bar to open that queue."}
              </p>
            </div>
            {profile.roles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No queues assigned yet — ask your manager to add some.
              </p>
            ) : (
              <DailyBurndown roleCounts={counts} countsLoading={loading} visibleRoleIds={profile.roles} order={order} roleFilters={profile.roleFilters} />
            )}
          </div>
        </main>
      )}

      {/* Settings gear — lower-left, identical to the manager view: click for
          theme colors + the signed-in email + sign out. */}
      <div className="fixed bottom-4 left-4 z-40">
      </div>
    </div>
  );
}
