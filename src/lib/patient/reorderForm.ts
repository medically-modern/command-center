/**
 * The REORDER FORM — what the patient answered on the link we texted them.
 *
 * Josh, 2026-09-22, on the diff between Brandon's redesign handoff and what
 * `main` renders: *"fix the missing stuff, start with the reorder form
 * column"*, with the framing that governs every item on that list — *"he built
 * this thinking everything he was adding was already available in the command
 * center, he just wanted to change the ui"*. The reorder form was the clearest
 * case of it: **seven populated columns on the Subscription board, read by
 * nothing in the SPA.** His handoff names all seven and puts them in the fourth
 * column of the Orders tab's Upcoming order strip:
 *
 * > "and, in the fourth column, the **Reorder form** — what the patient
 * > answered on the link we texted: Order response chip (Confirmed / Delay /
 * > Pause / Cancel), Insurance response chip (Confirmed / Changed), 'submitted
 * > <timestamp>', an open-form link, the latest line of the change summary
 * > ('Order date changed from … to …', 'Insurance changed from …') and the
 * > patient's help message when there is one; before a response it shows 'No
 * > response yet' with Resend, and 'Not sent yet' with Send now before the link
 * > goes out."
 *
 * Everything in that paragraph is DISPLAY and is built. The two buttons are
 * not — see `REORDER_SEND_FROM_COMMAND_CENTER` below.
 *
 * ⚠️ **The column ids are verified against the live board** (2026-09-22), and
 * so are both status vocabularies: Patient Order Response `color_mm3kjykc` is
 * *Confirmed · Delay · Cancel · No Response · Pause* and Patient Insurance
 * Response `color_mm3k4z79` is *Confirmed · Changed · Cancel*, exactly as the
 * handoff says. Nothing here writes, so no label INDEX is needed — and an
 * unrecognised label renders verbatim rather than being dropped (§5.20's
 * `networkLabel` rule), because a vocabulary that grows announces itself to
 * nobody otherwise.
 */

/** Subscription board — the only board that carries a reorder form. */
const SUBSCRIPTION_BOARD_ID = 18407459988;

export const REORDER_COL = {
  /** The patient's own form URL — `https://reorder.medicallymodern.com?token=…`. */
  link: "text_mm3khve4",
  /** Already-formatted ET, e.g. `Sep 18, 2026, 2:00 PM ET`. */
  textSent: "text_mm3rzqks",
  orderResponse: "color_mm3kjykc",
  insuranceResponse: "color_mm3k4z79",
  /** Already-formatted ET, and it belongs to the LAST answer ever — see below. */
  respondedAt: "text_mm3kt9bs",
  /** A log, newest entry LAST: `[9/18/26, 2:02 PM] Patient CONFIRM:\n<lines>`. */
  changeSummary: "long_text_mm3k5y3n",
  helpMessage: "long_text_mm3xnb6k",
} as const;

const COLS = Object.values(REORDER_COL) as string[];

/**
 * The columns this rule needs, for a board's dossier read.
 *
 * ⚠️ **Additive to the dossier and invisible in the Comms Hub.** These ride
 * `dossierCols` beside `stageDetailColumns`, but `buildStageDetail` renders
 * from its own map only — so the pane a rep reads on a call is byte-identical
 * and this is seven more ids on a `column_values(ids:)` list that already runs.
 * Putting them in `stageDetail`'s SUBSCRIPTION map instead would have rendered
 * them there as a flat fact list, which is not what Brandon drew and is the
 * two-readers hazard §5.46b records for that map.
 */
export function reorderFormColumns(boardId: number): string[] {
  return boardId === SUBSCRIPTION_BOARD_ID ? [...COLS] : [];
}

export type ReorderState =
  /** A real answer to THIS cycle. */
  | "responded"
  /** The link is out and the patient has not answered it. */
  | "awaiting"
  /** No link on the row, so nothing has been sent. */
  | "not-sent";

export type ReorderForm = {
  state: ReorderState;
  link: string;
  textSent: string;
  orderResponse: string;
  insuranceResponse: string;
  /** The stamp on `respondedAt`, whatever cycle it belongs to. */
  answeredAt: string;
  /** The newest entry's change lines, joined — "the latest line". */
  latestChange: string;
  helpMessage: string;
};

/**
 * ⚠️⚠️ **"No Response" IS A RESET, NOT AN ANSWER — and the timestamp does not
 * reset with it.** Measured over the 300 most recent responders on the live
 * board (2026-09-22): 8 rows read `No Response` while still carrying a response
 * timestamp and a full change summary from a PREVIOUS cycle, and 88 more carry
 * a timestamp with the status column blank altogether (rows that predate it).
 * So the status column is the state of the CURRENT cycle and the timestamp is
 * the last answer ever, and reading the timestamp as "they answered" would put
 * *submitted 18 Jun* on a patient we are waiting on today.
 *
 * Hence: a positive label decides `responded`; `No Response` and a blank are
 * both `awaiting`; and the stamp is labelled by the state it is rendered in,
 * never on its own.
 */
const POSITIVE_ORDER_RESPONSES = ["confirmed", "delay", "cancel", "pause"];

export function buildReorderForm(
  boardId: number,
  cols: Record<string, string>,
): ReorderForm | null {
  if (boardId !== SUBSCRIPTION_BOARD_ID) return null;
  const get = (id: string) => (cols[id] ?? "").trim();

  const link = get(REORDER_COL.link);
  const orderResponse = get(REORDER_COL.orderResponse);
  const insuranceResponse = get(REORDER_COL.insuranceResponse);

  /** ⚠️ `No Response` is not in this set, deliberately — see above. */
  const answered = POSITIVE_ORDER_RESPONSES.includes(orderResponse.toLowerCase());

  return {
    // ⚠️ Keyed on the LINK, not on Reorder Text Sent: that column is newer than
    // the flow and is blank on 195 of the same 300 rows, every one of which
    // plainly did get a text — so "no stamp" would report "Not sent yet" for
    // two thirds of the patients who have already answered.
    state: !link ? "not-sent" : answered ? "responded" : "awaiting",
    link,
    textSent: get(REORDER_COL.textSent),
    orderResponse,
    insuranceResponse,
    answeredAt: get(REORDER_COL.respondedAt),
    latestChange: latestChange(get(REORDER_COL.changeSummary)),
    helpMessage: stripStamp(get(REORDER_COL.helpMessage)),
  };
}

const ENTRY_HEAD = /^\[[^\]]*\]/;

/**
 * The newest entry's change lines — Brandon's "the latest line of the change
 * summary".
 *
 * ⚠️ **Newest is LAST.** The column is an append-only log, so the first entry
 * is the oldest: reading from the top shows a change from months ago on a
 * patient who answered this morning, indefinitely stale while looking live.
 * (Same trap, opposite handling, as `recentNotes` — there the whole list is
 * reversed; here only the last entry is wanted.)
 *
 * ⚠️ A body that matches no entry header is returned VERBATIM rather than
 * dropped: the log has been written by more than one thing over its life, and
 * failing to parse must cost the tidying, never the content (§5.20).
 */
export function latestChange(summary: string): string {
  const body = summary.trim();
  if (!body) return "";
  const lines = body.split("\n");
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (ENTRY_HEAD.test(lines[i].trim())) {
      start = i;
      break;
    }
  }
  if (start < 0) return body.replace(/\s*\n\s*/g, " · ");
  const detail = lines
    .slice(start + 1)
    .map((l) => l.trim())
    .filter(Boolean);
  // A header with nothing under it still says WHEN and WHAT verb, so it is
  // better than an empty cell.
  if (!detail.length) return lines[start].trim();
  return detail.join(" · ");
}

/**
 * The help message carries its own `[8/16/26, 2:03 PM ET]` stamp on the first
 * line; the card already renders a timestamp beside it, so the stamp is
 * dropped here rather than printed twice.
 *
 * ⚠️ Only when the FIRST line is nothing but a stamp — a message whose own
 * first words happen to be bracketed is left alone.
 */
export function stripStamp(message: string): string {
  const body = message.trim();
  if (!body) return "";
  const [first, ...rest] = body.split("\n");
  if (!/^\[[^\]]*\]$/.test(first.trim()) || !rest.length) return body;
  return rest.join("\n").trim();
}

/** Chip tone, matching the board's own label colours. */
export function responseTone(label: string): "green" | "amber" | "red" | "" {
  switch (label.trim().toLowerCase()) {
    case "confirmed":
      return "green";
    case "delay":
    case "pause":
    case "changed":
      return "amber";
    case "cancel":
      return "red";
    default:
      // "No Response", a blank, and anything the board grows later. An
      // unrecognised label must never borrow a colour that states an outcome.
      return "";
  }
}

/**
 * ⚠️⚠️ **RESEND / SEND NOW ARE NOT BUILT, AND THIS IS THE ONE PART OF
 * BRANDON'S PARAGRAPH THAT WAS NOT ALREADY AVAILABLE.** Every other field is a
 * column somebody is already filling in; those two are WRITES, and there is no
 * trigger for them — the Subscription board has no "send the reorder text"
 * column (its full column list was read on 2026-09-22), so the text is sent by
 * the `reorder-patient-form` Railway service on its own schedule and a button
 * here would have to be a new integration with it.
 *
 * ⚠️ So the card offers **Copy link** instead, which is a real passing move
 * rather than a greyed-out one: the form URL is on the row, and a rep can send
 * it from the Communications hub in the next breath. A control whose only
 * stated move is impossible is the dead end §5.10 · §5.20 · §5.31c · §5.31f ·
 * §5.39d each record reversing; a disabled *Resend* would have been exactly
 * that. Flip this to a real send only alongside a trigger column or a service
 * route, never on its own.
 */
export const REORDER_SEND_FROM_COMMAND_CENTER = false;
