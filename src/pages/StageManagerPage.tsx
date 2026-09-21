import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { StageManagerView } from "@/pages/SystemMgmtPage";
import { useSystemPatients } from "@/hooks/systemMgmt/useSystemPatients";

/**
 * Stage Manager on its own (§5.41) — Josh, 2026-09-21: *"add stage manager as an
 * assignable top tab (like communications)"*.
 *
 * ⚠️ It renders the SAME `StageManagerView` the System Management tab renders,
 * imported rather than copied. That screen WRITES the Stage Advancer, which is
 * what every board automation fires on (§6), so two divergent copies of it is
 * the one duplication that could move a patient two different ways.
 *
 * ⚠️ Unlike `/operations` beside it, this page really does need
 * `useSystemPatients()`: the view searches across boards and filters to Medical
 * Evaluation and Insurance, so the seven-board snapshot IS its input.
 *
 * ⚠️ The `stageManager` ability is enforced at the ROUTE in `App.tsx` — a gate
 * on the header tab is not a gate on the page (§5.39h), and this is a screen
 * that moves patients.
 */
export default function StageManagerPage() {
  const navigate = useNavigate();
  const { patients, loading, error, refetch } = useSystemPatients();

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  return (
    <div className="min-h-screen bg-gradient-subtle">
      <header className="bg-card border-b border-border px-4 sm:px-6 py-3 flex items-center gap-3 sticky top-0 z-20">
        <button onClick={goBack} className="p-2 rounded-lg hover:bg-muted/50" title="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-semibold text-foreground">Stage Manager</h1>
        <button
          onClick={() => refetch()}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/50"
          title="Re-read the boards"
        >
          <RefreshCw className={`w-3.5 h-3.5${loading ? " animate-spin" : ""}`} /> Refresh
        </button>
      </header>
      <main className="p-4 sm:p-6">
        {/* ⚠️ A failed read is not an empty board (§9) — saying so is the
            difference between "nobody is here" and "we could not look". */}
        {error && (
          <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
            The patient list may be out of date — Monday couldn&apos;t be read.{" "}
            <button onClick={() => refetch()} className="underline font-medium">Retry</button>
          </div>
        )}
        {loading && patients.length === 0 ? (
          <p className="text-sm text-muted-foreground">Reading the boards…</p>
        ) : (
          <StageManagerView patients={patients} onMoved={refetch} />
        )}
      </main>
    </div>
  );
}
