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
 *   Reports & Metrics  → `/system-mgmt?tab=operations`
 *
 * ⚠️ **Reports & Metrics points at Operations deliberately**, and that is Josh's
 * own pick (2026-09-18): Brandon's Patient Pipeline Tracker does not exist in
 * this build and its numbers are specified nowhere, while Operations is the real
 * page his own audit calls "the most sensible map of the roles anywhere in the
 * app". It was commented out for a day while that tab was switched off; the tab
 * is live again (§5.39f), so the collision is gone.
 *
 * ⚠️⚠️ **EVERY TAB IS ABILITY-GATED AND THE GATE READS THE *EFFECTIVE* IDENTITY**
 * (Josh, 2026-09-19: *"i want everything on this list functional. ie if i dont
 * assign myself communications the tab should be removed from the top bar for
 * me"* · *"if mashekes view has patient communication assigned and i view her
 * view it should appear"*). So the tabs answer for the person whose view is on
 * show — mine, or the one borrowed through `lib/shell/viewAs` — and so do the
 * Manage menu and the Users button.
 *
 * ⚠️ An ability nobody has turned off is ON (§5.39c), so every tab renders for
 * everybody until an admin says otherwise; the model stays additive.
 *
 * ⚠️⚠️ **THE SOFTPHONE BADGE IS NOT BORROWED.** It reads the signed-in email
 * straight from `useAccessContext`, because it drives a real SIP registration on
 * a shared extension (§5.13b) — borrowing it would register this browser as
 * somebody else, or stop MY phone ringing while I look at their screen.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Activity, ArrowRightLeft, BarChart3, ChevronDown, Grid3x3, KeyRound, ListChecks, LogOut, MessageSquare, Package, Monitor, Moon, Settings, Sliders, Stethoscope, Sun, Users } from "lucide-react";
import { getUser, signOut } from "@/lib/shared/auth";
import { GlobalSearch } from "./GlobalSearch";
import CallConnectionBadge from "@/components/inboundCalls/CallConnectionBadge";
import { useShellLayout } from "@/hooks/shell/useShellLayout";
import { useAppearance } from "@/hooks/shell/useAppearance";
import { useTheme } from "@/hooks/shell/useTheme";
import { THEMES } from "@/lib/shell/theme";
import { useAccessContext } from "@/components/AccessProvider";
import { hasAbility, isAdmin, isManagerOf } from "@/lib/shell/abilities";
import { useViewAs } from "@/lib/shell/viewAs";
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
    ability: "comms",
  },
  {
    key: "inventory",
    label: "Inventory",
    to: "/orders?view=stock",
    icon: Package,
    match: (p, s) => p === "/orders" && s.includes("view=stock"),
    ability: "inventory",
  },
  {
    key: "reports",
    label: "Reports & Metrics",
    // ⚠️ `/operations`, NOT `/system-mgmt?tab=operations` (Josh, 2026-09-21:
    // "make reports and metrics ONLY the daily operations screen no need for
    // system management bar"). The tab used to open the whole System
    // Management page — navy header, five-tab bar — with Operations inside it,
    // so a header tab landed you on a screen wearing a second set of tabs.
    to: "/operations",
    icon: BarChart3,
    match: (p, s) => p === "/operations" || (p === "/system-mgmt" && s.includes("tab=operations")),
    ability: "reports",
  },
  {
    key: "stageManager",
    label: "Stage Manager",
    to: "/stage-manager",
    icon: ArrowRightLeft,
    match: (p, s) => p === "/stage-manager" || (p === "/system-mgmt" && s.includes("tab=stageManager")),
    ability: "stageManager",
  },
];

export function GlobalHeader() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [layout, setLayout] = useShellLayout();
  const { appearance, setAppearance } = useAppearance();
  const { theme, setTheme } = useTheme();
  const { email, config } = useAccessContext();
  /**
   * ⚠️⚠️ **WHOSE HEADER THIS IS.** `viewAs` is set by the home screen's
   * "Viewing" dropdown (§5.39g) and is empty the rest of the time, so `who` is
   * the signed-in email unless a borrow is on. Every gate below reads `who`;
   * nothing that WRITES may.
   *
   * ⚠️ The borrow is only honoured while the signed-in person actually holds
   * `viewOthers` — an ability revoked mid-session must not leave somebody stuck
   * inside another person's screen.
   */
  const borrowing = useViewAs();
  const mayBorrow = hasAbility(email, config, "viewOthers");
  const who = borrowing && mayBorrow ? borrowing : email;
  const borrowedName =
    who !== email ? (config.processors?.[who]?.name || who.split("@")[0]) : "";

  const admin = isAdmin(who, config);
  /** Manager tools are for managers. `isAdmin` is true for every manager while
   *  `admins` is empty (§5.39c), so today this is the same set — but the two
   *  answer different questions and must not be conflated. */
  const managerish = isManagerOf(who, config);
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
        {TABS.filter((t) => !t.ability || hasAbility(who, config, t.ability)).map((t) => {
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
              {/* ⚠️⚠️ **THE LAYOUT TOGGLE IS GONE** (Josh, 2026-09-21: "remove
                  switch to tlayout as it ws"). The redesign is the app now.
                  The MECHANISM survives — `AppShell` still branches and
                  `?layout=current` still works — so there is a way to compare
                  if something ever looks wrong, but it is no longer a control
                  anybody can land on by accident. ⚠️ `readLayout` migrates a
                  stored "current" back to the redesign at boot, or the handful
                  of browsers sitting in the old layout would have been stranded
                  in it with no header and therefore no menu (§5.39d, the exact
                  one-way door this project already paid for once). */}
              {/* ⚠️ Appearance is a SEPARATE axis from the colour theme in the
                  settings popover, not a seventh theme (§5.40) — and it is in
                  BOTH menus for the layout toggle's reason: a scheme you cannot
                  read is a scheme you must be able to leave from wherever you
                  are. `?appearance=light` is the route from a page with neither
                  menu. */}
              <div className="eyebrow">Appearance</div>
              <div className="seg" role="group" aria-label="Appearance">
                {([
                  ["light", "Light", Sun],
                  ["dark", "Dark", Moon],
                  ["system", "System", Monitor],
                ] as const).map(([id, label, Icon]) => (
                  <button
                    key={id}
                    type="button"
                    className={appearance === id ? "on" : undefined}
                    aria-pressed={appearance === id}
                    onClick={() => setAppearance(id)}
                  >
                    <Icon style={{ width: 13, height: 13 }} />
                    {label}
                  </button>
                ))}
              </div>
              <div className="divider" />
              {/* ⚠️ **THE MANAGE ▾ MENU WAS REMOVED** (Josh, 2026-09-21: "also
                  remove the manage tab / i think everything that exists there
                  exists other places now"). Two of its three entries did NOT
                  exist elsewhere, so they moved here rather than going with it:
                  **System Management** had no other door at all, and
                  **Access & permissions** had only the Users button beside this
                  one — which is ADMIN-only, and `isAdmin` is true for every
                  manager merely because `admins` is empty (§5.39c). The day
                  somebody names the first admin, a manager who is not one would
                  have lost `/access` entirely. Stage Manager really did have
                  another door: it is a header tab. */}
              {/* ⚠️ **GATED ON `managerish`, which the pre-2026-09-21 version of
                  this section was NOT.** It already offered Pipeline Oversight
                  and System Management to every processor — harmless for
                  Oversight, which guards itself with "Managers only." — and the
                  Manage ▾ menu that just folded into it WAS gated. Folding an
                  admin-shaped entry into an ungated list is how a move becomes
                  a widening, so the gate comes with them. Nothing is lost: the
                  pages that guard themselves still do, and Stage Manager is
                  ability-gated at its route either way. */}
              {managerish && (
                <>
                  <div className="eyebrow">Manager</div>
                  <button className="opt" role="menuitem" onClick={() => { setMenu(false); navigate("/oversight"); }}>
                    <BarChart3 style={{ width: 13, height: 13, marginRight: 6, verticalAlign: -2 }} />
                    Pipeline Oversight
                  </button>
                  <button className="opt" role="menuitem" onClick={() => { setMenu(false); navigate("/stage-manager"); }}>
                    <ArrowRightLeft style={{ width: 13, height: 13, marginRight: 6, verticalAlign: -2 }} />
                    Stage Manager
                  </button>
                  <button className="opt" role="menuitem" onClick={() => { setMenu(false); navigate("/system-mgmt"); }}>
                    <ListChecks style={{ width: 13, height: 13, marginRight: 6, verticalAlign: -2 }} />
                    System Management
                  </button>
                  {/* ⚠️ Here AND on the admin-only Users button beside this menu
                      — `isAdmin` is true for every manager only while `admins`
                      is empty (§5.39c), so the day somebody names the first
                      admin this is the one route a non-admin manager has. */}
                  <button className="opt" role="menuitem" onClick={() => { setMenu(false); navigate("/access"); }}>
                    <KeyRound style={{ width: 13, height: 13, marginRight: 6, verticalAlign: -2 }} />
                    Access &amp; permissions
                  </button>
                  <div className="divider" />
                </>
              )}
              {/* ⚠️ The fax screens stay UNGATED — they are rep tools, and both
                  are listed deliberately (§5.39c): Brandon's combined bar was
                  added beside the Fax Inbox rather than replacing it. */}
              <div className="eyebrow">Faxes</div>
              <button className="opt" role="menuitem" onClick={() => { setMenu(false); navigate("/fax"); }}>
                Faxes — with the sending office
              </button>
              <button className="opt" role="menuitem" onClick={() => { setMenu(false); navigate("/fax-inbox"); }}>
                Fax Inbox
              </button>
              {/* ⚠️ **THE LOWER-LEFT FLOATING GEAR IS GONE** (Josh, 2026-09-21:
                  "putt everything in the lower left setting into the upper
                  right settings"). Everything it held is here: the appearance
                  switch above, these six colour themes, and sign-out below. It
                  was also the button the call-status notices kept covering
                  (§5.39d) — a corner this menu cannot be pushed into. */}
              <div className="divider" />
              <div className="eyebrow">Theme</div>
              <div className="swatches" role="group" aria-label="Colour theme">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    title={t.label}
                    aria-label={t.label}
                    aria-pressed={theme === t.id}
                    className={theme === t.id ? "on" : undefined}
                    onClick={() => setTheme(t.id)}
                  >
                    <span className={`sw ${t.swatch}`} />
                  </button>
                ))}
              </div>
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
