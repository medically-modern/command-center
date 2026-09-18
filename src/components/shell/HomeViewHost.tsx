/**
 * The home route (§5.39c) — Brandon's per-person custom view, plus the
 * "Viewing: <person>" dropdown that answers Josh's "I want to test how it looks
 * for a processor … maybe we make a fake login?" (2026-09-18). It is not a fake
 * login and does not need to be: `ProcessorView` is driven entirely by the
 * profile it is handed, so rendering it with somebody else's profile IS their
 * home screen — their bars, their SOP order, their per-role escalation filters.
 *
 * ⚠️⚠️ **THE BORROW MUST RENDER `ProcessorView` DIRECTLY — NEVER `<Index />`.**
 * This is the wiring that was wrong when the dropdown first shipped. `Index`
 * reads `useAccessContext()` itself and only takes its processor branch when the
 * SIGNED-IN person is a processor, so a manager picking somebody in the dropdown
 * got their own manager dashboard back: the URL changed, the banner appeared,
 * and the screen did not. And `bars` is the only view anybody in the config has
 * today, so that was the borrow doing nothing, every time, for everyone.
 *
 * ⚠️⚠️ **WITH ONE VIEW AND NO `viewOthers` THIS IS `<Index />` AND NOTHING ELSE.**
 * `viewOthers` is opt-in (§5.39c), so the dropdown exists for the two people who
 * have been granted it and for nobody else; every other config reads `["bars"]`
 * and the switch renders null. That is what makes a home-page rewrite additive —
 * the same reasoning as the layout toggle (§5.39b), one level down.
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
import ProcessorView from "@/pages/ProcessorView";
import { useAccessContext } from "@/components/AccessProvider";
import { HomeViewSwitch } from "./HomeViewSwitch";
import { hasAbility, homeViewsOf } from "@/lib/shell/abilities";
import { processorPeople } from "@/lib/people";
import type { HomeView, ProcessorProfile } from "@/lib/accessStore";

/** ⚠️ Lazy, so a person on the bars never downloads the Care Coordinator or
 *  Oversight bundles — those are two of the heaviest pages in the build. */
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

  const canViewOthers = hasAbility(email, config, "viewOthers");
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
   * ⚠️ A `?viewing=` naming somebody who is no longer in the config is SAID, not
   * swallowed. Falling back to my own screen while the URL still names them is
   * the quiet lie this whole component exists to avoid — you would be looking at
   * yourself believing you were looking at them.
   */
  const missingViewing = viewingKey && !borrowed ? viewingKey : null;

  /** Whose views the toggle is offering: theirs while borrowing, else mine. */
  const ownerEmail = borrowed ? borrowed.email : email;
  const views = useMemo(() => homeViewsOf(ownerEmail, config), [ownerEmail, config]);

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

  if (active === "bars") {
    return (
      <>
        {switcher}
        {/* ⚠️ The borrow is the whole point of the dropdown — see the header.
            `ProcessorView` takes the profile it is given and reads no identity
            of its own, so this is that person's home screen exactly. */}
        {borrowed ? <ProcessorView profile={borrowed.profile} email={borrowed.email} /> : <Index />}
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
