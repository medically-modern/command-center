/**
 * The Medical Necessity Docs files on a Subscription item — the list Brandon's
 * MN & Auth card draws with View and Download (pixel-match, 2026-09-24).
 *
 * ⚠️ **READ-ONLY, and the same reader `/subscription`'s own `MnDocsPanel`
 * uses** (`fetchItemFileColumns`), so the two screens list the same files. It
 * reads the column's `value` for the asset ids and the item's `assets` for the
 * links — the asset's `public_url` is the signed link a browser can open; the
 * column's own text is a `protected_static` link that only works signed in to
 * Monday (§5.30f).
 *
 * ⚠️ **On open, never on a timer** (INCIDENT_2026-08-20's rule): one request
 * when the Profile tab mounts, and again only when the caller asks — after a
 * Save that uploaded something. A failed read says so; it is never "no files".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { COL, fetchItemFileColumns, type MondayFileEntry } from "@/lib/subscription/mondayApi";

export function useMnDocFiles(itemId: string): {
  files: MondayFileEntry[] | null;
  loading: boolean;
  error: string;
  reload: () => Promise<void>;
} {
  const [files, setFiles] = useState<MondayFileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // A slow answer for a patient the rep has already left is dropped.
  const want = useRef(itemId);

  const load = useCallback(async () => {
    want.current = itemId;
    if (!itemId) {
      setFiles(null);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const cols = await fetchItemFileColumns(itemId, [COL.mnDocs]);
      if (want.current === itemId) setFiles(cols[COL.mnDocs] ?? []);
    } catch (e) {
      if (want.current === itemId) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (want.current === itemId) setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    setFiles(null);
    void load();
  }, [load]);

  return { files, loading, error, reload: load };
}
