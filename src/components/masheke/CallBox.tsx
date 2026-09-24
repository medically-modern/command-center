/**
 * The big "Call (555)-555-0100" button on Confirm Receipt's and Chase
 * Clinicals' method bar — the rep ringing the DOCTOR'S OFFICE.
 *
 * ⚠️ It dials IN the Command Center (Josh, 2026-09-24, CLAUDE.md §5.50: *"the
 * phone number throughout the command center doesnt call … it should NOT open
 * ring central and should call directly from the app"*). It was an
 * `<a href="tel:">`, which hands the number to whatever the operating system
 * has registered — the RingCentral desktop app, or nothing at all.
 *
 * ⚠️ One component for both panels: they carried two byte-identical copies,
 * which is how one of them ends up dialling and the other not.
 *
 * ⚠️ The dial popup is `DialPatientDialog` — dial only. Neither panel's attempt
 * step belongs to a call (they are the fax/portal chase), so nothing here logs.
 */
import { useState } from "react";
import { Phone } from "lucide-react";
import { DialPatientDialog } from "@/components/shared/DialPatientDialog";
import { formatPhoneNice } from "@/lib/shared/phoneDisplay";

export function CallBox({ phone, who }: {
  phone?: string;
  /** Who is being rung — the call popup's title ("Dr. Patel"). */
  who?: string;
}) {
  const [dialing, setDialing] = useState(false);
  const tel = (phone ?? "").replace(/[^\d+]/g, "");
  const display = formatPhoneNice(phone);
  return (
    <>
      <button
        type="button"
        disabled={!tel}
        onClick={() => setDialing(true)}
        title={tel ? `Call ${display} from the Command Center` : "No office phone on file"}
        className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-base font-bold text-[color:var(--mm-on-teal,#fff)] shadow-sm transition-opacity hover:opacity-90 bg-[color:var(--mm-teal)] disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Phone className="h-4 w-4 shrink-0" /> Call {display}
      </button>
      {dialing && tel && (
        <DialPatientDialog open phone={tel} name={who ?? ""} onClose={() => setDialing(false)} />
      )}
    </>
  );
}

export default CallBox;
