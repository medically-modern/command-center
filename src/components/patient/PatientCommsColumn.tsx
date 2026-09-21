/**
 * The patient screen's right-hand column (§5.39) — Texts | Calls, and the
 * patient's numbers, in Brandon's `.pt-side` layout.
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
 */
import { MessageSquare, Phone } from "lucide-react";
import ConversationThread from "@/components/assignedPatients/ConversationThread";
import { CallHistoryButton } from "@/components/shared/CallHistoryButton";
import type { PatientRef } from "@/lib/assignedPatients/patientLookup";
import type { PatientSide } from "@/lib/patient/patientScreen";
import type { DossierItem } from "@/lib/commsHub/dossier";
import { RecentNotes } from "@/components/patient/RecentNotes";

export function PatientCommsColumn({
  phone,
  patient,
  side,
  onSide,
  active,
  onNoteAppended,
}: {
  phone: string;
  patient: PatientRef | null;
  side: PatientSide;
  onSide: (s: PatientSide) => void;
  /** The board the patient is on NOW, for Recent notes. */
  active: DossierItem | null;
  onNoteAppended: (next: string) => void;
}) {
  return (
    <aside className="pt-side">
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

      <div className="numline">
        <Phone style={{ width: 11, height: 11 }} />
        <span className={phone ? "on" : ""}>{phone || "no phone on file"}</span>
        <span className="muted">primary</span>
      </div>

      {!phone ? (
        <div className="empty-pane">
          <div className="xs" style={{ maxWidth: 220 }}>
            No phone number on this record, so there is nothing to show here. Add one on the stage
            page and it appears.
          </div>
        </div>
      ) : side === "texts" ? (
        <div className="side-body">
          {/* ⚠️ `onCall` is a no-op on purpose: placing a call is the
              Communications Hub's job — it owns the softphone registration, and
              RingCentral caps the shared extension at five (§5.13b). A second
              dialer here would spend a slot. The Calls tab is the door. */}
          <ConversationThread phone={phone} patient={patient} onCall={() => {}} calling={false} />
        </div>
      ) : (
        <div className="side-body" style={{ padding: 14, gap: 10, overflowY: "auto" }}>
          <p className="xs muted" style={{ margin: 0 }}>
            Call history, recordings and voicemail for this number, from RingCentral.
          </p>
          <div>
            <CallHistoryButton phone={phone} />
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

      <RecentNotes active={active} phone={phone} onAppended={onNoteAppended} />
    </aside>
  );
}
