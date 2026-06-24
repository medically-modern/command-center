import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import OversightTab from "@/components/oversight/OversightTab";
import { useAccessContext } from "@/components/AccessProvider";

/**
 * Full-screen Oversight (the System Management › Oversight grid shown on its
 * own). Opened from the manager landing's "Managers" control. A back button
 * (upper-left) returns to wherever the user came from.
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
    <div className="min-h-screen bg-gradient-subtle">
      <header className="bg-card border-b border-border px-4 sm:px-6 py-3 flex items-center gap-3 sticky top-0 z-20">
        <button onClick={goBack} className="p-2 rounded-lg hover:bg-muted/50" title="Back">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-base font-semibold text-foreground">Oversight</h1>
      </header>
      <main className="p-4 sm:p-6">
        <OversightTab />
      </main>
    </div>
  );
}
