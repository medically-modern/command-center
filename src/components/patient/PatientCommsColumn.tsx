/**
 * The patient screen's right-hand column — Texts | Calls (§5.39).
 *
 * ⚠️ **Both halves are the EXISTING components, not new ones.** The thread is
 * `assignedPatients/ConversationThread`, which is the only surface RingCentral's
 * late `SendingFailed` verdict ever reaches (§5.5) and which already carries the
 * opt-out guard; the call history is `shared/CallHistoryButton`, which already
 * fetches ON OPEN rather than on render (§5.16), already plays and downloads a
 * recording, and already paces a bulk download against `rcLimiter`. Rebuilding
 * either one here would be a second copy of a rule whose drift is silent.
 *
 * ⚠️ **Only the OPEN tab reads RingCentral** — the §5.28 rule, and the reason
 * the Calls tab renders a button rather than an inline list in this first slice:
 * a list would have to fetch on mount, which is a per-patient RingCentral read
 * on a screen a rep clicks through. The button is the version that already has
 * the incident guards.
 */
import { Phone, MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import ConversationThread from "@/components/assignedPatients/ConversationThread";
import { CallHistoryButton } from "@/components/shared/CallHistoryButton";
import type { PatientRef } from "@/lib/assignedPatients/patientLookup";
import type { PatientSide } from "@/lib/patient/patientScreen";

export function PatientCommsColumn({
  phone,
  patient,
  side,
  onSide,
}: {
  phone: string;
  patient: PatientRef | null;
  side: PatientSide;
  onSide: (s: PatientSide) => void;
}) {
  if (!phone) {
    return (
      <aside className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        No phone number on this record, so there is nothing to show here. Add one on the stage page
        and it will appear.
      </aside>
    );
  }

  return (
    <aside className="flex min-h-0 flex-col rounded-xl border bg-card">
      <div className="flex shrink-0 items-center gap-1 border-b p-2">
        <Tab active={side === "texts"} onClick={() => onSide("texts")} icon={<MessageSquare className="h-3.5 w-3.5" />}>
          Texts
        </Tab>
        <Tab active={side === "calls"} onClick={() => onSide("calls")} icon={<Phone className="h-3.5 w-3.5" />}>
          Calls
        </Tab>
      </div>

      {side === "texts" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* ⚠️ `onCall` is deliberately a no-op here: placing a call is the
              Communications Hub's job (it owns the softphone registration,
              §5.13b), and a second dialer on this screen would spend a second
              SIP slot. The Calls tab beside it is where a rep goes. */}
          <ConversationThread phone={phone} patient={patient} onCall={() => onSide("calls")} calling={false} />
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3 p-4">
          <p className="text-sm text-muted-foreground">
            Every call with this number — both directions, with the recording where RingCentral kept
            one.
          </p>
          <CallHistoryButton phone={phone} display={phone} label="Open call history" />
          <p className="text-xs text-muted-foreground">
            ⚠️ RingCentral deletes recordings after 90 days and keeps the log row, so an older call
            looks the same as one that was never recorded.
          </p>
        </div>
      )}
    </aside>
  );
}

function Tab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
      )}
    >
      {icon}
      {children}
    </button>
  );
}
