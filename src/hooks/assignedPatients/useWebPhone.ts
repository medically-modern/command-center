/**
 * Click-to-call for the Communications Hub — the same interface it has always
 * had, now served by the browser's ONE softphone (lib/softphone/softphone.ts,
 * §5.13b) instead of a registration of its own.
 *
 * Why it is no longer self-contained: RingCentral caps the shared extension at
 * five SIP registrations, and every browser now holds one that can also
 * ANSWER. A second registration per tab for dialling would spend a second slot
 * for nothing. So this dials through the shared phone: if the browser has opted
 * into answering, the registration is already up; if not, it is raised for the
 * call and released half a minute after it ends.
 *
 * The overlay for a live call is mounted app-wide by IncomingCallHost (an
 * answered inbound call needs it on every page), so callers of this hook must
 * NOT mount their own — `softphoneRules.test.ts` pins that.
 */
import { useMemo } from "react";
import { useElapsedSeconds, useSoftphone } from "@/hooks/softphone/useSoftphone";
import type { CallStatus } from "@/lib/softphone/types";

export type { CallStatus };

export interface WebPhoneCall {
  phone: string;
  status: CallStatus;
  /** Seconds since the call connected; 0 until then. */
  seconds: number;
  muted: boolean;
}

export function useWebPhone() {
  const phone = useSoftphone();
  const seconds = useElapsedSeconds(phone.call?.connectedAt ?? null);
  const call = useMemo<WebPhoneCall | null>(
    () =>
      phone.call
        ? { phone: phone.call.phone, status: phone.call.status, seconds, muted: phone.call.muted }
        : null,
    [phone.call, seconds],
  );
  return {
    call,
    error: phone.lastError,
    dismissError: phone.dismissError,
    dial: phone.dial,
    hangup: phone.hangup,
    toggleMute: phone.toggleMute,
  };
}
