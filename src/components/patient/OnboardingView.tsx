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
 *
 * ⚠️ **From 2026-09-21 the panel is the REAL TOOL** (§5.39c) — `StagePanelEmbed`
 * renders the stage's own component read-only, which is Brandon's spec and what
 * his mockup's "Stand-in" banner stood in for. Three of the thirteen tools have
 * no embeddable component yet (DVS and the two Intake tools live inline in
 * their pages; Auth Denied is deliberately unbuilt), and those fall back to the
 * `buildStageDetail` cards this view has always drawn — so nothing was removed,
 * only added under it.
 *
 * ⚠️ **The Open link stays** (Josh, 2026-09-21: *"add the per page pannels he
 * has but leave the link to open them"*), and now aims at the SELECTED
 * sub-stage: a manager reading the Confirm Receipt panel who presses Open
 * expects Confirm Receipt, not the board's default tool.
 */
import { ArrowUpRight, Check, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import type { DossierItem, PatientDossier } from "@/lib/commsHub/dossier";
import { buildStageDetail, hasStageDetail } from "@/lib/commsHub/stageDetail";
import { infoFacts, itemOpenHref, snapStateLabel, snapTabLabel, stepCaption, subStageOpenHref, type StageStep } from "@/lib/patient/patientScreen";
import { defaultSubStage, subStagesFor, type SubStageStep } from "@/lib/patient/stagePanels";
import { StagePanelEmbed, StagePanelUnavailable } from "@/components/patient/StagePanelEmbed";

interface Props {
  dossier: PatientDossier;
  steps: StageStep[];
  stepIdx: number;
  onStep: (i: number) => void;
  snapId: string;
  onSnap: (itemId: string) => void;
  /** Which sub-stage tool the panel shows — "" means the default. */
  toolKey: string;
  onTool: (key: string) => void;
}

export function OnboardingView({ dossier, steps, stepIdx, onStep, snapId, onSnap, toolKey, onTool }: Props) {
  const facts = infoFacts(dossier);
  const step = steps[stepIdx];
  const snap = step?.items.find((i) => i.itemId === snapId) ?? step?.lead ?? null;

  // The record's own sub-stages. `[]` for a board with no embeddable tools, in
  // which case everything below degrades to what this view drew before.
  const subs = subStagesFor(snap);
  // ⚠️ A URL naming a sub-stage the patient never reached falls back rather than
  // rendering an empty tool — the same rule the stepper uses for a `step=` past
  // the current stage.
  const wanted = subs.find((t) => t.key === toolKey && t.reached);
  const tool = wanted ?? subs.find((t) => t.key === defaultSubStage(subs)) ?? null;

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
              <OpenTool item={snap} tool={tool} />
            </div>
          </div>

          {subs.length > 1 && (
            <div className="tool-tabs">
              {subs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`${t.key === tool?.key ? "on" : ""}${t.reached ? "" : " off"}`}
                  disabled={!t.reached}
                  onClick={() => t.reached && onTool(t.key)}
                  title={
                    t.reached
                      ? t.current
                        ? "Where the patient is now"
                        : `The ${t.tool} tool as this record has it`
                      : `${t.tool} — the patient never reached this step`
                  }
                >
                  {t.label}
                  {t.current && <i className="dot" />}
                </button>
              ))}
            </div>
          )}

          <div className="snap-page">
            <Snapshot step={step} item={snap} tool={tool} />
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

/**
 * ⚠️ **Kept, deliberately** — the embedded panel is read-only, so the link is
 * the only route to the tool a rep can actually work in. It aims at the SELECTED
 * sub-stage where there is one, falling back to the board's default; a
 * sub-stage with no page (Auth Denied) is plain text rather than a dead link.
 */
/**
 * ⚠️ **The ten tools with an embeddable panel** — mirrors `StagePanelEmbed`'s
 * own `panelFor`, and is the one thing that decides whether this view draws the
 * real tool or falls back to the `buildStageDetail` cards. A pair listed here
 * with no case in `panelFor` renders an empty panel and no cards, which is the
 * one outcome that looks like a broken screen rather than a missing feature —
 * `stagePanelEmbed.test.ts` fails the build when the two disagree.
 */
const PANELLED = new Set([
  "18406060017:Evaluate MN",
  "18406060017:Send Request",
  "18406060017:Confirm Receipt",
  "18406060017:Chase Clinicals",
  "18406060017:Doctor Appointment",
  "18410601299:Benefits / SoS",
  "18410601299:Submit Auth.",
  "18410601299:Auth. Outstanding",
  "18410804557:Welcome Call",
  "18410804557:Review Profile",
]);

/** ⚠️ Medical Evaluation's five tools share ONE item, so a column a later
 *  sub-stage overwrote reads as though it always said that. Said here rather
 *  than implied. */
const SUB_STAGE_CAVEAT =
  " All this board's steps share one record, so a field a later step changed shows its latest value.";

function OpenTool({ item, tool }: { item: DossierItem | null; tool: SubStageStep | null }) {
  const href = (tool ? subStageOpenHref(item, tool.route) : null) ?? itemOpenHref(item);
  if (!item) return null;
  if (!href) {
    return (
      <span className="xs muted" title={`${tool?.tool ?? item.boardName} has no page in the Command Center`}>
        No page for {tool ? tool.tool : "this board"}
      </span>
    );
  }
  return (
    <Link className="btn outline xs" to={href}>
      <ArrowUpRight style={{ width: 12, height: 12 }} />
      {item.isCompleted ? "Open read-only" : `Open ${tool ? tool.tool : "the tool"}`}
    </Link>
  );
}

function Snapshot({ step, item, tool }: { step: StageStep; item: DossierItem | null; tool: SubStageStep | null }) {
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
  const embeddable = tool !== null && PANELLED.has(`${item.boardId}:${tool.key}`);

  return (
    <>
      <div className="snap-tool">
        {tool ? (
          <>
            {tool.tool} <span className="muted">· {item.boardName}</span>
          </>
        ) : (
          <>
            {item.boardName} <span className="muted">· {item.groupTitle}</span>
          </>
        )}
      </div>

      {/* ⚠️ **What the numbers MEAN, said out loud.** A completed board item is
          frozen (§5.38), so its columns are the values the patient left with; a
          live one is current. Brandon's spec stamps exactly this distinction,
          and his handoff allows the second: *"until [a snapshot store] exists,
          show the current columns and say so."* */}
      <div className={`snap-stamp ${item.isCompleted ? "done" : "live"}`}>
        {item.isCompleted
          ? `Snapshot — the values on this record when the patient left ${item.boardName}.`
          : tool?.current
            ? "Live — the patient is here now, so these are today's values."
            : `Live record — these are ${item.boardName}'s values today, not the ones this step was left with.`}
        {tool && !item.isCompleted && SUB_STAGE_CAVEAT}
      </div>

      {embeddable && tool && <StagePanelEmbed item={item} subStage={tool.key} />}
      {tool && !embeddable && <StagePanelUnavailable tool={tool.tool} />}

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
