/**
 * Re-read a text thread shortly after sending, so a LATE delivery failure
 * actually reaches the rep's eyes.
 *
 * The three texting surfaces all refresh the thread the instant a send
 * resolves — at which point the message is `Queued` and looks perfectly
 * healthy. RingCentral only flips it to `SendingFailed` a few seconds later
 * (see `lib/shared/smsDelivery.ts`), by which time nothing re-reads the thread
 * and the rep has moved on. Without this the failure marker is technically
 * present and practically invisible: you would have to reopen the conversation
 * later, already suspecting something went wrong.
 *
 * ⚠️ **Cancellation is not tidiness, it is correctness.** Each surface's reload
 * is bound to the patient who was open when the send happened. A timer left
 * running across a patient switch fetches the PREVIOUS patient's conversation
 * and paints it into the open one — one patient's texts under another's name.
 * So callers must `cancel()` on every phone/patient change; unmount is handled
 * here.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";

/**
 * When to look again, in ms after the send resolves. Two passes: most
 * rejections (an unallocated or landline number) come back almost at once, and
 * the later one catches a slower carrier without polling all day.
 */
export const DELIVERY_RECHECK_MS = [6_000, 20_000];

export function useDeliveryRecheck(): {
  /** Re-read via `reload` at each recheck point. Replaces any pending run. */
  schedule: (reload: () => unknown) => void;
  /** Drop any pending recheck — call this whenever the open patient changes. */
  cancel: () => void;
} {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const cancel = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  const schedule = useCallback(
    (reload: () => unknown) => {
      cancel();
      timers.current = DELIVERY_RECHECK_MS.map((ms) =>
        setTimeout(() => {
          void reload();
        }, ms),
      );
    },
    [cancel],
  );

  useEffect(() => cancel, [cancel]);

  // ⚠️ ONE object identity for the life of the component — memoized, not a
  // fresh literal. `schedule` and `cancel` are already stable, but the OBJECT
  // holding them was rebuilt on every render, and a caller that (correctly)
  // lists this hook's result in an effect's dependency array then has an effect
  // whose deps change every render: effect runs → it setStates → render → new
  // object → effect runs again, unbounded, at render speed.
  //
  // That is not hypothetical. IntakeMessages did exactly this on 2026-08-20 and
  // fired `POST /messaging/conversation` thousands of times a second until the
  // browser ran out of sockets (`ERR_INSUFFICIENT_RESOURCES`) — and the flood
  // pushed the shared RingCentral account over its rate limit, which took the
  // INBOUND CALL subscription lookups down with it (429), which paged everyone
  // about an outage that was never happening. One render loop, three systems.
  //
  // The consumer was fixed too. This is the half that protects the NEXT caller:
  // depending on the whole object is the natural thing to write, and it must be
  // safe rather than merely discouraged.
  return useMemo(() => ({ schedule, cancel }), [schedule, cancel]);
}
