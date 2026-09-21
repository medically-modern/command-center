/**
 * The patient screen's Recent notes strip (§5.39c3) — the notes column of the
 * board the patient is on now, newest first.
 *
 * Brandon's handoff: *"Under both tabs: Recent notes — the notes column of the
 * board the patient is currently on (Subscription board notes once subscribed),
 * newest first, with an All notes expander and an add-a-note box."*
 *
 * ⚠️ **This is NOT the Onboarding view's "Notes from this stage" card.** That
 * one is per SNAPSHOT: it shows whichever historical record the stepper has
 * open, in the main column, read-only. This one is per PATIENT: always the live
 * board, beside the thread, writable — which is the whole reason it sits under
 * both tabs rather than inside either.
 *
 * ⚠️⚠️ **A BLOCK THAT DOES NOT MATCH THE STAMP IS RENDERED VERBATIM, NEVER
 * DROPPED.** Seven boards, years of writers and two hand-migrated columns (§10)
 * have put every shape imaginable in these columns — Doctor Appointments'
 * attempt lines are `8/3/26, 1:38 PM · Phone call — No answer · … —JH`, the
 * bulk-import stamps are `=== Imported from … ===`, and plenty predate
 * `noteStamp` entirely. Parsing is an enhancement that pulls the author and the
 * time onto their own line; failing to parse must cost the formatting and never
 * the note. Same rule as §5.20's `networkLabel`, which prints an answer it does
 * not recognise rather than substituting one of ours.
 */

export interface NoteEntry {
  /** "Jul 28, 2026, 2:33 PM" — as the board holds it, never re-formatted. */
  when: string;
  /** The stage label the line was stamped with, e.g. "Chase Clinicals". */
  stage: string;
  /** The rep's initials. */
  who: string;
  /** Everything else — the note itself, or the whole block when unparsed. */
  text: string;
  /** False when the stamp did not match and `text` is the raw block. */
  parsed: boolean;
}

/** `[when] Stage: text —XX` — every part after the timestamp is optional.
 *
 * ⚠️ **The brackets must hold a YEAR, not just anything.** `noteTimestamp`
 * always writes one ("Jul 28, 2026, 2:33 PM"), and without that requirement a
 * note whose own body opens a line with `[see attached]` reads as a second
 * stamped entry — so one note is torn into two, each missing half its text.
 * Caught by its own test rather than in production.
 */
const STAMP = /^\[([^\]]*\d{4}[^\]]*)\]\s*([\s\S]*)$/;
/** A stage label is short and colon-terminated; a body with a colon is not. */
const STAGE = /^([A-Za-z][A-Za-z0-9 .&/'-]{0,34}):\s*([\s\S]*)$/;
/** Trailing "—XX" or "-XX", the `noteStamp` suffix. */
const INITIALS = /[—-]\s*([A-Za-z]{1,4})\s*$/;

/**
 * ⚠️ **Blocks are blank-line separated, because `appendNoteEntry` joins with
 * `\n\n`** — but a single-newline run of stamped lines is split too. Several
 * older writers appended with one newline, and treating that run as ONE note
 * puts a month of history in a single entry: not wrong, exactly, but it defeats
 * a strip whose whole job is to show the last three things that happened.
 */
function blocks(raw: string): string[] {
  const out: string[] = [];
  for (const chunk of raw.split(/\n\s*\n/)) {
    const lines = chunk.split("\n");
    const live = lines.filter((l) => l.trim());
    // Only split a run where EVERY line opens a real stamp — a bare "[" is not
    // enough, or a note whose body starts a line with one is torn in half.
    const stamped = live.filter((l) => STAMP.test(l.trim()));
    if (live.length > 1 && stamped.length === live.length) {
      for (const l of live) out.push(l.trim());
    } else if (chunk.trim()) {
      out.push(chunk.trim());
    }
  }
  return out;
}

function parseBlock(block: string): NoteEntry {
  const m = STAMP.exec(block);
  if (!m) return { when: "", stage: "", who: "", text: block, parsed: false };

  let rest = m[2].trim();
  let who = "";
  const ini = INITIALS.exec(rest);
  if (ini) {
    who = ini[1];
    rest = rest.slice(0, ini.index).trimEnd();
  }

  let stage = "";
  const st = STAGE.exec(rest);
  if (st) {
    stage = st[1].trim();
    rest = st[2].trim();
  }

  return { when: m[1].trim(), stage, who, text: rest, parsed: true };
}

/**
 * Every entry in a notes column, **newest first**.
 *
 * ⚠️ The log APPENDS, so the newest line is LAST in the blob and the list has
 * to be reversed. A strip that showed the first three notes would show the
 * oldest three — and on a patient with any history at all that is indefinitely
 * stale while looking perfectly live.
 */
export function noteEntries(raw: string | undefined): NoteEntry[] {
  const body = (raw ?? "").trim();
  if (!body) return [];
  return blocks(body).map(parseBlock).reverse();
}

/**
 * The stage a new note is stamped with.
 *
 * ⚠️ **The SUB-STAGE where the board has one** — "Chase Clinicals", not
 * "Medical Evaluation". Several roles share one notes column and the label is
 * what makes a line traceable afterwards (§9). Shared with the Comms Hub
 * composer so the two cannot stamp the same column differently.
 */
export function noteStageLabel(item: { stageAdvancerText: string; boardName: string }): string {
  return item.stageAdvancerText || item.boardName;
}
