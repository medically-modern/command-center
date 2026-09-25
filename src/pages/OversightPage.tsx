import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import OversightTab from "@/components/oversight/OversightTab";
import { useAccessContext } from "@/components/AccessProvider";
import "@/components/oversight/oversight.css";

/**
 * Full-screen Oversight (the System Management › Oversight grid shown on its
 * own). Opened from the manager landing's "Managers" control. A back button
 * (upper-left) returns to wherever the user came from.
 *
 * The strip is Brandon's own page header for `#/oversight` (pixel-match
 * Phase 7, §5.52) — `.cc-ov-page` in `oversight.css`. The tab below carries
 * its own `.cc-ov` scope, so it looks the same in all three of its hosts.
 */
export default function OversightPage() {
  const navigate = useNavigate();
  const { access } = useAccessContext();

  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

  if (access.type !== "manager") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-subtle p-8">
        <div className="text-center space-y-3">
          <p className="text-sm text-muted-foreground">Managers only.</p>
          <button onClick={() => navigate("/")} className="text-sm text-primary underline">Back to home</button>
        </div>
      </div>
    );
  }

  return (
    <div className="cc-ov-page min-h-screen bg-gradient-subtle">
      <header className="ov-page-hdr">
        <button className="back" onClick={goBack} title="Back" aria-label="Back">
          <ArrowLeft style={{ width: 18, height: 18 }} />
        </button>
        <b>Oversight</b>
      </header>
      <main className="px-4 pb-6">
        <OversightTab />
      </main>
    </div>
  );
}
