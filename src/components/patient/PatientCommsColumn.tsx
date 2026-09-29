/**
 * The patient screen's right-hand column (§5.39) — Texts | Calls and the
 * patient's numbers, in Brandon's `.pt-side` layout.
 *
 * ⚠️ **The thread is the EXISTING component, not a new one** —
 * `assignedPatients/ConversationThread`, which is the only surface RingCentral's
 * late `SendingFailed` verdict ever reaches (§5.5) and which already carries the
 * opt-out guard. Rebuilding it here would be a second copy of a rule whose
 * drift is silent.
 *
 * ⚠️ **Nothing on the Calls tab reads RingCentral** — the counts come from OUR
 * call archive in Postgres. The Communications button that used to sit here
 * was deleted on 2026-09-25 (Josh: *"delete the communications button on the
 * side panel … under the calls tab"*); the full history is the Communications
 * header tab.
 *
 * ⚠️ **Call dials in the page** (Josh, 2026-09-24, §5.50), from the header's
 * top-right Call button (moved and restyled 2026-09-25). `useWebPhone` is a
 * view over the ONE registration every tab shares (§5.13b), so it costs no
 * second softphone slot.
 *
 * ⚠️ **Recent notes is GONE from this column** (Josh, 2026-09-25) — the notes
 * live on the main column: the Subscription view's notes card (with the
 * composer) and the Onboarding view's read-only "Notes from this stage" card.
 *
 * ⚠️ **The alternate number is a SWITCH, not a second pane** (§5.46e). Brandon's
 * numline carries the caregiver and two actions; here both of them point the
 * whole column at the alternate number, because this column is already built as
 * one `phone` feeding both tabs. That is one divergence from his mockup and it
 * is deliberate — see `CONTACTS` note below.
 *
 * ⚠️ **Brandon's pixel-match (item 14, 2026-09-24) is LOOK ONLY here** — Josh:
 * *"leave communcaitons alone"*. The header is the two tabs and nothing else;
 * the thread's own header (the name, the bell, the dark Call) is off on THIS
 * screen through `ConversationThread`'s opt-in `bare`, and the composer is his
 * one line. What moved rather than went:
 *  - **Call** — a chip on the number line, beside the number it dials, the way
 *    his "Call alt" sits beside the alternate. Dropping it would bring back the
 *    button that does nothing (§5.50), which Josh reported the same day.
 *  - **Texts N** — the thread's own count once it has loaded. **Calls N** is
 *    every call with the patient's numbers from OUR call archive in Postgres
 *    (Josh, 2026-09-24), through the route the Care Coordinator cards read
 *    (`useContactTotals`, §5.30i) — never RingCentral's call log, which would
 *    be a per-patient RingCentral read on every open (§5.16). The Calls tab
 *    leads with the split — we called / they called.
 *  - The bell stays on the Communications hub's thread and in the ring
 *    settings, the two ways a number joins the ring list (§5.13).
 * ⚠️ The resolve bar stays at the TOP of the column, where the Inbox plan put
 * it (COMMS_INBOX_PLAN.md §1.2) — it is Communications' own, and untouched.
 */
import { useCallback, useMemo, useState } from "react";
import { Loader2, MessageSquare, Phone } from "lucide-react";
import ConversationThread from "@/components/assignedPatients/ConversationThread";
import { useWebPhone } from "@/hooks/assignedPatients/useWebPhone";
import { reportDial } from "@/hooks/commsInbox/useInbox";
import type { PatientRef } from "@/lib/assignedPatients/patientLookup";
import type { PatientSide } from "@/lib/patient/patientScreen";
import type { Contacts } from "@/lib/patient/contacts";
import { PatientResolveBar } from "@/components/commsInbox/PatientResolveBar";
import type { NoteTarget } from "@/lib/commsInbox/api";
import { formatPhoneParen } from "@/lib/shared/phoneDisplay";
import { useContactTotals } from "@/hooks/careCoordinator/useContactTotals";
import { messagingConfigured } from "@/lib/assignedPatients/messagingApi";
import { patientCallTotals } from "@/lib/patient/callTotals";
import { CallCountsCard } from "@/components/patient/CallCountsCard";

export function PatientCommsColumn({
  phone,
  patient,
  side,
  onSide,
  contacts,
  noteTarget = null,
  paneRef,
  resizer = null,
}: {
  /** The column itself — measured by the width handle (`resizer`). */
  paneRef?: React.Ref<HTMLElement>;
  /** The drag handle on the column's left edge (`PaneResizer`), drawn inside it. */
  resizer?: React.ReactNode;
  phone: string;
  patient: PatientRef | null;
  side: PatientSide;
  onSide: (s: PatientSide) => void;
  /** Who we reach and on which number — null when no record carries them. */
  contacts: Contacts | null;
  /** The patient on this screen — where a resolve note made here is copied,
   *  even when the number files the item under another patient. */
  noteTarget?: NoteTarget | null;
}) {
  const [useAlt, setUseAlt] = useState(false);
  /** The thread's message count per number — what the Texts tab shows. Kept
   *  per NUMBER, so switching to the alternate cannot label one thread with
   *  the other's count, and it survives a visit to the Calls tab. */
  const [textCounts, setTextCounts] = useState<Record<string, number>>({});

  const alt = contacts?.alternatePhoneRaw || "";
  /** ⚠️ Falls back BY CONSTRUCTION when there is no alternate number, so a
   *  selection can never outlive the number it named. The parent also keys this
   *  column on the patient, which is what stops it following a sidebar click
   *  onto somebody else (§9's notes-box rule). */
  const onAlt = useAlt && !!alt;
  const activePhone = onAlt ? alt : phone;

  // Dials through the browser's one shared registration (§5.13b); the app-wide
  // call overlay shows the call. Who dialed is reported first, because the
  // call log cannot say — the whole team is one extension (§5.49).
  const webPhone = useWebPhone();
  const last10 = (n: string) => n.replace(/\D/g, "").slice(-10);
  const dialNumber = (n: string) => {
    if (!n) return;
    reportDial(n);
    void webPhone.dial(n);
  };
  const callingNumber = (n: string) => !!webPhone.call && !!n && last10(webPhone.call.phone) === last10(n);
  const callingActive = callingNumber(activePhone);
  /* ⚠️ Stable, and a no-op when nothing changed: the thread calls this from an
     effect, so a fresh function or a fresh object per render is a render loop
     (INCIDENT_2026-08-20 rule 2). */
  const onCount = useCallback(
    (n: number) =>
      setTextCounts((prev) => (prev[activePhone] === n ? prev : { ...prev, [activePhone]: n })),
    [activePhone],
  );
  const textCount = textCounts[activePhone];
  /* The patient's calls, BOTH numbers — "how many times have we called them"
     is about the patient, whichever of their lines it rang. The SAME route and
     hook the Care Coordinator cards read (§5.30i), so one patient can never
     read two different counts on two screens. Postgres only. */
  const totalsNumbers = useMemo(() => [phone, alt].filter(Boolean), [phone, alt]);
  const totals = useContactTotals(totalsNumbers);
  const callTotals = patientCallTotals(totals.byNumber, phone, alt, messagingConfigured());

  return (
    <aside className="pt-side" ref={paneRef}>
      {resizer}
      {/* The Inbox's resolve bar, compact (COMMS_INBOX_PLAN.md §1.2): the
          patient's open item, or their last resolution. It renders nothing when
          the Inbox is switched off or there is neither — so this column is
          otherwise exactly what it was. Both numbers, because an item is the
          PATIENT's, whichever line they reached us on. */}
      <PatientResolveBar numbers={[phone, alt]} noteTarget={noteTarget} />
      <div className="hd">
        <div className="side-tabs">
          <button type="button" className={side === "texts" ? "on" : ""} onClick={() => onSide("texts")}>
            <MessageSquare style={{ width: 13, height: 13 }} /> Texts
            {textCount !== undefined && <span className="n">{textCount}</span>}
          </button>
          <button type="button" className={side === "calls" ? "on" : ""} onClick={() => onSide("calls")}>
            <Phone style={{ width: 13, height: 13 }} /> Calls
            {callTotals.kind === "ready" && <span className="n">{callTotals.totals.total}</span>}
          </button>
        </div>
        {/* ⚠️ THE Call button, top right (Josh, 2026-09-25: *"make the call
            button like a bit prettier and on the top right area"*) — it moved
            up from the number-line chip and dials whichever number the column
            is on, through the same one shared registration (§5.13b · §5.50).
            "Call alt" below still dials the alternate directly. */}
        {activePhone && (
          <button
            type="button"
            className="call-top"
            onClick={() => dialNumber(activePhone)}
            disabled={callingActive}
            title={`Call ${formatPhoneParen(activePhone)} from the Command Center`}
          >
            {callingActive ? (
              <Loader2 className="animate-spin" style={{ width: 13, height: 13 }} />
            ) : (
              <Phone style={{ width: 13, height: 13 }} />
            )}{" "}
            Call
          </button>
        )}
      </div>

      {/* Brandon's numline: the primary number and who answers it, then the
          alternate number with the caregiver's name and his two actions. */}
      <div className="numline">
        <Phone style={{ width: 11, height: 11 }} />
        <span className={!onAlt && phone ? "on" : ""}>{formatPhoneParen(phone) || "no phone on file"}</span>
        <span className="muted">
          primary{contacts?.primaryContact ? ` · ${contacts.primaryContact}` : ""}
        </span>

        {alt ? (
          <>
            {/* ⚠️ The separator rides INSIDE the alt segment so the two wrap
                together — at the column's real 380px they land on different
                lines, and a lone "·" at the end of a line reads as a typo. */}
            <span className={onAlt ? "on" : ""}>
              · alt {formatPhoneParen(contacts?.alternatePhone || alt)}
              {contacts?.caregiverName ? ` · ${contacts.caregiverName}` : ""}
            </span>
            {onAlt ? (
              <button
                type="button"
                className="numbtn on"
                onClick={() => setUseAlt(false)}
                title="Back to the primary number"
              >
                <MessageSquare style={{ width: 10, height: 10 }} /> Back to primary
              </button>
            ) : (
              <button
                type="button"
                className="numbtn"
                onClick={() => {
                  setUseAlt(true);
                  onSide("texts");
                }}
                title="Text the alternate number instead"
              >
                <MessageSquare style={{ width: 10, height: 10 }} /> Text alt
              </button>
            )}
            {/* "Call alt" DIALS the alternate number (§5.50), and points the
                column at it so the thread beside the call is theirs. It stays
                on while the column is on the alternate, as in Brandon's
                numline. It used to show the alternate's call history instead,
                on the belief that a dialer here would spend a softphone slot —
                it does not; every tab shares one registration (§5.13b). */}
            <button
              type="button"
              className="numbtn"
              onClick={() => {
                setUseAlt(true);
                dialNumber(alt);
              }}
              disabled={callingNumber(alt)}
              title="Call the alternate number from the Command Center"
            >
              <Phone style={{ width: 10, height: 10 }} /> Call alt
            </button>
          </>
        ) : contacts?.caregiverName ? (
          <span className="muted">· caregiver {contacts.caregiverName}</span>
        ) : null}
      </div>

      {!activePhone ? (
        <div className="empty-pane">
          <div className="xs" style={{ maxWidth: 220 }}>
            No phone number on this record, so there is nothing to show here. Add one on the stage
            page and it appears.
          </div>
        </div>
      ) : side === "texts" ? (
        <div className="side-body">
          {onAlt && (
            <div className="altnote">
              Texting the alternate number{contacts?.caregiverName ? ` (${contacts.caregiverName})` : ""} — this
              is its own thread, not the patient&apos;s.
            </div>
          )}
          {/* `bare` is Brandon's look here (item 14): no header of its own —
              the number line above carries the Call — and the one-line
              composer. The thread, its guards and the send are unchanged.
              ⚠️ Keyed on the number so a switch to the alternate cannot carry a
              half-typed message across to a different thread. */}
          <ConversationThread
            key={activePhone}
            phone={activePhone}
            patient={patient}
            onCall={() => dialNumber(activePhone)}
            calling={callingActive}
            canText={contacts?.canText}
            bare
            composerPlaceholder={onAlt ? `Write a text to ${formatPhoneParen(alt)}…` : "Write a text…"}
            onCount={onCount}
          />
        </div>
      ) : (
        <div className="side-body" style={{ padding: 14, gap: 10, overflowY: "auto" }}>
          <CallCountsCard
            state={callTotals}
            since={totals.coverage?.callsSince ?? null}
            caregiverName={contacts?.caregiverName}
          />
          {/* ⚠️ The Communications button is GONE from this tab (Josh,
              2026-09-25: *"delete the communications button on the side panel
              … under the calls tab"* — it reversed §5.51's "keeps it"). The
              full history is still one click away on the Communications header
              tab; nothing here reads RingCentral (§5.16). */}
        </div>
      )}

      {/* ⚠️ Recent notes is GONE from this column (Josh, 2026-09-25: *"we
          have it at bottom of main page of profile page"*) — the Subscription
          view's notes card carries the composer, and the Onboarding view's
          "Notes from this stage" card carries the read-only log (§5.39c3's
          two-components rule survives it). */}
    </aside>
  );
}
