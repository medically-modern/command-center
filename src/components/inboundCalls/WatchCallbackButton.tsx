/**
 * "Ring me when they call back" — the one way a number gets onto your list.
 *
 * ⚠️ Membership is EXPLICIT (Josh, 2026-08-05). Texting a patient does not
 * enrol them, opening their thread does not enrol them, calling them does not
 * enrol them. This button does, and nothing else. An earlier cut inferred the
 * list from sent_messages, which quietly turned "only my list" into "all calls"
 * for the reps who text most — precisely the people who'd choose a narrow list.
 *
 * It lives on the conversation because that is the moment the intent exists:
 * you've just told a patient to call back, and now you want to hear it.
 *
 * Renders nothing at all when the rep is on `all` — there is no list to be on,
 * and a toggle that changes nothing is worse than no toggle.
 */
import { useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { toast } from "sonner";
import {
  addAllowedNumber,
  checkAllowedNumber,
  inboundCallsConfigured,
  removeAllowedNumber,
} from "@/lib/inboundCalls/callsApi";
import { cn } from "@/lib/utils";

interface Props {
  phone: string;
  /** Shown as the entry's note, so the settings list isn't a wall of digits. */
  label?: string;
}

export default function WatchCallbackButton({ phone, label }: Props) {
  const [pinned, setPinned] = useState<boolean | null>(null);
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!inboundCallsConfigured() || !phone) return;
    let alive = true;
    checkAllowedNumber(phone)
      .then((r) => {
        if (!alive) return;
        setPinned(r.pinned);
        setId(r.id);
      })
      // Unknown stays unknown: rendering "not watched" on a failed check would
      // invite a second add, and the row would look wrong until reload.
      .catch(() => alive && setPinned(null));
    return () => {
      alive = false;
    };
  }, [phone]);

  if (!inboundCallsConfigured() || pinned === null) return null;

  const toggle = async () => {
    setBusy(true);
    const next = !pinned;
    setPinned(next); // optimistic — reverted below if the write fails
    try {
      if (next) {
        const entry = await addAllowedNumber(phone, label || "");
        setId(entry.id);
        toast.success("You'll be notified when this number calls.");
      } else {
        await removeAllowedNumber(id);
        toast.success("Removed from your ring list.");
      }
    } catch (e) {
      setPinned(!next);
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={() => void toggle()}
      disabled={busy}
      title={pinned ? "Stop notifying me about this number" : "Notify me when they call back"}
      aria-pressed={pinned}
      className={cn(
        "h-8 w-8 rounded-lg border flex items-center justify-center transition-colors disabled:opacity-50",
        pinned
          ? "border-amber-500/40 bg-amber-500/10 text-amber-600"
          : "border-border text-muted-foreground hover:bg-muted",
      )}
    >
      {pinned ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
    </button>
  );
}
