/**
 * Surfaces a gateway send that failed AFTER the panel stopped watching.
 *
 * WHY THIS EXISTS (2026-08-11 incident). The gateway /send fast path returns
 * "submitted" when a job outlives the ~20s foreground poll, and every flow that
 * doesn't pass `requireDone` reports that to the rep as a clean send. That is
 * fine while the job succeeds — it is durable and idempotent, so it will run.
 * It is NOT fine when the job then FAILS server-side: the panel already showed
 * success, the rep moved on, and nothing anywhere says the patient never
 * advanced. A manager hit exactly this — "didn't get the error message, but it
 * also did not advance."
 *
 * App-wide on purpose (same reasoning as IncomingCallHost): by the time the job
 * resolves the rep is usually on another patient, or another page.
 */

import { useEffect } from "react";
import { toast } from "sonner";
import { subscribeSendFailures } from "@/lib/shared/gatewaySend";

const SendFailureHost = () => {
  useEffect(
    () =>
      subscribeSendFailures(({ label, error }) => {
        toast.error(`${label || "A save"} did NOT go through`, {
          // The server's own message — "Monday did not create the label X",
          // "verify timeout…" — is the actionable half, so it must survive.
          description:
            (error?.trim() || "The server accepted it but could not finish writing it to Monday.") +
            " The patient was not advanced — reopen them and send again.",
          // Never auto-dismiss: this fires while the rep is looking at something
          // else, and a toast they miss is the bug this component exists to fix.
          duration: Infinity,
          closeButton: true,
        });
      }),
    [],
  );
  return null;
};

export default SendFailureHost;
