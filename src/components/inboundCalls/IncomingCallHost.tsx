/**
 * The inbound-call cards — mounted app-wide, not on one page.
 *
 * A call arrives while you are working wherever you happen to be working, so
 * this hangs off the app root next to FileViewerHost rather than living on the
 * texting page. It is the whole reason the feature is worth having: RingCentral
 * already pops a notification that knows a phone number, and this one knows
 * WHO is calling, what stage they are at, and lets you take the call in a click.
 *
 * ── Two ways to take a call (§5.13b) ───────────────────────────────────────
 * Every card is the join of two signals about ONE ring (lib/softphone/
 * ringMerge.ts): the gateway's webhook, which every tab sees and which knows
 * the patient, and this browser's own SIP registration, which only the five
 * registered browsers have. When the SIP leg is here the card leads with
 * **Answer** — audio in the page. Otherwise, or by choice, **Take it** forwards
 * the ringing call to the rep's own phone exactly as before.
 *
 * ⚠️ The X on a card is LOCAL. It never declines the call — a decline from one
 * device can shorten the window in which a colleague, or Take it, can still
 * pick up (see softphone.ts). `softphoneRules.test.ts` pins this.
 *
 * ⚠️ ONLY the manager-assigned call answerers (accessStore `callAnswerers`,
 * at most five) get any of this — the stream, the cards, the registration.
 * Everyone else sees nothing, by design (Josh, 2026-09-14). The one thing that
 * renders for everybody is the overlay for a call THEY placed from the hub.
 *
 * Cards come in top-right, deliberately away from the CallOverlay at
 * bottom-right — "a call is arriving" and "you are on a call" must never be
 * mistaken for each other. The overlay for a LIVE call is mounted here too,
 * because an answered inbound call needs it on every page.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Phone, PhoneForwarded, PhoneIncoming, PhoneOff, X } from "lucide-react";
import { toast } from "sonner";
import { useInboundCalls } from "@/hooks/inboundCalls/useInboundCalls";
import { useElapsedSeconds, useSoftphone } from "@/hooks/softphone/useSoftphone";
import { digitsKey, mergeRings, type UnifiedRing } from "@/lib/softphone/ringMerge";
import { findPatientByPhone, type PatientRef } from "@/lib/assignedPatients/patientLookup";
import RingPreferencesDialog from "@/components/inboundCalls/RingPreferencesDialog";
import CallStreamStatus from "@/components/inboundCalls/CallStreamStatus";
import SoftphoneStatus from "@/components/inboundCalls/SoftphoneStatus";
import CallOverlay from "@/components/assignedPatients/CallOverlay";
import { fmtPhone, senderName } from "@/lib/assignedPatients/format";
import { authRequired, getUser } from "@/lib/shared/auth";
import { useAccessContext } from "@/components/AccessProvider";
import { canAnswerCalls } from "@/lib/accessStore";
import { cn } from "@/lib/utils";

/** Is this claim the signed-in user's own? `claim()` marks it "you" optimistically
 *  before the server echoes the real email back, so both have to count. */
function mine(claimedBy: string): boolean {
  if (claimedBy === "you") return true;
  const email = (getUser()?.email || "").toLowerCase();
  return !!email && claimedBy.toLowerCase() === email;
}

/** Ring windows are short — a card that has been up this long is about to lose
 *  the call to voicemail, and the bar turns amber to say so. */
const URGENT_AFTER_S = 15;

function useElapsed(startedAt: number, live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [live]);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

/**
 * A browser notification when the tab is in the background.
 *
 * Permission is never requested from here — an unprompted permission dialog on
 * page load is the fastest way to get permanently denied. The settings dialog
 * asks, in context, when the rep opts in.
 */
function useBackgroundNotification(ring: UnifiedRing, patient: PatientRef | null) {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current || ring.state !== "ringing") return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    if (!document.hidden) return;
    shown.current = true;
    const who = patient?.name || fmtPhone(ring.from);
    const n = new Notification(`${who} is calling`, {
      body: patient?.boardName ? `Medically Modern · ${patient.boardName}` : "Medically Modern",
      tag: ring.key,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return () => n.close();
  }, [ring, patient]);
}

function CallCard({
  ring,
  patient,
  busy,
  onAnswer,
  onClaim,
  onDismiss,
  onNeedsNumber,
}: {
  ring: UnifiedRing;
  patient: PatientRef | null;
  /** Already on a call — Answer would stack a second one. */
  busy: boolean;
  onAnswer: (() => void) | null;
  onClaim: (() => Promise<string>) | null;
  onDismiss: () => void;
  onNeedsNumber: () => void;
}) {
  const [claiming, setClaiming] = useState(false);
  const [ringingAt, setRingingAt] = useState("");
  const ringing = ring.state === "ringing";
  const seconds = useElapsed(ring.startedAt, ringing);
  useBackgroundNotification(ring, patient);

  const who = patient?.name || fmtPhone(ring.from);
  const urgent = ringing && seconds >= URGENT_AFTER_S;

  const subtitle = useMemo(() => {
    // Compared against the signed-in email, not a local flag: the optimistic
    // "you" is overwritten the moment the server's own update arrives, and
    // "Janelle took this call" on your own screen reads as losing the race.
    if (ring.claimedBy && mine(ring.claimedBy)) {
      return ringingAt ? `Ringing you at ${fmtPhone(ringingAt)}` : "Ringing your phone…";
    }
    if (ring.claimedBy) return `${senderName(ring.claimedBy)} took this call`;
    if (ring.state === "answered") return "Answered";
    if (ring.state === "missed") return "Missed";
    if (patient) return `${patient.boardName} · ${fmtPhone(ring.from)}`;
    // A caller on no board is normal — you can still take the call.
    return ring.callerName || "Not a patient on any board";
  }, [ring, patient, ringingAt]);

  const take = async () => {
    if (!onClaim) return;
    setClaiming(true);
    try {
      const at = await onClaim();
      setRingingAt(at);
      toast.success(`Picking up — your phone is ringing at ${fmtPhone(at)}`);
    } catch (e) {
      const err = e as Error & { status?: number; needsForwardNumber?: boolean };
      // The ordinary race, in all three shapes it arrives in: the caller hung
      // up, or a colleague was quicker. A ring is often only a few seconds
      // long and the terminal webhook can land between the render and the
      // click, so this is the COMMON outcome of a slow click — not a fault.
      //
      // ⚠️ 404 and 409 belong here too (2026-08-21). Only 410 was handled, so
      // the gateway's own "That call is no longer ringing." (404) and "…has
      // already ended." (409) — the same event, caught one layer earlier —
      // came out as a red error toast AND left the dead card on screen to be
      // clicked again. 410 is the same verdict reached via RingCentral; which
      // layer noticed first is not something a rep should be able to tell.
      if (err.status === 410 || err.status === 409 || err.status === 404) {
        toast.info(err.message);
        onDismiss();
      } else if (err.needsForwardNumber) {
        // Open the settings right here. The card is app-wide but the dialog
        // used to live only on the texting page, which left a rep on any other
        // page told to add a number with no way to add it — during a call with
        // seconds left on it.
        toast.error(err.message);
        onNeedsNumber();
      } else {
        toast.error(err.message || "Couldn't take that call.");
      }
    } finally {
      setClaiming(false);
    }
  };

  const canAnswer = ringing && !!onAnswer;
  return (
    <div
      className={cn(
        "w-80 rounded-xl border bg-card shadow-xl overflow-hidden pointer-events-auto",
        ringing ? "border-emerald-500/40" : "border-border",
      )}
      role="alert"
    >
      <div
        className={cn(
          "px-4 py-3 flex items-center gap-2.5 text-white",
          ringing ? "bg-gradient-navy" : "bg-muted text-foreground",
        )}
      >
        <span
          className={cn(
            "h-9 w-9 rounded-full flex items-center justify-center shrink-0",
            ringing ? "bg-emerald-500/20 text-emerald-300" : "bg-black/10",
          )}
        >
          <PhoneIncoming className={cn("h-4 w-4", ringing && "animate-pulse")} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{who}</p>
          <p className="text-[11px] opacity-80 truncate">{subtitle}</p>
        </div>
        {ringing && (
          <span className="text-[11px] tabular-nums opacity-80 shrink-0">
            {seconds}s
          </span>
        )}
        <button
          onClick={onDismiss}
          title="Dismiss — the call keeps ringing for everyone else"
          className="p-1 rounded hover:bg-white/10 shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {ringing && !ring.claimedBy && (
        <>
          <div className="h-0.5 bg-border">
            <div
              className={cn(
                "h-full transition-all duration-1000",
                urgent ? "bg-amber-500" : "bg-emerald-500",
              )}
              // Rough progress against a typical ring-to-voicemail window.
              style={{ width: `${Math.min(100, (seconds / 30) * 100)}%` }}
            />
          </div>
          <div className="flex items-center gap-2 p-3">
            {canAnswer ? (
              <>
                <button
                  onClick={onAnswer!}
                  disabled={busy}
                  title={busy ? "Finish your current call first" : "Answer in this browser"}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <Phone className="h-4 w-4" />
                  Answer
                </button>
                {onClaim && (
                  <button
                    onClick={() => void take()}
                    disabled={claiming}
                    title="Ring my phone instead"
                    className="h-9 w-9 rounded-lg border border-border flex items-center justify-center hover:bg-muted disabled:opacity-50"
                  >
                    {claiming ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <PhoneForwarded className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={() => void take()}
                disabled={claiming || !onClaim}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {claiming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                Take it
              </button>
            )}
            <button
              onClick={onDismiss}
              title="Not for me"
              className="h-9 w-9 rounded-lg border border-border flex items-center justify-center hover:bg-muted"
            >
              <PhoneOff className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Names for the rings the gateway did not name (SIP-only rings, and the live
 * call's overlay). The gateway's own cards arrive already carrying `patient`;
 * this only fills the gaps, once per number, with the same lookup.
 */
function useNames(numbers: string[]): Map<string, PatientRef | null> {
  const [names, setNames] = useState<Map<string, PatientRef | null>>(() => new Map());
  const asked = useRef(new Set<string>());
  const wanted = numbers.map(digitsKey).filter(Boolean).join(",");
  useEffect(() => {
    for (const key of wanted.split(",").filter(Boolean)) {
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      void findPatientByPhone(key)
        .then((p) => setNames((m) => new Map(m).set(key, p)))
        .catch(() => setNames((m) => new Map(m).set(key, null)));
    }
  }, [wanted]);
  return names;
}

export default function IncomingCallHost() {
  const { email, config } = useAccessContext();
  // With Google sign-in off (a dev build) everyone is a manager and, by the
  // same token, an answerer — otherwise nothing could be tried locally.
  const enabled = !authRequired() || canAnswerCalls(email, config);
  const { calls, claim, dismiss, connected, error } = useInboundCalls(enabled);
  const phone = useSoftphone();
  // The store registers (or lets go) within a poll of the assignment changing.
  // `setEnabled` is the store's own bound function, so its identity is stable.
  const { setEnabled } = phone;
  useEffect(() => {
    setEnabled(enabled);
  }, [enabled, setEnabled]);
  // Carried here rather than on the texting page so "add your number" is
  // fixable from wherever the call found you.
  const [settingsOpen, setSettingsOpen] = useState(false);

  const merged = useMemo(() => mergeRings(calls, phone.rings), [calls, phone.rings]);
  const unnamed = useMemo(
    () => [...merged.filter((u) => !u.patient).map((u) => u.from), ...(phone.call ? [phone.call.phone] : [])],
    [merged, phone.call],
  );
  const names = useNames(unnamed);
  const seconds = useElapsedSeconds(phone.call?.connectedAt ?? null);

  // A failed answer or dial is worth interrupting for, once, wherever the rep
  // is. The message stays in the snapshot until dismissed so a page that
  // renders it inline can.
  const lastToast = useRef<string | null>(null);
  useEffect(() => {
    if (phone.lastError && phone.lastError !== lastToast.current) {
      lastToast.current = phone.lastError;
      toast.error(phone.lastError);
    }
    if (!phone.lastError) lastToast.current = null;
  }, [phone.lastError]);

  const callName = phone.call ? names.get(digitsKey(phone.call.phone))?.name || "" : "";

  // ⚠️ No early return on "nothing ringing" any more — the status notes have
  // to render precisely when there are NO calls, because "no calls" is exactly
  // what a dead stream, or a full line, looks like.
  return (
    <>
      {enabled && (
        <div className="fixed bottom-4 left-4 z-[60] flex flex-col gap-2 pointer-events-auto">
          <CallStreamStatus connected={connected} error={error} />
          <SoftphoneStatus enabled={phone.enabled} registration={phone.registration} error={phone.registrationError} />
        </div>
      )}
      {/* pointer-events-none on the stack so the gap between cards doesn't
          swallow clicks on the page behind them. */}
      <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
        {enabled && merged.map((u) => (
          <CallCard
            key={u.key}
            ring={u}
            patient={u.patient ?? names.get(digitsKey(u.from)) ?? null}
            busy={!!phone.call}
            onAnswer={u.sip ? () => phone.answer(u.sip!.id) : null}
            onClaim={u.sse ? () => claim(u.sse!.id) : null}
            onDismiss={() => {
              if (u.sse) dismiss(u.sse.id);
              if (u.sip) phone.ignore(u.sip.id);
            }}
            onNeedsNumber={() => setSettingsOpen(true)}
          />
        ))}
      </div>
      {phone.call && (
        <CallOverlay
          call={{ phone: phone.call.phone, status: phone.call.status, seconds, muted: phone.call.muted }}
          name={callName}
          onHangup={phone.hangup}
          onToggleMute={phone.toggleMute}
        />
      )}
      <RingPreferencesDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
