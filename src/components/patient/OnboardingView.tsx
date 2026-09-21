/**
 * The patient screen's Onboarding view (§5.39) — the info strip, the four-stage
 * stepper, and the read-only snapshot of the step a rep picks.
 *
 * ⚠️⚠️ **THE SNAPSHOT IS THE COMPLETED BOARD RECORD, READ-ONLY — and that is
 * not a stand-in for something we have yet to build** (Josh, 2026-09-18:
 * *"this is just rendering the completed version of the profile at that stage
 * as read only, we already have this"*). §5.38 is the mechanism: a patient is
 * one item per board and a board hop is a create-item automation, so the
 * finished item stays frozen in that board's Completed group and nothing writes
 * to it again. `buildStageDetail` already maps each board's columns to the
 * fields a rep wants, and `?completedStage=` already opens the real tool in
 * review mode. Both are reused here rather than re-derived.
 *
 * ⚠️ **Granularity is per BOARD, not per sub-stage.** Medical Evaluation spans
 * evaluate → send request → confirm receipt → chase → doctor appointments on
 * ONE item, so a column overwritten later in the same board reads as though it
 * always said that. The panel says which record it is showing rather than
 * implying a per-step history it cannot have.
 */
import { ArrowUpRight, Check, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import type { DossierItem, PatientDossier } from "@/lib/commsHub/dossier";
import { buildStageDetail, hasStageDetail } from "@/lib/commsHub/stageDetail";
import { infoFacts, itemOpenHref, snapStateLabel, snapTabLabel, stepCaption, type StageStep } from "@/lib/patient/patientScreen";

interface Props {
  dossier: PatientDossier;
  steps: StageStep[];
  stepIdx: number;
  onStep: (i: number) => void;
  snapId: string;
  onSnap: (itemId: string) => void;
}

export function OnboardingView({ dossier, steps, stepIdx, onStep, snapId, onSnap }: Props) {
  const facts = infoFacts(dossier);
  const step = steps[stepIdx];
  const snap = step?.items.find((i) => i.itemId === snapId) ?? step?.lead ?? null;

  return (
    <>
      {facts.length > 0 && (
        <section className="card pad left-teal">
          <div className="strip">
            {facts.map((f) => (
              <div className="fact" key={f.label}>
                <div className="k">{f.label}</div>
                <div className={`v${f.missing ? " gone" : ""}`} title={f.value}>
                  {f.value}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="stepper">
        {steps.map((s, i) => {
          const reached = s.state !== "todo";
          return (
            <button
              key={s.stage.key}
              type="button"
              className={`st ${s.state}${i === stepIdx ? " sel" : ""}`}
              disabled={!reached}
              onClick={() => reached && onStep(i)}
              title={reached ? s.stage.label : `${s.stage.label} hasn't started yet`}
            >
              <span className="n">
                <span className="c">
                  {s.state === "done" ? <Check style={{ width: 12, height: 12 }} /> : i + 1}
                </span>
                <span className="truncate">{s.stage.label}</span>
              </span>
              <span className="s truncate">{stepCaption(s)}</span>
              <span className="bar">
                <i style={{ width: `${Math.round(s.progress * 100)}%` }} />
              </span>
            </button>
          );
        })}
      </div>

      {step && (
        <section className="snap">
          <div className="snap-h">
            {step.items.length > 1 ? (
              <div className="snap-tabs">
                {step.items.map((it) => (
                  <button
                    key={it.itemId}
                    type="button"
                    className={it.itemId === snap?.itemId ? "on" : ""}
                    onClick={() => onSnap(it.itemId)}
                  >
                    {it.isCompleted && <Check style={{ width: 11, height: 11 }} />}
                    {snapTabLabel(step.items, it)}
                  </button>
                ))}
              </div>
            ) : (
              <b className="small">{snap?.boardName || step.stage.label}</b>
            )}

            <div className="row wrap" style={{ gap: 6, marginLeft: "auto" }}>
              {snap && (
                <span
                  className={`chip ${
                    snap.isCompleted ? "green" : snap.isStuck || snap.isProposedStuck ? "amber" : "blue"
                  }`}
                >
                  {snapStateLabel(snap)}
                </span>
              )}
              <span
                className="chip"
                title="Nothing on this panel writes to Monday — it is the record of what the tool saw"
              >
                <Eye style={{ width: 11, height: 11 }} /> Read-only
              </span>
              <OpenTool item={snap} />
            </div>
          </div>

          <div className="snap-page">
            <Snapshot step={step} item={snap} />
          </div>
        </section>
      )}

      {snap && (
        <section className="card pad">
          <div className="section-h">
            <b className="small">Notes from this stage</b>
            <span className="xs muted">{snap.boardName}</span>
          </div>
          <div className="notes">
            {snap.notes.trim() ? (
              <div className="note">{snap.notes.trim()}</div>
            ) : (
              <div className="note muted">
                <i>No notes on this board.</i>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function OpenTool({ item }: { item: DossierItem | null }) {
  const href = itemOpenHref(item);
  if (!item) return null;
  if (!href) {
    return (
      <span className="xs muted" title={`${item.boardName} has no page in the Command Center`}>
        No page for this board
      </span>
    );
  }
  return (
    <Link className="btn outline xs" to={href}>
      <ArrowUpRight style={{ width: 12, height: 12 }} />
      {item.isCompleted ? "Open read-only" : "Open the tool"}
    </Link>
  );
}

function Snapshot({ step, item }: { step: StageStep; item: DossierItem | null }) {
  if (!item) {
    return (
      <div className="card pad small muted">
        {step.state === "done"
          ? "This patient completed this stage before it was tracked on its own board — there is no record to show."
          : "Nothing here yet — the tool opens once the patient reaches this step."}
      </div>
    );
  }

  const sections = buildStageDetail(item.boardId, item.cols);

  return (
    <>
      <div className="snap-tool">
        {item.boardName} <span className="muted">· {item.groupTitle}</span>
      </div>

      {sections.length === 0 && (
        <div className="card pad small muted">
          {hasStageDetail(item.boardId)
            ? "Nothing has been filled in on this board yet."
            : "No read-only view is mapped for this board — open it on Monday."}
        </div>
      )}

      {sections.map((s) => (
        <section className="card snapcard" key={s.title}>
          <div className="snap-ct">{s.title}</div>
          <div className="rogrid">
            {s.fields.map((f) => (
              <div className={`rof${f.lead ? " lead" : ""}`} key={f.col}>
                <div className="k">{f.label}</div>
                <div className="v">{f.value}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
