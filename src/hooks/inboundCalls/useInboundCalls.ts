/**
 * Live inbound calls for the signed-in employee.
 *
 * Holds one SSE connection to the gateway for the whole app. Calls arrive
 * already filtered by this user's rules (server-side — see callsApi.ts), so
 * everything this hook receives is meant for this screen.
 *
 * The caller's NAME is resolved here rather than on the gateway: the board and
 * phone-column registry lives in the SPA (systemMgmt's BOARDS), and duplicating
 * it server-side is exactly the kind of drift CLAUDE.md's keep-in-agreement
 * notes exist to prevent. The card renders the moment the number arrives and
 * fills the name in when the lookup lands, so a slow Monday query delays the
 * patient's name, never the ring.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  claimCall,
  inboundCallsConfigured,
  streamUrl,
  type InboundCall,
  type RingPrefs,
} from "@/lib/inboundCalls/callsApi";
import { findPatientByPhone, type PatientRef } from "@/lib/assignedPatients/patientLookup";
import { isAuthed, onAuthChange } from "@/lib/shared/auth";

/** How long a finished call stays on screen before it clears itself. Long
 *  enough to register "missed" or "Sarah took it"; short enough that a stale
 *  card is never mistaken for a live one. */
const LINGER_MS = 6_000;
/** EventSource retries forever by default. A token the gateway rejects would
 *  otherwise reconnect in a tight loop for the life of the tab. */
const MAX_CONSECUTIVE_FAILURES = 5;

export interface RingingCall extends InboundCall {
  /** Resolved from Monday; null while looking up or when the caller is on no board. */
  patient: PatientRef | null;
}

export function useInboundCalls() {
  const [calls, setCalls] = useState<RingingCall[]>([]);
  const [prefs, setPrefs] = useState<RingPrefs | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const failures = useRef(0);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [authed, setAuthed] = useState(isAuthed);

  useEffect(() => onAuthChange(() => setAuthed(isAuthed())), []);

  const dismiss = useCallback((id: string) => {
    setCalls((cur) => cur.filter((c) => c.id !== id));
    const t = timers.current.get(id);
    if (t) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  /** Clear a finished call after a beat, without racing a second update. */
  const scheduleClear = useCallback(
    (id: string) => {
      if (timers.current.has(id)) return;
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), LINGER_MS),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    if (!inboundCallsConfigured() || !authed) return;
    let stopped = false;
    const timerMap = timers.current;

    const connect = () => {
      if (stopped) return;
      const es = new EventSource(streamUrl());
      esRef.current = es;

      es.addEventListener("open", () => {
        failures.current = 0;
        setConnected(true);
        setError(null);
      });

      es.addEventListener("ready", (e) => {
        try {
          const d = JSON.parse((e as MessageEvent).data) as { prefs: RingPrefs };
          setPrefs((p) => ({ ...(p ?? { allow: [] }), ...d.prefs }) as RingPrefs);
        } catch {
          /* a malformed hello is not worth dropping the stream over */
        }
      });

      es.addEventListener("prefs", (e) => {
        try {
          const d = JSON.parse((e as MessageEvent).data) as Partial<RingPrefs>;
          setPrefs((p) => ({ ...(p ?? ({ allow: [] } as unknown as RingPrefs)), ...d }));
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("call-ring", (e) => {
        let call: InboundCall;
        try {
          call = JSON.parse((e as MessageEvent).data) as InboundCall;
        } catch {
          return;
        }
        setCalls((cur) => (cur.some((c) => c.id === call.id) ? cur : [...cur, { ...call, patient: null }]));
        // Name the caller in the background — the card is already up.
        void findPatientByPhone(call.from)
          .then((p) => {
            if (!p) return;
            setCalls((cur) => cur.map((c) => (c.id === call.id ? { ...c, patient: p } : c)));
          })
          .catch(() => {});
      });

      es.addEventListener("call-update", (e) => {
        let call: InboundCall;
        try {
          call = JSON.parse((e as MessageEvent).data) as InboundCall;
        } catch {
          return;
        }
        setCalls((cur) => cur.map((c) => (c.id === call.id ? { ...c, ...call } : c)));
        if (call.state !== "ringing") scheduleClear(call.id);
      });

      es.addEventListener("error", () => {
        setConnected(false);
        es.close();
        esRef.current = null;
        failures.current += 1;
        if (failures.current >= MAX_CONSECUTIVE_FAILURES) {
          setError("Not receiving inbound calls — reload to try again.");
          return;
        }
        // Back off rather than hammering: 1s, 2s, 4s, 8s…
        setTimeout(connect, Math.min(1000 * 2 ** (failures.current - 1), 15_000));
      });
    };

    connect();
    return () => {
      stopped = true;
      esRef.current?.close();
      esRef.current = null;
      for (const t of timerMap.values()) clearTimeout(t);
      timerMap.clear();
    };
  }, [authed, scheduleClear]);

  /**
   * Take a call. Resolves to the number RingCentral is ringing, so the UI can
   * say where to pick up rather than leaving the rep staring at a dead card.
   */
  const claim = useCallback(async (id: string): Promise<string> => {
    const { ringingAt } = await claimCall(id);
    setCalls((cur) => cur.map((c) => (c.id === id ? { ...c, claimedBy: "you" } : c)));
    return ringingAt;
  }, []);

  return { calls, prefs, setPrefs, connected, error, claim, dismiss };
}
