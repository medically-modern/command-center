/**
 * One line in a role header: "what you're looking at may be out of date".
 *
 * Every queue hook already catches a failed Monday read into an `error` string
 * and clears it on the next successful poll — but most pages render that string
 * only in the sidebar or in `EmptyPatientPane`, i.e. only when the list is
 * EMPTY. The common case is therefore silent: a rep is working a patient, a
 * background poll fails, and the screen keeps showing what it had. On
 * 2026-09-01 Monday 500'd eight reads and 503'd two more and nobody using the
 * app saw a thing (Josh: "put a small line of text in the header telling them
 * to reload the page").
 *
 * ⚠️ It renders NOTHING when `error` is null, which is almost always. The hooks
 * poll every 15-30s and clear the error on the next success, so this appears
 * during a wobble and disappears on its own — no dismiss button, because a
 * notice you can dismiss while the data is still stale is worse than none.
 *
 * ⚠️ `scope` is required and has no default. Only the caller knows WHICH fetch
 * failed, and naming the wrong part of the screen is worse than naming none —
 * on the intake page the queue list and the open patient's detail are separate
 * requests that fail independently (§5.25).
 *
 * ⚠️ `skin="page"` is REQUIRED inside `.pf-root`, for the §9 reason: that page
 * resets `.pf-root button` with a one-class-plus-type selector that out-weighs
 * every single-class Tailwind utility, so a default-skinned Retry renders as
 * bare text. `.pf-root .btn` is two classes and wins.
 */
import { AlertTriangle } from "lucide-react";
import { describeReadFailure, staleNoticeText } from "@/lib/shared/mondayError";

export function StaleDataNotice({
  error,
  scope,
  onRetry,
  retrying = false,
  skin = "header",
  className = "",
}: {
  /** The hook's `error` — null whenever the last read succeeded. */
  error: string | null | undefined;
  /** Which part of the screen is stale, e.g. "The patient list". */
  scope: string;
  onRetry?: () => void;
  retrying?: boolean;
  skin?: "header" | "page";
  className?: string;
}) {
  if (!error) return null;
  const failure = describeReadFailure(error ? new Error(error) : null);
  const text = staleNoticeText(scope, failure);

  return (
    <div
      role="status"
      className={`flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-900 dark:text-amber-200 ${className}`}
    >
      <AlertTriangle className="h-3.5 w-3.5 flex-none" aria-hidden />
      <span className="min-w-0">{text}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className={
            skin === "page"
              ? "btn secondary ml-auto flex-none"
              : "ml-auto flex-none rounded border border-amber-500/50 bg-transparent px-2 py-0.5 font-medium hover:bg-amber-500/20 disabled:opacity-60"
          }
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      )}
    </div>
  );
}
