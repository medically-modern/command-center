import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle, Send } from "lucide-react";

interface Props {
  onSend: () => Promise<void>;
  disabled?: boolean;
  validationErrors?: string[];
}

export function SendToMondayButton({ onSend, disabled, validationErrors = [] }: Props) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleClick = async () => {
    setSending(true);
    try {
      await onSend();
      setSent(true);
      setTimeout(() => setSent(false), 3000);
    } catch {
      // error is handled by parent via toast
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2">
      <Button
        onClick={handleClick}
        disabled={disabled || sending}
        className="w-full gap-2 h-12 text-base font-semibold bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-600 hover:to-emerald-600 text-white shadow-lg"
      >
        {sending ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" /> Sending…
          </>
        ) : sent ? (
          <>
            <CheckCircle className="h-5 w-5" /> Confirmed & Sent!
          </>
        ) : (
          <>
            <Send className="h-5 w-5" /> Confirm Profile & Send to Monday
          </>
        )}
      </Button>

      {validationErrors.length > 0 && (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 px-4 py-2 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">Missing before send</p>
          <p className="mt-0.5 text-xs text-amber-600">{validationErrors.join(" · ")}</p>
        </div>
      )}
    </div>
  );
}
