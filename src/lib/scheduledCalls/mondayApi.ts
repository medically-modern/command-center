/**
 * Reads for the Scheduled Calls role.
 *
 * Source is the Profile Send Off board's DTC-form groups — the same rows the
 * Patient Intake queue works. Calendly owns the appointment; the dtc-mm-form
 * backend mirrors it onto these columns, so this role needs no Calendly
 * credentials and counts like any other stage (CLAUDE.md §5.8).
 */
import { MONDAY_API_URL, mondayIdentityHeaders } from "@/lib/shared/mondayEndpoint";
import type { ScheduledCall } from "./workflow";

export const BOARD_ID = 18406352652;

/** The DTC form's own groups. Nothing lands in Patient Intake.
 *
 *  ⚠️ `profileCleanUp` is in here on purpose (§5.20). An intake advance moves
 *  the item to that group, and the unlock gate accepts "Send request now"
 *  without an intake call — so a patient can hold a real Calendly booking and
 *  still be advanced. Reading only the form groups would drop that appointment
 *  out of this queue and out of the 10-minute reminder, with nothing erroring:
 *  a booked call nobody makes, which is the exact failure §5.15 exists to
 *  prevent. Mirrors PROF_SCHED_GROUPS in BOTH baseline generators. */
export const GROUPS = {
  completed: "group_mm5zgeak",
  partial: "group_mm5z87zt",
  profileCleanUp: "group_mm6c3rhb",
};

export const COL = {
  phone: "phone_mm1x44yk",
  email: "text_mm1xc140",
  // Written by the Calendly webhook. Monday stores the time in UTC and returns
  // `text` already rendered in the account's zone, so what comes back IS
  // Eastern wall-clock and needs no conversion here.
  scheduledCallTime: "date_mm63na19",
  bookingStatus: "color_mm5zrbn3",
  calendlyEventUri: "text_mm63e086",
  reason: "color_mm5zb8h6",
  requestType: "color_mm1w1978",
  generalInsurance: "color_mm24ap4j",
  state: "text_mm5zc4vy",
};

const READ_COLUMN_IDS = Object.values(COL);

interface MondayItem {
  id: string;
  name: string;
  column_values: { id: string; text: string | null }[];
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...mondayIdentityHeaders() },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }
  return json.data as T;
}

function col(item: MondayItem, id: string): string {
  return item.column_values.find((c) => c.id === id)?.text ?? "";
}

/**
 * Split Monday's `YYYY-MM-DD HH:mm` into date and time.
 *
 * A date column with no time returns just the date, which is why the two are
 * kept apart rather than parsed into a Date — an appointment with no time is a
 * real state the day view has to render, not an error.
 */
function splitDateTime(text: string): { date: string; time: string } {
  const t = (text || "").trim();
  if (!t) return { date: "", time: "" };
  const [date, time = ""] = t.split(/\s+/);
  // Monday renders `HH:mm`; the workflow's parser wants a bare 24-hour value
  // and rejects anything else, so pad seconds rather than hand it a shape it
  // will refuse.
  return { date, time: time ? (time.length === 5 ? `${time}:00` : time) : "" };
}

function toScheduledCall(item: MondayItem): ScheduledCall {
  const { date, time } = splitDateTime(col(item, COL.scheduledCallTime));
  return {
    id: item.id,
    name: item.name,
    phone: col(item, COL.phone),
    email: col(item, COL.email),
    callDate: date,
    callTime: time,
    bookingStatus: col(item, COL.bookingStatus),
    reason: col(item, COL.reason),
    requestType: col(item, COL.requestType),
    generalInsurance: col(item, COL.generalInsurance),
    state: col(item, COL.state),
    calendlyEventUri: col(item, COL.calendlyEventUri),
  };
}

const PAGE = 200;

/**
 * Every booking on the DTC form's groups.
 *
 * Filtering to a single day happens in the caller rather than in the query:
 * Monday's date rules compare against the board's own idea of today, and this
 * role's "today" is Eastern regardless of where the browser is. Fetching the
 * group and filtering in code keeps that one definition (`etToday`) in one
 * place — the same reason the counting contract exists.
 */
export async function fetchScheduledCalls(): Promise<ScheduledCall[]> {
  const groups = [GROUPS.completed, GROUPS.partial, GROUPS.profileCleanUp];
  const all: MondayItem[] = [];

  for (const groupId of groups) {
    // ⚠️ `compare_value` is a CompareValue!, not a list — passing a `[String!]`
    // variable is rejected outright ("used in position expecting type
    // CompareValue!"). Every working query in this codebase INLINES the value,
    // so this one does too rather than inventing a third spelling.
    const query = `
      query ($boardId: ID!, $cols: [String!]) {
        boards(ids: [$boardId]) {
          items_page(limit: ${PAGE}, query_params: { rules: [{ column_id: "group", compare_value: ${JSON.stringify([groupId])} }] }) {
            cursor
            items { id name column_values(ids: $cols) { id text } }
          }
        }
      }
    `;
    const data = await gql<{ boards: { items_page: { cursor: string | null; items: MondayItem[] } }[] }>(
      query,
      { boardId: BOARD_ID, cols: READ_COLUMN_IDS },
    );

    const page = data.boards?.[0]?.items_page;
    all.push(...(page?.items ?? []));
    let cursor = page?.cursor ?? null;

    while (cursor) {
      const next = await gql<{ next_items_page: { cursor: string | null; items: MondayItem[] } }>(
        `query ($cursor: String!, $cols: [String!]) {
           next_items_page(limit: ${PAGE}, cursor: $cursor) {
             cursor
             items { id name column_values(ids: $cols) { id text } }
           }
         }`,
        { cursor, cols: READ_COLUMN_IDS },
      );
      all.push(...(next.next_items_page?.items ?? []));
      cursor = next.next_items_page?.cursor ?? null;
    }
  }

  return all.map(toScheduledCall);
}
