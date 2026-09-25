/**
 * The browser half of the Communications inbox — "the Unresolved queue"
 * (COMMS_INBOX_PLAN.md; Brandon + Katie's v2, 2026-09-22; Josh's answers,
 * 2026-09-23).
 *
 * ⚠️ Almost every RULE lives on the gateway (`services/monday-gateway/
 * commsInboxRules.mjs`): what opens an item, the weekday-only wait clock, the
 * suggestion, the compare-and-set resolve. The browser only shows what it is
 * given — a second copy of the wait clock here would buy nothing but a mirror
 * to drift (CLAUDE.md §5.7). What lives here is what only the browser does:
 *
 *  · the wire types;
 *  · formatting a wait the gateway already counted;
 *  · `commsNoteLine` — the line a resolve note becomes when it is copied into
 *    the patient's Monday notes, which the browser writes (only the resolver's
 *    browser can stamp the right initials, plan §5.3).
 *
 * The four constants mirrored below are pinned against the gateway's by
 * `services/monday-gateway/inboxParity.test.mjs`.
 */
import { INTAKE_BLOCK_END, INTAKE_BLOCK_START } from "@/lib/welcomeCall/callIntake";

/* ── mirrored constants (parity-tested against the gateway) ─────────────── */

export type ResolveHow = "called" | "texted" | "no_action" | "left_vm";
export const HOW_LABEL: Record<ResolveHow, string> = {
  called: "Called",
  texted: "Texted",
  no_action: "No action needed",
  left_vm: "Left voicemail",
};
/** The server takes an Undo only inside this window. */
export const UNDO_WINDOW_MS = 15 * 60_000;
/** A Monday copy later than this says when the resolve happened (plan §5.4). */
export const LATE_COPY_AFTER_MS = 15 * 60_000;
/** The inline note's cap (plan §5.9). */
export const NOTE_MAX = 2000;
/** Over this many COUNTED hours an item is "Over 24h". */
export const OVER_AFTER_MS = 24 * 3600_000;

/** The stage label the Monday copy is stamped with — `[…] Communications: …`. */
export const COMMS_NOTE_STAGE = "Communications";

/* ── wire types ─────────────────────────────────────────────────────────── */

export type InboxKind = "text" | "missed" | "voicemail";
export type StagePill =
  | "Intake"
  | "Medical Necessity"
  | "Insurance"
  | "Welcome Call"
  | "Subscription"
  | "Inactive"
  | "Claims"
  | "Unmatched";

/**
 * The list's stage filter, in the order the menu offers it: the pipeline, then
 * the stages a patient is in after or outside it. `stageFilter.test.ts` holds
 * this to the gateway's `STAGE_PILLS` — which is what the filter is checked
 * against there (an unknown value is ignored) — MINUS "Claims" (Josh,
 * 2026-09-25): Secondary Claims is only ever a patient's pill when they have
 * no later record, and a menu entry for it confused more than it filtered.
 * The ROW pill keeps the value, which is why `StagePill` keeps the member.
 */
export const STAGE_FILTERS: readonly StagePill[] = [
  "Intake",
  "Medical Necessity",
  "Insurance",
  "Welcome Call",
  "Subscription",
  "Inactive",
  "Unmatched",
];

export interface InboxResolution {
  resolutionId: string;
  how: ResolveHow;
  label: string;
  by: string;
  at: number;
  note: string;
  coversThrough: number;
  mirrored: boolean;
}

export interface InboxSuggestion {
  how: "called" | "texted";
  at: number;
  by: string;
}

/** One list row, as `/comms/inbox` returns it. */
export interface InboxRow {
  /** Opaque: `p:<board>:<item>` or `n:<hmac>`. Never a phone number. */
  key: string;
  name: string;
  stage: StagePill;
  boardId: number | null;
  itemId: string | null;
  numbers: { hmac: string; last4: string }[];
  open: boolean;
  openedBy: { at: number; kind: InboxKind } | null;
  /** COUNTED wait — weekdays only, Eastern. The gateway's number, shown as is. */
  waitMs: number;
  over: boolean;
  reopened: boolean;
  previewKind: InboxKind | "";
  preview: string;
  lastInbound: { at: number; kind: InboxKind; preview: string } | null;
  lastResolution: InboxResolution | null;
  suggestion: InboxSuggestion | null;
  attempts: { resolutionId: string; by: string; at: number }[];
  stickyWaitMs: number;
  lastAt: number;
}

export interface InboxList {
  rows: InboxRow[];
  counts: { open: number; over: number };
  total: number;
  badge: { open: number; over: number };
  computedAt: number;
  epoch: number;
}

export interface ItemState {
  open: boolean;
  openedBy: { at: number; kind: InboxKind } | null;
  openCount: number;
  waitMs: number;
  over: boolean;
  reopened: boolean;
  lastInbound: { at: number; kind: InboxKind; preview: string } | null;
  previewKind: InboxKind | "";
  preview: string;
  lastResolution: InboxResolution | null;
  suggestion: InboxSuggestion | null;
  attempts: { resolutionId: string; by: string; at: number }[];
  stickyWaitMs: number;
  lastAt: number;
  /** The newest inbound event still open — what a resolve covers up to. */
  newestOpenAt: number | null;
}

export interface TimelineAttachment {
  id: string;
  contentType: string;
  uri: string;
  /** The photo is in our archive (§5.47c) — play it from there. */
  archived?: boolean;
}

export type TimelineEntry =
  | {
      type: "text";
      id: string;
      dir: "in" | "out";
      at: number;
      last4: string;
      body: string;
      status: string;
      deliveryError: string;
      attachments: TimelineAttachment[];
      sentBy: string;
      /** Laid over from the live thread (§4.6) — not yet in the archive. */
      live?: boolean;
    }
  | {
      type: "call";
      id: string;
      dir: "in" | "out";
      at: number;
      last4: string;
      durationSec: number;
      result: string;
      connected: boolean;
      missed: boolean;
      blocked: boolean;
      /** An inbound call answered in the BROWSER, which RingCentral logged as a
       *  single Outbound record toward the caller (measured 2026-09-25 — Josh's
       *  own test call). The gateway joins the call log to its own telephony
       *  webhook registry (`call_events`) to say so; `dir` stays "out" because
       *  that is what the record is, and the WORDING and icon flip on this. */
      pickedUp?: boolean;
      audioState: string;
      dialedBy: string;
      /** RingCentral's own recording uri, for a call our archive has not got yet. */
      recordingUri: string;
      voicemail: {
        id: string;
        at: number;
        durationSec: number;
        transcript: string;
        audioState: string;
        audioUri: string;
      } | null;
    }
  | {
      type: "voicemail";
      id: string;
      dir: "in" | "out";
      at: number;
      last4: string;
      durationSec: number;
      transcript: string;
      audioState: string;
      audioUri: string;
    }
  | {
      type: "attempt";
      resolutionId: string;
      how: "left_vm";
      label: string;
      by: string;
      at: number;
      linkedCallId: string | null;
      linkedCallAudio: string | null;
    }
  | ({ type: "resolution" } & InboxResolution);

export interface ItemNumber {
  hmac: string;
  last4: string;
  /** The full number — resolved on OPEN, never listed (plan §4.8). */
  e164: string | null;
}

export interface InboxItem {
  key: string;
  name: string;
  stage: StagePill;
  boardId: number | null;
  itemId: string | null;
  numbers: ItemNumber[];
  state: ItemState;
  timeline: TimelineEntry[];
  epoch: number;
  now: number;
}

/* ── formatting ─────────────────────────────────────────────────────────── */

/**
 * "12m" · "3h 12m" · "2d 4h" — the mockup's `ibFmtAgo`, over the gateway's
 * COUNTED milliseconds. A "day" here is 24 counted hours, i.e. a weekday.
 */
export function formatWait(ms: number): string {
  const m = Math.max(0, Math.round((Number(ms) || 0) / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

const ET_TIME = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const ET_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
const ET_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

/** "Sep 16 · 3:10 PM", Eastern — every time on these boards is Eastern (§5.15). */
export function formatWhen(at: number): string {
  if (!Number.isFinite(at)) return "";
  const d = new Date(at);
  return `${ET_DAY.format(d)} · ${ET_TIME.format(d)}`;
}

/** "3:10 PM" today, "Sep 16" otherwise — the suggestion's `<em>` and a log row's time. */
export function formatShort(at: number, now: number = Date.now()): string {
  if (!Number.isFinite(at)) return "";
  const d = new Date(at);
  return ET_KEY.format(d) === ET_KEY.format(new Date(now)) ? ET_TIME.format(d) : ET_DAY.format(d);
}

/** The first name of an email, for "✓ Called · katie". */
export function whoShort(email: string): string {
  const local = String(email || "").split("@")[0] || "";
  if (!local) return "";
  const first = local.split(/[._-]/)[0] || local;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

/* ── the Monday copy ────────────────────────────────────────────────────── */

/**
 * The text of a resolve note's copy in the patient's Monday notes — the body
 * `appendNoteToRecord` stamps into `[Sep 23, 2026, 2:10 PM] Communications: …`.
 *
 *     Called — told her it ships Friday
 *     Called (Sep 23, 2:10 PM) — told her it ships Friday      ← copied late
 *
 * ⚠️⚠️ A COMMS NOTE MUST NEVER READ AS A STAGE'S OWN STRUCTURED LINE (plan
 * §5.5). Two of the columns this lands in are PARSED:
 *  · Medical Evaluation's notes are Doctor Appointments' attempt COUNTER — a
 *    line shaped `… · <Phone call|Text message|Email> — <outcome>` counts as an
 *    attempt. So every " · " is rewritten: with it gone the line cannot split
 *    into the segments the parser reads. (The reset markers are anchored at
 *    their source — `apptOutreach.isResetLine` — so they cannot fire here.)
 *  · Welcome Call's notes carry the `--- WC INTAKE v1 ---` block, and its
 *    parser reads the LAST start marker. A note carrying one would hide the
 *    real block, so both markers are stripped — the rule `callIntake` itself
 *    applies to caretaker notes.
 * And newlines go, so no part of the note can begin a line of its own — which
 * is what a `[Proposed Stuck` or `[Returned to queue` tag would need.
 * `rules.test.ts` proves all four against the real parsers.
 *
 * @param resolvedAt  when the rep resolved (ms)
 * @param now         when the copy is being written (ms)
 */
export function commsNoteLine({
  how,
  note,
  resolvedAt,
  now = Date.now(),
}: {
  how: ResolveHow;
  note: string;
  resolvedAt: number;
  now?: number;
}): string {
  const label = HOW_LABEL[how] ?? "Resolved";
  const clean = sanitizeNote(note);
  const late =
    Number.isFinite(resolvedAt) && now - resolvedAt > LATE_COPY_AFTER_MS
      ? ` (${ET_DAY.format(new Date(resolvedAt))}, ${ET_TIME.format(new Date(resolvedAt))})`
      : "";
  return clean ? `${label}${late} — ${clean}` : `${label}${late}`;
}

/** One line, no separators a parser reads, no intake markers, capped. */
export function sanitizeNote(note: string): string {
  let s = String(note ?? "").replace(/\r?\n+/g, " / ");
  s = s.replace(/\s+/g, " ");
  // The intake markers, whatever case — stripped AFTER the whitespace collapse,
  // so a double space cannot smuggle one past, then collapsed again.
  for (const marker of [INTAKE_BLOCK_START, INTAKE_BLOCK_END]) {
    s = s.replace(new RegExp(escapeRe(marker), "gi"), " ");
  }
  s = s.replace(/\s*·\s*/g, " - ");
  return s.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * What an item looks like from the outside — enough to notice that its list
 * row and the open item disagree (a new message, a resolution, an attempt).
 * The same fields on both: the list row and the item's state come from one
 * gateway rule.
 */
export function inboxStateSig(s: {
  lastAt: number;
  open: boolean;
  lastResolution: { resolutionId: string } | null;
  attempts: unknown[];
}): string {
  return [s.lastAt, s.open, s.lastResolution?.resolutionId ?? "", s.attempts.length].join("|");
}

/** What opened an item, in words. */
export const KIND_LABEL: Record<InboxKind, string> = {
  text: "Text",
  missed: "Missed call",
  voicemail: "Voicemail",
};

/**
 * The name a row or an item shows. An unmatched caller is *Unknown caller
 * ···1234* — the list never holds a full number (plan §4.8); the RingCentral
 * caller-ID name is deliberately not stored either.
 */
export function rowName(r: { name: string; numbers: { last4: string }[] }): string {
  const { name, tail } = rowNameParts(r);
  return tail ? `${name} ${tail}` : name;
}

/**
 * The same name in two parts, so a narrow row can truncate the WORDS and keep
 * the digits: for an unknown caller the last four are the only thing that
 * tells two rows apart, and an ellipsis is exactly what would eat them.
 */
export function rowNameParts(r: { name: string; numbers: { last4: string }[] }): { name: string; tail: string } {
  if (r.name) return { name: r.name, tail: "" };
  const last4 = r.numbers.find((n) => n.last4)?.last4;
  return { name: "Unknown caller", tail: last4 ? `···${last4}` : "" };
}

/* ── keys ───────────────────────────────────────────────────────────────── */

/** Is this key an unmatched number (vs a patient's record)? */
export function isUnmatchedKey(key: string): boolean {
  return /^n:[0-9a-f]{64}$/.test(String(key || ""));
}
