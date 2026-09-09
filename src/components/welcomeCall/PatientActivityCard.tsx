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
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageSquare, Phone, Voicemail, RefreshCw, ChevronRight, Loader2 } from "lucide-react";
import { PatientContact } from "@/components/masheke/mmKit";
import { usePatientActivity, type ActivityTab } from "@/hooks/welcomeCall/usePatientActivity";
import SmsDeliveryNote from "@/components/shared/SmsDeliveryNote";

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
    <Card className="p-4">
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
  return (
    <div className="space-y-2">
      {rows.map((m) => (
        <div
          key={m.id}
          className={cn(
            "rounded-lg px-3 py-2 text-sm max-w-[85%]",
            m.direction === "Outbound"
              ? "ml-auto bg-[color:var(--mm-teal)]/10 border border-[color:var(--mm-teal)]/30"
              : "bg-muted",
          )}
        >
          <p className="text-[11px] font-semibold text-muted-foreground">
            {m.direction === "Outbound" ? "Medically Modern" : "Patient"} · {when(m.time)}
          </p>
          <p className="whitespace-pre-wrap break-words">{m.text}</p>
          {/* An ACCEPTED text is not a DELIVERED text (§5.5) — this thread is
              the only surface that late verdict ever reaches, which is why the
              texts tab reads the gateway route rather than RingCentral direct. */}
          <SmsDeliveryNote
            direction={m.direction}
            messageStatus={m.messageStatus}
            deliveryError={m.deliveryError}
          />
        </div>
      ))}
    </div>
  );
}

function Calls({ rows }: { rows?: import("@/lib/callHistory/callHistory").PatientCall[] }) {
  if (!rows?.length) return <Empty what="calls" />;
  return (
    <div className="space-y-1.5">
      {rows.map((c) => (
        <div key={c.id} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium">
            {c.direction === "Inbound" ? "Patient called" : "We called"}
          </span>
          <span className={cn("text-xs", c.connected ? "text-muted-foreground" : "text-rose-600")}>
            {/* ⚠️ `connected` reads the LEGS, not RingCentral's `result` — a
                claimed (forwarded) inbound call is NOT a missed call, and
                reading the result literally flashes "Missed" at the person who
                just took it (§5.13/§5.16). */}
            {c.voicemail ? "voicemail" : c.connected ? "connected" : "no answer"}
            {c.durationSec > 0 && ` · ${mmss(c.durationSec)}`}
          </span>
          <span className="text-xs text-muted-foreground ml-auto shrink-0">{when(c.startTime)}</span>
        </div>
      ))}
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
        </div>
      ))}
    </div>
  );
}
