import { useFilteredRoleCounts } from "@/hooks/useFilteredRoleCounts";
import { DailyBurndown } from "@/components/dashboard/DailyBurndown";
import type { ProcessorProfile } from "@/lib/accessStore";
import { orderedRoleIds } from "@/lib/roleView";
import { ThemePickerButton } from "@/components/ThemePicker";
import { Stethoscope } from "lucide-react";

/** Stripped, no-sidebar view for a processor: only their assigned role bars. */
export default function ProcessorView({ profile, email }: { profile: ProcessorProfile; email: string }) {
  const { counts, loading } = useFilteredRoleCounts(profile);
  const order = orderedRoleIds(profile);
  return (
    <div className="min-h-screen bg-gradient-subtle">
      <header className="bg-gradient-navy text-white px-6 py-4 flex items-center gap-3 shadow-lg">
        <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
          <Stethoscope className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h1 className="text-base font-bold tracking-tight">Command Center</h1>
          <p className="text-[11px] text-white/60 truncate">{profile.name || email}</p>
        </div>
      </header>

      <main className="p-6 sm:p-8">
        <div className="max-w-3xl xl:max-w-5xl 2xl:max-w-7xl mx-auto space-y-6">
          <div>
            <h2 className="text-xl font-semibold text-foreground">
              {profile.name ? `${profile.name}'s work` : "Your work"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">Click a bar to open that queue.</p>
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

      {/* Settings gear — lower-left, identical to the manager view: click for
          theme colors + the signed-in email + sign out. */}
      <div className="fixed bottom-4 left-4 z-40">
        <ThemePickerButton />
      </div>
    </div>
  );
}
