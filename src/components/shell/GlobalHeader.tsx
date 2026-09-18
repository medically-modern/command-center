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
 *   Reports & Metrics  → `/system-mgmt?tab=operations`  (Josh, 2026-09-18)
 *
 * ⚠️ **Reports & Metrics points at Operations DELIBERATELY.** Brandon's mockup
 * draws a Patient Pipeline Tracker that does not exist in this build, and the
 * numbers behind it are not specified anywhere. Operations is the closest real
 * thing (the 9 AM baseline against live counts, grouped by stage — his own
 * feature audit calls that grouping "the most sensible map of the roles
 * anywhere in the app"). Pointing a tab at a page of invented numbers would be
 * worse than pointing it at a real one under a borrowed name.
 *
 * ⚠️ **Nothing here is gated on an ability yet.** The abilities model
 * (`admins[]`, `perms`) is a later phase, and §5.39 records the rule for when
 * it lands: default every ability ON, or the first deploy reads an access.json
 * with no `perms` and everybody fails closed — the same reasoning as
 * `isBootstrapMode` (§5.3).
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BarChart3, Grid3x3, MessageSquare, Package, Settings, Stethoscope, Users } from "lucide-react";
import { GlobalSearch } from "./GlobalSearch";
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
  {
    key: "reports",
    label: "Reports & Metrics",
    to: "/system-mgmt?tab=operations",
    icon: BarChart3,
    match: (p, s) => p === "/system-mgmt" && s.includes("tab=operations"),
    ability: "reports",
  },
];

export function GlobalHeader() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const [layout, setLayout] = useShellLayout();
  const { email, config } = useAccessContext();
  const admin = isAdmin(email, config);
  const [menu, setMenu] = useState(false);
  const menuBox = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => {
      if (menuBox.current && !menuBox.current.contains(e.target as Node)) setMenu(false);
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
              <button className="opt" role="menuitem" onClick={() => { setMenu(false); navigate("/system-mgmt?tab=oversight"); }}>
                Pipeline Oversight
              </button>
              <button className="opt" role="menuitem" onClick={() => { setMenu(false); navigate("/system-mgmt"); }}>
                System Management
              </button>
              {/* ⚠️ BOTH fax screens are listed, deliberately (Josh, 2026-09-18):
                  Brandon's combined bar was added beside the Fax Inbox rather
                  than replacing it, so both stay reachable until we trim. */}
              <button className="opt" role="menuitem" onClick={() => { setMenu(false); navigate("/fax"); }}>
                Faxes — with the sending office
              </button>
              <button className="opt" role="menuitem" onClick={() => { setMenu(false); navigate("/fax-inbox"); }}>
                Fax Inbox
              </button>
            </div>
          )}
        </span>
      </div>
    </header>
  );
}
