/**
 * The patient screen's right-hand column (§5.39) — Texts | Calls, the patient's
 * numbers, and Recent notes, in Brandon's `.pt-side` layout.
 *
 * ⚠️ **Both halves are the EXISTING components, not new ones.** The thread is
 * `assignedPatients/ConversationThread`, which is the only surface RingCentral's
 * late `SendingFailed` verdict ever reaches (§5.5) and which already carries the
 * opt-out guard; the Calls tab is `comms/CommunicationsButton` (§5.50), whose
 * popup reads the patient's whole history from the archives and falls back to
 * the call log ON OPEN (§5.16). Rebuilding either here would be a second copy
 * of a rule whose drift is silent.
 *
 * ⚠️ **Only the OPEN tab reads RingCentral** — the §5.28 rule, and the reason
 * the Calls tab renders a button rather than an inline list: a list would have
 * to fetch on mount, which is a per-patient RingCentral read on a screen a rep
 * clicks through. INCIDENT_2026-08-20 is that shape.
 *
 * ⚠️ **Call dials in the page** (Josh, 2026-09-24, §5.50). This column's Call
 * button was a deliberate no-op on the belief that a dialer here would spend a
 * second softphone slot. It would not: `useWebPhone` is a view over the ONE
 * registration every tab shares (§5.13b), so a rep pressed Call and nothing
 * happened for no benefit at all.
 *
 * ⚠️ **Recent notes sits UNDER both tabs, outside the tab body** (§5.39c3) —
 * Brandon's spec, and it falls out of what the block is: a fact about the
 * patient, not about texts or calls. Mounted once here rather than inside each
 * pane, so a rep switching tabs does not lose a half-typed note and the two
 * copies cannot drift. It costs no read: the notes come with the dossier the
 * screen already holds.
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
 *    (Josh, 2026-09-24 — `useCallCounts`), never RingCentral's call log, which
 *    would be a per-patient RingCentral read on every open (§5.16). The Calls
 *    tab leads with the split — we called / they called.
 *  - The bell stays on the Communications hub's thread and in the ring
 *    settings, the two ways a number joins the ring list (§5.13).
 * ⚠️ The resolve bar stays at the TOP of the column, where the Inbox plan put
 * it (COMMS_INBOX_PLAN.md §1.2) — it is Communications' own, and untouched.
 */
import { useCallback, useState } from "react";
import { Loader2, MessageSquare, Phone } from "lucide-react";
import ConversationThread from "@/components/assignedPatients/ConversationThread";
import { CommunicationsButton } from "@/components/comms/CommunicationsButton";
import { useWebPhone } from "@/hooks/assignedPatients/useWebPhone";
import { reportDial } from "@/hooks/commsInbox/useInbox";
import type { PatientRef } from "@/lib/assignedPatients/patientLookup";
import type { PatientSide } from "@/lib/patient/patientScreen";
import type { DossierItem } from "@/lib/commsHub/dossier";
import type { Contacts } from "@/lib/patient/contacts";
import { RecentNotes } from "@/components/patient/RecentNotes";
import { PatientResolveBar } from "@/components/commsInbox/PatientResolveBar";
import type { NoteTarget } from "@/lib/commsInbox/api";
import { formatPhoneParen } from "@/lib/shared/phoneDisplay";
import { useCallCounts } from "@/hooks/callHistory/useCallCounts";
import { countLabel } from "@/lib/callHistory/callCounts";
import { CallCountsCard } from "@/components/patient/CallCountsCard";

export function PatientCommsColumn({
  phone,
  patient,
  side,
  onSide,
  active,
  contacts,
  onNoteAppended,
  noteTarget = null,
}: {
  phone: string;
  patient: PatientRef | null;
  side: PatientSide;
  onSide: (s: PatientSide) => void;
  /** The board the patient is on NOW, for Recent notes. */
  active: DossierItem | null;
  /** Who we reach and on which number — null when no record carries them. */
  contacts: Contacts | null;
  onNoteAppended: (next: string) => void;
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
     is about the patient, whichever of their lines it rang. Postgres only. */
  const callCounts = useCallCounts(phone, alt);

  return (
    <aside className="pt-side">
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
            {callCounts.counts && (
              <span className="n">{countLabel(callCounts.counts.total, callCounts.counts.capped)}</span>
            )}
          </button>
        </div>
      </div>

      {/* Brandon's numline: the primary number and who answers it, then the
          alternate number with the caregiver's name and his two actions. */}
      <div className="numline">
        <Phone style={{ width: 11, height: 11 }} />
        <span className={!onAlt && phone ? "on" : ""}>{formatPhoneParen(phone) || "no phone on file"}</span>
        <span className="muted">
          primary{contacts?.primaryContact ? ` · ${contacts.primaryContact}` : ""}
        </span>
        {/* The primary number's Call, beside the number it dials (§5.50) — the
            dark Call button that used to do this is gone with the thread's
            header on this screen. */}
        {phone && (
          <button
            type="button"
            className="numbtn"
            onClick={() => dialNumber(phone)}
            disabled={callingNumber(phone)}
            title="Call this number from the Command Center"
          >
            {callingNumber(phone) ? (
              <Loader2 className="animate-spin" style={{ width: 10, height: 10 }} />
            ) : (
              <Phone style={{ width: 10, height: 10 }} />
            )}{" "}
            Call
          </button>
        )}

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
          <CallCountsCard view={callCounts} caregiverName={contacts?.caregiverName} />
          <p className="xs muted" style={{ margin: 0 }}>
            Every text, call, recording and voicemail with{" "}
            {onAlt ? "the alternate number" : "this patient"}, full screen — and a composer to text them.
          </p>
          <div>
            <CommunicationsButton
              phone={activePhone}
              altPhone={onAlt ? phone : alt}
              patientName={patient?.name}
              mondayItemId={patient?.itemId}
              canText={onAlt ? undefined : contacts?.canText}
            />
          </div>
          {/* ⚠️ Says WHY the history is behind a press rather than just shown —
              the call log is one of RingCentral's more rate-limited endpoints
              (§5.16) and this screen renders for every patient a rep clicks
              through. */}
          <p className="xs muted" style={{ margin: 0 }}>
            Loaded when you open it, so a patient you only glance at costs nothing.
          </p>
        </div>
      )}

      {/* ⚠️ The PRIMARY number, always: a note is about the patient, and the
          audit line the writer stamps must not name a caregiver's number
          because the thread happened to be switched. */}
      <RecentNotes active={active} phone={phone} onAppended={onNoteAppended} />
    </aside>
  );
}
