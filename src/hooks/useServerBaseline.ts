/**
 * useServerBaseline — fetches the server-generated baseline snapshot.
 *
 * The GitHub Actions cron job writes public/data/baseline.json at 9 AM ET
 * each weekday.  This hook fetches that file and returns the snapshot.
 *
 * Falls back gracefully: if the file doesn't exist or is stale, the
 * consuming component should fall back to localStorage snapshots.
 */
import { useEffect, useState } from "react";
import type { RoleCounts } from "@/hooks/useRoleCounts";

export interface ServerBaseline {
  dateKey: string;        // YYYY-MM-DD Eastern
  counts: RoleCounts;
  takenAt: string;        // ISO timestamp
  source: "github-actions";
}

let cachedBaseline: ServerBaseline | null = null;
let fetchPromise: Promise<ServerBaseline | null> | null = null;

async function fetchBaseline(): Promise<ServerBaseline | null> {
  try {
    // Cache-bust with date to avoid stale CDN/browser cache
    const dateStr = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/New_York",
    });
    const res = await fetch(
      `${import.meta.env.BASE_URL}data/baseline.json?d=${dateStr}`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.dateKey || !data.counts) return null;
    return data as ServerBaseline;
  } catch {
    return null;
  }
}

export function useServerBaseline() {
  const [baseline, setBaseline] = useState<ServerBaseline | null>(
    cachedBaseline,
  );
  const [loading, setLoading] = useState(!cachedBaseline);

  useEffect(() => {
    if (cachedBaseline) {
      setBaseline(cachedBaseline);
      setLoading(false);
      return;
    }

    // Deduplicate concurrent requests
    if (!fetchPromise) {
      fetchPromise = fetchBaseline().then((b) => {
        cachedBaseline = b;
        fetchPromise = null;
        return b;
      });
    }

    fetchPromise.then((b) => {
      setBaseline(b);
      setLoading(false);
    });
  }, []);

  return { baseline, loading };
}
