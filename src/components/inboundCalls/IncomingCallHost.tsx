/**
 * The inbound-call cards — mounted app-wide, not on one page.
 *
 * A call arrives while you are working wherever you happen to be working, so
 * this hangs off the app root next to FileViewerHost rather than living on the
 * texting page. It is the whole reason the feature is worth having: RingCentral
 * already pops a notification that knows a phone number, and this one knows
 * WHO is calling, what stage they are at, and lets you take the call in a click.
 *
 * ── One way to take a call (§5.13b, since 2026-09-28) ──────────────────────
 * Every card is the join of two signals about ONE ring (lib/softphone/
 * ringMerge.ts): the gateway's webhook, which every tab sees and which knows
 * the patient, and this browser's own SIP registration, which only the five
 * registered browsers have. When the SIP leg is here the card leads with
 * **Answer** — audio in the page. When it is not, the card SAYS WHY instead.
 *
 * ⚠️⚠️ **"TAKE IT" (forward to my phone) IS GONE** (Josh, 2026-09-28, after a
 * test call rang his cell: *"it sent to my phone??? which it should never
 * fucking do"* — the forward was us, /calls/claim at 15:34:25Z, pressed on the
 * one big green button a card offers when the browser holds no SIP leg). The
 * policy was already stated on 2026-09-25 (*"we dont do call forwarding
 * anymore everyone answers in the browser"*) when the number EDITOR went; the
 * button survived for people with saved numbers, which meant the product
 * offered the banned thing precisely when the allowed thing was broken. Now:
 * no Answer ⇒ the card explains the registration state (line full, connecting,
 * the error) — the same reading the badge gives — and the fix is fixing the
 * registration, never routing a patient to a personal phone. The gateway's
 * /calls/claim route and saved numbers stay untouched (the §5.13 precedent);
 * only the UI into them is removed. An old-build browser that still claims a
 * call renders here as "<name> took this call", unchanged.
 *
 * ⚠️ The X on a card is LOCAL. It never declines the call — a decline from one
 * device can shorten the window in which a colleague, or Take it, can still
 * pick up (see softphone.ts). `softphoneRules.test.ts` pins this.
 *
 * ⚠️ ONLY people who connected their own RingCentral login get any of this —
 * the stream, the cards, the registration (§5.13c; until 2026-09-30 it was the
 * manager-assigned `callAnswerers`, five at most on Katie's line). Everyone
 * else sees nothing, by design. The one thing that renders for everybody is
 * the overlay for a call THEY placed from the hub, which still goes out on the
 * shared line as before (`phoneLine` in lib/softphone/rcLine.ts).
 *
 * Cards come in top-right, deliberately away from the CallOverlay at
 * bottom-right — "a call is arriving" and "you are on a call" must never be
 * mistaken for each other. The overlay for a LIVE call is mounted here too,
 * because an answered inbound call needs it on every page.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Phone, PhoneIncoming, PhoneOff, X } from "lucide-react";
import { toast } from "sonner";
import { useInboundCalls } from "@/hooks/inboundCalls/useInboundCalls";
import { usePhoneStateReport } from "@/hooks/inboundCalls/usePhoneStateReport";
import { useElapsedSeconds, useSoftphone } from "@/hooks/softphone/useSoftphone";
import { digitsKey, mergeRings, type UnifiedRing } from "@/lib/softphone/ringMerge";
import type { RegistrationStatus } from "@/lib/softphone/types";
import { ringingCards } from "@/lib/softphone/ringRules";
import { findPatientByPhone, type PatientRef } from "@/lib/assignedPatients/patientLookup";
import CallStreamStatus from "@/components/inboundCalls/CallStreamStatus";
import SoftphoneStatus from "@/components/inboundCalls/SoftphoneStatus";
import CallOverlay from "@/components/assignedPatients/CallOverlay";
import { fmtPhone, senderName } from "@/lib/assignedPatients/format";
import { authRequired, getUser } from "@/lib/shared/auth";
import { clearRcLineNotice, phoneLine, useRcLine } from "@/lib/softphone/rcLine";
import { cn } from "@/lib/utils";

/** Is this claim the signed-in user's own? Claims can only come from another
 *  browser still on a build with Take it (the gateway keeps the route), and
 *  its optimistic "you" never reaches this tab — but the server echo does. */
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
  noAnswerReason,
  onDismiss,
}: {
  ring: UnifiedRing;
  patient: PatientRef | null;
  /** Already on a call — Answer would stack a second one. */
  busy: boolean;
  onAnswer: (() => void) | null;
  /** Why Answer is missing, when it is — the registration state, in the same
   *  words the badge uses, given how long the card has been up. The card must
   *  never be a dead end with no story. */
  noAnswerReason: (seconds: number) => string;
  onDismiss: () => void;
}) {
  const ringing = ring.state === "ringing";
  const seconds = useElapsed(ring.startedAt, ringing);
  useBackgroundNotification(ring, patient);

  const who = patient?.name || fmtPhone(ring.from);
  const urgent = ringing && seconds >= URGENT_AFTER_S;

  const subtitle = useMemo(() => {
    // Compared against the signed-in email, not a local flag: the optimistic
    // "you" is overwritten the moment the server's own update arrives, and
    // "Janelle took this call" on your own screen reads as losing the race.
    if (ring.claimedBy && mine(ring.claimedBy)) return "Ringing your phone…";
    if (ring.claimedBy) return `${senderName(ring.claimedBy)} took this call`;
    if (ring.state === "answered") return "Answered";
    if (ring.state === "missed") return "Missed";
    if (patient) return `${patient.boardName} · ${fmtPhone(ring.from)}`;
    // A caller on no board is normal — you can still take the call.
    return ring.callerName || "Not a patient on any board";
  }, [ring, patient]);

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
              <button
                onClick={onAnswer!}
                disabled={busy}
                title={busy ? "Finish your current call first" : "Answer in this browser"}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                <Phone className="h-4 w-4" />
                Answer
              </button>
            ) : (
              /* ⚠️ No SIP leg ⇒ no button AT ALL — never a forward (the header
                 explains; Josh, 2026-09-28). The card's job here is the WHY:
                 the same reading the badge gives, beside the call it is
                 costing. The call keeps ringing every registered device and
                 the RingCentral app regardless. */
              <p className="flex-1 text-[11px] leading-snug text-muted-foreground">
                {noAnswerReason(seconds)}
              </p>
            )}
            <button
              onClick={onDismiss}
              title="Not for me"
              className="h-9 w-9 rounded-lg border border-border flex items-center justify-center hover:bg-muted shrink-0"
            >
              <PhoneOff className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** How long a registered browser waits for its SIP leg before the card says
 *  the call went to another device: the greeting plays before anyone rings. */
const FIRST_RING_GRACE_S = 15;

/**
 * Why a ringing card has no Answer button, in the badge's own voice (§5.13b).
 * The registration state is the whole story: Answer exists exactly when this
 * browser holds the call's SIP leg, and it holds legs exactly when registered.
 */
function reasonForNoAnswer(registration: RegistrationStatus, error: string | null, seconds: number): string {
  switch (registration) {
    case "full":
      return "The line is full, so this browser can't answer — quit RingCentral apps or spare Command Center tabs to free a slot. It retries every minute.";
    case "registering":
      return "Connecting this browser to the line — Answer appears when it's registered.";
    case "registered":
      // ⚠️ Not yet rung is NOT "rung elsewhere". The main line answers to play
      // Katie's greeting first, and only then rings anyone: measured 7.3s from
      // the card to the first device leg on 2026-10-01 (§5.13c). Saying "another
      // device" during the greeting told Josh his own test call wasn't his.
      if (seconds < FIRST_RING_GRACE_S) {
        return "The caller is hearing the greeting — Answer appears when RingCentral rings this browser.";
      }
      // Registered, and still no leg for THIS call: RingCentral delivered it
      // to a more recently registered device (§5.13b's instanceId rule).
      return "This call is ringing on another registered device, not this browser.";
    case "error":
      return error || "This browser can't register with RingCentral right now.";
    default:
      return "Browser answering is off in this browser.";
  }
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
  // ⚠️ Rung = connected their OWN RingCentral login (§5.13c). The /access
  // assignment no longer decides this (Josh, 2026-09-30). With Google sign-in
  // off (a dev build) nobody can connect, so everyone rings on the shared line
  // — otherwise nothing could be tried locally.
  const rcLine = useRcLine();
  const { enabled, line } = phoneLine(!authRequired(), rcLine);
  const { calls, dismiss, connected, error } = useInboundCalls(enabled);
  const phone = useSoftphone();
  // The store registers (or lets go) within a poll of the assignment changing.
  // `setEnabled` is the store's own bound function, so its identity is stable.
  // ⚠️ The line FIRST, so the registration `setEnabled` starts is already on
  // the right extension.
  const { setCardRings, setEnabled, setLine } = phone;
  useEffect(() => {
    setLine(line);
    setEnabled(enabled);
  }, [enabled, line, setEnabled, setLine]);
  // The outcome of a Connect that just came back from RingCentral — once.
  useEffect(() => {
    const n = rcLine.notice;
    if (!n) return;
    if (n.kind === "connected") toast.success("RingCentral connected — calls now ring on your own line");
    else toast.error(n.reason ? `RingCentral didn't connect: ${n.reason}` : "RingCentral didn't connect");
    clearRcLineNotice();
  }, [rcLine.notice]);
  // ⚠️ **The ringtone is keyed on the CARDS, not on this browser's SIP legs**
  // (§5.13b, 2026-09-28 — Josh: "sometimes the notif pops up and it doesnt"
  // ring). A card arrives for every assigned answerer; the SIP leg only
  // arrives if this browser holds one of RingCentral's five registrations and
  // was the most recent of them, which is exactly what is not true while the
  // line is full, a retry is in flight, or the RingCentral desktop app has the
  // newest registration. The store de-duplicates against its own legs and
  // decides which tab makes the sound (ringRules.ts), so this only has to say
  // what this tab can see.
  useEffect(() => {
    setCardRings(ringingCards(calls));
  }, [calls, setCardRings]);
  // Tell the gateway whether this browser is actually on the line — the one
  // thing it cannot see for itself (§5.13b). Leader tab only, one beat a
  // minute; the readout is on /access.
  usePhoneStateReport(phone, phone.instanceId, enabled);

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
      {/* ⚠️⚠️ **THIS STACK SAT ON THE SETTINGS BUTTON AND SWALLOWED THE CLICK.**
          `ThemePickerButton` is `fixed bottom-4 left-4 z-40` on `ProcessorView`
          and on the no-sidebar home, and the old sidebar puts its own settings
          gear plus Manage Access in the same corner — so at `bottom-4 z-[60]`
          with pointer events on, these notices covered all three. That button
          is sign-out AND the layout escape hatch (§5.39b), so "covered" meant a
          rep with an unhealthy call stream could not leave the layout or the
          app. Measured in a browser, not reasoned about: the click was
          reported intercepted by this div.

          ⚠️ **Fixed BY CONSTRUCTION, not by tuning the offset.** These notices
          only report, so `pointer-events-none` on the stack means they can
          never intercept anything — whatever corner they sit in, however tall
          they grow, and whatever a page puts behind them. That is the same
          thing the card stack below already does, for the same reason; the one
          interactive thing in here (`CallStreamStatus`' Reload, which renders
          only when the stream is dead) takes `pointer-events-auto` back for
          itself. `bottom-14` is then only about being SEEN: it clears the 32px
          button visually, so the escape hatch stays findable rather than
          merely clickable-through. */}
      {enabled && (
        <div className="fixed bottom-14 left-4 z-[60] flex flex-col gap-2 pointer-events-none">
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
            noAnswerReason={(seconds) => reasonForNoAnswer(phone.registration, phone.registrationError, seconds)}
            onDismiss={() => {
              // ⚠️ `dismiss` drops the card from THIS tab's list; `ignore` is
              // what reaches the tab making the sound. The card half needs
              // both now that the ringtone follows the card — without the
              // second call, X would clear the card here and leave the leader
              // tab chiming at a call this browser has already waved off.
              if (u.sse) {
                dismiss(u.sse.id);
                phone.ignore(u.sse.id);
              }
              if (u.sip) phone.ignore(u.sip.id);
            }}
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
    </>
  );
}
