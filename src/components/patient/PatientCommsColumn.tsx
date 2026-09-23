/**
 * The patient screen's right-hand column (§5.39) — Texts | Calls, the patient's
 * numbers, and Recent notes, in Brandon's `.pt-side` layout.
 *
 * ⚠️ **Both halves are the EXISTING components, not new ones.** The thread is
 * `assignedPatients/ConversationThread`, which is the only surface RingCentral's
 * late `SendingFailed` verdict ever reaches (§5.5) and which already carries the
 * opt-out guard; the call history is `shared/CallHistoryButton`, which already
 * fetches ON OPEN rather than on render (§5.16), already plays and downloads a
 * recording, and already paces a bulk download against `rcLimiter`. Rebuilding
 * either here would be a second copy of a rule whose drift is silent.
 *
 * ⚠️ **Only the OPEN tab reads RingCentral** — the §5.28 rule, and the reason
 * the Calls tab renders the button rather than an inline list: a list would have
 * to fetch on mount, which is a per-patient RingCentral read on a screen a rep
 * clicks through. INCIDENT_2026-08-20 is that shape.
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
 */
import { useState } from "react";
import { MessageSquare, Phone } from "lucide-react";
import ConversationThread from "@/components/assignedPatients/ConversationThread";
import { CallHistoryButton } from "@/components/shared/CallHistoryButton";
import type { PatientRef } from "@/lib/assignedPatients/patientLookup";
import type { PatientSide } from "@/lib/patient/patientScreen";
import type { DossierItem } from "@/lib/commsHub/dossier";
import type { Contacts } from "@/lib/patient/contacts";
import { RecentNotes } from "@/components/patient/RecentNotes";
import { PatientResolveBar } from "@/components/commsInbox/PatientResolveBar";

export function PatientCommsColumn({
  phone,
  patient,
  side,
  onSide,
  active,
  contacts,
  onNoteAppended,
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
}) {
  const [useAlt, setUseAlt] = useState(false);

  const alt = contacts?.alternatePhoneRaw || "";
  /** ⚠️ Falls back BY CONSTRUCTION when there is no alternate number, so a
   *  selection can never outlive the number it named. The parent also keys this
   *  column on the patient, which is what stops it following a sidebar click
   *  onto somebody else (§9's notes-box rule). */
  const onAlt = useAlt && !!alt;
  const activePhone = onAlt ? alt : phone;

  return (
    <aside className="pt-side">
      {/* The Inbox's resolve bar, compact (COMMS_INBOX_PLAN.md §1.2): the
          patient's open item, or their last resolution. It renders nothing when
          the Inbox is switched off or there is neither — so this column is
          otherwise exactly what it was. Both numbers, because an item is the
          PATIENT's, whichever line they reached us on. */}
      <PatientResolveBar numbers={[phone, alt]} />
      <div className="hd">
        <div className="side-tabs">
          <button type="button" className={side === "texts" ? "on" : ""} onClick={() => onSide("texts")}>
            <MessageSquare style={{ width: 13, height: 13 }} /> Texts
          </button>
          <button type="button" className={side === "calls" ? "on" : ""} onClick={() => onSide("calls")}>
            <Phone style={{ width: 13, height: 13 }} /> Calls
          </button>
        </div>
      </div>

      {/* Brandon's numline: the primary number and who answers it, then the
          alternate number with the caregiver's name and his two actions. */}
      <div className="numline">
        <Phone style={{ width: 11, height: 11 }} />
        <span className={!onAlt && phone ? "on" : ""}>{phone || "no phone on file"}</span>
        <span className="muted">
          primary{contacts?.primaryContact ? ` · ${contacts.primaryContact}` : ""}
        </span>

        {alt ? (
          <>
            {/* ⚠️ The separator rides INSIDE the alt segment so the two wrap
                together — at the column's real 380px they land on different
                lines, and a lone "·" at the end of a line reads as a typo. */}
            <span className={onAlt ? "on" : ""}>
              · alt {contacts?.alternatePhone || alt}
              {contacts?.caregiverName ? ` · ${contacts.caregiverName}` : ""}
            </span>
            {onAlt ? (
              <button type="button" className="numbtn on" onClick={() => setUseAlt(false)}>
                Back to primary
              </button>
            ) : (
              <>
                {/* ⚠️⚠️ **"Call alt" shows the alternate number's call HISTORY
                    rather than dialling, and that is the one place this column
                    departs from the mockup.** His `callalt` handler is a toast
                    standing in for placing a call; placing one from this screen
                    is deliberately not done — the softphone registration is the
                    Communications Hub's and RingCentral caps the shared
                    extension at five (§5.13b), so a dialer here would spend a
                    slot. Switching the Calls tab is a real move his sample data
                    could not offer, and it costs nothing. */}
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
                <button
                  type="button"
                  className="numbtn"
                  onClick={() => {
                    setUseAlt(true);
                    onSide("calls");
                  }}
                  title="Show the alternate number's call history"
                >
                  <Phone style={{ width: 10, height: 10 }} /> Call alt
                </button>
              </>
            )}
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
          {/* ⚠️ `onCall` is a no-op on purpose: placing a call is the
              Communications Hub's job — it owns the softphone registration, and
              RingCentral caps the shared extension at five (§5.13b). A second
              dialer here would spend a slot. The Calls tab is the door.
              ⚠️ Keyed on the number so a switch to the alternate cannot carry a
              half-typed message across to a different thread. */}
          <ConversationThread
            key={activePhone}
            phone={activePhone}
            patient={patient}
            onCall={() => {}}
            calling={false}
            canText={contacts?.canText}
          />
        </div>
      ) : (
        <div className="side-body" style={{ padding: 14, gap: 10, overflowY: "auto" }}>
          <p className="xs muted" style={{ margin: 0 }}>
            Call history, recordings and voicemail for {onAlt ? "the alternate number" : "this number"},
            from RingCentral.
          </p>
          <div>
            <CallHistoryButton phone={activePhone} />
          </div>
          {/* ⚠️ Says WHY the list is behind a press rather than just showing a
              button — the call log is one of RingCentral's more rate-limited
              endpoints (§5.16) and this screen renders for every patient a rep
              clicks through. */}
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
