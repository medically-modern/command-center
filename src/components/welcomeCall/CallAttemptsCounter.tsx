import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Phone, Plus, Loader2 } from "lucide-react";
import { sendCallAttemptsToMonday } from "@/lib/welcomeCall/mondayWrite";
import { toast } from "sonner";

interface Props {
  itemId: string;
  callAttempts: string;
  onUpdate: (count: string) => void;
}

export function CallAttemptsCounter({ itemId, callAttempts, onUpdate }: Props) {
  const [saving, setSaving] = useState(false);
  const count = Number(callAttempts) || 0;

  const handleIncrement = async () => {
    const newCount = count + 1;
    onUpdate(String(newCount));
    setSaving(true);
    try {
      await sendCallAttemptsToMonday(itemId, newCount);
      toast.success(`Call attempt #${newCount} logged`);
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
    <div className="flex items-center gap-3 rounded-lg border border-input bg-muted/30 px-4 py-2">
      <Phone className="h-4 w-4 text-muted-foreground" />
      <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
        Call Attempts
      </span>
      <span className="text-lg font-bold tabular-nums min-w-[2ch] text-center">
        {count}
      </span>
      <Button
        variant="outline"
        size="sm"
        onClick={handleIncrement}
        disabled={saving}
        className="gap-1 h-8"
      >
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        +1
      </Button>
    </div>
  );
}
