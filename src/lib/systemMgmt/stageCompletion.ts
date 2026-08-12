/**
 * "This patient already finished that stage" — the click target behind the
 * green completion badges in System Management → Search.
 *
 * A patient is ONE item per board (§6): finishing Medical Evaluation leaves a
 * completed item sitting in that board's Completed group while the live item
 * moves on to Insurance. Search shows that history as badges ("MN", "Insurance",
 * …) built by `buildCompletionMap`, and clicking one opens the COMPLETED item on
 * the role page that gathered the data — a historical record, not live work.
 *
 * Two things this module owns, both of them pure so they can be tested without
 * a board:
 * 1. Which page shows a finished board's data (`COMPLETED_STAGE_ROUTES`).
 * 2. WHEN the stage was marked complete (`completedAtFromLogs`) — no board has a
 *    "date completed" column, so the answer only exists in Monday's activity log.
 */

/** One finished board in a patient's history — what a completion badge links to. */
export interface CompletedStage {
  /** Badge text, e.g. "MN" (board-level, since a badge means the whole board). */
  label: string;
  /** Monday item id of the COMPLETED item — usually NOT the search row's id:
   *  the row is the patient's live item on a later board. */
  itemId: string;
  boardId: number;
  boardName: string;
  /** Role page that shows what the rep filled out on that board. */
  route: string;
}

/**
 * Board → the role page a completion badge opens.
 *
 * A badge is board-granular (the whole stage is done), so each board gets ONE
 * canonical page: the one whose panels render that board's data. Medical
 * Evaluation spans evaluate → send request → chase, but Evaluate is where the
 * medical-necessity findings live, so that's the page a manager wants; likewise
 * Benefits for Insurance and Welcome Call for that board.
 */
export const COMPLETED_STAGE_ROUTES: Record<number, string> = {
  18406352652: "/profile",       // Profile Send Off
  18406060017: "/evaluate",      // Medical Evaluation ("Masheke")
  18410601299: "/benefits",      // Insurance ("Samantha")
  18410804557: "/welcome-call",  // Welcome Call
};

/**
 * The status write each board makes when a patient finishes it — the fallback
 * signal when no group move is in the log (see `completedAtFromLogs`).
 *
 * Labels are matched case-insensitively but are otherwise EXACT board strings
 * (§9: label strings are the contract). Note the three different vocabularies:
 * Insurance says "Complete", Welcome Call / Medical Evaluation say "Completed",
 * and Profile Send Off has no Stage Advancer at all — its exit is the
 * "Move to Onboarding" column reading "Advance to MN".
 */
export const STAGE_COMPLETION_COLUMNS: Record<number, { columnId: string; labels: string[] }> = {
  18406352652: { columnId: "color_mm1zmeb3", labels: ["Advance to MN"] },
  18406060017: { columnId: "color_mm1wyr92", labels: ["Completed"] },
  18410601299: { columnId: "color_mm1ws96t", labels: ["Complete", "Completed"] },
  18410804557: { columnId: "color_mm1ws96t", labels: ["Completed", "Complete"] },
};

/**
 * Where a completion badge navigates.
 *
 * `patientId` is the COMPLETED item (a different item from the search row it
 * was clicked on), and `completedStage` is what puts the destination page into
 * review mode — banner on, advance off. `from` keeps Back returning to System
 * Management (§9, history-first back-nav).
 */
export function completedStageUrl(
  stage: Pick<CompletedStage, "itemId" | "boardId" | "route">,
): string {
  const params = new URLSearchParams({
    patientId: stage.itemId,
    completedStage: String(stage.boardId),
    from: "system-mgmt",
  });
  return `${stage.route}?${params.toString()}`;
}

/**
 * The completed record a patient's OWN row opens, when that row IS the finished
 * item (Search lists every board a patient sits on, so a completed one appears
 * as a row in its own right).
 *
 * Such a row used to be a dead end — `hasPage` is false for anything in a
 * Completed group, so it toasted "no dedicated page yet". It has exactly the
 * record the completion badges open, so it opens the same thing.
 *
 * Null when the board has no review page, which keeps the old toast for it.
 */
export function completedStageForPatient(p: {
  id: string;
  boardId: number;
  boardName: string;
  isCompleted: boolean;
}): CompletedStage | null {
  if (!p.isCompleted) return null;
  const route = COMPLETED_STAGE_ROUTES[p.boardId];
  if (!route) return null;
  return { label: p.boardName, itemId: p.id, boardId: p.boardId, boardName: p.boardName, route };
}

/** A row of `boards { activity_logs { … } }`, as Monday returns it. */
export interface ActivityLogEntry {
  event: string;
  /** 100-nanosecond ticks since the epoch — 17 digits, NOT milliseconds. */
  created_at: string;
  /** JSON blob; shape varies by event. */
  data: string;
}

export interface CompletionSignal {
  /** Group ids that mean "finished" on this board. */
  completedGroupIds: string[];
  /** The status column + labels that mark completion (see above). */
  column: { columnId: string; labels: string[] } | null;
}

/**
 * Monday's activity-log `created_at` is 100-ns ticks since the epoch, not ms —
 * a 17-digit number where `Date.now()` has 13. Reading it as ms lands ~50,000
 * years in the future, which would render as a plausible-looking date rather
 * than an obvious error.
 */
export function activityLogMs(createdAt: string): number {
  return Math.round(Number(createdAt) / 10_000);
}

/**
 * When was this item marked complete? Returns an ISO instant, or null when the
 * log doesn't reach back far enough (Monday prunes activity by plan retention —
 * the caller must render "unknown", never guess).
 *
 * Two independent signals, because neither alone is reliable:
 * - the **move into the Completed group** — the definitive moment, but a batch
 *   move or a board-to-board hop can log no `move_pulse_*` event at all
 *   (observed on the Welcome Call board);
 * - the **completion status write** — always present when the app advanced the
 *   patient, but on Profile Send Off it lives on a different column entirely.
 *
 * We take the LATEST match across both. They land within a second of each other
 * on the normal path (the app writes the status, an automation moves the item),
 * and for a patient who completed a board twice the most recent completion is
 * the one their current record reflects.
 */
export function completedAtFromLogs(
  logs: ActivityLogEntry[],
  signal: CompletionSignal,
): string | null {
  let latest = 0;

  for (const log of logs) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(log.data) as Record<string, unknown>;
    } catch {
      continue; // malformed entry — skip, never fail the whole lookup
    }

    let matches = false;

    if (log.event === "move_pulse_from_group" || log.event === "move_pulse_into_group") {
      const dest = data.dest_group as { id?: string } | undefined;
      matches = !!dest?.id && signal.completedGroupIds.includes(dest.id);
    } else if (log.event === "update_column_value" && signal.column) {
      const columnId = data.column_id as string | undefined;
      if (columnId === signal.column.columnId) {
        const value = data.value as { label?: { text?: string } } | undefined;
        const text = value?.label?.text ?? "";
        matches = signal.column.labels.some(
          (l) => l.toLowerCase() === text.trim().toLowerCase(),
        );
      }
    }

    if (!matches) continue;
    const ms = activityLogMs(log.created_at);
    if (Number.isFinite(ms) && ms > latest) latest = ms;
  }

  return latest > 0 ? new Date(latest).toISOString() : null;
}

/**
 * "Aug 3, 2026 at 2:14 PM" — the completion instant rendered in ET.
 *
 * Unlike Monday's date COLUMNS (timezone-naive ET strings, §9), an activity-log
 * timestamp is a real UTC instant, so converting it to ET is both correct and
 * necessary: a rep in ET must not read a completion as having happened at 9 PM
 * because the browser is elsewhere.
 */
export function formatStageCompletedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} at ${time}`;
}
