/**
 * "Which calls ring me" — each employee's own settings.
 *
 * ⚠️ This is a NOTIFICATION filter, never routing (Josh, 2026-08-05). The
 * Command Center is one instance; every call lands on the shared line and it
 * does not matter who picks up. Narrowing your list quiets YOUR screen — it
 * cannot make a call unanswerable by anyone else, and the copy below says so
 * because the opposite assumption would make people afraid to use it.
 *
 * The allow list stores HMACs, not numbers (services/monday-gateway/
 * inboundCalls.mjs) — which is why an entry reads "•••‑0101" and why removal
 * keys on the id the row was rendered with rather than sending the number back.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  addAllowedNumber,
  fetchRingPrefs,
  removeAllowedNumber,
  saveRingPrefs,
  type RingMode,
  type RingPrefs,
} from "@/lib/inboundCalls/callsApi";
import { cn } from "@/lib/utils";

const MODES: Array<{ id: RingMode; label: string; hint: string }> = [
  { id: "all", label: "Every call", hint: "Anything that comes in on the main line." },
  { id: "list", label: "Only my list", hint: "Just the numbers you've put on it, below." },
  { id: "off", label: "Nothing", hint: "Stay quiet. You can still call out." },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RingPreferencesDialog({ open, onOpenChange }: Props) {
  const [prefs, setPrefs] = useState<RingPrefs | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newNumber, setNewNumber] = useState("");
  const [newLabel, setNewLabel] = useState("");
  /** Latest-wins bookkeeping for persist(); see the note there. */
  const saveSeq = useRef(0);
  const inFlight = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchRingPrefs()
      .then(setPrefs)
      .catch((e: Error) => toast.error(e.message))
      .finally(() => setLoading(false));
  }, [open]);

  /**
   * Persist immediately — a settings panel with a Save button people forget to
   * press is a settings panel that silently doesn't work.
   *
   * ⚠️ Writes are SERIALISED and superseded ones are dropped. Each call sends a
   * full snapshot, and the ordinary interaction fires two in a few
   * milliseconds: typing a number and then clicking a mode blurs the input
   * (save A) and clicks (save B). Left concurrent, A can land last and revert
   * the server — and the SSE prefs push with it — to a state the user has
   * already moved on from, while the dialog still shows their newer choice and
   * says "Saved". Only the newest intent is worth writing.
   */
  const persist = useCallback((next: RingPrefs) => {
    setPrefs(next);
    const seq = ++saveSeq.current;
    setSaving(true);
    inFlight.current = inFlight.current
      .catch(() => {})
      .then(async () => {
        // A newer persist is already queued behind this one and carries the
        // state this write would have clobbered. The last link in the chain
        // always matches, so something always gets written.
        if (seq !== saveSeq.current) return;
        try {
          await saveRingPrefs({ mode: next.mode, forwardNumber: next.forwardNumber });
        } catch (e) {
          toast.error((e as Error).message);
        }
      })
      .finally(() => {
        if (seq === saveSeq.current) setSaving(false);
      });
  }, []);

  const addNumber = async () => {
    if (!prefs || !newNumber.trim()) return;
    try {
      const entry = await addAllowedNumber(newNumber, newLabel);
      setPrefs({ ...prefs, allow: [entry, ...prefs.allow.filter((a) => a.id !== entry.id)] });
      setNewNumber("");
      setNewLabel("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const removeNumber = async (id: string) => {
    if (!prefs) return;
    const before = prefs.allow;
    setPrefs({ ...prefs, allow: before.filter((a) => a.id !== id) });
    try {
      await removeAllowedNumber(id);
    } catch (e) {
      setPrefs({ ...prefs, allow: before });
      toast.error((e as Error).message);
    }
  };

  const askNotifications = async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    if (result === "granted") toast.success("You'll get a desktop alert when the tab is in the background.");
    else toast.info("Desktop alerts stay off. Calls still appear in the app.");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Which calls ring me</DialogTitle>
          <DialogDescription>
            Everyone shares the main line and anyone can pick up. This only changes what reaches
            your screen — it never stops a colleague from taking a call.
          </DialogDescription>
        </DialogHeader>

        {loading || !prefs ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Without this the Take-it button has nowhere to send the call, so
                it leads rather than hiding at the bottom. */}
            <div className="space-y-1.5">
              <label htmlFor="ring-at" className="text-sm font-medium">
                Ring me at
              </label>
              <input
                id="ring-at"
                value={prefs.forwardNumber}
                onChange={(e) => setPrefs({ ...prefs, forwardNumber: e.target.value })}
                onBlur={() => void persist(prefs)}
                placeholder="(347) 555-0123"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <p className="text-[11px] text-muted-foreground">
                Your desk phone or cell. When you take a call, RingCentral transfers it here and
                your phone rings — so you answer wherever you already pick up calls.
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">Notify me about</p>
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => void persist({ ...prefs, mode: m.id })}
                  className={cn(
                    "w-full text-left rounded-lg border px-3 py-2.5 transition-colors",
                    prefs.mode === m.id
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <p className="text-sm font-medium">{m.label}</p>
                  <p className="text-[11px] text-muted-foreground">{m.hint}</p>
                </button>
              ))}
            </div>

            {prefs.mode === "list" && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Numbers that ring me</p>
                  <p className="text-[11px] text-muted-foreground">
                    Only these. Texting or calling a patient never adds them here — use the bell on
                    a conversation when you're expecting a call back.
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={newNumber}
                      onChange={(e) => setNewNumber(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void addNumber()}
                      placeholder="Phone number"
                      className="flex-1 min-w-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                    <input
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && void addNumber()}
                      placeholder="Note (optional)"
                      className="w-32 shrink-0 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                    />
                    <button
                      onClick={() => void addNumber()}
                      disabled={!newNumber.trim()}
                      title="Add"
                      className="h-8 w-8 shrink-0 rounded-md bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>

                  {prefs.allow.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5"
                    >
                      <span className="text-sm tabular-nums">•••&nbsp;{a.last4 || "????"}</span>
                      {a.label && (
                        <span className="text-[11px] text-muted-foreground truncate">{a.label}</span>
                      )}
                      <button
                        onClick={() => void removeNumber(a.id)}
                        title="Remove"
                        className="ml-auto p-1 rounded hover:bg-muted text-muted-foreground shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {!prefs.allow.length && (
                    <p className="text-[11px] text-muted-foreground">
                      No pinned numbers yet. Add one when you're waiting on a callback.
                    </p>
                  )}
                </div>
              </div>
            )}

            <button
              onClick={() => void askNotifications()}
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted/50"
            >
              <Bell className="h-4 w-4" />
              Alert me when this tab is in the background
            </button>

            <p className="text-[11px] text-muted-foreground text-right h-4">
              {saving ? "Saving…" : "Saved automatically"}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
