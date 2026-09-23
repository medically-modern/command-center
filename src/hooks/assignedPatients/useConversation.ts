/**
 * One SMS conversation's live state — the history, whether we saw ALL of it,
 * the opt-out verdict, and a send that re-reads the thread afterwards.
 *
 * Extracted from `ConversationThread` so the Communications inbox's timeline
 * (COMMS_INBOX_PLAN.md §4.6) renders the SAME guards rather than a copy of them:
 *
 *  · **Opt-out.** The consent rule needs the WHOLE history, so `historyComplete`
 *    rides beside the messages and a partial thread is never read as consent.
 *  · **The late delivery failure** (CLAUDE.md §5.5). A send resolves while the
 *    text is `Queued`; RingCentral flips it to `SendingFailed` seconds later, so
 *    the thread is re-read at +6s and +20s (`useDeliveryRecheck`).
 *
 * ⚠️ There is exactly one copy of each guard, and it is here or in `Composer`.
 * A second copy is how one surface stops honouring a STOP.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchConversation, sendMessage, type ConversationMessage } from "@/lib/assignedPatients/messagingApi";
import { consentState, type ConsentState } from "@/lib/assignedPatients/optOut";
import { useDeliveryRecheck } from "@/hooks/useDeliveryRecheck";

export interface ConversationView {
  phone: string;
  messages: ConversationMessage[];
  /** We read the whole thread. Consent can't be inferred from a partial one. */
  historyComplete: boolean;
  loading: boolean;
  error: string | null;
  consent: ConsentState;
  /** Re-read the thread. `showSpinner` false for a quiet refresh. */
  reload: (showSpinner?: boolean) => Promise<void>;
  /**
   * Send a text, re-read the thread, and arm the late-failure recheck. Throws
   * when the send fails — the caller reports it (and keeps the draft).
   *
   * `onAccepted` runs the moment RingCentral ACCEPTS the text, before the
   * re-read — the composer clears its draft there, as the thread always did
   * before the extraction. ⚠️ Clearing after the re-read instead left the sent
   * text in the box while the thread reloaded, and wiped a follow-up typed in
   * that window (2026-09-23 review).
   *
   * ⚠️ Does NOT check consent: the composer refuses before calling this, and
   * that refusal is the one copy of the rule.
   */
  send: (text: string, onAccepted?: () => void) => Promise<void>;
}

/**
 * @param phone          the number whose thread this is
 * @param mondayItemId   the patient record an outbound text is about, so the
 *                       gateway can tie the send to it (§5.28)
 */
export function useConversation(phone: string, mondayItemId?: string | null): ConversationView {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  // ⚠️ Starts FALSE and is reset to false on every phone change and every failed
  // load. Starting true meant an empty message list read as "complete history,
  // no STOP found" — so the composer was live during the load, and stayed live
  // after a load that failed outright. Not knowing must never look like consent.
  const [historyComplete, setHistoryComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A delivery failure lands seconds AFTER the send resolves — see the hook.
  const recheck = useDeliveryRecheck();
  /**
   * The number a read was started for. Every caller keys the component on the
   * number, so this is belt and braces — but a read for the PREVIOUS number
   * landing on this one would put one patient's texts under another's name, so
   * the answer is dropped unless it is still the one on screen.
   */
  const want = useRef(phone);
  want.current = phone;

  const load = useCallback(
    async (showSpinner = true) => {
      const forPhone = phone;
      if (showSpinner) setLoading(true);
      try {
        const thread = await fetchConversation(forPhone);
        if (want.current !== forPhone) return;
        setMessages(thread.messages);
        setHistoryComplete(thread.complete);
        setError(null);
      } catch (e) {
        if (want.current !== forPhone) return;
        // A history we couldn't read is a history we can't clear for sending.
        setHistoryComplete(false);
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (want.current === forPhone) setLoading(false);
      }
    },
    [phone],
  );

  useEffect(() => {
    // ⚠️ A recheck armed for the previous number would paint that
    // conversation into this one.
    recheck.cancel();
    setMessages([]);
    setHistoryComplete(false);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  const send = useCallback(
    async (text: string, onAccepted?: () => void) => {
      await sendMessage({ to: phone, text, mondayItemId: mondayItemId || undefined });
      onAccepted?.();
      await load(false);
      // This first read shows it Queued; the failure, if any, arrives later.
      recheck.schedule(() => load(false));
    },
    [phone, mondayItemId, load, recheck],
  );

  const consent = useMemo(() => consentState(messages, historyComplete), [messages, historyComplete]);

  return useMemo(
    () => ({ phone, messages, historyComplete, loading, error, consent, reload: load, send }),
    [phone, messages, historyComplete, loading, error, consent, load, send],
  );
}
