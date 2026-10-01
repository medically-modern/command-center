/**
 * One item, as ONE timeline (COMMS_INBOX_PLAN.md §1.2, §4.6, §4.9).
 *
 *   texts as bubbles · calls and voicemails as rows, with Play · past
 *   resolutions as quiet dividers — then the composer, then the resolve bar.
 *
 * Everything on it comes from `/comms/item` — the four archives on the
 * gateway's Postgres, read by the patient's number hashes — except the newest
 * texts, which come from the LIVE thread for the number the rep is replying to
 * and win any collision (`mergeLiveTexts`).
 *
 * ⚠️⚠️ **THE THREAD'S GUARDS ARE REUSED, NEVER COPIED.** The composer is
 * `assignedPatients/Composer` and the live thread is `useConversation` — the
 * same opt-out rule, the same late-delivery recheck (CLAUDE.md §5.5), the same
 * Can Text block as the hub's Text tab. A second copy is how one surface stops
 * honouring a STOP.
 *
 * ⚠️ **Playback is archive-first, RingCentral second, and never on open**
 * (§5.47's `recordingSource` rule, applied to voicemails and photos too). The
 * archive's presigned URL is a bare `<audio src>` / `<img src>` and is never
 * `fetch()`ed — a browser following a cross-origin redirect with fetch needs
 * CORS on the bucket, which Railway cannot set.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { AlertTriangle, ArrowRight, Loader2, Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Play, Voicemail } from "lucide-react";
import MessageBubble from "@/components/assignedPatients/MessageBubble";
import Composer from "@/components/assignedPatients/Composer";
import { MessageAttachments } from "@/components/shared/MessageAttachments";
import { AudioPlayer } from "@/components/shared/AudioPlayer";
import { useConversation } from "@/hooks/assignedPatients/useConversation";
import { archivedMediaUrl, type NoteTarget } from "@/lib/commsInbox/api";
import { archivedPlaybackUrl } from "@/lib/callHistory/archivedRecordings";
import { fetchRcContentBlobUrl, fetchRecordingBlobUrl } from "@/lib/fax/ringcentralApi";
import { fmtPhone } from "@/lib/assignedPatients/format";
import {
  HOW_LABEL,
  formatWhen,
  rowName,
  whoShort,
  type InboxItem,
  type ItemNumber,
  type ItemState,
  type TimelineAttachment,
  type TimelineEntry,
} from "@/lib/commsInbox/rules";
import { answeredByLabel, callLine, formatDuration, liveSuggestion, mergeLiveTexts, numberHint, seenThroughFor } from "@/lib/commsInbox/timeline";
import ResolveBar, { type StickyResolution } from "./ResolveBar";
import CallTranscript from "./CallTranscript";
import { StagePill } from "./pills";
import { cn } from "@/lib/utils";

type Props = {
  item: InboxItem;
  /** The patient's numbers, with any the gateway couldn't resolve filled in. */
  numbers: ItemNumber[];
  /** The number the composer texts and Call dials. */
  active: ItemNumber | null;
  onActive: (hmac: string) => void;
  onCall: (phone: string) => void;
  calling: boolean;
  /** The patient record an outbound text is about (§5.28). */
  mondayItemId: string | null;
  canText?: "yes" | "no" | "unknown";
  /** Where the resolve note is copied, when not the item's own patient. */
  noteTarget?: NoteTarget | null;
  sticky: StickyResolution | null;
  onResolved: StickyHandler;
  onUndone: () => void;
  /** Re-read the item and the list. */
  onChanged: () => void;
  /** A signal that the item was re-read, so the live thread re-reads too. */
  refreshSeq: number;
  /**
   * `"inbox"` (the default) is the Communications hub's item detail: a header,
   * the timeline, the composer and the resolve bar.
   *
   * `"view"` is the Communications POPUP that every patient header opens
   * (CLAUDE.md §5.50): the timeline and the composer, and nothing else. No
   * header — the popup draws its own, with the number picker and the live
   * call — and ⚠️ **NO resolve bar**. Josh, 2026-09-24: *"there are no action
   * items here, viewing the notes or the texts and calls vms etc are what we
   * want, with the ability to text them from there"*. Resolving belongs to
   * the Inbox, where the queue is.
   */
  mode?: "inbox" | "view";
  /**
   * The composer's draft, held by a caller that OUTLIVES this view — the
   * popup's button, so a template seeded before it opens lands in the box and
   * a half-typed text survives a close (the rule `lib/shared/textDraft` keeps).
   * Absent — the hub — the composer keeps its own, exactly as before.
   */
  draft?: string;
  onDraftChange?: (text: string) => void;
  /** Told with the BODY once a text went out — Patient Intake stamps its
   *  Call Log from it. Absent, nothing is told. */
  onTextSent?: (body: string) => void;
};
type StickyHandler = Parameters<typeof ResolveBar>[0]["onResolved"];

export default function ItemTimeline(props: Props) {
  const { item, active } = props;
  if (!active?.e164) {
    return <TimelineShell {...props} entries={item.timeline} live={null} />;
  }
  // Keyed on the number: a switch to the patient's other number must not carry
  // a half-typed text into a different conversation.
  return <WithLiveThread key={active.e164} {...props} phone={active.e164} />;
}

function WithLiveThread(props: Props & { phone: string }) {
  const { item, phone, mondayItemId, refreshSeq } = props;
  const conversation = useConversation(phone, mondayItemId);
  const reload = conversation.reload;
  // The item was re-read (its list row changed): re-read the thread quietly too,
  // so a text that just landed shows with its live status.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    void reload(false);
  }, [refreshSeq, reload]);

  const entries = useMemo(
    () => mergeLiveTexts(item.timeline, conversation.messages, props.active?.last4 ?? ""),
    [item.timeline, conversation.messages, props.active?.last4],
  );
  return <TimelineShell {...props} entries={entries} live={conversation} />;
}

function TimelineShell({
  item,
  numbers,
  active,
  onActive,
  onCall,
  calling,
  canText,
  noteTarget,
  sticky,
  onResolved,
  onUndone,
  onChanged,
  mode = "inbox",
  draft,
  onDraftChange,
  onTextSent,
  entries,
  live,
}: Props & { entries: TimelineEntry[]; live: ReturnType<typeof useConversation> | null }) {
  const view = mode === "view";
  // ⚠️ The SCROLL CONTAINER is moved, never `scrollIntoView`: that walks every
  // scrollable ancestor, and in the popup one of those is the page underneath
  // — the trap `IntakeMessages` recorded dragging a whole page mid-screen
  // (§5.30e). The hub's pane has no scrolling ancestor, so it is unchanged.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, item.key]);

  const state = useMemo(() => effectiveState(item, sticky, entries), [item, sticky, entries]);
  const seenThrough = useMemo(() => seenThroughFor(entries, item.state.newestOpenAt), [entries, item.state.newestOpenAt]);
  const name = rowName(item);
  const reachable = numbers.filter((n) => n.e164);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col">
      {!view && (
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate text-sm font-semibold">{name}</h2>
          <StagePill stage={item.stage} />
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          {reachable.length > 1 ? (
            // A patient with two numbers is one item; the rep picks which one
            // to reply on. Defaults to the one the newest message came in on.
            <select
              value={active?.hmac ?? ""}
              onChange={(e) => onActive(e.target.value)}
              aria-label="Reply on which number"
              className="rounded border border-border bg-background px-1 py-0.5 text-[11px] text-foreground"
            >
              {reachable.map((n) => (
                <option key={n.hmac} value={n.hmac}>
                  {fmtPhone(n.e164 || "")}
                </option>
              ))}
            </select>
          ) : active?.e164 ? (
            <span>{fmtPhone(active.e164)}</span>
          ) : (
            <span title="The full number couldn't be read — it shows once RingCentral answers">
              {numbers.map((n) => `···${n.last4}`).join(" · ") || "No number"}
            </span>
          )}
        </div>
        {/* The watch-callback bell is GONE (Josh, 2026-09-25 — the pinned
            numbers went with the ring modes; every connected answerer rings
            for every call, so there is nothing left for a pin to change). */}
        <button
          onClick={() => active?.e164 && onCall(active.e164)}
          disabled={!active?.e164 || calling}
          className={cn(
            "ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[color:var(--mm-teal,theme(colors.teal.600))] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50",
            !active?.e164 && "ml-auto",
          )}
        >
          {calling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
          Call
        </button>
      </header>
      )}

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-gradient-subtle p-4">
        {/* ⚠️ In the popup the column is CENTRED at a readable width — a text
            bubble stretched across a 1,900px screen is unreadable, and a call
            row at that width is a scrub bar you have to turn your head to
            follow. The hub's pane is already narrow and keeps its full width. */}
        <div className={cn("flex flex-col gap-2", view && "mx-auto w-full max-w-4xl")}>
          {live?.error && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-100">
              The live thread didn't load ({live.error}) — showing the archive, which can be a minute behind.
            </p>
          )}
          {entries.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">Nothing on file for this number yet.</p>
          ) : (
            entries.map((e) => <Entry key={entryKey(e)} e={e} entries={entries} numbers={numbers} />)
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-card">
        <div className={cn(view && "mx-auto w-full max-w-4xl")}>
        {live ? (
          <Composer conversation={live} canText={canText} onSent={(body) => {
            onChanged();
            onTextSent?.(body);
          }} draft={draft} onDraftChange={onDraftChange} grow={view} />
        ) : (
          <p className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
            The full number for this item couldn&apos;t be read yet, so texting and calling are off here. It
            shows once RingCentral answers.{" "}
            {/* ⚠️ Its OWN re-read: the list's Refresh reloads the list, and the
                open item is read again only when its row changes — so pointing
                at that button sent a rep to a control that does not do this. */}
            <button type="button" onClick={onChanged} className="font-medium underline hover:no-underline">
              Check again
            </button>
          </p>
        )}
        </div>
        {!view && (
          <ResolveBar
            key={item.key}
            itemKey={item.key}
            state={state}
            seenThrough={seenThrough}
            sticky={sticky && sticky.key === item.key ? sticky : null}
            noteTarget={noteTarget}
            textNumbers={reachable.map((n) => n.e164 as string)}
            onResolved={onResolved}
            onUndone={onUndone}
            onChanged={onChanged}
          />
        )}
      </div>
    </section>
  );
}

/**
 * The state the bar shows: the gateway's, with two things laid over it.
 *  · The suggestion is brought forward by the live thread (`liveSuggestion`).
 *  · ⚠️ For the moment between a resolve and the re-read, the bar shows it
 *    RESOLVED — otherwise the three buttons stay live for a second click that
 *    could only 409. Bounded to an item read before the resolve, so a text
 *    that genuinely reopened it after is never hidden.
 */
function effectiveState(item: InboxItem, sticky: StickyResolution | null, entries: TimelineEntry[]): ItemState {
  const base = item.state;
  if (sticky && sticky.key === item.key && base.open && item.now < sticky.resolvedAt) {
    return {
      ...base,
      open: false,
      over: false,
      lastResolution: {
        resolutionId: sticky.resolutionId,
        how: sticky.how,
        label: sticky.label,
        by: sticky.by,
        at: sticky.resolvedAt,
        note: sticky.note,
        coversThrough: sticky.coversThrough,
        mirrored: false,
      },
    };
  }
  const suggestion = liveSuggestion(base, entries);
  return suggestion === base.suggestion ? base : { ...base, suggestion };
}

function entryKey(e: TimelineEntry): string {
  if (e.type === "attempt" || e.type === "resolution") return `${e.type}:${e.resolutionId}`;
  return `${e.type}:${e.id}`;
}

/* ── one row ────────────────────────────────────────────────────────────── */

function Entry({ e, entries, numbers }: { e: TimelineEntry; entries: TimelineEntry[]; numbers: ItemNumber[] }) {
  if (e.type === "text") {
    const meta = numberHint(e.last4, numbers);
    return (
      <MessageBubble
        m={{
          direction: e.dir === "out" ? "Outbound" : "Inbound",
          text: e.body,
          time: e.at,
          sentBy: e.sentBy || undefined,
          messageStatus: e.status || undefined,
          deliveryError: e.deliveryError || undefined,
        }}
        meta={meta}
        timeLabel={formatWhen(e.at)}
        attachments={e.attachments.length ? <TimelineAttachments messageId={e.id} attachments={e.attachments} /> : undefined}
      />
    );
  }

  if (e.type === "resolution") {
    return (
      <p className="self-center px-2.5 py-0.5 text-center text-[11px] text-muted-foreground">
        Resolved · {HOW_LABEL[e.how] ?? e.label} · {whoShort(e.by) || e.by} · {formatWhen(e.at)}
        {e.note ? ` — “${e.note}”` : ""}
      </p>
    );
  }

  if (e.type === "attempt") {
    const linked = e.linkedCallId ? entries.find((x) => x.type === "call" && x.id === e.linkedCallId) : undefined;
    const uri = linked && linked.type === "call" ? linked.recordingUri : "";
    const linkedSec = linked && linked.type === "call" ? linked.durationSec : undefined;
    return (
      <EventRow dir="out" icon={<Voicemail className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />}>
        <b className="font-semibold">Left voicemail</b>
        <div className="text-[11px] text-muted-foreground">
          {whoShort(e.by) || e.by} · {formatWhen(e.at)}
        </div>
        {/* ⚠️ No linked call, no Listen — linking the wrong call would play the
            rep a different conversation (plan §4.4). */}
        {e.linkedCallId && (
          <PlayAudio
            label="Listen"
            source={
              e.linkedCallAudio === "stored"
                ? { kind: "call-archive", callId: e.linkedCallId }
                : uri
                  ? { kind: "rc-recording", uri }
                  : null
            }
            unavailable="The recording of that call isn't available yet."
            durationHint={linkedSec}
          />
        )}
      </EventRow>
    );
  }

  if (e.type === "voicemail") {
    return (
      <EventRow dir={e.dir} icon={<Voicemail className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />}>
        <b className="font-semibold">Voicemail</b>
        {e.durationSec > 0 && <span className="text-[11px] text-muted-foreground"> · {formatDuration(e.durationSec)}</span>}
        {e.transcript && <div className="mt-0.5 text-xs">“{e.transcript}”</div>}
        <div className="text-[11px] text-muted-foreground">
          {formatWhen(e.at)}
          {numberHint(e.last4, numbers) ? ` · ${numberHint(e.last4, numbers)}` : ""}
        </div>
        <PlayAudio
          label="Listen"
          source={
            e.audioState === "stored"
              ? { kind: "vm-archive", messageId: e.id }
              : e.audioUri
                ? { kind: "rc-content", uri: e.audioUri }
                : null
          }
          unavailable={audioAbsence(e.audioState)}
          durationHint={e.durationSec}
          kindLabel="Voicemail"
        />
      </EventRow>
    );
  }

  // A call. ⚠️ A browser pickup wears the INBOUND face — the record's
  // direction is RingCentral's inversion, not the call's (callLine's note).
  const Icon = e.pickedUp ? PhoneIncoming : e.dir === "out" ? PhoneOutgoing : e.missed ? PhoneMissed : PhoneIncoming;
  const hasRecording = e.connected && (e.audioState === "stored" || !!e.recordingUri);
  return (
    <EventRow
      dir={e.pickedUp ? "in" : e.dir}
      icon={
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            e.missed ? "text-orange-500" : e.dir === "out" && !e.pickedUp ? "text-[color:var(--mm-green)]" : "text-muted-foreground",
          )}
        />
      }
    >
      <b className="font-semibold">{callLine(e)}</b>
      {/* Who picked up an inbound call — the extension that answered (§5.47d). */}
      {answeredByLabel(e) && (
        <div className="text-xs">
          Picked up by <span className="font-medium">{answeredByLabel(e)}</span>
        </div>
      )}
      <div className="text-[11px] text-muted-foreground">
        {formatWhen(e.at)}
        {numberHint(e.last4, numbers) ? ` · ${numberHint(e.last4, numbers)}` : ""}
      </div>
      {hasRecording && (
        <PlayAudio
          label="Play recording"
          source={
            e.audioState === "stored"
              ? { kind: "call-archive", callId: e.id }
              : e.recordingUri
                ? { kind: "rc-recording", uri: e.recordingUri }
                : null
          }
          unavailable={audioAbsence(e.audioState)}
          durationHint={e.durationSec}
          kindLabel="Call recording"
        />
      )}
      {/* Google's transcript of the recording (§5.47e), fetched on open. */}
      {e.hasTranscript && (
        <CallTranscript key={e.id} callId={e.id} answeredBy={e.dir === "in" ? e.answeredName ?? "" : ""} />
      )}
      {e.voicemail && (
        <div className="mt-1.5 border-t border-border pt-1.5">
          <span className="inline-flex items-center gap-1 font-semibold">
            <Voicemail className="h-3 w-3 text-violet-600 dark:text-violet-400" /> Voicemail
          </span>
          {e.voicemail.durationSec > 0 && (
            <span className="text-[11px] text-muted-foreground"> · {formatDuration(e.voicemail.durationSec)}</span>
          )}
          {e.voicemail.transcript && <div className="mt-0.5 text-xs">“{e.voicemail.transcript}”</div>}
          <PlayAudio
            label="Listen"
            source={
              e.voicemail.audioState === "stored"
                ? { kind: "vm-archive", messageId: e.voicemail.id }
                : e.voicemail.audioUri
                  ? { kind: "rc-content", uri: e.voicemail.audioUri }
                  : null
            }
            unavailable={audioAbsence(e.voicemail.audioState)}
            durationHint={e.voicemail.durationSec}
            kindLabel="Voicemail"
          />
        </div>
      )}
    </EventRow>
  );
}

function audioAbsence(state: string): string {
  if (state === "pending") return "Still being saved — try again shortly.";
  if (state === "gone") return "RingCentral deleted this before we could save it.";
  if (state === "failed") return "We couldn't save this one.";
  return "No audio for this one.";
}

function EventRow({ dir, icon, children }: { dir: "in" | "out"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "flex max-w-[78%] items-start gap-2.5 rounded-xl border border-border px-2.5 py-2 text-xs",
        // ⚠️ A row that is PLAYING takes (nearly) the whole column, so the scrub
        // bar is as long as the screen allows (Josh, 2026-09-24: "make it large
        // so i can scrub back and forth"). Keyed on the element itself rather
        // than lifted state, so a call row carrying two players (its recording
        // and the voicemail it left) grows for either.
        "has-[audio]:w-full has-[audio]:max-w-[94%]",
        dir === "out" ? "self-end bg-muted" : "self-start bg-card",
      )}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* ── playback ───────────────────────────────────────────────────────────── */

type Source =
  | { kind: "call-archive"; callId: string }
  | { kind: "vm-archive"; messageId: string }
  | { kind: "rc-recording"; uri: string }
  | { kind: "rc-content"; uri: string };

/**
 * A Play button that fetches its audio ON THE PRESS — never on open, because
 * an item is opened far more often than anything on it is played, and the
 * RingCentral half spends the shared account's budget.
 */
function PlayAudio({
  label,
  source,
  unavailable,
  durationHint,
  kindLabel = "Recording",
}: {
  label: string;
  source: Source | null;
  unavailable: string;
  /** The length the archive or call log recorded — the bar can be scrubbed
   *  before the file has told us its own. */
  durationHint?: number;
  /** What it is, for the player's accessible name. */
  kindLabel?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [blob, setBlob] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Only a blob URL is ours to revoke — a presigned URL is a bare href.
  useEffect(() => {
    if (!src || !blob) return;
    return () => URL.revokeObjectURL(src);
  }, [src, blob]);

  if (!source) return <div className="mt-1 text-[11px] text-muted-foreground">{unavailable}</div>;

  const load = async () => {
    if (busy || src) return;
    setBusy(true);
    setErr(null);
    try {
      if (source.kind === "call-archive") {
        setSrc(await archivedPlaybackUrl(source.callId));
      } else if (source.kind === "vm-archive") {
        setSrc(await archivedMediaUrl("voicemail", { messageId: source.messageId }));
      } else if (source.kind === "rc-recording") {
        setBlob(true);
        setSrc(await fetchRecordingBlobUrl(source.uri));
      } else {
        setBlob(true);
        setSrc(await fetchRcContentBlobUrl(source.uri));
      }
    } catch (e) {
      setBlob(false);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (src) {
    return (
      <AudioPlayer
        src={src}
        durationHint={durationHint}
        label={kindLabel}
        className="mt-1.5"
        // ⚠️ An archive link is presigned and dies after five minutes (§5.47),
        // so a recording paused and resumed later can fail mid-play. The Play
        // button comes back and fetches a fresh link rather than leaving a
        // silent, broken player (2026-09-23 review).
        onError={() => {
          setSrc(null);
          setBlob(false);
          setErr("The recording couldn't load — press play to try again.");
        }}
      />
    );
  }
  return (
    <div className="mt-1.5">
      <button
        onClick={() => void load()}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {label}
      </button>
      {err && <p className="mt-1 break-words text-[11px] text-destructive">{err}</p>}
    </div>
  );
}

/**
 * A text's photos: from our archive when it holds them (§5.47c), else from
 * RingCentral exactly as today's thread shows them.
 */
function TimelineAttachments({ messageId, attachments }: { messageId: string; attachments: TimelineAttachment[] }) {
  const archived = attachments.filter((a) => a.archived && /^image\//i.test(a.contentType));
  const rest = attachments.filter((a) => !(a.archived && /^image\//i.test(a.contentType)));
  return (
    <>
      {archived.map((a) => (
        <ArchivedPhoto key={a.id} messageId={messageId} attachmentId={a.id} />
      ))}
      {rest.length > 0 && (
        <MessageAttachments
          attachments={rest.map((a) => ({ id: Number(a.id) || 0, contentType: a.contentType, uri: a.uri }))}
        />
      )}
    </>
  );
}

/** A presigned archive link lives five minutes (§5.47); older than this, it is
 *  re-issued before it is opened. */
const LINK_FRESH_MS = 4 * 60_000;

function ArchivedPhoto({ messageId, attachmentId }: { messageId: string; attachmentId: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const fetchedAt = useRef(0);
  const [failed, setFailed] = useState(false);
  // A photo IS the message, so it loads with the item — the same posture as
  // today's thread — but from our bucket, which costs RingCentral nothing.
  useEffect(() => {
    let alive = true;
    archivedMediaUrl("photo", { messageId, attachmentId })
      .then((u) => {
        if (!alive) return;
        fetchedAt.current = Date.now();
        setSrc(u);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [messageId, attachmentId]);

  /**
   * ⚠️ Opening the full photo later than the link's life would land on the
   * bucket's AccessDenied page (2026-09-23 review), so an old link is re-issued
   * first. The tab is opened INSIDE the click — a browser only allows a new tab
   * during the click itself, and an await before `window.open` spends that — and
   * pointed at the fresh link when it arrives.
   */
  const openFresh = (e: MouseEvent<HTMLAnchorElement>) => {
    if (Date.now() - fetchedAt.current < LINK_FRESH_MS) return;
    e.preventDefault();
    const w = window.open("", "_blank");
    if (!w) return;
    w.opener = null;
    archivedMediaUrl("photo", { messageId, attachmentId }).then(
      (u) => {
        fetchedAt.current = Date.now();
        setSrc(u);
        w.location.href = u;
      },
      () => {
        w.close();
        setFailed(true);
      },
    );
  };
  if (failed) {
    return (
      <span className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-black/10 px-2 py-1 text-[11px] opacity-80">
        <AlertTriangle className="h-3 w-3" /> photo couldn&apos;t load
      </span>
    );
  }
  if (!src) {
    return (
      <span className="mt-1.5 flex h-24 w-32 items-center justify-center rounded-lg bg-black/10">
        <Loader2 className="h-4 w-4 animate-spin opacity-70" />
      </span>
    );
  }
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="mt-1.5 block" onClick={openFresh}>
      <img src={src} alt="Texted photo" className="max-h-56 max-w-full rounded-lg border border-black/10" />
    </a>
  );
}

/* ── the states around an item ──────────────────────────────────────────── */

export function ItemMoved({ moved, onOpen }: { moved: string; onOpen: (key: string) => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-sm font-medium">This number now belongs to a patient.</p>
      <p className="max-w-[40ch] text-xs text-muted-foreground">
        Somebody linked it while you had it open, so its texts and calls are on the patient&apos;s item now.
      </p>
      <button
        onClick={() => onOpen(moved)}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
      >
        Open the patient&apos;s item <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
