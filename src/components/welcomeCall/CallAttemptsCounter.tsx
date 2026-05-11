import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Phone, Plus, Loader2 } from "lucide-react";
import { sendCallAttemptsToMonday, sendFollowUpToMonday } from "@/lib/welcomeCall/mondayWrite";
import { toast } from "sonner";

/** Get tomorrow's date in YYYY-MM-DD using Eastern Time. */
function getTomorrow(): string {
  const now = new Date();
  // Use ET so all users see the same "tomorrow"
  const etStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [y, m, d] = etStr.split("-").map(Number);
  const tomorrow = new Date(y, m - 1, d + 1);
  return tomorrow.toISOString().slice(0, 10);
}

interface Props {
  itemId: string;
  callAttempts: string;
  onUpdate: (count: string) => void;
  onFollowUp?: () => void;
}

export function CallAttemptsCounter({ itemId, callAttempts, onUpdate, onFollowUp }: Props) {
  const [saving, setSaving] = useState(false);
  const count = Number(callAttempts) || 0;

  const handleIncrement = async () => {
    const newCount = count + 1;
    onUpdate(String(newCount));
    setSaving(true);
    try {
      const tomorrow = getTomorrow();
      // Write call attempts + follow-up in parallel
      await Promise.all([
        sendCallAttemptsToMonday(itemId, newCount),
        sendFollowUpToMonday(itemId, tomorrow),
      ]);
      toast.success(`Call attempt #${newCount} logged — follow up ${tomorrow}`);
      onFollowUp?.();
    } catch (e) {
      toast.error("Failed to save call attempt", {
        description: e instanceof Error ? e.message : String(e),
      });
      // revert
      onUpdate(String(count));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/30 bg-white/10 px-4 py-2">
      <Phone className="h-4 w-4 text-white/70" />
      <span className="text-xs uppercase tracking-wider text-white/80 font-semibold">
        Call Attempts
      </span>
      <span className="text-lg font-bold tabular-nums min-w-[2ch] text-center text-white">
        {count}
      </span>
      <Button
        size="sm"
        onClick={handleIncrement}
        disabled={saving}
        className="gap-1 h-8 bg-white text-navy hover:bg-white/90 font-semibold shadow-elevate"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        +1
      </Button>
    </div>
  );
}
