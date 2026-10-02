/**
 * Loads the Onboarding Oversight snapshot: paint from cache, then items-only (cold), then full history.
 * Refreshes every refreshMs while the tab is visible, immediately on return if stale, and on demand.
 * Fixture mode (VITE_OO_FIXTURE=1) uses the synthetic demo snapshot with no network (BUILD-SPEC §5.7).
 */
import type { Dict } from "@/lib/onboardingOversight/types";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccessView } from "@/lib/onboardingOversight/types";
import type { FullSnapshot } from "@/lib/onboardingOversight/model/buildSnapshot";
import { OO_CONFIG } from "@/lib/onboardingOversight/config";
import { bumpGeneration, readCache, refreshSnapshot, resetCache, snapshotFromCache, type LoadProgress } from "@/lib/onboardingOversight/data/loadSnapshot";
import { onComplexityPause } from "@/lib/onboardingOversight/data/gql";

export type LoadStatus = "cold" | "warm" | "refreshing" | "ready" | "error";
const FIXTURE = (import.meta.env.VITE_OO_FIXTURE as string | undefined) === "1";
/** CR-9 snapshot mode: the scout's real-data export, served by the dev server only. */
const SNAPSHOT = (import.meta.env.VITE_OO_SNAPSHOT as string | undefined) === "1";

export function useOnboardingOversight(access: AccessView | null, periodDays: number) {
  const [snapshot, setSnapshot] = useState<FullSnapshot | null>(null);
  const [status, setStatus] = useState<LoadStatus>("cold");
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [itemsOnly, setItemsOnly] = useState(false);
  const busy = useRef(false);
  const accessRef = useRef(access); accessRef.current = access;
  const lastAt = useRef(0);

  const refresh = useCallback(async () => {
    if (busy.current) return; busy.current = true;
    try {
      if (SNAPSHOT) {
        const { loadRealSnapshot } = await import("@/lib/onboardingOversight/data/snapshotMode");
        const s = await loadRealSnapshot(); setSnapshot(s); setStatus("ready"); setError(s.fetchErrors.length ? s.fetchErrors.map((e) => `${e.board}: ${e.message}`).join("; ") : null); return;
      }
      if (FIXTURE) {
        const { demoSnapshot } = await import("@/lib/onboardingOversight/__fixtures__/demoSnapshot");
        setSnapshot(demoSnapshot(Date.now())); setStatus("ready"); return;
      }
      setStatus((s) => (s === "cold" ? "cold" : "refreshing"));
      const s = await refreshSnapshot({ access: accessRef.current, periodDays,
        onProgress: (p: LoadProgress) => setProgress(p.message),
        onPartial: (partial) => { setSnapshot(partial); setItemsOnly(true); } });
      setSnapshot(s); lastAt.current = s.snapshotAt; setItemsOnly(false); setStatus("ready"); setError(s.fetchErrors.length ? s.fetchErrors.map((e) => `${e.board}: ${e.message}`).join("; ") : null);
    } catch (e: unknown) {
      setError(String((e as Error)?.message ?? e)); setStatus("error");
    } finally { busy.current = false; }
  }, [periodDays]);

  useEffect(() => {
    let alive = true;
    onComplexityPause((m) => setProgress(m ?? ""));
    (async () => {
      if (!FIXTURE && !SNAPSHOT) {
        const c = await readCache();
        if (alive && c) { setSnapshot(snapshotFromCache(c, accessRef.current)); setStatus("warm"); }
      }
      if (alive) await refresh();
    })();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, OO_CONFIG.refreshMs);
    const onVis = () => { if (document.visibilityState === "visible" && snapshotAgeMs() > OO_CONFIG.refreshMs) void refresh(); };
    const snapshotAgeMs = () => Date.now() - lastAt.current;
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVis); onComplexityPause(null); };
  }, [refresh]);

  // Reset: bump the generation so an in-flight refresh cannot write its old blob back, then refresh once it is free.
  const reset = useCallback(async () => {
    bumpGeneration(); await resetCache(); setSnapshot(null); setStatus("cold");
    for (let i = 0; i < 600 && busy.current; i++) await new Promise((r) => setTimeout(r, 500));
    await refresh();
  }, [refresh]);
  return { snapshot, status, progress, error, itemsOnly, refresh, reset, fixture: FIXTURE, exportMode: SNAPSHOT };
}
