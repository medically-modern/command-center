import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { OperationsTab } from "@/components/systemMgmt/OperationsTab";

/**
 * Reports & Metrics — the daily operations screen, on its own (§5.41).
 *
 * Josh, 2026-09-21: *"make reports and metrics ONLY the daily operations screen
 * no need for system management bar"*. The header tab used to open
 * `/system-mgmt?tab=operations`, i.e. the whole System Management page — navy
 * header, five-tab bar — with Operations inside it, so a tab in the app's
 * primary navigation landed you on a screen wearing a second set of tabs and a
 * title that did not match the tab you pressed.
 *
 * ⚠️ It renders `OperationsTab` DIRECTLY and takes no props, so this page does
 * NOT run `useSystemPatients()` — the seven-board snapshot that System
 * Management fetches for its search, pipeline chart and Stage Manager, and
 * which Operations has never read. Splitting it out is therefore cheaper than
 * the tab it replaces, not just tidier.
 *
 * ⚠️ The `reports` ability is enforced at the ROUTE in `App.tsx`, not here: a
 * gate on the tab is not a gate on the page (§5.39h), and this URL is
 * bookmarkable.
 */
export default function OperationsPage() {
  const navigate = useNavigate();
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
        <h1 className="text-base font-semibold text-foreground">Reports &amp; Metrics</h1>
      </header>
      <main className="p-4 sm:p-6">
        <OperationsTab />
      </main>
    </div>
  );
}
