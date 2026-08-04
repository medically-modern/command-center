/**
 * Click-to-call for Assigned Patients, shared by the sidebar row button and the
 * conversation header so the two can't drift.
 *
 * ⚠️ Two different numbers are involved and confusing them is the whole trap:
 *   callerId — what the PATIENT sees. Always the MM number. Never per-rep.
 *   from     — the phone RINGCENTRAL RINGS to reach the rep, so they can be
 *              bridged to the patient. This is the rep's own line.
 * With no `from` configured we fall back to the MM main number, which means the
 * main line rings and whoever answers there gets connected — not necessarily
 * the person who clicked. The page says so.
 */
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { mmPhoneNumber, startRingOut } from "@/lib/fax/ringcentralApi";
import { fmtPhone } from "@/lib/assignedPatients/format";

export function useRingOut(repPhone: string) {
  const [callingPhone, setCallingPhone] = useState<string | null>(null);

  const call = useCallback(
    async (patientPhone: string) => {
      if (!patientPhone || callingPhone) return;
      setCallingPhone(patientPhone);
      try {
        const from = repPhone || mmPhoneNumber();
        await startRingOut({ from, to: patientPhone, callerId: mmPhoneNumber() });
        toast.success(
          repPhone
            ? `Calling — pick up at ${fmtPhone(from)} and we'll connect you.`
            : `Calling — pick up at the main line ${fmtPhone(from)} and we'll connect you.`,
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setCallingPhone(null);
      }
    },
    [repPhone, callingPhone],
  );

  return { call, callingPhone };
}
