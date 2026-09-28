/**
 * Report this browser's RingCentral registration to the gateway (§5.13b).
 *
 * ⚠️⚠️ **THE ONLY WAY ANYONE CAN SEE THIS.** The SIP socket goes browser →
 * RingCentral **directly** — the gateway is not on that path — and the sipInfo
 * cache means a healthy browser asks it for credentials about once a week. So
 * "five browsers registered and ringing" and "nobody has been able to register
 * since Tuesday" produce exactly the same gateway logs, which is how a rep on
 * prod sat on *"cant connct ring centerals phone server retrying and it never
 * resolves"* for an afternoon with nothing server-side recording it
 * (2026-09-28). Josh: *"i need a way to monitor if rc is correctly connecting
 * in everyones browsers"*. This is the half that supplies the facts; the
 * readout is on /access.
 *
 * ⚠️ **The LEADER tab only.** It is the tab that holds the browser's one
 * registration (tabProtocol.ts); a follower is mirroring its state and would
 * report the same row again under the same instance id, once per open tab.
 *
 * ⚠️ **ONE timer, at one a minute** (INCIDENT_2026-08-20's rule): at most five
 * answerers, so single figures a minute at the gateway and nothing at all at
 * RingCentral. It posts immediately whenever the registration CHANGES, so the
 * heartbeat is only there to say "this browser is still open" — which is what
 * lets the gateway tell a broken browser from a closed one.
 */
import { useEffect, useRef } from "react";
import { reportPhoneState } from "@/lib/inboundCalls/callsApi";
import type { PhoneSnapshot } from "@/lib/softphone/types";

/** ⚠️ Keep in agreement with the gateway's `PRESENCE_HEARTBEAT_MS`, which
 *  derives its staleness window (3 beats) from this. */
export const PHONE_REPORT_EVERY_MS = 60_000;

export function usePhoneStateReport(phone: PhoneSnapshot, instanceId: string, enabled: boolean): void {
  const { leader, registration, registrationError } = phone;
  // Read inside the effect so a changing value never re-arms the timer.
  const latest = useRef({ registration, registrationError, instanceId });
  latest.current = { registration, registrationError, instanceId };

  useEffect(() => {
    if (!enabled || !leader) return;
    let stopped = false;
    const send = () => {
      if (stopped) return;
      const cur = latest.current;
      void reportPhoneState({
        registration: cur.registration,
        detail: cur.registrationError,
        leader: true,
        instanceId: cur.instanceId,
        userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
      });
    };
    // Immediately on any change of the values in the deps, then on the beat.
    send();
    const id = setInterval(send, PHONE_REPORT_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
    // ⚠️ `registrationError` is deliberately NOT a dep: it changes wording
    // within one failure state and would restart the heartbeat each time. The
    // next beat carries the current text, and `registration` covers every
    // change that matters to the verdict.
  }, [enabled, leader, registration]);
}
