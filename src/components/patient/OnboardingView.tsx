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
 *
 * ⚠️⚠️ **AND SINCE 2026-09-25 THE LINK IS ROLE-GATED** (Josh, on Brandon's
 * "delete Open Final Profile Confirmation": *"people who are assigned the
 * ROLE of final profile confirmation should see it — people who arent
 * assigned that rols shouldnt see it and it should be the read only thing"*).
 * `mayWorkRoute` applies the §5.3 model to the door: a manager sees every
 * Open link, a processor only the ones for roles on their profile, and
 * everybody still gets the read-only embed below. ⚠️ Gated on the SIGNED-IN
 * person's resolved access (`useAccessContext().access`), never a borrowed
 * view's (§5.39g) — this is a door into a tool where a rep can act.
 */
import { Activity, AlertTriangle, ArrowUpRight, Check, ClipboardList, Eye } from "lucide-react";
import { Link } from "react-router-dom";
import type { DossierItem, PatientDossier } from "@/lib/commsHub/dossier";
import { buildStageDetail, hasStageDetail } from "@/lib/commsHub/stageDetail";
import { useAccessContext } from "@/components/AccessProvider";
import { mayWorkRoute } from "@/lib/roleView";
import {
  itemOpenHref,
  snapStamp,
  snapTabLabel,
  stageSubline,
  stepCaption,
  subStageOpenHref,
  type StageStep,
} from "@/lib/patient/patientScreen";
import { STAGE_DAYS_WARN, daysInStage, infoStripFacts } from "@/lib/patient/infoStrip";
import { noteEntries } from "@/lib/patient/recentNotes";
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
  /**
   * Drawn inside the Communications hub's right pane (COMMS_INBOX_PLAN.md §7).
   * Two things change, both because the pane is ~400–540px and a rep there is
   * mid-conversation:
   *   · the stage's call-detail cards come BEFORE the embedded tool, not after
   *     it — the tool is a whole read-only page, and the cards are the answer to
   *     "what matters on this call" (the job the dossier pane's stage detail
   *     did, §5.28);
   *   · the live record's "Notes from this stage" card is not drawn, because the
   *     pane's own writable notes, directly above, ARE that record's notes. A
   *     historical step's card still is.
   */
  embedded?: boolean;
}

export function OnboardingView({
  dossier,
  steps,
  stepIdx,
  onStep,
  snapId,
  onSnap,
  toolKey,
  onTool,
  embedded = false,
}: Props) {
  const facts = infoStripFacts(dossier);
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
  const stageNotes = noteEntries(snap?.notes);
  const stamp = snapStamp(snap, tool);
  /* His "N days here" chip, on the stage the patient is IN — the info strip's
     own Stage start count (`daysInStage`), so the two cannot disagree. */
  const here = step && (step.state === "now" || step.state === "stuck") ? daysInStage(dossier) : null;

  return (
    <>
      {/* Brandon's eight facts, four to a row (§5.46f). ⚠️ The `note` is his
          `<span class="xs muted">`, and a fact that has a VALUE wears it in
          brackets — "9/18/2026 (4 days ago)" — while a fact whose value IS the
          note (the Stage sub-step) does not. */}
      {facts.length > 0 && (
        <section className="card pad left-teal">
          <div className="strip">
            {facts.map((f) => (
              <div className="fact" key={f.label}>
                <div className="k">{f.label}</div>
                <div
                  className={`v${f.missing ? " gone" : ""}${f.tone ? ` ${f.tone}` : ""}`}
                  title={[f.value, f.note, f.sub].filter(Boolean).join(" · ")}
                >
                  {f.value}
                  {f.note && (
                    <span className="xs muted" style={{ marginLeft: 6 }}>
                      {f.missing ? f.note : `(${f.note})`}
                    </span>
                  )}
                  {f.sub && (
                    <span className="xs muted" style={{ marginLeft: 6 }}>
                      · {f.sub}
                    </span>
                  )}
                  {f.chip && (
                    <span className={`chip ${f.chip.tone} stuckchip`} title={f.chip.title}>
                      {f.chip.text}
                    </span>
                  )}
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
        <>
          {/* Brandon's stage heading (pixel-match Phase 2): the stage, how far
              it has got, and — on the stage the patient is in — how long they
              have been there, amber, red past a fortnight (§5.46f's rule). */}
          <div className="section-h stage-h">
            <div>
              <h2>{step.stage.label}</h2>
              <div className="xs muted">{stageSubline(step, subs.length, snap)}</div>
            </div>
            {here !== null && here >= 0 && (
              <span className={`chip ${here > STAGE_DAYS_WARN ? "red" : "amber"}`}>
                <AlertTriangle style={{ width: 11, height: 11 }} /> {here} day{here === 1 ? "" : "s"} here
              </span>
            )}
          </div>

          <section className="snap">
            <div className="snap-h">
              {/* His sub-step tabs, where our separate tool row used to be — a
                  check on a step the patient went through, a dot on the one
                  they are in, and a step never reached cannot be opened. */}
              {subs.length > 1 ? (
                <div className="segc snap-tabs" role="tablist" aria-label="Steps on this board">
                  {subs.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      role="tab"
                      aria-selected={t.key === tool?.key}
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
                      {t.passed && <Check style={{ width: 11, height: 11 }} />}
                      {t.label}
                      {t.current && <i className="dot" />}
                    </button>
                  ))}
                </div>
              ) : (
                <b className="small">{tool ? tool.tool : snap?.boardName || step.stage.label}</b>
              )}

              <div className="row wrap" style={{ gap: 6, marginLeft: "auto" }}>
                {stamp && (
                  <span className={`chip ${stamp.tone}`}>
                    {stamp.icon === "check" ? (
                      <Check style={{ width: 11, height: 11 }} />
                    ) : stamp.icon === "alert" ? (
                      <AlertTriangle style={{ width: 11, height: 11 }} />
                    ) : (
                      <Activity style={{ width: 11, height: 11 }} />
                    )}
                    {stamp.text}
                  </span>
                )}
                <span
                  className="chip grey"
                  title="Nothing on this panel writes to Monday — it is the record of what the tool saw"
                >
                  <Eye style={{ width: 11, height: 11 }} /> Read-only
                </span>
                <OpenTool item={snap} tool={tool} />
              </div>
            </div>

            {/* ⚠️ Not in his mockup, whose sample has one record per stage. Ours
                does not — a stage run twice, or two intake boards, is two
                records — so the record picker keeps a row of its own under the
                steps rather than disappearing (§5.42). */}
            {step.items.length > 1 && (
              <div className="snap-recs">
                {/* Josh, 2026-09-25: say it in the rep's words — two profiles
                    on one stage should never happen, and when it has, the row
                    must read as a flag, not as furniture. */}
                <span className="xs muted">
                  This patient has {step.items.length} profiles in this stage
                </span>
                <div className="segc snap-tabs" aria-label="Records on this stage">
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
              </div>
            )}

            <div className="snap-page">
              <Snapshot step={step} item={snap} tool={tool} detailFirst={embedded} />
            </div>
          </section>
        </>
      )}

      {snap && !(embedded && snap.itemId === dossier.active?.itemId) && (
        <section className="card pad">
          <div className="section-h">
            <b className="small">Notes from this stage</b>
            <span className="xs muted">{snap.boardName} · newest first</span>
          </div>
          {/* Brandon's card: one entry per note, newest first, the author and
              the time on their own line. ⚠️ The SAME parser the Recent notes
              strip uses (`noteEntries`), so a block that doesn't match the
              stamp is shown verbatim rather than dropped, and the two can
              never read one notes column differently. */}
          <div className="notes">
            {stageNotes.length ? (
              stageNotes.map((e, i) => (
                // Keyed by position: two identical notes are legitimate.
                <div className="note" key={i}>
                  {(e.when || e.who || e.stage) && (
                    <div className="who">{[e.who, e.stage, e.when].filter(Boolean).join(" · ")}</div>
                  )}
                  {e.text}
                </div>
              ))
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
  /* ⚠️ The SIGNED-IN person's resolved access, never a borrowed view's
     (§5.39g): the link is a door into a tool where a rep can act. */
  const { access } = useAccessContext();
  const href = (tool ? subStageOpenHref(item, tool.route) : null) ?? itemOpenHref(item);
  if (!item) return null;
  if (!href) {
    return (
      <span className="xs muted" title={`${tool?.tool ?? item.boardName} has no page in the Command Center`}>
        No page for {tool ? tool.tool : "this board"}
      </span>
    );
  }
  /* ⚠️ ROLE-GATED (Josh, 2026-09-25): only somebody assigned the tool's role
     — or a manager — gets the door; everybody else has the read-only embed
     below and nothing is offered that they cannot work. */
  if (!mayWorkRoute(access, href)) return null;
  /* His "Open <tool>". ⚠️ A finished record still opens in REVIEW MODE — the
     link carries `?completedStage=`, which disables the send there (§5.38) —
     so the label names the tool and the tooltip says what the page will be. */
  return (
    <Link
      className="btn outline xs"
      to={href}
      title={
        item.isCompleted
          ? "Opens in review mode — a finished record can't be advanced from there"
          : undefined
      }
    >
      <ArrowUpRight style={{ width: 12, height: 12 }} />
      Open {tool ? tool.tool : item.boardName}
    </Link>
  );
}

function Snapshot({
  step,
  item,
  tool,
  detailFirst = false,
}: {
  step: StageStep;
  item: DossierItem | null;
  tool: SubStageStep | null;
  /** The call-detail cards before the tool rather than after (embedded). */
  detailFirst?: boolean;
}) {
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
      {/* His "📋 <tool> · <patient>". */}
      <div className="snap-tool">
        <ClipboardList style={{ width: 13, height: 13 }} />
        {tool ? (
          <>
            {tool.tool} <span className="muted">· {item.name}</span>
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

      {!detailFirst && tool && <ToolPanel item={item} tool={tool} embeddable={embeddable} />}

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

      {detailFirst && tool && <ToolPanel item={item} tool={tool} embeddable={embeddable} />}
    </>
  );
}

/** The real stage tool, read-only — or the sentence saying it has no panel. */
function ToolPanel({ item, tool, embeddable }: { item: DossierItem; tool: SubStageStep; embeddable: boolean }) {
  return embeddable ? <StagePanelEmbed item={item} subStage={tool.key} /> : <StagePanelUnavailable tool={tool.tool} />;
}
