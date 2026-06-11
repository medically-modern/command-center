/**
 * Hook that returns the correct back-navigation behavior for role pages.
 *
 * Strategy: HISTORY FIRST. If the user arrived here from another screen in
 * this app (react-router tracks an `idx` in history.state; idx > 0 means
 * there's an in-app entry behind us), `goBack()` does a real `navigate(-1)`,
 * landing on exactly the screen they came from — Janelle's manager view,
 * Masheke's processor view, the System Management Operations tab, etc.
 * Index.tsx mirrors its view state (tab / sub / user) into the URL, so the
 * restored screen is fully reconstructed.
 *
 * Fallback (deep link, bookmark, new tab — no in-app history):
 *   - ?from=system-mgmt → /system-mgmt
 *   - ?manager=1        → /?tab=roles&sub=dashboards  (manager dashboards)
 *   - otherwise         → /?tab=dashboard             (processors)
 */
import { useSearchParams, useNavigate } from "react-router-dom";
import { useCallback } from "react";

/** True if there is an in-app history entry behind the current one. */
function hasInAppHistory(): boolean {
  const state = window.history.state as { idx?: number } | null;
  return typeof state?.idx === "number" && state.idx > 0;
}

export function useBackNavigation() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const from = searchParams.get("from");
  const isManager = searchParams.get("manager") === "1";

  const backTarget =
    from === "system-mgmt"
      ? "/system-mgmt"
      : isManager
        ? "/?tab=roles&sub=dashboards"
        : "/?tab=dashboard";

  const goBack = useCallback(() => {
    if (hasInAppHistory()) {
      navigate(-1);
    } else {
      navigate(backTarget);
    }
  }, [navigate, backTarget]);

  return { backTarget, goBack };
}
