/**
 * The text inbox — RingCentral's conversation list, from the shared MM line.
 *
 * Pure: fold a window of message-store records into one row per patient
 * number, newest first, with an unread count. The REST reads live in
 * `lib/fax/ringcentralApi.ts`.
 *
 * ⚠️ **Unread is RingCentral's own `readStatus`, not a local flag.** Reps also
 * work this line in the RingCentral desktop app (that is where these
 * conversations come from), so a locally-invented read state would drift from
 * what they see there within a day. Opening a conversation PUTs the inbound
 * messages to Read; "Mark as unread" PUTs the newest one back. Both are the
 * same `message-store/{id}` write the fax inbox already makes.
 *
 * ⚠️ **Only INBOUND messages carry a meaningful read state.** RingCentral
 * reports outbound messages as Read the moment they are sent, so counting both
 * directions would make every conversation permanently read — the filter would
 * be empty and nobody would ever find out why.
 */
import { contactKey } from "../contactState/contactState";

/** The slice of a message-store record this module reads. */
export interface RcConversationRecord {
  id?: number;
  type?: string;
  direction?: string;
  subject?: string;
  text?: string;
  creationTime?: string;
  readStatus?: string;
  messageStatus?: string;
  deliveryErrorCode?: string;
  from?: { phoneNumber?: string; name?: string };
  to?: Array<{ phoneNumber?: string; name?: string }>;
  attachments?: Array<{ id?: number; type?: string; contentType?: string }>;
}

export interface Conversation {
  /** Last 10 digits — the join key against Monday phone columns. */
  key: string;
  /** E.164 where the number normalises, else the raw value. */
  phone: string;
  /** RingCentral's own caller-ID name, when it has one. Never a patient name
   *  from Monday — that resolution happens in the browser, per patient. */
  rcName: string;
  /** Body of the newest message, or a placeholder for a media-only MMS. */
  preview: string;
  lastAt: string;
  lastDirection: "Inbound" | "Outbound";
  /** Inbound messages RingCentral still has as Unread. */
  unread: number;
  /** Ids of those unread inbound messages — what "open marks read" writes. */
  unreadIds: number[];
  /** Newest inbound message id, whatever its read state — what "mark as
   *  unread" writes back. Zero when they have never texted us. */
  newestInboundId: number;
  /** RingCentral gave up on the newest outbound message. Surfaced so a failed
   *  text is visible from the LIST, not only once the thread is opened. */
  failed: boolean;
}

const TEXT_TYPES = new Set(["sms", "mms"]);
const isOutbound = (d: unknown) => String(d ?? "") === "Outbound";

/** RingCentral's terminal SMS failure statuses — the same two `smsDelivery.ts`
 *  reads. STATUS decides; a code only ever explains (CLAUDE.md §5.5). */
const FAILED_STATUSES = new Set(["SendingFailed", "DeliveryFailed"]);

function bodyOf(r: RcConversationRecord): string {
  const text = (r.subject ?? r.text ?? "").trim();
  if (text) return text;
  // A media-only MMS has no body. Saying so beats an empty row that reads as a
  // bug — a photo IS the message.
  const media = (r.attachments ?? []).filter((a) => a && a.type !== "Text" && !/^text\//i.test(a.contentType || ""));
  return media.length ? (media.length === 1 ? "📎 Attachment" : `📎 ${media.length} attachments`) : "";
}

function ms(iso: unknown): number {
  const t = new Date(String(iso ?? "")).getTime();
  return Number.isFinite(t) ? t : NaN;
}

/**
 * One row per number, newest first.
 *
 * `ownNumbers` are our own lines, so a record where we are both sides can't
 * open a conversation with ourselves.
 */
/** Accumulator — the public row plus the two timestamps used to pick winners.
 *  Kept as its own type rather than stashed on `Conversation`, so the returned
 *  object has no fields a caller can accidentally read. */
interface Acc {
  row: Conversation;
  lastMs: number;
  newestInboundMs: number;
}

export function buildConversations(
  records: RcConversationRecord[],
  opts: { ownNumbers?: string[] } = {},
): Conversation[] {
  const own = new Set((opts.ownNumbers ?? []).map(contactKey).filter((n) => n.length === 10));
  const byKey = new Map<string, Acc>();

  for (const r of records) {
    if (!TEXT_TYPES.has(String(r.type ?? "").toLowerCase())) continue;
    const outbound = isOutbound(r.direction);
    const party = outbound ? (r.to ?? [])[0] : r.from;
    const key = contactKey(party?.phoneNumber);
    if (key.length !== 10 || own.has(key)) continue;
    const at = ms(r.creationTime);
    if (!Number.isFinite(at)) continue;

    let acc = byKey.get(key);
    if (!acc) {
      acc = {
        row: {
          key,
          phone: String(party?.phoneNumber || ""),
          rcName: String(party?.name || "").trim(),
          preview: "",
          lastAt: "",
          lastDirection: "Inbound",
          unread: 0,
          unreadIds: [],
          newestInboundId: 0,
          failed: false,
        },
        lastMs: -Infinity,
        newestInboundMs: -Infinity,
      };
      byKey.set(key, acc);
    }
    const { row } = acc;
    if (!row.rcName && party?.name) row.rcName = String(party.name).trim();

    if (!outbound) {
      const id = Number(r.id ?? 0);
      if (String(r.readStatus ?? "") === "Unread") {
        row.unread += 1;
        if (id) row.unreadIds.push(id);
      }
      // Newest inbound wins — this is the message "mark as unread" flips back.
      if (id && at >= acc.newestInboundMs) {
        row.newestInboundId = id;
        acc.newestInboundMs = at;
      }
    }

    if (at > acc.lastMs) {
      acc.lastMs = at;
      row.preview = bodyOf(r);
      row.lastAt = String(r.creationTime);
      row.lastDirection = outbound ? "Outbound" : "Inbound";
      row.failed = outbound && FAILED_STATUSES.has(String(r.messageStatus ?? ""));
    }
  }

  return [...byKey.values()].sort((a, b) => b.lastMs - a.lastMs).map((a) => a.row);
}

/** Total unread across the inbox — the badge on the Text tab. */
export function totalUnread(conversations: Conversation[]): number {
  return conversations.reduce((n, c) => n + c.unread, 0);
}

/**
 * Apply the rep's own read/unread clicks on top of RingCentral's answer.
 *
 * The PUT and the next poll are seconds apart, so without an override layer a
 * conversation a rep just opened jumps back to unread until the store
 * refreshes. `true` = the rep marked it unread, `false` = they opened it.
 */
export function applyReadOverrides(
  conversations: Conversation[],
  overrides: Map<string, boolean>,
): Conversation[] {
  if (!overrides.size) return conversations;
  return conversations.map((c) => {
    const o = overrides.get(c.key);
    if (o === undefined) return c;
    if (o) return c.unread ? c : { ...c, unread: 1 };
    return c.unread ? { ...c, unread: 0, unreadIds: [] } : c;
  });
}
