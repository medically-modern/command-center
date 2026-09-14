/**
 * Reads for the Care Coordinator dashboard — and ONLY reads.
 *
 * Three boards, one slim paged query each, through the same endpoint switch
 * every module uses (`MONDAY_API_URL` + `mondayIdentityHeaders`, §5.1). Nothing
 * here writes to Monday: the page links into the stage pages for every action,
 * so the stage's own write path — with its verification, its stamps and its
 * side effects — is the only one that ever runs.
 *
 * ⚠️ Deliberately NOT the stage hooks. `hooks/masheke/useMondayPatients`
 * backfills a blank Next Action Date and self-heals stale escalations ON READ;
 * `hooks/profile/useMondayPatients` seeds overlays and caches. A dashboard that
 * merely looks at three stages must not trigger any of that, so it has its own
 * reads with its own column lists.
 *
 * Column ids are imported from each slice's `mondayApi.ts` rather than retyped —
 * a column renamed there is renamed here.
 */
import { MONDAY_API_URL, mondayIdentityHeaders } from "@/lib/shared/mondayEndpoint";
import { BOARD_ID as PROFILE_BOARD_ID, COL as PROFILE_COL, GROUPS as PROFILE_GROUPS } from "@/lib/profile/mondayApi";
import { BOARD_ID as ME_BOARD_ID, COL as ME_COL, GROUPS as ME_GROUPS } from "@/lib/masheke/mondayApi";
import { BOARD_ID as WC_BOARD_ID, COL as WC_COL, GROUPS as WC_GROUPS } from "@/lib/welcomeCall/mondayApi";
import { COL as SCHED_COL, GROUPS as SCHED_GROUPS } from "@/lib/scheduledCalls/mondayApi";
import type { ChaseItem, IntakeLead, WelcomeCallItem } from "./workflow";
import { CHASE_STAGES } from "./workflow";

/* ── GraphQL plumbing ────────────────────────────────────────── */

interface RawItem {
  id: string;
  name: string;
  created_at: string;
  group: { id: string } | null;
  column_values: { id: string; text: string | null; value: string | null }[];
}

interface PageResult {
  cursor: string | null;
  items: RawItem[];
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...mondayIdentityHeaders() },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Monday read failed: HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }
  return json.data as T;
}

const PAGE = 500;
const ITEM_FIELDS = `id name created_at group { id } column_values(ids: $cols) { id text value }`;

/**
 * Every item in one board group, all pages.
 *
 * ⚠️ Throws on a failed page rather than returning what it has: a truncated
 * list on this screen reads as "those patients are done", which is the §9
 * absence-is-not-evidence trap. The hook shows a StaleDataNotice instead.
 *
 * `compare_value` is inlined, not a variable — Monday rejects a `[String!]`
 * variable in that position (see lib/scheduledCalls/mondayApi.ts).
 */
/**
 * Called after each page lands, with that page's row count.
 *
 * ⚠️ Reports PAGES, not a fraction. Monday's `items_page` returns `cursor` and
 * `items` and nothing else — there is no total anywhere in the API — so the
 * only honest thing a fetch can say is how much it has actually got
 * (`lib/careCoordinator/loadProgress.ts` turns that into a percentage against a
 * remembered total, and says so).
 */
export type PageReport = (rows: number) => void;

async function fetchGroup(
  boardId: string | number, groupId: string, cols: string[], onPage?: PageReport,
): Promise<RawItem[]> {
  const first = await gql<{ boards: { items_page: PageResult }[] }>(
    `query ($boardId: ID!, $cols: [String!]) {
       boards(ids: [$boardId]) {
         items_page(limit: ${PAGE}, query_params: { rules: [{ column_id: "group", compare_value: ${JSON.stringify([groupId])} }] }) {
           cursor
           items { ${ITEM_FIELDS} }
         }
       }
     }`,
    { boardId: String(boardId), cols },
  );
  const page = first.boards?.[0]?.items_page;
  const all: RawItem[] = [...(page?.items ?? [])];
  onPage?.(page?.items?.length ?? 0);
  let cursor = page?.cursor ?? null;
  while (cursor) {
    const next = await gql<{ next_items_page: PageResult }>(
      `query ($cursor: String!, $cols: [String!]) {
         next_items_page(limit: ${PAGE}, cursor: $cursor) { cursor items { ${ITEM_FIELDS} } }
       }`,
      { cursor, cols },
    );
    all.push(...(next.next_items_page?.items ?? []));
    onPage?.(next.next_items_page?.items?.length ?? 0);
    cursor = next.next_items_page?.cursor ?? null;
  }
  return all;
}

const text = (item: RawItem, id: string): string =>
  item.column_values.find((c) => c.id === id)?.text ?? "";

/** Selected index of a status column from its raw `value` JSON, or null. */
function statusIndex(item: RawItem, id: string): number | null {
  const raw = item.column_values.find((c) => c.id === id)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { index?: number } | null;
    return typeof parsed?.index === "number" ? parsed.index : null;
  } catch {
    return null;
  }
}

/* ── Intake: the DTC form groups (+ Clean-Up, for bookings only) ── */

/**
 * The groups this read covers — the SAME three the Scheduled Calls count and
 * both baseline generators read (`lib/scheduledCalls/mondayApi.ts` GROUPS):
 * Profile Clean-Up is in the list only so a booked call survives an advance.
 * `intakeBuckets` needs `formGroupIds` to know which of these an UNBOOKED lead
 * must still be in to count as a call.
 */
export const INTAKE_GROUP_IDS: readonly string[] = [SCHED_GROUPS.partial, SCHED_GROUPS.completed, SCHED_GROUPS.profileCleanUp];
export const INTAKE_FORM_GROUP_IDS: readonly string[] = [PROFILE_GROUPS.newFormPartial, PROFILE_GROUPS.newFormCompleted];

/**
 * ⚠️ NO NOTES COLUMN HERE. The Partial Leads group is ~1,700 rows and Profile
 * Send Off Notes runs to 9,000+ characters on some of them (§5.25 — the intake
 * list dropped to nine columns for exactly this). Notes are fetched for ONE
 * patient at a time by `fetchItemNotes` when the coordinator opens them.
 */
const INTAKE_COLS: string[] = [
  PROFILE_COL.ptPhone, PROFILE_COL.email,
  PROFILE_COL.formDropOffStep, PROFILE_COL.attemptCounter, PROFILE_COL.dropOffAttempt,
  PROFILE_COL.requestType, PROFILE_COL.formPumpNeed, PROFILE_COL.formReasonForInquiry,
  PROFILE_COL.formProceedPreference, PROFILE_COL.scheduledCallTime, PROFILE_COL.formBookingStatus,
  PROFILE_COL.intakeCallComplete, PROFILE_COL.intakeEscalation,
  PROFILE_COL.referralType, PROFILE_COL.referralSource, PROFILE_COL.alreadyInSystem,
  PROFILE_COL.followUp, PROFILE_COL.followUpDate, PROFILE_COL.dupCheckResult,
  PROFILE_COL.formState, PROFILE_COL.generalInsurance,
  // Needed to hand the schedule grid a full `ScheduledCall` (BookingLinkDialog
  // reads the event URI) without a second read of the same groups.
  SCHED_COL.calendlyEventUri,
];

function toIntakeLead(item: RawItem): IntakeLead {
  return {
    id: item.id,
    name: item.name,
    groupId: item.group?.id ?? "",
    createdAt: item.created_at,
    phone: text(item, PROFILE_COL.ptPhone),
    email: text(item, PROFILE_COL.email),
    dropOffStep: text(item, PROFILE_COL.formDropOffStep),
    attemptCounter: text(item, PROFILE_COL.attemptCounter),
    dropOffAttempt: text(item, PROFILE_COL.dropOffAttempt),
    requestType: text(item, PROFILE_COL.requestType),
    pumpNeed: text(item, PROFILE_COL.formPumpNeed),
    reasonForInquiry: text(item, PROFILE_COL.formReasonForInquiry),
    proceedPreference: text(item, PROFILE_COL.formProceedPreference),
    scheduledCallTime: text(item, PROFILE_COL.scheduledCallTime),
    bookingStatus: text(item, PROFILE_COL.formBookingStatus),
    intakeCallComplete: text(item, PROFILE_COL.intakeCallComplete),
    intakeEscalation: text(item, PROFILE_COL.intakeEscalation),
    referralType: text(item, PROFILE_COL.referralType),
    referralSource: text(item, PROFILE_COL.referralSource),
    alreadyInSystem: text(item, PROFILE_COL.alreadyInSystem),
    followUp: text(item, PROFILE_COL.followUp),
    followUpDate: text(item, PROFILE_COL.followUpDate),
    dupCheckResult: text(item, PROFILE_COL.dupCheckResult),
    state: text(item, PROFILE_COL.formState),
    generalInsurance: text(item, PROFILE_COL.generalInsurance),
    calendlyEventUri: text(item, SCHED_COL.calendlyEventUri),
  };
}

/**
 * ⚠️ The three groups run in PARALLEL and their pages interleave, so `onPage`
 * fires out of order and the caller must only ever ACCUMULATE — never treat a
 * report as "page N of this group". Partial Leads alone is ~1,718 rows, i.e.
 * four sequential pages of its own, which is where the wait actually is.
 */
export async function fetchIntakeLeads(onPage?: PageReport): Promise<IntakeLead[]> {
  const pages = await Promise.all(
    INTAKE_GROUP_IDS.map((g) => fetchGroup(PROFILE_BOARD_ID, g, INTAKE_COLS, onPage)),
  );
  return pages.flat().map(toIntakeLead);
}

/* ── Medical Evaluation: Confirm Receipt + Chase Clinicals ───── */

const CHASE_COLS: string[] = [
  ME_COL.phone, ME_COL.subStage, ME_COL.nextActionDate, ME_COL.escalation, ME_COL.mnAttempts,
  ME_COL.clinicalsMethod, ME_COL.doctorName, ME_COL.clinicName, ME_COL.requestSentAt,
  ME_COL.appointmentDate, ME_COL.dateOfIntake,
  ME_COL.confirmAttempt1, ME_COL.confirmAttempt2, ME_COL.confirmAttempt3,
  ME_COL.chaseAttempt1, ME_COL.chaseAttempt2, ME_COL.chaseAttempt3,
  ME_COL.receiptConfirmedName, ME_COL.requestType, ME_COL.serving,
];

function toChaseItem(item: RawItem): ChaseItem {
  return {
    id: item.id,
    name: item.name,
    groupId: item.group?.id ?? "",
    createdAt: item.created_at,
    phone: text(item, ME_COL.phone),
    subStage: text(item, ME_COL.subStage),
    nextActionDate: text(item, ME_COL.nextActionDate),
    escalationIndex: statusIndex(item, ME_COL.escalation),
    escalation: text(item, ME_COL.escalation),
    mnAttempts: text(item, ME_COL.mnAttempts),
    clinicalsMethod: text(item, ME_COL.clinicalsMethod),
    doctorName: text(item, ME_COL.doctorName),
    clinicName: text(item, ME_COL.clinicName),
    requestSentAt: text(item, ME_COL.requestSentAt),
    appointmentDate: text(item, ME_COL.appointmentDate),
    dateOfIntake: text(item, ME_COL.dateOfIntake),
    confirmAttempts: [text(item, ME_COL.confirmAttempt1), text(item, ME_COL.confirmAttempt2), text(item, ME_COL.confirmAttempt3)],
    chaseAttempts: [text(item, ME_COL.chaseAttempt1), text(item, ME_COL.chaseAttempt2), text(item, ME_COL.chaseAttempt3)],
    receiptConfirmedName: text(item, ME_COL.receiptConfirmedName),
    requestType: text(item, ME_COL.requestType),
    serving: text(item, ME_COL.serving),
  };
}

/**
 * The whole Medical Necessity group, filtered to the two chase stages here
 * rather than by a status rule in the query: `useRoleCounts` reads the group
 * the same way, and one paged read of ~200 rows is cheaper than two filtered
 * ones. Only the two stages come back.
 */
export async function fetchChaseItems(onPage?: PageReport): Promise<ChaseItem[]> {
  const rows = await fetchGroup(ME_BOARD_ID, ME_GROUPS.medicalNecessity, CHASE_COLS, onPage);
  const stages = new Set<string>(CHASE_STAGES);
  return rows.map(toChaseItem).filter((i) => stages.has(i.subStage.trim()));
}

/* ── Welcome Call group ──────────────────────────────────────── */

/** Welcome Call's Escalation column. The same id as Medical Evaluation's (the
 *  board was duplicated from it) — and since 2026-09-14 the same three rungs
 *  (welcomeCall/mondayApi ESCALATION_INDEX, §5.34). Read as index AND text. */
const WC_ESCALATION_COL = "color_mm1x7997";

const WC_COLS: string[] = [
  // Email is here for ONE reason: it is the only join between a Calendly
  // welcome-call booking and this patient's chart (the grid's "Open"). The
  // Calendly mirror uses the same single join for intake — §5.15.
  WC_COL.phone, WC_COL.email, WC_ESCALATION_COL,
  WC_COL.followUp, WC_COL.followUpDate, WC_COL.serving, WC_COL.requestType, WC_COL.pumpQty,
  WC_COL.ipLastBillDate, WC_COL.medicarePriorPumpDate, WC_COL.callAttempts, WC_COL.doctorName,
  WC_COL.primaryInsurance, WC_COL.referralReceivedDate,
];

function toWelcomeCallItem(item: RawItem): WelcomeCallItem {
  return {
    id: item.id,
    name: item.name,
    groupId: item.group?.id ?? "",
    createdAt: item.created_at,
    phone: text(item, WC_COL.phone),
    email: text(item, WC_COL.email),
    escalation: text(item, WC_ESCALATION_COL),
    escalationIndex: statusIndex(item, WC_ESCALATION_COL),
    followUp: text(item, WC_COL.followUp),
    followUpDate: text(item, WC_COL.followUpDate),
    serving: text(item, WC_COL.serving),
    requestType: text(item, WC_COL.requestType),
    pumpQty: text(item, WC_COL.pumpQty),
    ipLastBillDate: text(item, WC_COL.ipLastBillDate),
    medicarePriorPumpDate: text(item, WC_COL.medicarePriorPumpDate),
    callAttempts: text(item, WC_COL.callAttempts),
    doctorName: text(item, WC_COL.doctorName),
    primaryInsurance: text(item, WC_COL.primaryInsurance),
    referralReceivedDate: text(item, WC_COL.referralReceivedDate),
  };
}

export async function fetchWelcomeCallItems(onPage?: PageReport): Promise<WelcomeCallItem[]> {
  const rows = await fetchGroup(WC_BOARD_ID, WC_GROUPS.welcomeCall, WC_COLS, onPage);
  return rows.map(toWelcomeCallItem);
}

/* ── One patient's notes, on demand ──────────────────────────── */

/** Which notes column each column of the dashboard reads — the stage's own
 *  running case history, the same column its NotesPanel writes. */
export const NOTES_COLUMN = {
  intake: PROFILE_COL.notes,        // Profile Send Off Notes (text_mm389fs)
  chase: ME_COL.mnEvalNotes,        // MN Workflow Notes (text_mm6vevjf)
  welcome: WC_COL.notes,            // Welcome Call Notes (text_mm6vqq2k)
} as const;

/**
 * The notes body for ONE item. Called when a card's "Notes" is opened, never
 * for the list — see the INTAKE_COLS note above for why.
 */
export async function fetchItemNotes(itemId: string, columnId: string): Promise<string> {
  const data = await gql<{ items: { column_values: { id: string; text: string | null }[] }[] }>(
    `query ($ids: [ID!], $cols: [String!]) {
       items(ids: $ids) { column_values(ids: $cols) { id text } }
     }`,
    { ids: [itemId], cols: [columnId] },
  );
  return data.items?.[0]?.column_values?.find((c) => c.id === columnId)?.text ?? "";
}
