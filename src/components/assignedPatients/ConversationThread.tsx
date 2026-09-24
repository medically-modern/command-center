/**
 * One SMS conversation: the message history, a composer that sends from the MM
 * number, and click-to-call.
 *
 * The state, the opt-out guard and the late-delivery recheck live in
 * `useConversation`; the composer and the Can Text block in `Composer`; a text
 * bubble in `MessageBubble`. They were extracted (COMMS_INBOX_PLAN.md §4.6) so
 * the Communications inbox's timeline renders the same guards rather than a
 * copy of them — this component still renders exactly what it did before.
 *
 * ⚠️ The opt-out rule is in `Composer`: if the patient has texted STOP (or
 * another CTIA keyword) the composer is disabled. RingCentral only auto-honors
 * opt-out on High Volume SMS, and we send through plain /sms, so nothing
 * upstream stops this.
 */
import { useEffect, useRef } from "react";
import { Loader2, Phone } from "lucide-react";
import type { PatientRef } from "@/lib/assignedPatients/patientLookup";
import { fmtPhone } from "@/lib/assignedPatients/format";
import WatchCallbackButton from "@/components/inboundCalls/WatchCallbackButton";
import { useConversation } from "@/hooks/assignedPatients/useConversation";
import Composer from "./Composer";
import MessageBubble from "./MessageBubble";

interface Props {
  phone: string;
  patient: PatientRef | null;
  /** Start the call (in-browser softphone). */
  onCall: () => void;
  calling: boolean;
  /**
   * The patient's **Can Text** column (§5.46e), when the caller holds it.
   *
   * ⚠️ **OPT-IN: absent means `"unknown"`, which is today's behaviour exactly**
   * — the three call sites that pass nothing are byte-identical. Only the
   * patient screen reads that column, and only the Subscription and Welcome
   * Call boards carry it. The rule itself is `Composer`'s.
   */
  canText?: "yes" | "no" | "unknown";
  /**
   * The patient screen's look (Brandon's pixel-match item 14, 2026-09-24):
   * no header — the name, the bell and the Call button are drawn by that
   * screen's own top bar and number line — and the one-line composer.
   * ⚠️ **OPT-IN, and LOOK ONLY:** absent, this renders exactly what it always
   * has on the Communications hub; present, the thread, the guards and the send
   * are the same code. The bell is still on the hub's thread and in the ring
   * settings, which are the ways a number joins the ring list (§5.13).
   */
  bare?: boolean;
  /** Placeholder for the one-line composer (e.g. naming the alternate number). */
  composerPlaceholder?: string;
  /** Told how many messages the thread holds once it has loaded — the
   *  patient screen's "Texts N" tab. Never called while loading or on an error,
   *  so a count is only ever one the thread actually read. */
  onCount?: (n: number) => void;
}

export default function ConversationThread({
  phone,
  patient,
  onCall,
  calling,
  canText,
  bare = false,
  composerPlaceholder,
  onCount,
}: Props) {
  const conversation = useConversation(phone, patient?.itemId);
  const { messages, loading, error } = conversation;
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  useEffect(() => {
    if (!loading && !error) onCount?.(messages.length);
  }, [messages.length, loading, error, onCount]);

  return (
    <section className="flex-1 flex flex-col min-h-0 min-w-0">
      {!bare && (
        <header className="px-4 py-3 border-b border-border bg-card shrink-0 flex items-center gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">{patient?.name || fmtPhone(phone)}</h2>
            <p className="text-[11px] text-muted-foreground truncate">
              {fmtPhone(phone)}
              {patient?.boardName ? ` · ${patient.boardName}` : ""}
            </p>
          </div>
          {/* The only way a number joins your ring list — see the component. */}
          <div className="ml-auto shrink-0">
            <WatchCallbackButton phone={phone} label={patient?.name || ""} />
          </div>
          <button
            onClick={onCall}
            disabled={calling}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--mm-teal,theme(colors.teal.600))] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {calling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
            Call
          </button>
        </header>
      )}

      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-2 bg-gradient-subtle">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading conversation…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        ) : messages.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} m={m} />)
        )}
        <div ref={bottomRef} />
      </div>

      <Composer
        conversation={conversation}
        canText={canText}
        variant={bare ? "line" : "box"}
        placeholder={composerPlaceholder}
      />
    </section>
  );
}
