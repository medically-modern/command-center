/**
 * Client for the gateway's patient-phone → rep assignment store.
 *
 * The gateway stores an HMAC of each number rather than the number itself (see
 * services/monday-gateway/assignments.mjs), and the pepper never leaves the
 * server — so the browser CANNOT compute a hash. Lookups are therefore
 * "here are the numbers I'm looking at, tell me which are assigned"
 * (`matchAssignments`) rather than "give me my numbers".
 *
 * That also means a rep's assignment list comes back as Monday item ids, not
 * phone numbers: the caller resolves those against Monday for the patient's
 * name and number, which the UI has to do anyway.
 */
import { getIdToken } from "../shared/auth";

const GATEWAY =
  (import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined)?.replace(/\/+$/, "") || "";

export function assignmentsConfigured(): boolean {
  return !!GATEWAY;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  if (!GATEWAY) throw new Error("Assigned Patients needs the Monday gateway (VITE_MONDAY_GATEWAY_URL).");
  const token = getIdToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) || {}),
  };
  if (token) headers["X-MM-Auth"] = token;
  return fetch(`${GATEWAY}${path}`, { ...init, headers });
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) {
    let msg = `${what} failed (${res.status})`;
    try {
      const e = (await res.json()) as { error?: string };
      if (e?.error) msg = e.error;
    } catch {
      /* keep default */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export interface AssignmentMatch {
  repEmail: string;
  mondayItemId: string;
  mondayBoardId: string | null;
  /** When the asking rep last opened this thread; null = never. */
  lastReadAt: string | null;
}

/** Which of `phones` are assigned, keyed by the SAME strings that were passed
 *  in (so callers can look results up without normalizing twice). */
export async function matchAssignments(
  phones: string[],
  rep: string,
): Promise<Record<string, AssignmentMatch>> {
  const unique = [...new Set((phones || []).filter(Boolean))];
  if (!unique.length) return {};
  const res = await call("/assignments/match", {
    method: "POST",
    body: JSON.stringify({ phones: unique, rep }),
  });
  return json<Record<string, AssignmentMatch>>(res, "Assignment lookup");
}

/** One conversation on the MM number, as summarised by the gateway. */
export interface InboxThread {
  phone: string;
  lastText: string;
  lastTime: string;
  lastDirection: "Inbound" | "Outbound";
  /** Newest INBOUND message time, or "" if the patient never replied. */
  lastInboundTime: string;
  messageCount: number;
}

export interface AssignedInboxThread extends InboxThread {
  assignment: AssignmentMatch;
}

/**
 * The caller's inbox, assembled and filtered ON THE SERVER.
 *
 * The MM number is one shared RingCentral inbox holding every patient
 * conversation. Fetching it in the browser and filtering there would put every
 * patient's number and last message into each rep's network response and memory
 * — client-side filtering is a UI convention, not a boundary. So the gateway
 * joins RingCentral against the assignments table and returns only what this
 * caller is entitled to. `unassigned` comes back non-empty for managers only.
 */
export async function fetchInbox(rep: string): Promise<{ threads: AssignedInboxThread[]; unassigned: InboxThread[] }> {
  const q = rep ? `?rep=${encodeURIComponent(rep)}` : "";
  const res = await call(`/assignments/inbox${q}`);
  return json<{ threads: AssignedInboxThread[]; unassigned: InboxThread[] }>(res, "Loading inbox");
}

export interface ConversationMessage {
  id: number;
  direction: "Inbound" | "Outbound";
  text: string;
  time: string;
  from: string;
  to: string;
}

/**
 * Full message history for one conversation, authorized per number — knowing a
 * phone number is not enough to read its thread.
 *
 * `complete` reports whether the whole history was read. The opt-out guard
 * treats an incomplete history as consent UNKNOWN, never as consent given.
 */
export async function fetchConversation(
  phone: string,
  rep: string,
): Promise<{ messages: ConversationMessage[]; complete: boolean }> {
  const res = await call("/assignments/conversation", {
    method: "POST",
    body: JSON.stringify({ phone, rep }),
  });
  return json<{ messages: ConversationMessage[]; complete: boolean }>(res, "Loading conversation");
}

export interface AssignmentRow {
  phoneHmac: string;
  repEmail: string;
  mondayItemId: string;
  mondayBoardId: string | null;
  assignedBy: string | null;
  assignedAt: string | null;
}

/** Every assignment, or just one rep's. No raw numbers by design. */
export async function listAssignments(rep?: string): Promise<AssignmentRow[]> {
  const q = rep ? `?rep=${encodeURIComponent(rep)}` : "";
  const res = await call(`/assignments${q}`);
  return json<AssignmentRow[]>(res, "Loading assignments");
}

/** Assign a patient to a rep. A number belongs to exactly one rep, so
 *  re-assigning moves it. */
export async function assignPatient(opts: {
  phone: string;
  repEmail: string;
  mondayItemId: string;
  mondayBoardId?: string;
}): Promise<void> {
  const res = await call("/assignments", { method: "POST", body: JSON.stringify(opts) });
  await json<{ ok: boolean }>(res, "Assigning patient");
}

export async function unassignPatient(opts: { phone?: string; phoneHmac?: string }): Promise<void> {
  const res = await call("/assignments/remove", { method: "POST", body: JSON.stringify(opts) });
  await json<{ ok: boolean }>(res, "Unassigning patient");
}

/** Stamp this thread read for this rep, as of now.
 *
 *  Per-rep, deliberately: RingCentral's own readStatus is ACCOUNT-wide, so one
 *  rep opening a thread would otherwise clear the unread dot for everyone. */
export async function markThreadRead(phone: string, rep: string): Promise<void> {
  const res = await call("/assignments/read", { method: "POST", body: JSON.stringify({ phone, rep }) });
  await json<{ ok: boolean }>(res, "Marking read");
}
