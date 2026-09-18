/**
 * The patient screen — `/patient/:itemId?board=<boardId>` (§5.39).
 *
 * ONE screen holding a patient's whole record, in Brandon's 2026-09-18 layout:
 * the top bar card (name · DOB · phone + the Onboarding | Subscription toggle),
 * the four-stage stepper, the read-only snapshot of the step a rep picks, and a
 * fixed right column carrying their texts and calls.
 *
 * ⚠️⚠️ **READ-ONLY, AND THAT IS THE DESIGN, not an omission.** It adds no writer
 * and no mutation: every action deep-links to the stage page whose verified
 * write path already does the work (§5.2). Two writers for one column is how
 * they disagree — the reason `PhoneField` left the Welcome Call banner (§5.31d)
 * and the Secondary Insurance select left `PatientInfoCard` (§5.31c). The one
 * thing on screen that writes is `ConversationThread`'s composer, which is the
 * existing component making the existing write.
 *
 * ⚠️ **Purely additive.** Nothing was removed to make room for it: every page it
 * links to still works exactly as it did, the role bars are untouched, and no
 * queue rule, role count or baseline generator was changed. A screen that reads
 * cannot move a patient (§5.8's counting contract is safe by construction).
 *
 * ⚠️ **No header of its own** — it renders inside the global shell (§5.39's
 * `AppShell`), which is where the brand, the section tabs and the patient search
 * live. A second header would put two navy bars on one screen.
 *
 * ⚠️⚠️ **WHICH IS WHY IT CARRIES ITS OWN BACK CONTROL.** Relying on the shell
 * for navigation made this screen a DEAD END in the "as today" layout — no
 * header, no back, nothing: measured 0 controls leading anywhere (Josh,
 * 2026-09-18). A back button is the app's standing convention anyway (§9,
 * history-first `useBackNavigation`), and the shell's header carries tabs but
 * no BACK, so this is right in both layouts rather than a patch for one.
 * ⚠️ It renders in EVERY branch, the two error states included — a page that
 * says "this link is missing the board" and offers no way off it is the same
 * trap one screen smaller.
 *
 * ⚠️ **`?board=` is required and that is deliberate.** A Monday item id does not
 * say which board it is on, and `fetchDossierItemsForPick` needs both. Every
 * caller has it — a search hit, a Comms Hub match — so requiring it costs
 * nothing and guessing would mean a board scan per open.
 */
import { useCallback, useMemo } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, ClipboardList, RefreshCw, RotateCw } from "lucide-react";
import { useBackNavigation } from "@/hooks/useBackNavigation";
import { OnboardingView } from "@/components/patient/OnboardingView";
import { PatientCommsColumn } from "@/components/patient/PatientCommsColumn";
import { usePatientRecord } from "@/hooks/patient/usePatientRecord";
import { clearDossierCaches, type DossierPick } from "@/lib/commsHub/dossierApi";
import {
  BOARD_PARAM,
  SIDE_PARAM,
  SNAP_PARAM,
  STEP_PARAM,
  VIEW_PARAM,
  buildStages,
  defaultStepIndex,
  onboardingCaption,
  parseSide,
  parseView,
  subscriptionCaption,
  subscriptionItem,
  topBarFacts,
  type PatientSide,
} from "@/lib/patient/patientScreen";
import type { PatientRef } from "@/lib/assignedPatients/patientLookup";
import "./patient/redesign.css";

export default function PatientPage() {
  const { itemId = "" } = useParams<{ itemId: string }>();
  const [params, setParams] = useSearchParams();

  const boardId = Number(params.get(BOARD_PARAM) || 0);
  const view = parseView(params.get(VIEW_PARAM));
  const side = parseSide(params.get(SIDE_PARAM));

  /** ⚠️ Rebuilt each render, which is why `usePatientRecord` depends on a KEY
   *  string rather than on this object — incident rule 2. */
  const pick: DossierPick | null = useMemo(
    () => (itemId && boardId ? { itemId, boardId, name: "", phone: "" } : null),
    [itemId, boardId],
  );

  const { dossier, loading, error, configured, reload } = usePatientRecord(pick);

  const setParam = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(patch)) next.set(k, v);
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  const hardReload = useCallback(() => {
    clearDossierCaches();
    reload();
  }, [reload]);

  const steps = useMemo(() => buildStages(dossier), [dossier]);
  const rawStep = params.get(STEP_PARAM);
  const stepIdx = rawStep !== null && Number.isFinite(Number(rawStep))
    ? Math.max(0, Math.min(steps.length - 1, Number(rawStep)))
    : defaultStepIndex(steps);

  const active = dossier?.active ?? null;
  const phone = dossier?.phone || active?.phone || "";
  const subItem = subscriptionItem(dossier);
  const facts = topBarFacts(dossier);

  /** What an outbound text is attributed to. Null when there is no live record —
   *  deliberately, because a text filed against a finished item is a note in the
   *  wrong place (§5.28's `threadPatient` rule). */
  const threadPatient: PatientRef | null = active
    ? {
        itemId: active.itemId,
        name: dossier?.name || active.name,
        phone: active.phone,
        boardId: String(active.boardId),
        boardName: active.boardName,
      }
    : null;

  if (!itemId || !boardId) {
    return (
      <div className="cc-pt">
        <BackRow />
        <div className="pt-main">
          <div className="notice amber">
            This link is missing the board it belongs to, so the patient can't be looked up. Open
            them from the search box above, or from the Communications hub.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="cc-pt">
      <BackRow />
      {!configured ? (
        <div className="pt-main">
          <div className="notice amber">
            This build has no Monday connection, so a patient record can't be read.
          </div>
        </div>
      ) : error ? (
        <div className="pt-main">
          <div className="notice amber">
            <div>
              <b>Couldn't load this patient.</b>
              <div style={{ marginTop: 4 }}>{error}</div>
              <button className="btn outline sm" style={{ marginTop: 10 }} onClick={hardReload}>
                <RotateCw style={{ width: 13, height: 13 }} /> Try again
              </button>
            </div>
          </div>
        </div>
      ) : loading && !dossier ? (
        <div className="pt-main">
          <p className="small muted">Reading this patient's record…</p>
        </div>
      ) : !dossier ? (
        <div className="pt-main">
          <div className="notice amber">
            No board record was found for this item. It may have been deleted on Monday.
          </div>
        </div>
      ) : (
        <div className="pt-screen">
          <div className="pt-main">
            {/* ── the top bar card, on BOTH views ─────────────────────────── */}
            <section className="card tb-card">
              <div className="tb">
                {facts.map((f, i) => (
                  <div className="fact" key={f.label}>
                    <div className="k">{f.label}</div>
                    <div className={`v${i === 0 ? " nm" : ""}${f.missing ? " gone" : ""}`}>
                      {f.value}
                    </div>
                  </div>
                ))}

                <div className="vtoggle">
                  <button
                    type="button"
                    className={view === "onboarding" ? "on" : ""}
                    onClick={() => setParam({ [VIEW_PARAM]: "onboarding" })}
                  >
                    <ClipboardList style={{ width: 14, height: 14 }} /> Onboarding
                    <span className="st">{onboardingCaption(dossier)}</span>
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

            {view === "onboarding" || !subItem ? (
              <OnboardingView
                dossier={dossier}
                steps={steps}
                stepIdx={stepIdx}
                onStep={(i) => setParam({ [STEP_PARAM]: String(i), [SNAP_PARAM]: "" })}
                snapId={params.get(SNAP_PARAM) || ""}
                onSnap={(id) => setParam({ [SNAP_PARAM]: id })}
              />
            ) : (
              <SubscriptionView item={subItem} />
            )}
          </div>

          <PatientCommsColumn
            phone={phone}
            patient={threadPatient}
            side={side}
            onSide={(s: PatientSide) => setParam({ [SIDE_PARAM]: s })}
          />
        </div>
      )}
    </div>
  );
}

/**
 * The Subscription view.
 *
 * ⚠️ **Profile and Orders are the EXISTING pages, linked rather than
 * duplicated.** Brandon draws them as tabs inside this view; rebuilding either
 * here would put a second writer on the Subscription columns and a second copy
 * of the order rules (§5.35). The tabs come when those pages are split into
 * shell and body — a later phase, and a decision with a known price.
 */
function SubscriptionView({ item }: { item: { itemId: string; groupTitle: string; stageAdvancerText: string } }) {
  return (
    <section className="card pad">
      <div className="section-h">
        <h2 style={{ fontSize: 16 }}>Subscription</h2>
        <span className="chip">{item.stageAdvancerText || item.groupTitle}</span>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <Link className="btn outline sm" to={`/subscription?patientId=${item.itemId}&from=patient`}>
          Open the profile <ArrowUpRight style={{ width: 13, height: 13 }} />
        </Link>
        <Link className="btn outline sm" to={`/update-clinicals?patientId=${item.itemId}&from=patient`}>
          Update clinicals <ArrowUpRight style={{ width: 13, height: 13 }} />
        </Link>
      </div>
      <p className="xs muted" style={{ marginTop: 10, marginBottom: 0 }}>
        Profile and Orders open their existing pages, so there is exactly one place that writes
        these columns.
      </p>
    </section>
  );
}

/**
 * Back, history-first (§9) — the same `useBackNavigation` every other page uses,
 * so a rep who arrived from Search, the Communications hub or a role page lands
 * exactly where they were. ⚠️ Not gated on the layout: the redesign's header has
 * tabs but no back, so this screen needs one in both.
 */
function BackRow() {
  const { goBack } = useBackNavigation();
  return (
    <div className="pt-back">
      <button type="button" onClick={goBack}>
        <ArrowLeft style={{ width: 14, height: 14 }} />
        Back
      </button>
    </div>
  );
}
