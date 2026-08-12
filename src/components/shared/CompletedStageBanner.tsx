/**
 * "You are looking at a finished stage" — the banner a role page wears when it
 * was opened from a completion badge in System Management → Search.
 *
 * The page underneath is the ordinary role page showing an item that already
 * left this stage, so nothing on screen would otherwise say so: the panels look
 * exactly like live work. This says what it is, and when it was finished.
 *
 * Driven entirely by the URL (`?completedStage=<boardId>` alongside the usual
 * `?patientId=`), so a shared link opens the same historical view.
 *
 * The completion instant is fetched here rather than passed in a query param:
 * no board has a "completed on" column, so the answer lives in Monday's
 * activity log and has to be looked up. That lookup can come back empty when
 * the log has aged out — the banner then says the date is unavailable rather
 * than inventing one.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2 } from "lucide-react";
import { BOARDS, fetchStageCompletedAt } from "@/lib/systemMgmt/mondayApi";
import { formatStageCompletedAt } from "@/lib/systemMgmt/stageCompletion";

/**
 * The completed record this page was opened on, or null for ordinary work.
 * Role pages gate their advance buttons on this (`reviewMode`).
 *
 * Pass the currently selected patient: the URL params survive a click in the
 * sidebar, so without this check a rep who moves to a LIVE patient keeps the
 * banner and the disabled send button — the page would claim a stage was
 * finished when it isn't, and refuse to advance a patient who needs it.
 */
export function useCompletedStageReview(
  selectedPatientId?: string | null,
): { boardId: number; itemId: string } | null {
  const [searchParams] = useSearchParams();
  const boardId = Number(searchParams.get("completedStage"));
  const itemId = searchParams.get("patientId");
  if (!boardId || !itemId) return null;
  // undefined = caller has no selection concept; null/"" = nothing selected yet
  // (the deep-linked patient is still being fetched), so hold the review view.
  if (selectedPatientId && selectedPatientId !== itemId) return null;
  return { boardId, itemId };
}

export function CompletedStageBanner({ patientId }: { patientId?: string | null }) {
  const review = useCompletedStageReview(patientId);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const boardId = review?.boardId ?? 0;
  const itemId = review?.itemId ?? "";

  useEffect(() => {
    if (!boardId || !itemId) return;
    let cancelled = false;
    setLoading(true);
    setCompletedAt(null);
    fetchStageCompletedAt(boardId, itemId)
      .then((at) => { if (!cancelled) setCompletedAt(at); })
      .catch(() => { /* leave it unknown — the banner says so */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [boardId, itemId]);

  if (!review) return null;

  const boardName = BOARDS.find((b) => b.boardId === review.boardId)?.boardName ?? "this stage";

  return (
    <div className="rounded-xl border-2 border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 flex items-start gap-3">
      <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200">
          {boardName} is complete{" "}
          {loading ? (
            <span className="inline-flex items-center gap-1 font-normal text-emerald-700 dark:text-emerald-300">
              <Loader2 className="h-3 w-3 animate-spin" /> checking when…
            </span>
          ) : completedAt ? (
            <span className="font-normal text-emerald-700 dark:text-emerald-300">
              — marked complete {formatStageCompletedAt(completedAt)} ET
            </span>
          ) : (
            <span className="font-normal text-emerald-700 dark:text-emerald-300">
              — completion date unavailable (older than Monday&rsquo;s activity history)
            </span>
          )}
        </p>
        <p className="text-xs text-emerald-800/90 dark:text-emerald-300/90 mt-0.5">
          Everything below is the data the rep filled out at this stage. This is a
          historical record — the patient has already moved on, so advancing them
          from here is turned off.
        </p>
      </div>
    </div>
  );
}
