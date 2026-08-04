/**
 * In-browser softphone for Assigned Patients: click Call, talk in the page,
 * hang up. No "RingCentral rings your phone first" — that's RingOut, and it
 * confused everyone who used it.
 *
 * The browser has no RingCentral token (the JWT lives on the gateway), so the
 * SIP credentials come from `${GATEWAY}/assignments/sip-provision`. Registration
 * is lazy: nothing connects until the first call, so merely opening the page
 * doesn't claim a SIP registration.
 *
 * ⚠️ OUTBOUND ONLY, and that is what makes a shared extension workable. Every
 * rep registers as the same RingCentral extension; the documented consequence of
 * sharing an instanceId is that older instances stop receiving INBOUND calls,
 * which costs us nothing because we never answer. We deliberately pass no
 * instanceId — distinct ones would each claim a slot against the SIP server's
 * 5-registrations-per-extension cap, which four reps with two tabs would blow.
 *
 * ⚠️ Needs the `VoipCalling` scope and a Digital Line on that extension. Without
 * either, provisioning fails and `error` carries RingCentral's own reason so the
 * UI can say what's actually wrong instead of silently doing nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import WebPhone from "ringcentral-web-phone";
import { getIdToken } from "@/lib/shared/auth";

const GATEWAY =
  (import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined)?.replace(/\/+$/, "") || "";

export type CallStatus = "idle" | "connecting" | "ringing" | "connected" | "ending";

export interface WebPhoneCall {
  phone: string;
  status: CallStatus;
  /** Seconds since the call connected; 0 until then. */
  seconds: number;
  muted: boolean;
}

interface RcCallSession {
  hangup?: () => Promise<void> | void;
  mute?: () => Promise<void> | void;
  unmute?: () => Promise<void> | void;
  on?: (event: string, fn: () => void) => void;
  state?: string;
}

export function useWebPhone() {
  const [call, setCall] = useState<WebPhoneCall | null>(null);
  const [error, setError] = useState<string | null>(null);
  const phoneRef = useRef<WebPhone | null>(null);
  const sessionRef = useRef<RcCallSession | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (tickRef.current) clearInterval(tickRef.current);
      // Leave the SIP registration up on unmount only if a call is live;
      // otherwise release it so we don't hold a slot on the shared extension.
      if (!sessionRef.current) void phoneRef.current?.dispose?.().catch?.(() => {});
    };
  }, []);

  /** Register with RingCentral, reusing the existing registration if there is
   *  one. Throws with RingCentral's own message when provisioning is refused. */
  const ensureRegistered = useCallback(async (): Promise<WebPhone> => {
    if (phoneRef.current) return phoneRef.current;
    if (!GATEWAY) throw new Error("Calling needs the Monday gateway (VITE_MONDAY_GATEWAY_URL).");
    const token = getIdToken();
    const res = await fetch(`${GATEWAY}/assignments/sip-provision`, {
      headers: token ? { "X-MM-Auth": token } : {},
    });
    if (!res.ok) {
      let msg = `Couldn't set up calling (${res.status})`;
      try {
        const j = (await res.json()) as { error?: string; message?: string };
        msg = j.error || j.message || msg;
      } catch {
        /* keep default */
      }
      throw new Error(msg);
    }
    const provision = (await res.json()) as { sipInfo?: unknown[] };
    const sipInfo = Array.isArray(provision.sipInfo) ? provision.sipInfo[0] : provision.sipInfo;
    if (!sipInfo) throw new Error("RingCentral returned no SIP credentials for this extension.");
    // No instanceId on purpose — see the header note about the 5-per-extension cap.
    const wp = new WebPhone({ sipInfo: sipInfo as never });
    await wp.start();
    phoneRef.current = wp;
    return wp;
  }, []);

  const cleanupCall = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    sessionRef.current = null;
    if (mounted.current) setCall(null);
  }, []);

  const dial = useCallback(
    async (phone: string) => {
      if (!phone || sessionRef.current) return;
      setError(null);
      setCall({ phone, status: "connecting", seconds: 0, muted: false });
      try {
        const wp = await ensureRegistered();
        if (!mounted.current) return;
        setCall((c) => (c ? { ...c, status: "ringing" } : c));

        const session = (await wp.call(phone)) as unknown as RcCallSession;
        sessionRef.current = session;

        session.on?.("answered", () => {
          if (!mounted.current) return;
          setCall((c) => (c ? { ...c, status: "connected" } : c));
          const startedAt = Date.now();
          tickRef.current = setInterval(() => {
            if (!mounted.current) return;
            setCall((c) => (c ? { ...c, seconds: Math.floor((Date.now() - startedAt) / 1000) } : c));
          }, 1000);
        });
        // Both names appear across SDK versions; harmless to listen for both.
        session.on?.("disposed", cleanupCall);
        session.on?.("terminated", cleanupCall);
      } catch (e) {
        if (!mounted.current) return;
        setError(e instanceof Error ? e.message : String(e));
        cleanupCall();
      }
    },
    [ensureRegistered, cleanupCall],
  );

  const hangup = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return cleanupCall();
    setCall((c) => (c ? { ...c, status: "ending" } : c));
    try {
      await s.hangup?.();
    } catch {
      /* the call is going away either way */
    }
    cleanupCall();
  }, [cleanupCall]);

  const toggleMute = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    const next = !call?.muted;
    try {
      if (next) await s.mute?.();
      else await s.unmute?.();
      setCall((c) => (c ? { ...c, muted: next } : c));
    } catch {
      /* leave the flag alone if the SDK refused */
    }
  }, [call?.muted]);

  return { call, error, dismissError: () => setError(null), dial, hangup, toggleMute };
}
