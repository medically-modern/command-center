/**
 * The home route (§5.39c) — Brandon's per-person custom view.
 *
 * ⚠️⚠️ **WITH ONE VIEW THIS IS `<Index />` AND NOTHING ELSE.** Every access.json
 * today has no `homeView`, which `homeViewsOf` reads as `["bars"]`, so on the
 * deploy that ships this the home page is byte-identical for everybody and the
 * switch renders nothing. A second view appears only for the person an admin
 * gives one to. That is what makes a home-page rewrite additive — the same
 * reasoning as the layout toggle (§5.39b), one level down.
 *
 * ⚠️ **It sits at the ROUTE, not inside `Index`.** `Index.tsx` returns early for
 * processors and carries helper components after its own closing brace, so
 * wrapping its two branches in place means two edits to a file this has no
 * business changing. Here it is one element in `App.tsx` and `Index` is
 * untouched.
 *
 * ⚠️ **The other two views are the EXISTING pages.** `coordinator` renders the
 * live Care Coordinator dashboard (§5.30), `oversight` the live Oversight tab
 * (§7) — both with their real rules, their real counting contracts and their
 * real data. Brandon's mockup redraws them from sample data and calls its
 * coordinator screen "a rebuild, not a port"; rebuilding either here would be a
 * second copy of rules whose drift is silent (§5.30's keep-in-agreement list is
 * twelve places long on its own).
 */
import { Suspense, lazy, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import Index from "@/pages/Index";
import { useAccessContext } from "@/components/AccessProvider";
import { HomeViewSwitch } from "./HomeViewSwitch";
import { hasAbility, homeViewsOf } from "@/lib/shell/abilities";
import { processorPeople } from "@/lib/people";
import type { HomeView } from "@/lib/accessStore";

/** ⚠️ Lazy, so a person on the bars never downloads the Care Coordinator or
 *  Oversight bundles — those are two of the heaviest pages in the build. */
const CareCoordinatorPage = lazy(() => import("@/pages/CareCoordinatorPage"));
const OversightTab = lazy(() => import("@/components/oversight/OversightTab"));

/** Query key for the chosen view, so a home tab survives a reload and a Back. */
const VIEW = "home";
/** Query key for whose view is being borrowed. */
const VIEWING = "viewing";

export function HomeViewHost() {
  const [params, setParams] = useSearchParams();
  const { email, config } = useAccessContext();

  const canViewOthers = hasAbility(email, config, "viewOthers");
  const viewingKey = canViewOthers ? params.get(VIEWING) || "" : "";

  const people = useMemo(
    () => (canViewOthers ? processorPeople(config).map((p) => ({ key: p.key, name: p.name })) : []),
    [canViewOthers, config],
  );

  /** Whose views are on screen: mine, or the person picked in the dropdown. */
  const owner = useMemo(() => {
    if (!viewingKey) return { email, name: "" };
    const key = Object.keys(config.processors || {}).find(
      (k) => k.split("@")[0] === viewingKey || k === viewingKey,
    );
    const name = key ? config.processors[key]?.name || key : "";
    return { email: key || email, name };
  }, [viewingKey, config, email]);

  const views = useMemo(() => homeViewsOf(owner.email, config), [owner.email, config]);

  const raw = params.get(VIEW) as HomeView | null;
  // An unrecognised or no-longer-granted view falls back to the first one this
  // person actually has, never to a blank screen.
  const active: HomeView = raw && views.includes(raw) ? raw : views[0];

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    // Changing WHOSE view invalidates which view, since they may not have it.
    if (key === VIEWING) next.delete(VIEW);
    setParams(next, { replace: true });
  };

  const switcher = (
    <HomeViewSwitch
      views={views}
      active={active}
      onView={(v) => setParam(VIEW, v)}
      people={people}
      viewingKey={viewingKey}
      onViewing={(k) => setParam(VIEWING, k)}
      borrowedName={viewingKey ? owner.name || null : null}
    />
  );

  // The ordinary case, and the one every config produces today: one view, no
  // borrowing. `switcher` renders null, so this is `<Index />` exactly.
  if (active === "bars") {
    return (
      <>
        {switcher}
        <Index />
      </>
    );
  }

  return (
    <>
      {switcher}
      <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading…</div>}>
        {active === "coordinator" ? <CareCoordinatorPage /> : <OversightTab />}
      </Suspense>
    </>
  );
}
