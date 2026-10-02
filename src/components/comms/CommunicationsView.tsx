/**
 * What the Communications popup shows (CLAUDE.md §5.50) — the patient's whole
 * back-and-forth with us, in one scroll: texts, calls with their recordings,
 * voicemails, and the Inbox's notes (resolutions and Left-voicemail attempts),
 * with a composer to text them. No action items (Josh, 2026-09-24).
 *
 * ⚠️⚠️ **IT IS THE HUB'S MIDDLE PANE, NOT A COPY OF IT.** The timeline is
 * `commsInbox/ItemTimeline` in its `"view"` mode — the same component, the
 * same `/comms/item` read, the same live-thread overlay, the same composer and
 * therefore the same STOP / Can Text / late-delivery guards (§5.5, §5.49). A
 * second timeline would be a second place those rules could drift.
 *
 * ⚠️ **Reads happen on OPEN, never on render of the page behind it.** This
 * component mounts only while the popup is open (Radix unmounts closed
 * content). `/comms/state` and `/comms/item` are Postgres reads on the
 * gateway; the live thread is the same read the old Text popup made on open.
 *
 * ⚠️ **It never dead-ends.** When the Inbox is switched off or cannot be read,
 * the popup falls back to what the Text and Calls buttons it replaced showed —
 * the live text thread and the RingCentral call history, side by side — and
 * says why. A button that opened a blank dialog would be a regression from the
 * two it replaced (§5.39f's lossless rule).
 *
 * ⚠️ **One live-call bar, inside the popup.** The app-wide `CallOverlay` sits
 * UNDER a modal dialog and cannot be clicked while one is open, so a rep who
 * presses Call in here needs Hang up and Mute in here too. It is a view over
 * the same softphone store — it never mounts a second overlay (§5.13b).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Grid3x3, Loader2, MessageSquare, Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import CallKeypad from "@/components/inboundCalls/CallKeypad";
import ItemTimeline from "@/components/commsInbox/ItemTimeline";
import { StagePill } from "@/components/commsInbox/pills";
import Composer from "@/components/assignedPatients/Composer";
import QuickTextBar from "@/components/comms/QuickTextBar";
import type { QuickTextsContext } from "@/lib/comms/quickTexts";
import MessageBubble from "@/components/assignedPatients/MessageBubble";
import { CallHistoryList } from "@/components/shared/CallHistoryList";
import { useConversation } from "@/hooks/assignedPatients/useConversation";
import { useWebPhone } from "@/hooks/assignedPatients/useWebPhone";
import { reportDial, useCommsConfig, useInboxItem } from "@/hooks/commsInbox/useInbox";
import { fetchCommsState } from "@/lib/commsInbox/api";
import { isUnmatchedKey } from "@/lib/commsInbox/rules";
import { activeNumber, numberKey, popupNumbers, withHeaderNumbers } from "@/lib/comms/commsPopup";
import { fmtPhone } from "@/lib/assignedPatients/format";
import { formatClock } from "@/lib/shared/audioScrub";

export interface CommunicationsViewProps {
  /** The patient's number on the page that opened the popup. */
  phone: string;
  /** Their other number, when the page holds one (a caregiver's line). */
  altPhone?: string;
  /** Whose communications these are — the page's own name for them. */
  name?: string;
  /** The board record an outbound text is about (§5.28). */
  mondayItemId?: string | null;
  /** The PRIMARY line's Can Text answer (§5.31d). Applies to that number only. */
  canText?: "yes" | "no" | "unknown";
  /** Drafts, held by the button so they outlive a close — keyed by number. */
  draftFor: (key: string) => string;
  setDraftFor: (key: string, text: string) => void;
  /** Told with the body of every text sent from here. */
  onTextSent?: (body: string) => void;
  /**
   * Drawn in the Care Coordinator's side panel (~760px) rather than full
   * screen. Only the fallback cares: its texts and calls sit side by side at
   * `lg`, which is a VIEWPORT breakpoint and would squeeze each to ~380px in
   * the panel, so there it stacks them.
   */
  narrow?: boolean;
  /**
   * The suggested-text buttons under the text box, for the board that opened
   * this (`lib/comms/quickTexts`). Absent — every screen but the Care
   * Coordinator card — there is no bar.
   */
  quickTexts?: QuickTextsContext;
}

/** Which number the popup is on, keyed by its last ten digits. */
function useChosenNumber(primaryKey: string) {
  const [chosen, setChosen] = useState(primaryKey);
  // A new patient behind the popup starts on their own number.
  useEffect(() => setChosen(primaryKey), [primaryKey]);
  return [chosen, setChosen] as const;
}

/**
 * The Inbox key the popup's numbers file under — `/comms/state`, one Postgres
 * read, bound to the numbers it was asked about (a slow answer for another
 * patient's numbers must never open under this one).
 */
function useCommsKey(numbers: string[], enabled: boolean) {
  const sig = numbers.join(",");
  const [got, setGot] = useState<{ sig: string; key: string | null; error: string | null; done: boolean }>({
    sig: "",
    key: null,
    error: null,
    done: false,
  });
  const want = useRef("");
  const [seq, setSeq] = useState(0);
  useEffect(() => {
    want.current = sig;
    if (!enabled || !sig) return;
    setGot({ sig, key: null, error: null, done: false });
    fetchCommsState(sig.split(",")).then(
      (out) => want.current === sig && setGot({ sig, key: out.key, error: null, done: true }),
      (e: unknown) =>
        want.current === sig &&
        setGot({ sig, key: null, error: e instanceof Error ? e.message : String(e), done: true }),
    );
  }, [sig, enabled, seq]);
  const mine = got.sig === sig;
  return {
    key: mine ? got.key : null,
    error: mine ? got.error : null,
    loading: enabled && !!sig && (!mine || !got.done),
    retry: useCallback(() => setSeq((n) => n + 1), []),
  };
}

export function CommunicationsView({
  phone,
  altPhone,
  name,
  mondayItemId,
  canText,
  draftFor,
  setDraftFor,
  onTextSent,
  narrow = false,
  quickTexts,
}: CommunicationsViewProps) {
  const config = useCommsConfig();
  const headerNumbers = useMemo(() => popupNumbers(phone, altPhone), [phone, altPhone]);
  const primaryKey = numberKey(headerNumbers[0] ?? phone);
  const [chosenKey, setChosenKey] = useChosenNumber(primaryKey);

  const inboxOn = config.loaded && config.enabled;
  const commsKey = useCommsKey(headerNumbers, inboxOn);
  // The item a 409 said the number moved to (somebody linked it meanwhile).
  const [movedKey, setMovedKey] = useState<string | null>(null);
  useEffect(() => setMovedKey(null), [commsKey.key]);
  const inbox = useInboxItem(inboxOn ? movedKey ?? commsKey.key : null);
  useEffect(() => {
    if (inbox.moved && inbox.moved !== movedKey) setMovedKey(inbox.moved);
  }, [inbox.moved, movedKey]);
  const item = inbox.item;
  const [refreshSeq, setRefreshSeq] = useState(0);
  const reloadItem = inbox.reload;
  const onChanged = useCallback(() => {
    reloadItem();
    setRefreshSeq((n) => n + 1);
  }, [reloadItem]);

  const numbers = useMemo(
    () => (item ? withHeaderNumbers(item.numbers, headerNumbers) : []),
    [item, headerNumbers],
  );
  const active = useMemo(
    () => (item ? activeNumber(numbers, chosenKey, primaryKey, item.timeline) : null),
    [item, numbers, chosenKey, primaryKey],
  );

  /**
   * Where the popup is: reading the switch or the item, the timeline, or the
   * fallback (which says why).
   *
   * ⚠️ An item on screen WINS over a later error: a quiet re-read that fails
   * keeps the timeline it had rather than yanking the rep into the fallback
   * mid-read. ⚠️ A lookup that answered "no key" (no usable number) is a
   * fallback, never an endless spinner.
   */
  const inboxError = commsKey.error || (!inbox.moved ? inbox.error : null);
  const noKey = inboxOn && !commsKey.loading && !commsKey.error && !commsKey.key;
  const mode: "loading" | "timeline" | "fallback" = !config.loaded
    ? "loading"
    : !config.enabled
      ? "fallback"
      : item
        ? "timeline"
        : inboxError || noKey
          ? "fallback"
          : "loading";

  // The number the header, the composer and Call use — from the timeline when
  // there is one, otherwise from the page's own numbers.
  const fallbackKey = headerNumbers.some((n) => numberKey(n) === chosenKey) ? chosenKey : primaryKey;
  const activeE164 =
    mode === "timeline"
      ? active?.e164 || ""
      : headerNumbers.find((n) => numberKey(n) === fallbackKey) ?? headerNumbers[0] ?? "";
  const activeKey = numberKey(activeE164);
  const choices =
    mode === "timeline"
      ? numbers.filter((n) => !!n.e164).map((n) => n.e164 as string)
      : headerNumbers;

  // ⚠️ Can Text is the PRIMARY line's answer (§5.31d) — it says nothing about
  // a caregiver's number, so it applies only while the primary is the one
  // being texted.
  const canTextHere = activeKey && activeKey === primaryKey ? canText : undefined;
  /** Under the text box, on the boards that ask (`lib/comms/quickTexts`). A
   *  fill button writes into THIS number's draft — the one the box shows. */
  const quickBar = quickTexts ? (
    <QuickTextBar context={quickTexts} draft={draftFor(activeKey)} onDraftChange={(t) => setDraftFor(activeKey, t)} />
  ) : null;

  const who = name?.trim() || (item?.name ?? "");
  const outboundRecord =
    mondayItemId ?? (item && !isUnmatchedKey(item.key) ? item.itemId : null) ?? null;

  const phoneCtl = useWebPhone();
  const call = phoneCtl.call;
  const dial = () => {
    if (!activeE164 || call) return;
    // Who dialed — the call log cannot say, the whole team is one RingCentral
    // extension (§5.13b). Best-effort; it never holds the dial up.
    reportDial(activeE164);
    phoneCtl.dial(activeE164);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card py-3 pl-5 pr-14">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[color:var(--mm-teal)] text-[color:var(--mm-on-teal,#fff)]">
            <MessageSquare className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Communications</p>
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="truncate text-lg font-bold">{who || fmtPhone(activeE164 || phone)}</h2>
              {item && <StagePill stage={item.stage} />}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          {choices.length > 1 ? (
            // A patient with two numbers: the rep picks which one the composer
            // texts and Call dials. Every event on EITHER number is in the
            // timeline regardless — this only chooses the reply line.
            <select
              value={activeKey}
              onChange={(e) => setChosenKey(e.target.value)}
              aria-label="Text and call which number"
              className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            >
              {choices.map((n) => (
                <option key={numberKey(n)} value={numberKey(n)}>
                  {fmtPhone(n)}
                  {numberKey(n) === primaryKey ? " · primary" : ""}
                </option>
              ))}
            </select>
          ) : (
            <span className="tabular-nums">{activeE164 ? fmtPhone(activeE164) : "No number"}</span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          {call && (
            <LiveCall
              call={call}
              onHangup={phoneCtl.hangup}
              onToggleMute={phoneCtl.toggleMute}
              onSendDtmf={phoneCtl.sendDtmf}
            />
          )}
          <button
            type="button"
            onClick={dial}
            disabled={!activeE164 || !!call}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--mm-teal)] px-3.5 py-2 text-sm font-semibold text-[color:var(--mm-on-teal,#fff)] shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            title={call ? "Finish the current call first" : `Call ${activeE164 ? fmtPhone(activeE164) : ""} from the Command Center`}
          >
            <Phone className="h-4 w-4" /> Call
          </button>
        </div>
      </header>

      {phoneCtl.error && !call && (
        <p className="shrink-0 border-b border-rose-300 bg-rose-50 px-5 py-2 text-sm text-rose-900 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
          {phoneCtl.error}{" "}
          <button type="button" onClick={phoneCtl.dismissError} className="font-semibold underline">
            Dismiss
          </button>
        </p>
      )}

      {mode === "loading" && (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading the conversation…
        </div>
      )}

      {mode === "timeline" && item && (
        <ItemTimeline
          key={item.key}
          mode="view"
          item={item}
          numbers={numbers}
          active={active}
          onActive={() => {}}
          onCall={() => dial()}
          calling={!!call}
          mondayItemId={outboundRecord}
          canText={canTextHere}
          sticky={null}
          onResolved={() => {}}
          onUndone={() => {}}
          onChanged={onChanged}
          refreshSeq={refreshSeq}
          draft={draftFor(activeKey)}
          onDraftChange={(t) => setDraftFor(activeKey, t)}
          onTextSent={onTextSent}
          composerFooter={quickBar}
        />
      )}

      {mode === "fallback" && (
        <FallbackView
          phone={activeE164}
          display={fmtPhone(activeE164)}
          mondayItemId={outboundRecord}
          canText={canTextHere}
          draft={draftFor(activeKey)}
          onDraftChange={(t) => setDraftFor(activeKey, t)}
          onTextSent={onTextSent}
          composerFooter={quickBar}
          reason={
            !config.enabled
              ? "The Communications inbox is switched off, so this shows the text thread and the call history straight from RingCentral."
              : inboxError
                ? `The Communications inbox couldn't be read (${inboxError}), so this shows the text thread and the call history straight from RingCentral.`
                : "The Communications inbox has nothing filed under this number yet, so this shows the text thread and the call history straight from RingCentral."
          }
          onRetry={config.enabled ? commsKey.retry : undefined}
          narrow={narrow}
        />
      )}
    </div>
  );
}

/** Status, timer, Mute and Hang up for a live call — the same softphone the
 *  app-wide overlay drives, drawn here because that overlay cannot be clicked
 *  while a modal is open. */
function LiveCall({
  call,
  onHangup,
  onToggleMute,
  onSendDtmf,
}: {
  call: NonNullable<ReturnType<typeof useWebPhone>["call"]>;
  onHangup: () => void;
  onToggleMute: () => void;
  /** Keypad tones on the live call (phone trees). */
  onSendDtmf: (digits: string) => void;
}) {
  const live = call.status === "connected";
  const [keypad, setKeypad] = useState(false);
  const label =
    call.status === "connecting"
      ? "Connecting…"
      : call.status === "ringing"
        ? "Ringing…"
        : call.status === "ending"
          ? "Hanging up…"
          : live
            ? `On the call · ${formatClock(call.seconds)}`
            : "";
  return (
    <div className="relative flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 py-1 pl-3 pr-1 text-sm text-emerald-900 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
      <span className="mr-1 inline-flex items-center gap-1.5 font-semibold tabular-nums">
        {live ? (
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        )}
        {label} <span className="font-normal opacity-80">{fmtPhone(call.phone)}</span>
      </span>
      <button
        type="button"
        onClick={onToggleMute}
        disabled={!live}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-emerald-100 disabled:opacity-40 dark:hover:bg-emerald-500/20"
        title={call.muted ? "Unmute" : "Mute"}
        aria-label={call.muted ? "Unmute" : "Mute"}
      >
        {call.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
      </button>
      <button
        type="button"
        onClick={() => setKeypad((k) => !k)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-emerald-100 dark:hover:bg-emerald-500/20"
        title={keypad ? "Hide keypad" : "Keypad"}
        aria-label={keypad ? "Hide keypad" : "Show keypad"}
        aria-pressed={keypad}
      >
        <Grid3x3 className="h-4 w-4" />
      </button>
      {keypad && (
        <div className="absolute right-0 top-full z-20 mt-1.5 w-56 rounded-xl border border-border bg-card p-3 shadow-xl">
          <CallKeypad onDigit={onSendDtmf} disabled={!live} />
        </div>
      )}
      <button
        type="button"
        onClick={onHangup}
        className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-700"
      >
        <PhoneOff className="h-3.5 w-3.5" /> Hang up
      </button>
    </div>
  );
}

/**
 * The popup when the Inbox can't be read: the two things the old Text and
 * Calls buttons showed, side by side. The texts use the SAME conversation hook
 * and composer as everywhere else — the guards are never re-implemented.
 */
function FallbackView({
  phone,
  display,
  mondayItemId,
  canText,
  draft,
  onDraftChange,
  onTextSent,
  reason,
  onRetry,
  narrow = false,
  composerFooter,
}: {
  phone: string;
  display: string;
  mondayItemId: string | null;
  canText?: "yes" | "no" | "unknown";
  draft: string;
  onDraftChange: (text: string) => void;
  onTextSent?: (body: string) => void;
  reason: string;
  onRetry?: () => void;
  /** Stack texts over calls — see `CommunicationsViewProps.narrow`. */
  narrow?: boolean;
  composerFooter?: ReactNode;
}) {
  if (!phone) {
    return (
      <p className="flex flex-1 items-center justify-center p-8 text-sm text-muted-foreground">
        No phone number on this record, so there is nothing to show.
      </p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="flex shrink-0 items-start gap-2 border-b border-amber-300 bg-amber-50 px-5 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {reason}
          {onRetry && (
            <>
              {" "}
              <button type="button" onClick={onRetry} className="font-semibold underline">
                Try again
              </button>
            </>
          )}
        </span>
      </p>
      <div className={narrow ? "grid min-h-0 flex-1 grid-cols-1 grid-rows-2" : "grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-2"}>
        {/* Keyed on the number: a switch must not carry a half-typed text into
            a different conversation. */}
        <FallbackTexts
          key={phone}
          phone={phone}
          mondayItemId={mondayItemId}
          canText={canText}
          draft={draft}
          onDraftChange={onDraftChange}
          onTextSent={onTextSent}
          composerFooter={composerFooter}
        />
        <section className={narrow ? "flex min-h-0 flex-col border-t border-border" : "flex min-h-0 flex-col border-t border-border lg:border-l lg:border-t-0"}>
          <h3 className="shrink-0 border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Calls &amp; recordings
          </h3>
          <CallHistoryList key={phone} phone={phone} display={display} />
        </section>
      </div>
    </div>
  );
}

function FallbackTexts({
  phone,
  mondayItemId,
  canText,
  draft,
  onDraftChange,
  onTextSent,
  composerFooter,
}: {
  phone: string;
  mondayItemId: string | null;
  canText?: "yes" | "no" | "unknown";
  draft: string;
  onDraftChange: (text: string) => void;
  onTextSent?: (body: string) => void;
  composerFooter?: ReactNode;
}) {
  const conversation = useConversation(phone, mondayItemId);
  const { messages, loading, error } = conversation;
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);
  return (
    <section className="flex min-h-0 flex-col">
      <h3 className="shrink-0 border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Texts
      </h3>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-gradient-subtle p-4">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading conversation…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
        ) : messages.length === 0 ? (
          <p className="py-16 text-center text-sm text-muted-foreground">No messages yet. Send the first text below.</p>
        ) : (
          messages.map((m) => <MessageBubble key={m.id} m={m} />)
        )}
      </div>
      <Composer
        conversation={conversation}
        canText={canText}
        draft={draft}
        onDraftChange={onDraftChange}
        onSent={(body) => onTextSent?.(body)}
        grow
      />
      {composerFooter}
    </section>
  );
}

export default CommunicationsView;
