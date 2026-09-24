/**
 * The patient screen's main column — the top bar card and the Onboarding |
 * Subscription view — split out of `PatientPage` so a second host can render
 * it (COMMS_INBOX_PLAN.md §7, Josh's D3). Two hosts today:
 *
 *   · `/patient/:itemId` (`PatientPage`) — the route shell: reads the URL,
 *     fetches the record, draws the Back row and the Texts | Calls column.
 *   · the Communications hub's right pane (`HubPatientPane`) — the same body,
 *     with the hub's own thread standing in for that column.
 *
 * ⚠️ **This is the same move §5.39c2 found the stage pages had already made**:
 * the body is prop-driven and reads nothing of its own — not the URL, not the
 * network. Its view state (`view`, `step`, `snap`, `tool`, `sub`) arrives as a
 * `get`/`set` pair keyed by the SAME param names the patient screen writes to
 * its URL, so the page passes `URLSearchParams` and the hub passes a plain map,
 * and neither can drift into a second vocabulary.
 *
 * ⚠️ It WRITES only through writers that already exist, exactly as the page
 * always did: the top bar's two pencils (`updatePatientContact`, §5.46g) and the
 * Subscription Profile tab behind `editProfile` (§5.45b). `patientScreen.test.ts`
 * scans this directory for a hand-rolled mutation.
 */
import { useMemo, type ReactNode } from "react";
import { ClipboardList, RefreshCw } from "lucide-react";
import { OnboardingView } from "@/components/patient/OnboardingView";
import { TopBarContact } from "@/components/patient/TopBarContact";
import { SubscriptionView, parseSubTab } from "@/components/patient/SubscriptionView";
import { useAbility } from "@/components/shell/AbilityLock";
import type { PatientDossier } from "@/lib/commsHub/dossier";
import { contactTarget, patientEmail } from "@/lib/patient/contactEdit";
import { isWebFormLead, onboardingCompletedOn } from "@/lib/patient/infoStrip";
import {
  SNAP_PARAM,
  STEP_PARAM,
  SUB_PARAM,
  TOOL_PARAM,
  VIEW_PARAM,
  buildStages,
  defaultStepIndex,
  onboardingCaption,
  subscriptionCaption,
  subscriptionItem,
  topBarFacts,
  viewFor,
} from "@/lib/patient/patientScreen";

/** Read-only access to the view state — `URLSearchParams` satisfies it. */
export interface PatientViewParams {
  get(name: string): string | null;
}

export function PatientBody({
  dossier,
  itemId,
  params,
  setParam,
  onSaved,
  embedded = false,
  afterTop,
}: {
  dossier: PatientDossier;
  /** The item the host opened — the top bar's key when there is no live record. */
  itemId: string;
  params: PatientViewParams;
  /** Same shape `PatientPage` writes to its URL: param name → value. */
  setParam: (patch: Record<string, string>) => void;
  /** After a pencil saves — the host re-reads the record. */
  onSaved: () => void;
  /** Drawn inside the Communications hub's right pane (§7). */
  embedded?: boolean;
  /** Between the top bar card and the view — the hub puts its notes here. */
  afterTop?: ReactNode;
}) {
  const steps = useMemo(() => buildStages(dossier), [dossier]);
  const rawStep = params.get(STEP_PARAM);
  const stepIdx =
    rawStep !== null && Number.isFinite(Number(rawStep))
      ? Math.max(0, Math.min(steps.length - 1, Number(rawStep)))
      : defaultStepIndex(steps);

  /** ⚠️ Resolved from the RECORD when nothing names a view (§5.46b): a patient
   *  on the Subscription board opens on it. An explicit value still wins, so
   *  the toggle, a shared link and Back all behave as they did. */
  const view = viewFor(params.get(VIEW_PARAM), dossier);
  const active = dossier.active ?? null;
  const phone = dossier.phone || active?.phone || "";
  const subItem = subscriptionItem(dossier);
  const subTab = parseSubTab(params.get(SUB_PARAM));
  /** Brandon's fourth top-bar fact, and what the two pencils write (§5.46g).
   *  Read across the records for the same reason the info strip is — the live
   *  record's board may not carry the column at all. */
  const email = useMemo(() => patientEmail(dossier), [dossier]);
  const target = useMemo(() => contactTarget(dossier), [dossier]);
  const canEditProfile = useAbility("editProfile");
  const facts = topBarFacts(dossier, email);
  /** Brandon's caption under Onboarding — "Done 4/21/2026" once subscribed, "Lead"
   *  for a web-form lead — from the same readings the info strip prints. */
  const onboardingSt = useMemo(
    () =>
      onboardingCaption(dossier, {
        completedOn: onboardingCompletedOn(dossier),
        lead: isWebFormLead(dossier.items),
      }),
    [dossier],
  );

  return (
    <>
      {/* ── the top bar card, on BOTH views ─────────────────────────── */}
      <section className="card tb-card">
        <div className="tb">
          {/* ⚠️ The four facts wrap AMONG THEMSELVES, in their own group.
              Flat in `.tb` the fourth fact drops below the view toggle at
              ~1100 — measured — because `.vtoggle` takes `margin-left:
              auto` on whatever line it lands on, so the card reads as the
              toggle and one stray field. */}
          <div className="tbfacts">
            {facts.map((f, i) =>
              f.field ? (
                /* ⚠️ Keyed on the RECORD, not just the label: the draft
                   inside must not survive a patient switch and be saved
                   onto whoever is open now (§9's notes-box rule). */
                <TopBarContact
                  key={`${f.label}-${active?.itemId ?? itemId}`}
                  label={f.label}
                  value={f.value}
                  missing={f.missing}
                  field={f.field}
                  target={target}
                  lookupPhone={phone}
                  canEdit={canEditProfile}
                  onSaved={onSaved}
                />
              ) : (
                <div className="fact" key={f.label}>
                  <div className="k">{f.label}</div>
                  <div className={`v${i === 0 ? " nm" : ""}${f.missing ? " gone" : ""}`}>{f.value}</div>
                </div>
              ),
            )}
          </div>

          <div className="vtoggle">
            <button
              type="button"
              className={view === "onboarding" ? "on" : ""}
              onClick={() => setParam({ [VIEW_PARAM]: "onboarding" })}
            >
              <ClipboardList style={{ width: 14, height: 14 }} /> Onboarding
              <span className="st">{onboardingSt}</span>
            </button>
            {/* ⚠️ Disabled by the ROW'S EXISTENCE, never by a status — the
                row is created at Final Profile Confirmation, so a patient
                stuck in Insurance with an early row can still open it. */}
            {subItem ? (
              <button
                type="button"
                className={view === "subscription" ? "on" : ""}
                onClick={() => setParam({ [VIEW_PARAM]: "subscription" })}
              >
                <RefreshCw style={{ width: 14, height: 14 }} /> Subscription
                <span className="st">{subscriptionCaption(subItem)}</span>
              </button>
            ) : (
              <span
                className="off"
                aria-disabled="true"
                title="Not on the Subscription board yet — the row is created at Final Profile Confirmation"
              >
                <RefreshCw style={{ width: 14, height: 14 }} /> Subscription
                <span className="st">Not yet</span>
              </span>
            )}
          </div>
        </div>
      </section>

      {afterTop}

      {view === "onboarding" || !subItem ? (
        <OnboardingView
          dossier={dossier}
          steps={steps}
          stepIdx={stepIdx}
          onStep={(i) => setParam({ [STEP_PARAM]: String(i), [SNAP_PARAM]: "", [TOOL_PARAM]: "" })}
          snapId={params.get(SNAP_PARAM) || ""}
          onSnap={(id) => setParam({ [SNAP_PARAM]: id, [TOOL_PARAM]: "" })}
          toolKey={params.get(TOOL_PARAM) || ""}
          onTool={(k) => setParam({ [TOOL_PARAM]: k })}
          embedded={embedded}
        />
      ) : (
        <SubscriptionView
          item={subItem}
          phone={dossier.phone ?? ""}
          tab={subTab}
          onTab={(next) => setParam({ [SUB_PARAM]: next })}
        />
      )}
    </>
  );
}
