/**
 * The redesign's shell (§5.39) — Brandon's global header above every page.
 *
 * ⚠️⚠️ **WITH THE TOGGLE OFF THIS RENDERS ITS CHILDREN AND NOTHING ELSE.** No
 * wrapper element, no class, no stylesheet reach — every rule in `shell.css` is
 * scoped under `.cc-shell`, which does not exist in that branch. That is what
 * lets a whole-app navigation change ship ON by default (Josh, 2026-09-18):
 * a page that misbehaves under the header, or a rep who wants their old screen
 * back, is one click from exactly the app they had. Keep the `current` branch a
 * bare fragment — the moment it renders a div, "as today" stops being true.
 *
 * ⚠️ It must sit INSIDE the router: the header's tabs, the global search and
 * the active-tab rule all read the current location.
 */
import type { ReactNode } from "react";
import { GlobalHeader } from "./GlobalHeader";
import { ViewAsBanner } from "./ViewAsBanner";
import { useShellLayout } from "@/hooks/shell/useShellLayout";
import { useAccessContext } from "@/components/AccessProvider";
import { hasAbility } from "@/lib/shell/abilities";
import { useViewAs } from "@/lib/shell/viewAs";
import "@/pages/shell.css";

export function AppShell({ children }: { children: ReactNode }) {
  const [layout] = useShellLayout();
  const { email, config } = useAccessContext();
  const borrowing = useViewAs();
  /** ⚠️ Same guard the header uses: a revoked `viewOthers` ends the borrow
   *  rather than leaving somebody stuck inside another person's screen. */
  const borrowedName =
    borrowing && hasAbility(email, config, "viewOthers")
      ? config.processors?.[borrowing]?.name || borrowing.split("@")[0]
      : "";

  if (layout !== "redesign") return <>{children}</>;

  // ⚠️ `has-viewas` raises `--cc-head` by the banner's own height, so the fit
  // overrides in `shell.css` keep subtracting the REAL chrome — without it
  // every page would be 36px too tall for exactly as long as a borrow is on,
  // which is the second-scrollbar failure §7 records, on a timer.
  return (
    <div className={`cc-shell${borrowedName ? " has-viewas" : ""}`}>
      <GlobalHeader />
      <ViewAsBanner name={borrowedName} />
      {/* ⚠️ The scroll container is HERE, not on the page. Existing pages size
          themselves against the viewport, and `shell.css` shortens them by the
          header's height so they still fit — §7 records what a page that does
          not fit looks like: a second scrollbar and a composer below the fold,
          reproducible only with a real, long list. */}
      <div className="cc-main">{children}</div>
    </div>
  );
}
