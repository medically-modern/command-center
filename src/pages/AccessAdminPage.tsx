import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAccessContext } from "@/components/AccessProvider";
import { ROLES } from "@/lib/config";
import { MAX_CALL_ANSWERERS, type RoleFilter } from "@/lib/accessStore";
import { AbilitiesEditor } from "@/components/shell/AbilitiesEditor";
import { HOME_VIEW_TAB, homeViewsOf } from "@/lib/shell/abilities";
import { CROSS_SELL_FILTER_ROLES, roleFilterFor, roleOrderNumber } from "@/lib/roleView";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ArrowLeft, Shield, Users, X } from "lucide-react";
import "./access/users.css";

/**
 * User management — Brandon's `viewUsers` (pixel-match Phase 6c, 2026-09-25;
 * CLAUDE.md §5.52), drawn over exactly the writers the page has always called.
 *
 * ⚠️⚠️ **THE LOOK IS HIS; EVERY SAVE IS OURS.** Thirteen writers come out of
 * `useAccessContext()` and every one of them is still called from this page —
 * `accessAdmin.test.tsx` scans for each by name, because a control that is
 * drawn and wired to nothing is the §5.31b failure (green tests, absent
 * function). Same `access.json`, same merge-on-conflict saves (§5.39j), same
 * self-lockout guard.
 *
 * ⚠️ **Managers-only, as before — NOT admins-only as his mockup gates it.** Who
 * may open this page is a permission, not a visual, and today `admins` is
 * empty, so "admins only" would read as "managers only" right up until the
 * first admin is named and every other manager lost the page (§5.39c). The
 * header's sentence says what is true.
 *
 * ⚠️ **Two Add buttons where he draws one.** His "Add" makes a processor; ours
 * keeps "Add as manager" beside it, because a pure manager (no processor entry)
 * is a shape this config has and his flow cannot produce in one press.
 *
 * ⚠️ Every person can be a Manager (full access), a Processor (only their
 * checked bars), or BOTH. Each assigned role carries a filter (All /
 * Non-escalated / Escalated, plus the two cross-sell scopes on Welcome Call)
 * and an optional SOP order number.
 */
const FILTER_OPTS: { value: RoleFilter; label: string }[] = [
  { value: "nonEscalated", label: "Non-escalated" },
  { value: "all", label: "All" },
  { value: "escalated", label: "Escalated" },
];

/** Welcome Call only — Katie + Brandon, 2026-09-21: Corey takes the cross-sell
 *  calls, somebody else takes the rest. Two scopes that SPLIT the one queue, so
 *  assigning them to two people covers it exactly once with nobody orphaned.
 *  ⚠️ Offered only for CROSS_SELL_FILTER_ROLES: `isCrossSell` is a Welcome Call
 *  rule, so on any other role this would store a filter nothing reads. */
const CROSS_SELL_OPTS: { value: RoleFilter; label: string }[] = [
  { value: "crossSell", label: "Cross-sells only" },
  { value: "nonCrossSell", label: "Everything but cross-sells" },
];

const filterOptsFor = (roleId: string) =>
  CROSS_SELL_FILTER_ROLES.has(roleId) ? [...FILTER_OPTS, ...CROSS_SELL_OPTS] : FILTER_OPTS;

export default function AccessAdminPage() {
  const navigate = useNavigate();
  const {
    access,
    email: me,
    config,
    addManager,
    setManager,
    removeEmail,
    addProcessor,
    setProcessorName,
    setProcessorPhone,
    toggleProcessorRole,
    setRoleFilter,
    setRoleOrder,
    setCallAnswerer,
    setAbility,
    setHomeView,
    setAdmin,
  } = useAccessContext();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");

  // Self-lockout guard: whoever is managing access is made an explicit manager
  // on open, so adding others (or a wrong first manager) can never lock them out.
  useEffect(() => {
    if (
      access.type === "manager" &&
      me &&
      !config.managers.some((m) => m.trim().toLowerCase() === me.trim().toLowerCase())
    ) {
      addManager(me);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (access.type !== "manager") {
    return (
      <div className="cc-us min-h-screen bg-gradient-subtle flex flex-col">
        <div className="empty-center">
          <div>
            <h2>Managers only.</h2>
            <p className="small muted" style={{ marginTop: 6 }}>User management is limited to managers.</p>
            <button type="button" className="btn outline sm" style={{ marginTop: 10 }} onClick={() => navigate("/")}>
              Back to home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const norm = (e: string) => e.trim().toLowerCase();

  // Unified people list: union of managers[] and processors{}.
  const allEmails = Array.from(
    new Set([...config.managers.map(norm), ...Object.keys(config.processors).map(norm)]),
  ).sort();

  const answerers = (config.callAnswerers || []).map(norm);
  const admins = (config.admins ?? []).map(norm);

  const onAddManager = () => {
    if (!norm(email)) return;
    addManager(email);
    setEmail("");
    setName("");
  };
  const onAddProcessor = () => {
    if (!norm(email)) return;
    addProcessor(email, name || email.split("@")[0]);
    setEmail("");
    setName("");
  };

  return (
    <div className="cc-us min-h-screen bg-gradient-subtle flex flex-col">
      <header className="us-head">
        <button type="button" onClick={() => navigate("/")} className="btn ghost sm" title="Back" aria-label="Back">
          <ArrowLeft style={{ width: 18, height: 18 }} />
        </button>
        <div>
          <h1>User management</h1>
          <div className="xs muted">
            Who sees what. Everyone gets a <b>custom view</b> as their home — <b>Stages (bars)</b> is the placeholder
            for people whose view isn't designed yet; two views make a toggle — plus the <b>bars</b> they work and the{" "}
            <b>abilities</b> that unlock actions. Managers can open this page. Changes sync across devices.
          </div>
        </div>
        <span className="xs muted" style={{ marginLeft: "auto", whiteSpace: "nowrap" }}>
          {answerers.length} of {MAX_CALL_ANSWERERS} call-answering devices in use
        </span>
      </header>

      <div className="acc-body">
        {/* Add a person */}
        <section className="card pad">
          <div className="row small" style={{ fontWeight: 600, marginBottom: 10 }}>+ Add a person</div>
          <div className="row wrap">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@medicallymodern.com"
              aria-label="Email"
              className="input grow"
              style={{ minWidth: 220 }}
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Display name (optional)"
              aria-label="Display name"
              className="input"
              style={{ width: 170 }}
            />
            <button type="button" onClick={onAddProcessor} className="btn blue sm">
              <Users style={{ width: 14, height: 14 }} /> Add
            </button>
            <button type="button" onClick={onAddManager} className="btn ghost sm" title="Full access, with no bars of their own">
              <Shield style={{ width: 14, height: 14 }} /> Add as manager
            </button>
          </div>
          <div className="xs muted" style={{ marginTop: 8 }}>
            New people start on the <b>Stages (bars)</b> placeholder view with no bars — set them on the card that
            appears. A person can be both: toggle <b>Manager</b> on their card and still assign them bars.
          </div>
        </section>

        {/* ⚠️ The "Answer calls in the browser" section is GONE (Josh,
            2026-09-23): it was a second control onto `callAnswerers[]`, the
            same list the "Answers calls" chip on each person's Abilities row
            writes. That chip is now the only one, and the count lives on it. */}

        {allEmails.length === 0 ? (
          <p className="small muted">No one added yet. Add a person above.</p>
        ) : (
          allEmails.map((pe) => {
            const isManager = config.managers.some((m) => norm(m) === pe);
            const profile = config.processors[pe];
            const roles = profile?.roles ?? [];
            const isSelf = pe === norm(me);
            const displayName = profile?.name || pe.split("@")[0];
            const views = homeViewsOf(pe, config);
            const viewLabel = views.map((v) => HOME_VIEW_TAB[v]).join(" | ");
            return (
              <section key={pe} className="card pad ucard" data-person={pe}>
                {/* Header row */}
                <div className="row wrap" style={{ marginBottom: 10, gap: 10 }}>
                  <span className="avatar" aria-hidden="true">{displayName.charAt(0).toUpperCase()}</span>
                  <div style={{ minWidth: 0 }}>
                    <b className="small">{displayName}</b>
                    {isSelf && <span className="xs muted"> (you)</span>}
                    <div className="xs muted">{pe}</div>
                  </div>
                  <span className="chips">
                    {admins.includes(pe) && <span className="chip navy">Admin</span>}
                    {isManager && <span className="chip amber">Manager</span>}
                    {answerers.includes(pe) && <span className="chip green">Answers calls</span>}
                    <span className="chip">{viewLabel}</span>
                  </span>
                  {profile ? (
                    <>
                      <input
                        value={profile.name}
                        onChange={(e) => setProcessorName(pe, e.target.value)}
                        placeholder="Display name"
                        aria-label="Display name"
                        className="input sm"
                        style={{ width: 130, marginLeft: "auto" }}
                      />
                      {/* Click-to-call: the number RingCentral rings to reach
                          this person. NOT what the patient sees — patients
                          always see the MM number. Blank falls back to the
                          main line, which rings whoever is on it. */}
                      <input
                        value={profile.phoneNumber ?? ""}
                        onChange={(e) => setProcessorPhone(pe, e.target.value)}
                        placeholder="Call-me-at number"
                        aria-label="Call-me-at number"
                        title="Number RingCentral rings to reach this person on a click-to-call. Patients always see the MM number."
                        className="input sm"
                        style={{ width: 150 }}
                      />
                    </>
                  ) : (
                    <span className="xs muted" style={{ marginLeft: "auto" }} title="A manager with no bars of their own — turn a bar on to give them a profile">
                      manager only
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => !isSelf && removeEmail(pe)}
                    disabled={isSelf}
                    title={isSelf ? "You can't remove yourself" : "Remove this person from the Command Center"}
                    className="btn ghost xs"
                  >
                    <X style={{ width: 12, height: 12 }} /> Remove
                  </button>
                </div>

                {/* Brandon's abilities + custom view (§5.39c) — the same editor,
                    now in his two-box grid. */}
                <AbilitiesEditor
                  email={pe}
                  config={config}
                  isManager={isManager}
                  isSelf={isSelf}
                  answersCalls={answerers.includes(pe)}
                  answerSlotsFull={!answerers.includes(pe) && answerers.length >= MAX_CALL_ANSWERERS}
                  answerCount={answerers.length}
                  onAbility={(a, on) => setAbility(pe, a, on)}
                  onHomeView={(v, on) => setHomeView(pe, v, on)}
                  onAdmin={(on) => setAdmin(pe, on)}
                  onManager={(on) => setManager(pe, on)}
                  onAnswersCalls={(on) => {
                    if (!setCallAnswerer(pe, on)) {
                      toast.error(`All ${MAX_CALL_ANSWERERS} browser-answering slots are taken. Turn somebody else off first.`);
                    }
                  }}
                />

                {/* Bars: checkbox + filter + SOP order */}
                <div className="row" style={{ margin: "12px 0 6px", gap: 8 }}>
                  <span className="eyebrow">Bars</span>
                  <span className="xs muted">
                    {views.includes("bars")
                      ? `${roles.length} on the Stages view`
                      : `not shown on the ${viewLabel} view — the queues still open from search and profile links`}
                  </span>
                </div>
                <div className="role-grid">
                  {ROLES.map((role) => {
                    const on = roles.includes(role.id);
                    return (
                      <div key={role.id} className={cn("role-cell", on && "on")}>
                        <label>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggleProcessorRole(pe, role.id)}
                            className="accent-primary"
                          />
                          <span className={cn("dot", role.color)} />
                          <span className="truncate">{role.label}</span>
                        </label>
                        {on && (
                          <>
                            <select
                              value={roleFilterFor(profile, role.id)}
                              onChange={(e) => setRoleFilter(pe, role.id, e.target.value as RoleFilter)}
                              title="Which patients this rep sees for this role"
                              aria-label="Filter"
                            >
                              {filterOptsFor(role.id).map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                            <input
                              type="number"
                              min={1}
                              value={roleOrderNumber(profile, role.id) ?? ""}
                              onChange={(e) =>
                                setRoleOrder(pe, role.id, e.target.value === "" ? null : parseInt(e.target.value, 10))
                              }
                              placeholder="#"
                              className="ord"
                              title="SOP order (1 = first)"
                              aria-label="Order"
                            />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
