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
import { Link, useLocation } from "react-router-dom";
import { ArrowRightLeft, BarChart3, Grid3x3, LogOut, MessageSquare, Package, Settings, Stethoscope, Users } from "lucide-react";
import { getUser, signOut } from "@/lib/shared/auth";
import { GlobalSearch } from "./GlobalSearch";
import { CallSettings } from "./CallSettings";
import CallConnectionBadge, { useCallStatus } from "@/components/inboundCalls/CallConnectionBadge";
import { useAppearance } from "@/hooks/shell/useAppearance";
import { useTheme } from "@/hooks/shell/useTheme";
import { THEMES } from "@/lib/shell/theme";
import { useAccessContext } from "@/components/AccessProvider";
import { HOME_VIEW_LABEL, hasAbility, homeViewsOf, isAdmin, isManagerOf } from "@/lib/shell/abilities";
import { useViewAs } from "@/lib/shell/viewAs";
import { useCommsConfig, useInboxBadge } from "@/hooks/commsInbox/useInbox";
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
  /**
   * The Communications tab's red badge: the UNRESOLVED count, never an unread
   * one (COMMS_INBOX_PLAN.md §1.2, §9.1 D4). ⚠️ A Postgres count on the
   * gateway, polled once a minute and never from a hidden tab — a badge on
   * every page for every rep cannot be RingCentral reads (INCIDENT_2026-08-20).
   * Only for somebody who can see the tab, and only once the inbox is on.
   */
  const commsConfig = useCommsConfig();
  const inboxBadge = useInboxBadge(commsConfig.ui && hasAbility(who, config, "comms"));
  /**
   * The dot on the gear (Brandon's `.sdot`) — the same reading the phone icon
   * beside it draws, so the two cannot disagree; grey for somebody the line
   * never rings. The sentence itself is inside the menu (`CallSettings`).
   */
  const call = useCallStatus();
  const [menu, setMenu] = useState(false);
  const menuBox = useRef<HTMLSpanElement>(null);

  /** Brandon's `.who` line: who is signed in, what they are, which home view
   *  they land on. The name is the Google one, then the configured one. */
  const me = getUser();
  const myName = me?.name || config.processors?.[email]?.name || email.split("@")[0] || "Signed in";
  const myRole = isAdmin(email, config) ? "Admin" : isManagerOf(email, config) ? "Manager" : "Processor";
  const viewLabel = homeViewsOf(who, config).map((v) => HOME_VIEW_LABEL[v]).join(" + ");

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      // ⚠️ The pinned-numbers dialog is a portal OUTSIDE this box; a click in
      // it must not read as a click away, or the dialog closes under the rep.
      const t = e.target as Node;
      if (menuBox.current && !menuBox.current.contains(t) && !(t instanceof Element && t.closest("[role=dialog]"))) {
        setMenu(false);
      }
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [menu]);

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
          const n = t.key === "comms" && inboxBadge ? inboxBadge.open : 0;
          return (
            <Link
              key={t.key}
              to={t.to}
              className={`tab${active ? " active" : ""}`}
              aria-current={active ? "page" : undefined}
              title={
                n
                  ? `${n} unresolved${inboxBadge?.over ? ` · ${inboxBadge.over} over 24h` : ""}`
                  : t.key === "home"
                    ? `My Dashboard — ${viewLabel}`
                    : undefined
              }
            >
              <Icon style={{ width: 15, height: 15 }} />
              <span className="lbl">{t.label}</span>
              {n > 0 && <span className="badge">{n > 99 ? "99+" : n}</span>}
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
            {/* Brandon's `.sdot`: the line's colour at a glance, on the gear —
                the same reading as the phone icon beside it. */}
            <span className={`sdot ${call.enabled ? call.tone : "grey"}`} aria-hidden="true" />
          </button>
          {menu && (
            <div className="menu settings" role="menu">
              {/* His `.who` line: who is signed in, what they are, which home
                  view they land on. The signed-in person, always — a borrow is
                  named after it rather than impersonated (§5.39g). */}
              <div className="who">
                <span className="avatar">{myName[0]?.toUpperCase() || "?"}</span>
                <div>
                  <b className="small">{myName}</b>
                  <div className="xs muted">
                    {email || "Signed in"} · {myRole} · view: {viewLabel}
                    {borrowedName ? ` · viewing ${borrowedName}` : ""}
                  </div>
                </div>
              </div>

              {/* Calls — his status line, "Ring me", "Which calls ring me" and
                  the ringtone, on the ring preferences that already exist
                  (§5.13). The answerer gate stays in the badge file (§5.13b). */}
              <CallSettings />

              {/* ⚠️ NO "Texts" section. Brandon's menu carries "Notify me about
                  new texts from my patients"; Josh, 2026-09-24: "dont build
                  that yet". */}

              {/* ⚠️ Access & permissions LEFT this menu on 2026-09-25 (Josh:
                  *"Get rid of access and permissions in the settings tab,
                  that's the same thing as users tab"*). The Users button
                  beside this menu is now the ONE door to `/access` — and it
                  is ADMIN-gated, so the §5.44 narrowing is real the day
                  somebody names the first admin: a non-admin manager then has
                  no route to `/access` from the chrome. Recorded in
                  `lossless.test.ts`; the fix, if it bites, is re-adding a
                  gated entry here. */}

              {/* ⚠️ Appearance is a SEPARATE axis from the colour theme, not a
                  seventh theme (§5.40) — his `segc`, Light · Dark only since
                  2026-09-25 (Josh: *"remove system setting and just have
                  light or dark"*; a stored System migrates in
                  `readAppearance`), and the six swatches under it.
                  `?appearance=light` is the route from a page with no menu. */}
              <div className="sec">
                <div className="eyebrow">Appearance</div>
                <div className="segc sm" role="group" aria-label="Appearance">
                  {([
                    ["light", "Light"],
                    ["dark", "Dark"],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={appearance === id ? "on" : undefined}
                      aria-pressed={appearance === id}
                      onClick={() => setAppearance(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
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
              </div>

              {/* Sign out is HERE, where nothing can cover it (§5.39d). */}
              <div className="sec">
                <button className="opt" role="menuitem" onClick={signOut}>
                  <LogOut style={{ width: 13, height: 13 }} />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </span>
      </div>
    </header>
  );
}
