/**
 * The RingCentral activity box — Brandon, 2026-09-09:
 * *"put text and call history on top… where we can toggle between texts, calls
 * and voicemails. At the top right of this box, should be a call and text
 * button, and this is where the user will press to call them."*
 *
 * That last clause is why the Call and Text buttons LEFT the patient banner
 * (his note: "get rid of the phone text and calls in the top banner though —
 * will have that lower down"). This box is the "lower down".
 *
 * ⚠️ Nothing is fetched until a tab is open — see `usePatientActivity` for the
 * INCIDENT_2026-08-20 rules this is built to. Collapsed, it costs nothing.
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageSquare, Phone, PhoneIncoming, PhoneOutgoing, Voicemail, RefreshCw, ChevronRight, Loader2, Play } from "lucide-react";
import { PatientContact } from "@/components/masheke/mmKit";
import { usePatientActivity, type ActivityTab } from "@/hooks/welcomeCall/usePatientActivity";
import SmsDeliveryNote from "@/components/shared/SmsDeliveryNote";
import { fetchRcContentBlobUrl, fetchRecordingBlobUrl } from "@/lib/fax/ringcentralApi";

const TABS: { id: ActivityTab; label: string; icon: typeof Phone }[] = [
  { id: "texts", label: "Texts", icon: MessageSquare },
  { id: "calls", label: "Calls", icon: Phone },
  { id: "voicemails", label: "Voicemails", icon: Voicemail },
];

/** Naive-ET-safe short stamp. RingCentral returns real UTC instants here (not
 *  the board's naive strings), so a Date is correct — unlike anything read off
 *  a Monday date column (§9). */
function when(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function mmss(sec: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PatientActivityCard({ phone }: { phone: string }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ActivityTab>("texts");
  const { data, loading, error, reload } = usePatientActivity(phone, tab, open);

  if (!phone?.trim()) return null;

  return (
    /* Same material as the form steps below it (see `FormSection`) — this box
       sits between the banner and the call, so it changing shell was half of
       "the rest is still in old format". */
    <Card
      className="p-4 rounded-2xl shadow-sm"
      style={{ borderColor: "var(--mm-card-border)" }}
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={cn("h-4 w-4 transition-transform", open && "rotate-90")} />
          RingCentral Activity
        </button>
        {/* Brandon: "this is where the user will press to call them". The Calls
            pop-up is suppressed because the Calls TAB below is the same history. */}
        <PatientContact phone={phone} hideCallHistory />
      </div>

      {open && (
        <>
          <div className="mt-3 flex items-center gap-1 flex-wrap">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors",
                  tab === t.id
                    ? "bg-[color:var(--mm-teal)] text-white"
                    : "text-muted-foreground hover:bg-muted",
                )}
              >
                <t.icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            ))}
            <button
              type="button"
              onClick={reload}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              title="Read this list again"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /> Refresh
            </button>
          </div>

          <div className="mt-3 max-h-72 overflow-y-auto">
            {loading && (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reading RingCentral…
              </p>
            )}
            {/* A failed read says so rather than rendering an empty list — an
                empty list and "we could not look" are different answers, and
                the silent version is what §5.27 records costing real time. */}
            {!loading && error && (
              <p className="text-sm text-amber-700 dark:text-amber-400">
                Couldn&apos;t read RingCentral: {error}
              </p>
            )}

            {!loading && !error && tab === "texts" && <Texts rows={data.texts} />}
            {!loading && !error && tab === "calls" && <Calls rows={data.calls} />}
            {!loading && !error && tab === "voicemails" && <Voicemails rows={data.voicemails} />}
          </div>
        </>
      )}
    </Card>
  );
}

function Empty({ what }: { what: string }) {
  /* ⚠️ Says the WINDOW, not just "none". RingCentral keeps ~30 days on this
     account and answers an older query with 200 + an empty list, which is
     indistinguishable from a patient nobody has contacted (§5.27). */
  return <p className="text-sm text-muted-foreground">No {what} on file in RingCentral&apos;s recent window.</p>;
}

function Texts({ rows }: { rows?: import("@/lib/assignedPatients/messagingApi").ConversationMessage[] }) {
  if (!rows?.length) return <Empty what="texts" />;
  /* Brandon, 2026-09-11: *"let's make the ringcentral texts pretty too, like it
     is lower in the tool"* — i.e. read like the conversation thread, not like a
     list of boxes. Ours = teal, right-aligned, white on the accent; theirs =
     grey, left. Tails on the outer corner, the timestamp under the bubble
     rather than inside it, and the day printed once when it changes. */
  let lastDay = "";
  return (
    <div className="space-y-2 pr-1">
      {rows.map((m) => {
        const mine = m.direction === "Outbound";
        const day = dayOf(m.time);
        const newDay = day !== lastDay;
        lastDay = day;
        return (
          <div key={m.id}>
            {newDay && day && (
              <p className="text-center text-[10px] uppercase tracking-wider text-muted-foreground my-3">
                {day}
              </p>
            )}
            <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[80%] px-3 py-2 text-sm leading-snug whitespace-pre-wrap break-words shadow-sm",
                  mine
                    ? "bg-[color:var(--mm-teal)] text-white rounded-2xl rounded-br-sm"
                    : "bg-muted text-foreground rounded-2xl rounded-bl-sm",
                )}
              >
                {m.text}
              </div>
              <div className={cn("mt-0.5 px-1", mine ? "text-right" : "text-left")}>
                <span className="text-[10px] text-muted-foreground">{when(m.time)}</span>
                {/* An ACCEPTED text is not a DELIVERED text (§5.5) — this thread
                    is the only surface that late verdict ever reaches, which is
                    why the texts tab reads the gateway route rather than
                    RingCentral direct. */}
                <SmsDeliveryNote
                  direction={m.direction}
                  messageStatus={m.messageStatus}
                  deliveryError={m.deliveryError}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** "Tue 9 Sep" in ET, for the once-per-day divider. Same zone rule as `when`. */
function dayOf(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  return t.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

/**
 * "Play" → fetch the bytes → an inline <audio>.
 *
 * Brandon, 2026-09-11: *"is there a way to listen to the calls/voicemails from
 * the tool?"* — yes, and the plumbing already existed: `CallHistoryButton` has
 * played call recordings since §5.16 and the Comms Hub plays voicemail audio.
 * This just surfaces it where he asked for it.
 *
 * ⚠️ Fetched **on click**, never on render. The media proxy is a RingCentral
 * request per item, and a list of twenty calls that pre-loaded twenty
 * recordings is INCIDENT_2026-08-20's shape on a page a rep opens all day.
 *
 * ⚠️ A blob URL is revoked when it is replaced, so a rep working down a list
 * does not accumulate one per item — the leak `FaxInboxPage` still has.
 *
 * ⚠️ **Absent audio is the NORMAL case, not an error** (§5.16): recordings need
 * the account to record AND the `ReadCallRecording` permission, and voicemail
 * audio needs an attachment RingCentral may not give us. No URI ⇒ no button.
 */
function AudioPlay({ uri, kind }: { uri: string; kind: "recording" | "voicemail" }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  if (!uri) return null;
  if (url) return <audio controls autoPlay src={url} className="mt-1.5 w-full h-9" />;

  return (
    <div className="mt-1">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const next =
              kind === "recording"
                ? await fetchRecordingBlobUrl(uri)
                : await fetchRcContentBlobUrl(uri);
            setUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev);
              return next;
            });
          } catch (e) {
            setErr(e instanceof Error ? e.message : "Couldn't load the audio");
          } finally {
            setBusy(false);
          }
        }}
        className="inline-flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-xs font-medium hover:bg-muted transition-colors disabled:opacity-60"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
        {busy ? "Loading…" : "Listen"}
      </button>
      {err && <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">{err}</p>}
    </div>
  );
}

function Calls({ rows }: { rows?: import("@/lib/callHistory/callHistory").PatientCall[] }) {
  if (!rows?.length) return <Empty what="calls" />;
  return (
    <div className="space-y-1.5">
      {rows.map((c) => {
        const inbound = c.direction === "Inbound";
        return (
          <div key={c.id} className="rounded-lg border border-input px-2.5 py-2">
            <div className="flex items-baseline gap-2 text-sm">
              {inbound ? (
                <PhoneIncoming className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" />
              ) : (
                <PhoneOutgoing className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground" />
              )}
              <span className="font-medium">{inbound ? "Patient called" : "We called"}</span>
              <span className={cn("text-xs", c.connected ? "text-muted-foreground" : "text-rose-600")}>
                {/* ⚠️ `connected` reads the LEGS, not RingCentral's `result` — a
                    claimed (forwarded) inbound call is NOT a missed call, and
                    reading the result literally flashes "Missed" at the person
                    who just took it (§5.13/§5.16). */}
                {c.voicemail ? "voicemail" : c.connected ? "connected" : "no answer"}
                {c.durationSec > 0 && ` · ${mmss(c.durationSec)}`}
              </span>
              <span className="text-xs text-muted-foreground ml-auto shrink-0">{when(c.startTime)}</span>
            </div>
            <AudioPlay uri={c.recording?.contentUri ?? ""} kind="recording" />
          </div>
        );
      })}
    </div>
  );
}

function Voicemails({ rows }: { rows?: import("@/lib/fax/ringcentralApi").VoicemailRecord[] }) {
  if (!rows?.length) return <Empty what="voicemails" />;
  return (
    <div className="space-y-2">
      {rows.map((v) => (
        <div key={v.id} className="rounded-lg bg-muted px-3 py-2 text-sm">
          <p className="text-[11px] font-semibold text-muted-foreground">
            {when(v.creationTime)}
            {v.durationSec > 0 && ` · ${mmss(v.durationSec)}`}
            {!v.read && " · unheard"}
          </p>
          {/* ⚠️ The transcript BODY is deliberately not fetched here. It is a
              separate request per voicemail (`fetchVoicemailTranscript`), and N
              extra RingCentral calls to populate a list nobody has asked to
              read is the shape INCIDENT_2026-08-20 warns about. The status is
              free — it rides on the list read — so the box says whether one
              exists and the Comms Hub is where a rep reads it.
              Transcription is a per-account feature that may be off here, so
              "not available" is the NORMAL case, not an error (§5.28). */}
          <p className="text-xs text-muted-foreground mt-0.5">
            {/^Completed/i.test(v.transcriptionStatus)
              ? "Transcript available — open it in Communications."
              : "No transcript."}
          </p>
          <AudioPlay uri={v.audioUri} kind="voicemail" />
        </div>
      ))}
    </div>
  );
}
