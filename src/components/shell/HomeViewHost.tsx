/**
 * The home route (§5.39c, rewritten §5.39g) — Brandon's per-person custom view,
 * plus the "Viewing: <person>" dropdown.
 *
 * ⚠️⚠️ **THE HOME IS THE SIGNED-IN PERSON'S OWN VIEW, MANAGER OR NOT** (Josh,
 * 2026-09-19: *"the home screen should be the assigned view / bars for that
 * person, ie for me josh logging in it should show my view by default"*). It
 * used to branch on `access.type`, so a manager — including one carrying a full
 * processor profile — got the team roster and never their own queues.
 * `homeProfileFor` is that rule; the roster's job is the dropdown below.
 *
 * ⚠️⚠️ **A BORROW SWAPS THE WHOLE UI, NOT JUST THIS PANE** (Josh, same message:
 * *"the whole ui should be EXACTLY what they see"* · *"if mashekes view has
 * patient communication assigned and i view her view it should appear"*). So the
 * borrowed email goes into `lib/shell/viewAs`, which the global header reads for
 * its tabs and menus. Read that file before changing this: the borrow is a
 * DISPLAY preview, it never reaches a write, and it never borrows who answers
 * the phone.
 *
 * ⚠️ **`ProcessorView` is rendered DIRECTLY — never `<Index />`.** `Index` reads
 * `useAccessContext()` itself and only takes its processor branch when the
 * SIGNED-IN person is a processor, so a manager picking somebody in the dropdown
 * got their own dashboard back: the URL changed, the banner appeared, and the
 * screen did not.
 *
 * ⚠️ **The two non-bars views are the EXISTING pages.** `coordinator` renders
 * the live Care Coordinator dashboard (§5.30), `oversight` the live Oversight
 * tab (§7) — real rules, real counting contracts, real data. Brandon's mockup
 * redraws both from sample data and calls its coordinator screen "a rebuild, not
 * a port"; rebuilding either here would be a second copy of rules whose drift is
 * silent (§5.30's keep-in-agreement list is twelve places on its own).
 *
 * ⚠️ **It sits at the ROUTE, not inside `Index`**, which returns early for
 * processors and carries helper components after its own closing brace.
 */
import { Suspense, lazy, useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import Index from "@/pages/Index";
import ProcessorView from "@/pages/ProcessorView";
import { useAccessContext } from "@/components/AccessProvider";
import { HomeViewSwitch } from "./HomeViewSwitch";
import { hasAbility, homeViewsOf } from "@/lib/shell/abilities";
import { homeProfileFor, isSyntheticHomeProfile } from "@/lib/shell/homeProfile";
import { setViewAs } from "@/lib/shell/viewAs";
import { useShellLayout } from "@/hooks/shell/useShellLayout";
import { processorPeople } from "@/lib/people";
import type { HomeView, ProcessorProfile } from "@/lib/accessStore";

/** ⚠️ Lazy, so a person on the bars never downloads the Care Coordinator or
 *  Oversight bundles — two of the heaviest pages in the build. */
const CareCoordinatorPage = lazy(() => import("@/pages/CareCoordinatorPage"));
const OversightTab = lazy(() => import("@/components/oversight/OversightTab"));

/** Query key for the chosen view, so a home tab survives a reload and a Back. */
const VIEW = "home";
/** Query key for whose view is being borrowed. */
const VIEWING = "viewing";

const norm = (e: string) => (e || "").trim().toLowerCase();

export function HomeViewHost() {
  const [params, setParams] = useSearchParams();
  const { email, config } = useAccessContext();
  const [layout] = useShellLayout();

  /**
   * ⚠️⚠️ **THE WHOLE MODEL IS PART OF THE REDESIGN, SO IT IS OFF IN "AS TODAY".**
   * This host sits OUTSIDE `AppShell`, so without this gate the "Viewing" strip
   * rendered above the old manager dashboard with no header over it — a bare
   * white bar floating on a screen that is meant to be byte-identical to the app
   * before any of this existed (Josh, 2026-09-18, with a screenshot of exactly
   * that). "As today" has to mean today, or the escape hatch is not one (§5.39b).
   */
  const redesign = layout === "redesign";

  const canViewOthers = redesign && hasAbility(email, config, "viewOthers");
  const viewingKey = canViewOthers ? params.get(VIEWING) || "" : "";

  const people = useMemo(
    () => (canViewOthers ? processorPeople(config).map((p) => ({ key: p.key, name: p.name })) : []),
    [canViewOthers, config],
  );

  /**
   * The person whose screen is on show, or null for "mine".
   *
   * ⚠️ Matched on the email LOCAL PART, because that is the `key` the dropdown
   * and `processorPeople` use and therefore what lands in the URL; a full email
   * is accepted too so a hand-typed link works.
   */
  const borrowed = useMemo((): { email: string; name: string; profile: ProcessorProfile } | null => {
    if (!viewingKey) return null;
    const want = norm(viewingKey);
    const key = Object.keys(config.processors || {}).find(
      (k) => norm(k) === want || norm(k).split("@")[0] === want.split("@")[0],
    );
    const profile = key ? config.processors[key] : null;
    if (!key || !profile) return null;
    return { email: key, name: (profile.name || "").trim() || key.split("@")[0], profile };
  }, [viewingKey, config]);

  /**
   * ⚠️⚠️ **THE HEADER READS THIS, WHICH IS WHAT MAKES THE BORROW THE WHOLE UI.**
   * Pushed to a module store rather than passed down, because `GlobalHeader`
   * lives in `AppShell` — above this route, not below it — so there is no prop
   * path between them. See `lib/shell/viewAs`.
   *
   * ⚠️ Cleared when the borrow ends, when `viewOthers` is revoked, and when this
   * component unmounts on sign-out; NOT on an ordinary navigation, or clicking
   * through to Communications would silently drop you back into your own screen
   * half way through looking at somebody else's.
   */
  useEffect(() => {
    setViewAs(borrowed ? borrowed.email : "");
  }, [borrowed]);

  /**
   * ⚠️ A `?viewing=` naming somebody who is no longer in the config is SAID, not
   * swallowed. Falling back to my own screen while the URL still names them is
   * the quiet lie this whole component exists to avoid — you would be looking at
   * yourself believing you were looking at them.
   */
  const missingViewing = viewingKey && !borrowed ? viewingKey : null;

  /** Whose views the toggle is offering: theirs while borrowing, else mine. */
  const ownerEmail = borrowed ? borrowed.email : email;
  // ⚠️ `["bars"]` in "as today" — one view, so `HomeViewSwitch` renders null and
  // the branch below is `<Index />` and nothing else. Gating only the PICKER
  // would still put a toggle bar over the old layout for anybody holding a
  // second view.
  const views = useMemo(
    () => (redesign ? homeViewsOf(ownerEmail, config) : (["bars"] as HomeView[])),
    [redesign, ownerEmail, config],
  );

  const raw = params.get(VIEW) as HomeView | null;
  // An unrecognised or no-longer-granted view falls back to the first one this
  // person actually has, never to a blank screen.
  const active: HomeView = raw && views.includes(raw) ? raw : views[0];

  /** The bars to draw: the borrowed person's, else my own (§5.39g). */
  const ownProfile = useMemo(() => homeProfileFor(email, config), [email, config]);
  const barsProfile = borrowed ? borrowed.profile : ownProfile;
  const barsEmail = borrowed ? borrowed.email : email;
  const allRoles = !borrowed && isSyntheticHomeProfile(email, config);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Changing WHOSE view invalidates which view, since they may not have it.
    if (key === VIEWING) next.delete(VIEW);
    setParams(next, { replace: true });
  };

  /**
   * ⚠️ The RESOLVED key, not the raw URL value: the options are keyed by email
   * local part, so a hand-typed `?viewing=masheke@medicallymodern.com` would
   * match no option and the dropdown would read "My view" while that person's
   * screen was on show.
   */
  const selectedKey = borrowed ? borrowed.email.split("@")[0] : "";

  const switcher = (
    <HomeViewSwitch
      views={views}
      active={active}
      onView={(v) => setParam(VIEW, v)}
      people={people}
      viewingKey={selectedKey}
      onViewing={(k) => setParam(VIEWING, k)}
      borrowedName={borrowed?.name ?? null}
      missingViewing={missingViewing}
      onClearViewing={() => setParam(VIEWING, "")}
    />
  );

  // ── "As today": the old dashboard, untouched. ──────────────────────────
  if (!redesign) return <Index />;

  // ⚠️ `.cc-home` is the strip + the view as ONE column: the switcher above a
  // page that claims `min-h-screen` would be 45px taller than the viewport and
  // put a scrollbar on every home screen. `shell.css` owns the two rules, and
  // they are scoped to `.cc-shell` so "as today" never sees them.
  if (active === "bars") {
    return (
      <div className="cc-home">
        {switcher}
        {/* ⚠️ `homeProfileFor` never returns null for anybody who can sign in
            (a manager with no processor entry gets every bar), so the fallback
            below is for a config that has genuinely never heard of this person
            — AuthGate stops those long before here. */}
        {barsProfile ? (
          <ProcessorView
            profile={barsProfile}
            email={barsEmail}
            allRoles={allRoles}
            mine={!borrowed}
            // Brandon's Stages look (§5.52) — the redesign's home only, which
            // this branch always is (`Index` renders this page for "as today").
            stages
          />
        ) : (
          <div className="p-8 text-sm text-muted-foreground">
            You aren't set up with any queues yet — ask a manager to add some on Users.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="cc-home">
      {switcher}
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
        {active === "coordinator" ? <CareCoordinatorPage /> : <OversightTab />}
      </Suspense>
    </div>
  );
}
