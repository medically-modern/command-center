/**
 * The resolve bar — under the composer in the Inbox, and compact at the top of
 * the patient screen's Texts | Calls column (COMMS_INBOX_PLAN.md §1.1, §5).
 *
 *   Waiting 3h 12m            Mark resolved: [Called] [Texted] [No action needed]   [Left voicemail]
 *
 *  · **Called** opens an inline note, *"What did you talk about? (required)"*,
 *    and resolves only once it has text — by Enter or Resolve. The server
 *    refuses a Called with no note too (400).
 *  · **Texted** and **No action needed** resolve at once, then offer *"Add a
 *    note (optional)"* while the row is sticky.
 *  · **Left voicemail** is an ATTEMPT (§9.1 D6): it logs, keeps the item open
 *    and its 24-hour clock running, and never resolves anything — which is why
 *    it sits apart from the three.
 *  · **The suggestion** — a connected callback or a text somebody sent here
 *    since the item opened — marks its button as a QUESTION (dashed amber,
 *    "Texted? 2:40 PM") and turns the label into *Suggested — press to
 *    confirm*. It never resolves anything on its own, and it is never green:
 *    green is what resolved looks like (Brandon, 2026-09-29).
 *
 * ⚠️ Keyed on the item by the caller, so a half-typed Called note can never
 * follow the rep onto a different patient (§9's notes-box rule).
 *
 * ⚠️ `seenThrough` is the newest inbound event the rep was SHOWN. Anything that
 * arrived after it stays open — that is what stops a text landing while the rep
 * types being swallowed by the resolve (plan §4.4).
 *
 * ⚠️ **A resolve marks the item's texts READ in RingCentral** (Josh,
 * 2026-09-27), exactly as opening the conversation in the Text tab does — the
 * texts the resolve covered, on `textNumbers` (`markTextsRead`). Called, Texted
 * and No action needed; never Left voicemail, which resolves nothing. The
 * resolve has already landed when it runs, so a failure only says so.
 * `textNumbers` is REQUIRED so a new caller cannot forget it.
 */
import { useState } from "react";
import { Check, Loader2, Voicemail } from "lucide-react";
import { toast } from "sonner";
import {
  InboxConflict,
  addResolutionNote,
  resolveItem,
  undoResolution,
  type ResolveResult,
  type NoteTarget,
} from "@/lib/commsInbox/api";
import { markTextsRead } from "@/lib/fax/ringcentralApi";
import { reloadTextsIfLoaded } from "@/hooks/commsHub/useHubData";
import {
  HOW_LABEL,
  KIND_LABEL,
  NOTE_MAX,
  formatShort,
  formatWait,
  formatWhen,
  whoShort,
  type ItemState,
  type ResolveHow,
} from "@/lib/commsInbox/rules";
import { cn } from "@/lib/utils";

/**
 * The resolution this session just made on an item — what Undo acts on, and
 * what the bar shows as resolved in the moment before the item is re-read.
 */
export type StickyResolution = ResolveResult & { key: string; note: string };

const RESOLVING: ("called" | "texted" | "no_action")[] = ["called", "texted", "no_action"];

export default function ResolveBar({
  itemKey,
  state,
  seenThrough,
  sticky,
  onResolved,
  onUndone,
  onChanged,
  compact = false,
  noteTarget = null,
  textNumbers,
}: {
  itemKey: string;
  /** The item's full numbers (E.164). A resolve marks the texts it covered on
   *  these Read in RingCentral; an empty list marks nothing. */
  textNumbers: string[];
  state: ItemState;
  seenThrough: number | null;
  /** Where the note is copied when that is NOT the item's own patient — the
   *  other patient on a shared line. Null: the item's own (the gateway's default). */
  noteTarget?: NoteTarget | null;
  /** The resolution this session just made on THIS item — Undo and the optional note. */
  sticky: StickyResolution | null;
  onResolved: (r: ResolveResult, note: string) => void;
  onUndone: () => void;
  /** Something changed that the caller should re-read (a note, a conflict). */
  onChanged: () => void;
  compact?: boolean;
}) {
  const [calling, setCalling] = useState(false);
  const [note, setNote] = useState("");
  const [after, setAfter] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const conflictToast = (e: InboxConflict) => {
    const c = e.conflict;
    toast.error(
      c ? `${whoShort(c.by) || c.by} already resolved this — ${HOW_LABEL[c.how] ?? c.label} · ${formatWhen(c.at)}` : e.message,
    );
    onChanged();
  };

  const resolve = async (how: ResolveHow, text = "") => {
    if (busy) return;
    if (how === "called" && !text.trim()) return;
    setBusy(how);
    try {
      const r = await resolveItem({ key: itemKey, how, note: text, seenThrough, ...(noteTarget ? { noteTarget } : {}) });
      setCalling(false);
      setNote("");
      if (how === "left_vm") {
        toast.success("Logged — left voicemail. It stays open and the clock keeps running.", {
          action: { label: "Undo", onClick: () => void undo(r.resolutionId, true) },
        });
        onChanged();
      } else {
        onResolved(r, text.trim());
        markResolvedTextsRead(r.coversThrough);
      }
    } catch (e) {
      if (e instanceof InboxConflict) conflictToast(e);
      else toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const markResolvedTextsRead = (coversThrough: number) => {
    void markTextsRead(textNumbers, coversThrough)
      .then((n) => {
        if (n) reloadTextsIfLoaded();
      })
      .catch((e: unknown) => {
        toast.error(`Resolved — but couldn't mark the text read in RingCentral: ${e instanceof Error ? e.message : String(e)}`);
      });
  };

  const undo = async (resolutionId: string, attempt = false) => {
    try {
      await undoResolution(resolutionId);
      if (attempt) onChanged();
      else onUndone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      onChanged();
    }
  };

  const saveAfter = async () => {
    if (!sticky || !after.trim() || busy) return;
    setBusy("note");
    try {
      await addResolutionNote(sticky.resolutionId, after);
      setAfter("");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const pad = compact ? "px-3 py-2.5" : "px-4 pb-3 pt-2";

  /* ── resolved ─────────────────────────────────────────────────────────── */
  if (!state.open) {
    const r = state.lastResolution;
    if (!r) return null;
    const mine = sticky && sticky.resolutionId === r.resolutionId;
    const offerNote = !compact && mine && !r.note && (r.how === "texted" || r.how === "no_action");
    return (
      <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-emerald-700 dark:text-emerald-400", pad)}>
        <Check className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={r.note || undefined}>
          Resolved · {HOW_LABEL[r.how] ?? r.label} · {whoShort(r.by) || r.by} · {formatWhen(r.at)}
          {r.note ? ` — “${r.note}”` : ""}
        </span>
        {/* Undo in BOTH sizes: until the rep moves on, nothing has reached
            Monday, and taking a resolution back is the whole point of that
            window (plan §5.4). Only the optional note is Inbox-only. */}
        {mine && (
          <button onClick={() => void undo(r.resolutionId)} className="shrink-0 font-semibold underline hover:no-underline">
            Undo
          </button>
        )}
        {offerNote && (
          <div className="flex basis-full items-center gap-2 pl-5">
            <input
              value={after}
              onChange={(e) => setAfter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveAfter();
              }}
              maxLength={NOTE_MAX}
              placeholder="Add a note (optional)"
              aria-label="Add a note (optional)"
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={() => void saveAfter()}
              disabled={!after.trim() || !!busy}
              className="shrink-0 font-semibold underline disabled:opacity-40 disabled:no-underline"
            >
              {busy === "note" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
            </button>
          </div>
        )}
      </div>
    );
  }

  const waitTitle = state.openedBy
    ? `Opened by ${KIND_LABEL[state.openedBy.kind].toLowerCase()} · ${formatWhen(state.openedBy.at)}`
    : undefined;

  /* ── Called: the required note ───────────────────────────────────────── */
  if (calling) {
    return (
      <div className={cn("flex flex-wrap items-center gap-2 text-xs", pad)}>
        <span className="shrink-0 font-semibold text-foreground">Called</span>
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && note.trim()) void resolve("called", note);
            if (e.key === "Escape") {
              setCalling(false);
              setNote("");
            }
          }}
          maxLength={NOTE_MAX}
          placeholder="What did you talk about? (required)"
          aria-label="Call note, required"
          className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={() => void resolve("called", note)}
          disabled={!note.trim() || !!busy}
          className="inline-flex shrink-0 items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-45"
        >
          {busy === "called" && <Loader2 className="h-3 w-3 animate-spin" />}
          Resolve
        </button>
        <button
          onClick={() => {
            setCalling(false);
            setNote("");
          }}
          className="shrink-0 text-muted-foreground underline hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    );
  }

  /* ── open ─────────────────────────────────────────────────────────────── */
  const sug = state.suggestion;
  const lastAttempt = state.attempts.length ? state.attempts[state.attempts.length - 1] : null;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs", pad)}>
      <span
        title={waitTitle}
        className={cn(
          "shrink-0 whitespace-nowrap font-semibold tabular-nums",
          state.over ? "text-destructive" : "text-muted-foreground",
        )}
      >
        Waiting {formatWait(state.waitMs)}
      </span>
      {lastAttempt && (
        <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">
          · Left voicemail · {whoShort(lastAttempt.by)} {formatShort(lastAttempt.at)}
          {state.attempts.length > 1 ? ` (${state.attempts.length} tries)` : ""}
        </span>
      )}
      {/* ⚠️ Compact (the patient screen's 380px column) keeps the four
          buttons on ONE line (Josh, 2026-09-25: *"can we have left voicemail
          on same line, instead of next row"*): the group never wraps
          internally — when the row is tight, the whole group drops below
          "Waiting" as one line instead of orphaning Left voicemail. */}
      <span className={cn("ml-auto flex items-center", compact ? "flex-nowrap gap-1" : "flex-wrap gap-1.5")}>
        {!compact && (
          <span className="mr-0.5 whitespace-nowrap text-[11px] text-muted-foreground">
            {sug ? "Suggested — press to confirm" : "Mark resolved"}
          </span>
        )}
        {RESOLVING.map((how) => {
          const suggested = sug?.how === how;
          return (
            <button
              key={how}
              onClick={() => (how === "called" ? setCalling(true) : void resolve(how))}
              disabled={!!busy}
              title={suggested ? `${HOW_LABEL[how]} ${formatWhen(sug.at)}${sug.by ? ` · ${whoShort(sug.by)}` : ""} — confirm to resolve` : undefined}
              className={cn(
                "inline-flex items-center gap-1 whitespace-nowrap rounded-full border font-semibold transition-colors disabled:opacity-50",
                compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
                // ⚠️ A suggestion is a QUESTION, never a green fill (Brandon,
                // 2026-09-29: *"Texted suggestion color is confusing - looks
                // marked already"*). Green is what RESOLVED looks like (the
                // check row above), so the suggested button is dashed amber
                // with a "?" until somebody presses it.
                suggested
                  ? "border-dashed border-amber-500 bg-card text-foreground hover:bg-amber-50 dark:border-amber-400 dark:hover:bg-amber-500/10"
                  : "border-border bg-card text-foreground hover:border-[color:var(--mm-green)]",
              )}
            >
              {busy === how && <Loader2 className="h-3 w-3 animate-spin" />}
              {HOW_LABEL[how]}
              {suggested && "?"}
              {/* ⚠️ Compact keeps the time in the hover only: inline, it pushed
                  Left voicemail out of the 380px column (measured 2026-09-29 —
                  it overflowed before the "?" too). */}
              {suggested && !compact && (
                <em className="ml-0.5 font-medium not-italic text-amber-700 dark:text-amber-300">{formatShort(sug.at)}</em>
              )}
            </button>
          );
        })}
        {/* Apart from the three, because it resolves nothing. */}
        <button
          onClick={() => void resolve("left_vm")}
          disabled={!!busy}
          title="Logs the attempt. The item stays open and the 24-hour clock keeps running."
          className={cn(
            "inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-dashed border-border font-medium text-muted-foreground hover:text-foreground disabled:opacity-50",
            compact ? "ml-0.5 px-2 py-1 text-[11px]" : "ml-1 px-3 py-1.5 text-xs",
          )}
        >
          {busy === "left_vm" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Voicemail className="h-3 w-3" />}
          Left voicemail
        </button>
      </span>
    </div>
  );
}
