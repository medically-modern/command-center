/**
 * The patient screen's compact resolve bar (COMMS_INBOX_PLAN.md §1.2): at the
 * top of the Texts | Calls column whenever the patient has an open item, and
 * their last resolution when they have none. Nothing at all when there is
 * neither — and nothing when the Inbox is switched off, so the patient screen
 * is exactly what it was (plan §8).
 *
 * ⚠️ It is the Inbox's own `ResolveBar`, never a copy: Called still needs its
 * note, a 409 still names who got there first, Left voicemail is still an
 * attempt that closes nothing.
 *
 * ⚠️ **Read on open, never polled.** One Postgres read per patient opened —
 * `/comms/state`, which touches RingCentral not at all — and again after the
 * rep acts on it. The screen is a reference view; the Inbox is where the queue
 * is watched.
 *
 * ⚠️ **Leaving the patient is this screen's "moving on"** (plan §5.4, Josh's
 * D5). The column is keyed on the record, so a patient change unmounts this bar,
 * and that is when a note made here is copied to Monday — the same deferral the
 * Inbox has, and the reason Undo is offered here too.
 *
 * ⚠️ `seenThrough` is the state's own newest open event: what this bar was
 * describing when the rep pressed. Anything that arrived after that read stays
 * open, exactly as in the Inbox (plan §4.4).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ResolveBar, { type StickyResolution } from "@/components/commsInbox/ResolveBar";
import { flushCommsOutbox, invalidateInbox, useCommsConfig } from "@/hooks/commsInbox/useInbox";
import { fetchCommsState, type NoteTarget, type ResolveResult } from "@/lib/commsInbox/api";
import type { ItemState } from "@/lib/commsInbox/rules";
import { contactKey } from "@/lib/contactState/contactState";

export function PatientResolveBar({
  numbers,
  noteTarget = null,
}: {
  numbers: string[];
  /**
   * The patient on THIS screen. A number two patients share files under one of
   * them, so the item this bar shows can be the other patient's; a note made
   * here is about the patient the rep is looking at, and is copied to them
   * (2026-09-23 review).
   */
  noteTarget?: NoteTarget | null;
}) {
  const cfg = useCommsConfig();
  /** A string, so a fresh array from the parent each render is not a new read
   *  (INCIDENT_2026-08-20 rule 2). */
  const sig = useMemo(
    () => [...new Set(numbers.map((n) => contactKey(n)).filter((k) => k.length === 10))].join(","),
    [numbers],
  );
  const [data, setData] = useState<{ key: string; state: ItemState } | null>(null);
  const [sticky, setSticky] = useState<StickyResolution | null>(null);
  const stickyRef = useRef<StickyResolution | null>(null);
  stickyRef.current = sticky;
  const want = useRef(0);

  const load = useCallback(async () => {
    const token = ++want.current;
    if (!sig) {
      setData(null);
      return;
    }
    try {
      const out = await fetchCommsState(sig.split(","));
      if (token !== want.current) return;
      setData(out.key && out.state ? { key: out.key, state: out.state } : null);
    } catch {
      // A reference view: a failed read shows nothing rather than a bar that
      // might be wrong. The Inbox is where an item is worked.
      if (token === want.current) setData(null);
    }
  }, [sig]);

  useEffect(() => {
    setSticky(null);
    if (cfg.ui) void load();
  }, [cfg.ui, load]);

  useEffect(() => {
    if (!cfg.enabled) return;
    return () => {
      // Leaving the patient is moving on from what was resolved here.
      void flushCommsOutbox(stickyRef.current?.resolutionId);
    };
  }, [cfg.enabled]);

  const onResolved = useCallback(
    (r: ResolveResult, note: string) => {
      if (!data) return;
      setSticky({ ...r, key: data.key, note });
      // Resolved at once; the re-read confirms it (or reopens it, if a
      // message landed after what the bar described).
      setData({
        key: data.key,
        state: {
          ...data.state,
          open: false,
          suggestion: null,
          lastResolution: {
            resolutionId: r.resolutionId,
            how: r.how,
            label: r.label,
            by: r.by,
            at: r.resolvedAt,
            note,
            coversThrough: r.coversThrough,
            mirrored: false,
          },
        },
      });
      invalidateInbox();
      void load();
    },
    [data, load],
  );

  const changed = useCallback(() => {
    invalidateInbox();
    void load();
  }, [load]);

  if (!cfg.ui || !data) return null;
  const { state } = data;
  if (!state.open && !state.lastResolution) return null;
  return (
    <div className="pt-resolve" data-state={state.open ? (state.over ? "over" : "open") : "resolved"}>
      <ResolveBar
        key={data.key}
        compact
        itemKey={data.key}
        state={state}
        seenThrough={state.newestOpenAt}
        sticky={sticky && sticky.key === data.key ? sticky : null}
        noteTarget={noteTarget}
        onResolved={onResolved}
        onUndone={() => {
          setSticky(null);
          changed();
        }}
        onChanged={changed}
      />
    </div>
  );
}
