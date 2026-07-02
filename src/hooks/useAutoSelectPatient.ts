import { useEffect, useRef } from "react";

interface HasId {
  id: string;
}

/**
 * Pins a role page's selected patient to the sidebar's visible list.
 *
 * Rules:
 * - While `initialLoading` is true (this role's first Monday fetch hasn't
 *   landed) nothing is selected — the localStorage-cached list must never
 *   drive selection, since it can hold patients who have since advanced off
 *   the board.
 * - Once loaded, if nothing valid is selected, select the FIRST patient of
 *   `visiblePatients` — the exact ordered list the sidebar renders
 *   (top-to-bottom), so the page always opens on the first patient the rep
 *   can actually see.
 * - An existing selection is kept as long as the patient is anywhere in
 *   `allPatients` (escalated / future-dated patients stay selected even when
 *   the sidebar's default filter hides them).
 * - A deep-linked selection (`pinnedId`, from ?patientId=) is NEVER moved:
 *   if its injection fetch fails one poll, the selection holds and self-heals
 *   when a later poll re-injects it, instead of silently opening a different
 *   patient.
 * - When a selected patient goes missing, selection only moves on after the
 *   patient is absent from two consecutive NON-EMPTY lists. A single missed
 *   poll (partial/malformed response coerced to [], an item mid-automation)
 *   holds and self-heals rather than yanking the rep to another patient
 *   mid-work. Once confirmed gone, selection falls back to the first visible
 *   patient — or clears when nothing is visible.
 */
export function useAutoSelectPatient(
  initialLoading: boolean,
  allPatients: readonly HasId[],
  visiblePatients: readonly HasId[],
  selectedId: string | null,
  setSelectedId: (id: string | null) => void,
  pinnedId?: string | null,
): void {
  // Tracks a selected-but-missing patient across list refreshes.
  const missedRef = useRef<{ id: string; count: number } | null>(null);

  useEffect(() => {
    if (initialLoading) return;
    if (selectedId) {
      if (allPatients.some((p) => p.id === selectedId)) {
        missedRef.current = null;
        return;
      }
      if (selectedId === pinnedId) return; // deep link: hold; injection retries each poll
      if (allPatients.length === 0) return; // empty/failed fetch: hold and self-heal
      const missed = missedRef.current;
      if (!missed || missed.id !== selectedId) {
        missedRef.current = { id: selectedId, count: 1 };
        return; // first miss — wait for the next list before moving on
      }
    }
    missedRef.current = null;
    const first = visiblePatients.length > 0 ? visiblePatients[0].id : null;
    if (first !== selectedId) setSelectedId(first);
  }, [initialLoading, allPatients, visiblePatients, selectedId, setSelectedId, pinnedId]);
}
