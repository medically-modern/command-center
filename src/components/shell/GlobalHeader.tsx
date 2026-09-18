/**
 * The redesign's global header (§5.39), ported from Brandon's 2026-09-18
 * mockup: brand · four section TABS · global patient search · Users · settings.
 *
 * ⚠️ **The tabs are PRIMARY NAVIGATION, and every one of them points at a page
 * that already exists.** That is the "route our current function into his new
 * look" instruction taken literally — no tab opens something new:
 *
 *   My Dashboard       → `/`                        (today's home)
 *   Communications     → `/assigned-patients`       (the RingCentral hub)
 *   Inventory          → `/orders?view=stock`       (the Cardinal SKU tracker)
 *
 * ⚠️⚠️ **REPORTS & METRICS IS COMMENTED OUT, AND IT NEEDS A DECISION.** It
 * pointed at `/system-mgmt?tab=operations` (Josh's own pick, 2026-09-18,
 * because Brandon's Patient Pipeline Tracker does not exist in this build and
 * its numbers are specified nowhere) — and later the same day Josh asked for
 * Operations to be commented out. The two instructions collide: a tab whose
 * only real destination has been switched off is a dead link, and a dead link
 * in primary navigation is worse than a missing tab. So it is commented rather
 * than repointed at something invented. Three ways back, in preference order:
 * uncomment the Operations tab in `SystemMgmtPage` and restore this; point it
 * at `/oversight` (real, but that is not "reports"); or build the tracker.
 *
 * ⚠️ **Nothing here is gated on an ability yet.** The abilities model
 * (`admins[]`, `perms`) is a later phase, and §5.39 records the rule for when
 * it lands: default every ability ON, or the first deploy reads an access.json
 * with no `perms` and everybody fails closed — the same reasoning as
 * `isBootstrapMode` (§5.3).
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Activity, ArrowRightLeft, BarChart3, ChevronDown, Grid3x3, KeyRound, ListChecks, LogOut, MessageSquare, Package, Settings, Sliders, Stethoscope, Users } from "lucide-react";
import { getUser, signOut } from "@/lib/shared/auth";
import { GlobalSearch } from "./GlobalSearch";
import CallConnectionBadge from "@/components/inboundCalls/CallConnectionBadge";
import { useShellLayout } from "@/hooks/shell/useShellLayout";
import { useAccessContext } from "@/components/AccessProvider";
import { hasAbility, isAdmin } from "@/lib/shell/abilities";
import type { Ability } from "@/lib/accessStore";

interface Tab {
  key: string;
  label: string;
  to: string;
  icon: typeof Grid3x3;
  /** Which pathnames light this tab up. */
  match: (path: string, search: string) => boolean;
  /**
   * The ability that shows this tab, as Brandon's header has it. ⚠️ Absent
   * means "always" — and an ability nobody has turned off is ON (§5.39c), so
   * every tab renders for everybody until an admin says otherwise.
   */
  ability?: Ability;
}

const TABS: Tab[] = [
  {
    key: "home",
    label: "My Dashboard",
    to: "/",
    icon: Grid3x3,
    match: (p) => p === "/",
  },
  {
    key: "comms",
    label: "Communications",
    to: "/assigned-patients",
    icon: MessageSquare,
    match: (p, s) => p === "/assigned-patients" || (p === "/system-mgmt" && s.includes("tab=communications")),
  },
  {
    key: "inventory",
    label: "Inventory",
    to: "/orders?view=stock",
    icon: Package,
    match: (p, s) => p === "/orders" && s.includes("view=stock"),
    ability: "inventory",
  },
  // ── Reports & Metrics — commented out 2026-09-18, see the header ──
  // {
  //   key: "reports",
  //   label: "Reports & Metrics",
  //   to: "/system-mgmt?tab=operations",
  //   icon: BarChart3,
  //   match: (p, s) => p === "/system-mgmt" && s.includes("tab=operations"),
  //   ability: "reports",
  // },
];

export function GlobalHeader() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [layout, setLayout] = useShellLayout();
  const { email, config, access } = useAccessContext();
  const admin = isAdmin(email, config);
  /** Manager tools are for managers. `isAdmin` is true for every manager while
   *  `admins` is empty (§5.39c), so today this is the same set — but the two
   *  answer different questions and must not be conflated. */
  const managerish = access.type === "manager";
  const [menu, setMenu] = useState(false);
  const menuBox = useRef<HTMLSpanElement>(null);
  const [manage, setManage] = useState(false);
  const manageBox = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (menuBox.current && !menuBox.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [menu]);

  useEffect(() => {
    if (!manage) return;
    const away = (e: MouseEvent) => {
      if (manageBox.current && !manageBox.current.contains(e.target as Node)) setManage(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [manage]);

  return (
    <header className="gh">
      <Link className="brand" to="/" title="My Dashboard">
        <span className="tile">
          <Stethoscope style={{ width: 17, height: 17 }} />
        </span>
        <div>
          <b>Command Center</b>
          <div className="dim">Medically Modern</div>
        </div>
      </Link>

      <nav className="topnav" aria-label="Sections">
        {TABS.filter((t) => !t.ability || hasAbility(email, config, t.ability)).map((t) => {
          const Icon = t.icon;
          const active = t.match(pathname, search);
          return (
            <Link
              key={t.key}
              to={t.to}
              className={`tab${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
            >
              <Icon style={{ width: 15, height: 15 }} />
              <span className="lbl">{t.label}</span>
            </Link>
          );
        })}
      </nav>

      <GlobalSearch />

      <div className="right">
        {/* The softphone, beside Users (Josh, 2026-09-18). ⚠️ It renders for
            ASSIGNED CALL ANSWERERS ONLY (§5.13b) and returns null for everybody
            else — there is no line to report on for somebody who is never rung.
            The `compact` form is the same component, so the gate and the tone
            rules cannot drift from the home badge's. */}
        <CallConnectionBadge compact />

        {/* ⚠️⚠️ **MANAGE ▾ IS WHERE THREE FEATURES LIVE THAT OTHERWISE HAVE NO
            DOOR AT ALL.** Stage Manager ("move a patient between stages") and
            Operations ("today's baseline vs live") exist only as tabs of
            `/system-mgmt`, and the redesign took the System Management button
            off the dashboard — so when those tabs were commented out on
            2026-09-18 the two features left the app completely. Josh, later
            that day: *"function should be lossless and will decide what gets
            cut later"*. Brandon's mockup header carries this exact menu
            (Oversight · Operations · Stage Manager · Access & permissions), so
            restoring them here is his design rather than a departure from it.

            ⚠️ Manager-gated, not admin-gated: these are manager tools, and
            `/access` is already reachable for admins via the Users button
            beside this. */}
        {managerish && (
          <span style={{ position: "relative" }} ref={manageBox}>
            <button
              className="ib"
              onClick={() => setManage((m) => !m)}
              title="Manager tools"
              aria-haspopup="menu"
              aria-expanded={manage}
            >
              <Sliders style={{ width: 16, height: 16 }} />
              <span className="lbl">Manage</span>
              <ChevronDown style={{ width: 12, height: 12 }} />
            </button>
            {manage && (
              <div className="menu" role="menu">
                <div className="eyebrow">Managers</div>
                <button className="opt" role="menuitem" onClick={() => { setManage(false); navigate("/oversight"); }}>
                  <BarChart3 style={{ width: 13, height: 13, marginRight: 6, verticalAlign: -2 }} />
                  Oversight
                </button>
                <button className="opt" role="menuitem" onClick={() => { setManage(false); navigate("/system-mgmt?tab=operations"); }}>
                  <Activity style={{ width: 13, height: 13, marginRight: 6, verticalAlign: -2 }} />
                  Operations
                </button>
                <button className="opt" role="menuitem" onClick={() => { setManage(false); navigate("/system-mgmt?tab=stageManager"); }}>
                  <ArrowRightLeft style={{ width: 13, height: 13, marginRight: 6, verticalAlign: -2 }} />
                  Stage Manager
                </button>
                <button className="opt" role="menuitem" onClick={() => { setManage(false); navigate("/system-mgmt"); }}>
                  <ListChecks style={{ width: 13, height: 13, marginRight: 6, verticalAlign: -2 }} />
                  System Management
                </button>
                <div className="divider" />
                <button className="opt" role="menuitem" onClick={() => { setManage(false); navigate("/access"); }}>
                  <KeyRound style={{ width: 13, height: 13, marginRight: 6, verticalAlign: -2 }} />
                  Access &amp; permissions
                </button>
              </div>
            )}
          </span>
        )}

        {/* ⚠️ Admins only, per Brandon — and `isAdmin` returns true for every
            MANAGER while `admins` is empty (§5.39c), which is every config
            today. So this renders exactly as it did until somebody names the
            first admin, and naming one is what makes the list the rule. */}
        {admin && (
          <Link
            className={`ib${pathname === "/access" ? " active" : ""}`}
            to="/access"
            title="Access & permissions"
          >
            <Users style={{ width: 16, height: 16 }} />
            <span className="lbl">Users</span>
          </Link>
        )}

        <span style={{ position: "relative" }} ref={menuBox}>
          <button
            className="ib"
            onClick={() => setMenu((m) => !m)}
            title="Settings"
            aria-haspopup="menu"
            aria-expanded={menu}
          >
            <Settings style={{ width: 16, height: 16 }} />
          </button>
          {menu && (
            <div className="menu" role="menu">
              <div className="eyebrow">Layout</div>
              {/* ⚠️ Brandon's own switch, ported with the design. It is what
                  makes a whole-app navigation change reversible in one click —
                  see lib/shell/layout.ts. */}
              <button
                className="opt"
                role="menuitem"
                onClick={() => {
                  setLayout(layout === "redesign" ? "current" : "redesign");
                  setMenu(false);
                }}
              >
                {layout === "redesign" ? "Switch to the layout as it was" : "Switch to the new layout"}
              </button>
              <div className="divider" />
              <div className="eyebrow">Manager</div>
              {/* ⚠️ `/oversight`, NOT `/system-mgmt?tab=oversight` — that tab is
                  commented out (2026-09-18). Oversight has its own full-screen
                  route (`OversightPage`), which is why commenting the tab took
                  nothing away; Stage Manager and Operations have no second
                  door and really are off until somebody uncomments them. */}
              <button className="opt" role="menuitem" onClick={() => { setMenu(false); navigate("/oversight"); }}>
                Pipeline Oversight
              </button>
              {/* ── System Management — removed from the menu 2026-09-18
                     (Josh: "remove system management, the search from there is
                     now in the top bar"). The route still exists, so a
                     bookmark works; it just is not advertised here any more.
              <button className="opt" role="menuitem" onClick={() => { setMenu(false); navigate("/system-mgmt"); }}>
                System Management
              </button>
              ── */}
              {/* ⚠️ BOTH fax screens are listed, deliberately (Josh, 2026-09-18):
                  Brandon's combined bar was added beside the Fax Inbox rather
                  than replacing it, so both stay reachable until we trim. */}
              <button className="opt" role="menuitem" onClick={() => { setMenu(false); navigate("/fax"); }}>
                Faxes — with the sending office
              </button>
              <button className="opt" role="menuitem" onClick={() => { setMenu(false); navigate("/fax-inbox"); }}>
                Fax Inbox
              </button>
              {/* ⚠️⚠️ **SIGN OUT LIVES HERE BECAUSE THE FLOATING ONE CAN BE
                  COVERED.** `ThemePickerButton` is the app's sign-out, and on
                  the no-sidebar home (§5.39c) it is the only one — but it sits
                  at `fixed bottom-4 left-4 z-40` and the call-status notices
                  sit at the SAME corner with `z-[60]`, so an unhealthy call
                  stream hides it. Measured in a browser, not reasoned about.
                  Losing the theme picker behind a notice is a nuisance; losing
                  sign-out is not, so it gets a route that nothing can cover. */}
              <div className="divider" />
              <div className="eyebrow">{getUser()?.email || "Signed in"}</div>
              <button className="opt" role="menuitem" onClick={signOut}>
                <LogOut style={{ width: 13, height: 13, marginRight: 6, verticalAlign: -2 }} />
                Sign out
              </button>
            </div>
          )}
        </span>
      </div>
    </header>
  );
}
