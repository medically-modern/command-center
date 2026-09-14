/**
 * The browser softphone as a React hook. A thin, stable view over the
 * module-scope `softphone` store (lib/softphone/softphone.ts).
 *
 * ⚠️ The returned snapshot is the store's own object and only changes when the
 * phone's state does — safe in dependency arrays (INCIDENT_2026-08-20 rule 2).
 * The actions are the store's bound arrow functions, so their identity never
 * changes either.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { softphone } from "@/lib/softphone/softphone";
import type { PhoneSnapshot } from "@/lib/softphone/types";

export type { PhoneSnapshot };

export function useSoftphone() {
  useEffect(() => {
    softphone.start();
  }, []);
  const snap = useSyncExternalStore(softphone.subscribe, softphone.getSnapshot, softphone.getSnapshot);
  return {
    ...snap,
    answer: softphone.answer,
    ignore: softphone.ignore,
    dial: softphone.dial,
    hangup: softphone.hangup,
    toggleMute: softphone.toggleMute,
    setEnabled: softphone.setEnabled,
    setRingMuted: softphone.setRingMuted,
    takeOver: softphone.takeOver,
    dismissError: softphone.dismissError,
  };
}

/** Seconds since `connectedAt`, ticking once a second; 0 while null. Derived
 *  locally so the leader tab never has to broadcast a clock. */
export function useElapsedSeconds(connectedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!connectedAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [connectedAt]);
  if (!connectedAt) return 0;
  return Math.max(0, Math.floor((now - connectedAt) / 1000));
}
