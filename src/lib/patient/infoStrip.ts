/**
 * The patient screen's Onboarding info strip — Brandon's EIGHT facts (§5.46f).
 *
 * Josh, 2026-09-22: *"keep going, do the info strip next / check everything
 * again to brandons mockup / its been throughly thought out"*, under the
 * standing rule for this list — *"he built this thinking everything he was
 * adding was already available in the command center, he just wanted to change
 * the ui"*. So these are gaps to close, not proposals to weigh.
 *
 * His handoff names them exactly: *"Intake date `date_mm1wf43j` with the days
 * since, calculated · Stage start date — the active board's stage start
 * `date_mm1w6jeq` (Send Off: the item's creation date) with the days in stage,
 * calculated (red when over 14) · Request type `color_mm1w1978` · Primary
 * insurance · Pump path `color_mm1w5xn1` · CGM path `color_mm1w7e5q` ·
 * Referral source `color_mm1w5wxr` · Stage — the macro stage and current
 * sub-step, a Stuck chip when the board group is Stuck, "Web-form lead" for
 * leads, and "Onboarding complete <date>" once the patient is subscribed."*
 *
 * ⚠️⚠️ **THE IDS HE NAMES ARE PROFILE SEND OFF'S AND MEDICAL EVALUATION'S, AND
 * TWO OF THEM DO NOT EXIST ON THE OTHER BOARDS.** Read live 2026-09-22:
 * **CGM Coverage Path** is `color_mm1w7e5q` on Send Off and ME, **`color_mm2w8q`
 * on Insurance** and **`color_mm2wsam4` on Welcome Call**; **Insulin Pump
 * Coverage Path** is `color_mm1w5xn1` everywhere except **Welcome Call, which
 * is `color_mm2xtn41`**. Using his ids board-wide would read BLANK on Insurance
 * and Welcome Call — silently, with nothing erroring (§5.11's trap) — for
 * exactly the two stages where those columns are most filled in (196/200 and
 * 171/200 on Insurance; 155/200 and 161/200 on Welcome Call). §5.30 already
 * records the same divergence one screen over.
 *
 * ⚠️ **Owned HERE rather than by widening `stageDetail`'s maps.** That map is
 * also what the Communications hub's dossier pane renders (§5.28), so editing
 * it to fix this screen would quietly change that one — the §5.46b two-readers
 * hazard. Same call as §5.46c · §5.46d · §5.46e.
 */
import type { DossierItem, PatientDossier } from "@/lib/commsHub/dossier";
import { PIPELINE_ORDER } from "@/lib/commsHub/pipelineOrder";
import { etToday } from "@/lib/masheke/etDate";
import { MACRO_STAGES, buildStages } from "@/lib/patient/patientScreen";

const DTC_INTAKE = 18392794310;
const PROFILE_SEND_OFF = 18406352652;
const MEDICAL_EVALUATION = 18406060017;
const INSURANCE = 18410601299;
const WELCOME_CALL = 18410804557;

export interface InfoStripCols {
  intakeDate: string | null;
  /** ⚠️ `null` means the board has no stage-start column, so the strip falls
   *  back to the ITEM'S CREATION DATE — which is Brandon's own rule for
   *  Profile Send Off, the one worked board without one. */
  stageStart: string | null;
  requestType: string | null;
  primaryInsurance: string | null;
  /** Profile Send Off only — the column the intake FORM writes. */
  generalInsurance: string | null;
  pumpPath: string | null;
  cgmPath: string | null;
  referralSource: string | null;
  /** Profile Send Off only — non-blank iff the patient touched the web form. */
  dropOffStep: string | null;
}

const none: InfoStripCols = {
  intakeDate: null,
  stageStart: null,
  requestType: null,
  primaryInsurance: null,
  generalInsurance: null,
  pumpPath: null,
  cgmPath: null,
  referralSource: null,
  dropOffStep: null,
};

/**
 * Per board, because the ids are not shared (see the header).
 *
 * ⚠️ **DTC Intake carries only what its titles name UNAMBIGUOUSLY.** It has no
 * Request Type at all and THREE candidate primary-insurance columns
 * (`color_mm164qr0` · `color_mm1gdfjy` "Final" · `color_mkxkpx71` "(Payer
 * Name)"), so both stay null rather than being guessed — §5.28's rule for that
 * board, where a guessed id yields a permanently blank row instead of an error.
 * Those two facts fall through to a later record for any patient who has one.
 */
export const INFO_COL: Record<number, InfoStripCols> = {
  [DTC_INTAKE]: {
    ...none,
    intakeDate: "date_mm1ftf0f",
    stageStart: "date_mkzc4p2m",
    pumpPath: "color_mkzb9b8m",
    cgmPath: "color_mm0c7433",
    referralSource: "color_mkywv02j",
  },
  [PROFILE_SEND_OFF]: {
    intakeDate: "date_mm1wf43j",
    stageStart: null, // no such column — Brandon: "Send Off: the item's creation date"
    requestType: "color_mm1w1978",
    primaryInsurance: "color_mm1xg10n",
    generalInsurance: "color_mm24ap4j",
    pumpPath: "color_mm1w5xn1",
    cgmPath: "color_mm1w7e5q",
    referralSource: "color_mm1w5wxr",
    dropOffStep: "color_mm5zv7q8",
  },
  [MEDICAL_EVALUATION]: {
    ...none,
    intakeDate: "date_mm1wf43j",
    stageStart: "date_mm1w6jeq",
    requestType: "color_mm1w1978",
    primaryInsurance: "color_mm1x157j",
    pumpPath: "color_mm1w5xn1",
    cgmPath: "color_mm1w7e5q",
    referralSource: "color_mm1w5wxr",
  },
  [INSURANCE]: {
    ...none,
    intakeDate: "date_mm1wf43j",
    stageStart: "date_mm1w6jeq",
    requestType: "color_mm1w1978",
    primaryInsurance: "color_mm1x157j",
    pumpPath: "color_mm1w5xn1",
    cgmPath: "color_mm2w8q",
    referralSource: "color_mm1w5wxr",
  },
  [WELCOME_CALL]: {
    ...none,
    intakeDate: "date_mm1wf43j",
    stageStart: "date_mm1w6jeq",
    requestType: "color_mm1w1978",
    primaryInsurance: "color_mm1x157j",
    pumpPath: "color_mm2xtn41",
    cgmPath: "color_mm2wsam4",
    referralSource: "color_mm1w5wxr",
  },
};

/**
 * What `dossierApi.dossierCols` must fetch for this board.
 *
 * ⚠️ Drop this out of that list and every fact reads blank on every patient,
 * with nothing erroring — the §5.11 trap, which is why
 * `infoStripWiring.test.ts` scans for the call.
 */
export function infoStripColumns(boardId: number): string[] {
  const c = INFO_COL[boardId];
  if (!c) return [];
  return Object.values(c).filter((id): id is string => !!id);
}

export interface StripFact {
  label: string;
  value: string;
  /** The quieter clause on the same line, in BRACKETS — "(4 days ago)".
   *  Brandon's `<span class="xs muted">` on the two date facts. */
  note?: string;
  /** The same span, DOT-led — "· Chase Clinicals". Brandon writes the Stage
   *  fact's sub-step and the onboarding-complete date that way, and the two
   *  separators are his, not a choice: a bracket reads as an aside about the
   *  value, a dot reads as the next part of it. */
  sub?: string;
  tone?: "warn" | "good";
  /** A chip after the value. Only the Stage fact has one. */
  chip?: { text: string; tone: "red" | "amber"; title: string };
  /** Nothing on the board answers this — rendered as a muted em dash. */
  missing?: boolean;
}

const rank = (boardId: number) => PIPELINE_ORDER.findIndex((b) => b.boardId === boardId);

/**
 * "2026-09-18T20:19:13Z" → "2026-09-18", in Eastern.
 *
 * ⚠️ This is the ONE date on the strip that may go through a `Date`: Monday's
 * `created_at` is a real UTC instant, unlike the naive wall-clock strings in
 * its date COLUMNS, which must never be parsed (§5.15). Same inversion §5.31e
 * records for a Calendly `start_time`.
 */
export function etDateOf(iso: string): string {
  const raw = (iso ?? "").trim();
  if (!raw) return "";
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(t));
}

/** "2026-09-26" → "9/26/2026"; anything else passes through verbatim. */
export function usDate(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((raw ?? "").trim());
  if (!m) return (raw ?? "").trim();
  return `${Number(m[2])}/${Number(m[3])}/${m[1]}`;
}

/**
 * Whole ET calendar days from `ymd` until today — negative once it has passed.
 *
 * ⚠️ Both sides are `YYYY-MM-DD` and the subtraction is done on a UTC midnight
 * built from the PARTS, never on a parsed board string (§5.15).
 */
export function daysSince(ymd: string, today: string = etToday()): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd ?? "").trim());
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!a || !b) return null;
  const at = Date.UTC(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const bt = Date.UTC(Number(b[1]), Number(b[2]) - 1, Number(b[3]));
  return Math.round((bt - at) / 86_400_000);
}

/** "today" · "3 days ago" · "in 2 days". Empty when the date is unreadable. */
export function agoText(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "today";
  if (days < 0) return `in ${Math.abs(days)} day${days === -1 ? "" : "s"}`;
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** The days-in-stage clause — a plain count, because it is always in the past. */
export function stageDaysText(days: number | null): string {
  if (days === null || days < 0) return "";
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** ⚠️ Brandon's threshold, and it is strictly GREATER than 14 — his own
 *  `j.daysInStage>14?'warn':''`. Fourteen days is not yet late. */
export const STAGE_DAYS_WARN = 14;

/**
 * The record every per-field lookup starts from.
 *
 * ⚠️ `dossier.active` is null for a patient whose only live record is in a
 * Stuck group — `pickActive` skips those by design — so the anchor falls back
 * to the furthest-along record that is not completed, and only then to the
 * furthest-along record at all. Without that, the whole strip goes blank for
 * exactly the patient a manager opened it to read.
 */
export function anchorItem(dossier: PatientDossier | null): DossierItem | null {
  const items = dossier?.items ?? [];
  if (!items.length) return null;
  if (dossier?.active) return dossier.active;
  const byRank = [...items].sort((a, b) => rank(b.boardId) - rank(a.boardId));
  return byRank.find((i) => !i.isCompleted) ?? byRank[0] ?? null;
}

/**
 * Read one fact across every record, furthest-along board first.
 *
 * ⚠️ **Not off the active record alone**, and that is Brandon's shape rather
 * than a widening: his strip reads a merged patient object, so a subscribed
 * patient — whose active record is the Subscription board, which carries none
 * of these columns — still shows their request type and coverage paths from
 * the Welcome Call record. Furthest-first means a value corrected on a later
 * board wins over the one it was copied from.
 */
function across(items: readonly DossierItem[], get: (c: InfoStripCols, it: DossierItem) => string): string {
  const byRank = [...items].sort((a, b) => rank(b.boardId) - rank(a.boardId));
  for (const it of byRank) {
    const cols = INFO_COL[it.boardId];
    if (!cols) continue;
    const v = get(cols, it).trim();
    if (v) return v;
  }
  return "";
}

const col = (it: DossierItem, id: string | null): string => (id ? (it.cols?.[id] ?? "") : "");

/**
 * Is this patient a web-form lead — Brandon's `mode === 'lead'`?
 *
 * ⚠️ **BOTH halves, because a New Form group is not evidence on its own.** The
 * 8/25 SNJ bulk import put ~1,697 rows into *New Form — Partial Leads* that
 * never touched the web form (§5.30); they are worked as referrals. Brandon
 * makes the same distinction (`webForm = !!so.dropOff || …`), and Drop-off Step
 * is the column that carries it (§5.24 · §5.30f's `isFormLead`).
 */
export function isWebFormLead(items: readonly DossierItem[]): boolean {
  return items.some(
    (it) =>
      it.boardId === PROFILE_SEND_OFF &&
      !it.isCompleted &&
      /new form/i.test(it.groupTitle) &&
      col(it, INFO_COL[PROFILE_SEND_OFF].dropOffStep).trim() !== "",
  );
}

/** The Stuck chip, or none. Named as §5.43 names them: a Stuck GROUP is out of
 *  the pipeline, a PROPOSAL is a manager decision nobody has made. */
function stuckChip(items: readonly DossierItem[]): StripFact["chip"] {
  if (items.some((i) => i.isStuck)) {
    return { text: "Stuck", tone: "red", title: "In a Stuck group — out of the pipeline until a manager moves them back" };
  }
  if (items.some((i) => i.isProposedStuck)) {
    return { text: "Stuck proposed", tone: "amber", title: "Stuck has been proposed and is waiting on a manager's decision" };
  }
  return undefined;
}

const SUBSCRIPTION_BOARD = 18407459988;

/**
 * ⚠️ The date is the Subscription row's creation — the moment onboarding
 * actually ended — with the Welcome Call record's stage start behind it, which
 * is Brandon's own fallback.
 */
function completionDate(items: DossierItem[]): string {
  const sub = items.find((i) => i.boardId === SUBSCRIPTION_BOARD);
  const wc = items.find((i) => i.boardId === WELCOME_CALL);
  const when = (sub ? etDateOf(sub.createdAt) : "") || (wc ? col(wc, INFO_COL[WELCOME_CALL].stageStart) : "");
  return when ? usDate(when) : "";
}

/**
 * When onboarding ended — "" until every stage is done, or when no record says.
 *
 * Brandon prints this date twice: on the strip's Stage fact ("Onboarding
 * complete 4/21/2026") and under the Onboarding half of the view toggle
 * ("Done 4/21/2026"). ⚠️ ONE reading for both, or the two disagree on one card.
 */
export function onboardingCompletedOn(dossier: PatientDossier | null): string {
  const items = dossier?.items ?? [];
  if (!items.length) return "";
  if (!buildStages(dossier).every((s) => s.state === "done")) return "";
  return completionDate(items);
}

/**
 * The eight facts, in Brandon's order.
 *
 * ⚠️ **A blank renders as an em dash and is MARKED missing, never as a zero or
 * an invented default** — missing and empty are different facts everywhere on
 * these boards (§5.31f · §5.31g), and a rep reading this strip on a call has to
 * be able to tell "nobody has answered that" from "the answer is none".
 */
export function infoStripFacts(
  dossier: PatientDossier | null,
  today: string = etToday(),
): StripFact[] {
  const items = dossier?.items ?? [];
  if (!items.length) return [];

  const anchor = anchorItem(dossier);
  const fact = (label: string, value: string, extra: Partial<StripFact> = {}): StripFact => ({
    label,
    value: value.trim() || "—",
    missing: !value.trim(),
    ...extra,
  });

  /* 1 · Intake date — copied across every board hop, so any record answers. */
  const intake = across(items, (c, it) => col(it, c.intakeDate));
  const intakeDays = daysSince(intake, today);

  /* 2 · Stage start — the ANCHOR record's, because the whole point of the fact
     is how long the patient has been where they are now. Profile Send Off has
     no such column, so it falls back to the item's creation date. */
  const anchorCols = anchor ? INFO_COL[anchor.boardId] : undefined;
  const stageStart = anchor
    ? col(anchor, anchorCols?.stageStart ?? null).trim() || etDateOf(anchor.createdAt)
    : "";
  const stageDays = daysSince(stageStart, today);

  /* 4 · Primary insurance. ⚠️ On Profile Send Off it falls back to GENERAL
     Insurance, which is the column the intake form writes and the one Stedi
     reads (§5.11 · §5.20): measured 2026-09-22, Primary is filled on 152/200
     intake rows and General on 194/200, so reading Primary alone shows an em
     dash for patients whose carrier is on the row one column over. It is also
     what puts "Cash Pay" (§5.48) on the strip. */
  const insurance = across(
    items,
    (c, it) => col(it, c.primaryInsurance) || col(it, c.generalInsurance),
  );

  /* 8 · Stage. */
  const steps = buildStages(dossier);
  const chip = stuckChip(items);
  const complete = steps.every((s) => s.state === "done");
  const liveIdx = steps.findIndex((s) => s.state === "now" || s.state === "stuck");
  const macro = liveIdx >= 0 ? MACRO_STAGES[liveIdx] : null;

  let stage: StripFact;
  if (isWebFormLead(items)) {
    stage = { label: "Stage", value: "Web-form lead", chip };
  } else if (complete) {
    stage = {
      label: "Stage",
      value: "Onboarding complete",
      tone: "good",
      sub: completionDate(items),
      chip,
    };
  } else {
    const sub = anchor?.stageAdvancerText.trim() || anchor?.groupTitle.trim() || "";
    stage = {
      label: "Stage",
      value: macro?.label || anchor?.boardName || "—",
      missing: !macro && !anchor,
      sub,
      chip,
    };
  }

  return [
    fact("Intake date", usDate(intake), { note: agoText(intakeDays) }),
    fact("Stage start date", usDate(stageStart), {
      note: stageDaysText(stageDays),
      tone: stageDays !== null && stageDays > STAGE_DAYS_WARN ? "warn" : undefined,
    }),
    fact("Request type", across(items, (c, it) => col(it, c.requestType))),
    fact("Primary insurance", insurance),
    fact("Pump path", across(items, (c, it) => col(it, c.pumpPath))),
    fact("CGM path", across(items, (c, it) => col(it, c.cgmPath))),
    fact("Referral source", across(items, (c, it) => col(it, c.referralSource))),
    stage,
  ];
}
