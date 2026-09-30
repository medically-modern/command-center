/**
 * The item timeline's browser-side rules (COMMS_INBOX_PLAN.md §4.6, §4.9).
 *
 * The gateway builds the timeline from the archives — every text, call,
 * voicemail and resolution on the patient's numbers, in time order. The
 * browser adds exactly one thing: the LIVE thread for the number the rep is
 * replying to, laid over the archived texts, because the archive is a minute
 * behind and a text sent a second ago — and its late delivery verdict — must
 * show at once.
 */
import type { ConversationMessage } from "@/lib/assignedPatients/messagingApi";
import { toE164 } from "@/lib/fax/ringcentralApi";
import { smsDeliveryState } from "@/lib/shared/smsDelivery";
import type { ItemNumber, ItemState, TimelineAttachment, TimelineEntry } from "./rules";
import { whoShort } from "./rules";

type TextEntry = Extract<TimelineEntry, { type: "text" }>;
type CallEntry = Extract<TimelineEntry, { type: "call" }>;

const last4Of = (phone: string) => String(phone ?? "").replace(/\D/g, "").slice(-4);

/**
 * Lay the live thread over the archived texts.
 *
 * ⚠️⚠️ **THE LIVE COPY WINS A COLLISION.** An archived text can still say
 * `Queued` after RingCentral has turned it into `SendingFailed` (CLAUDE.md
 * §5.5, §5.27) — the thread is the only surface that late verdict reaches, so
 * preferring the archive would pin the optimistic status and hide the one line
 * a rep has to act on.
 *
 * ⚠️ The archive keeps the one thing it knows better: whether a photo is in our
 * bucket (§5.47c), so a merged text still plays its photo from the archive.
 *
 * The live thread is ONE number's; texts on the patient's other numbers come
 * from the archive alone, which is why each live text is stamped with that
 * number's last four.
 */
export function mergeLiveTexts(
  timeline: TimelineEntry[],
  live: ConversationMessage[],
  activeLast4: string,
): TimelineEntry[] {
  if (!live.length) return timeline;
  const byId = new Map<string, ConversationMessage>();
  for (const m of live) byId.set(String(m.id), m);

  const used = new Set<string>();
  const out: TimelineEntry[] = timeline.map((e) => {
    if (e.type !== "text") return e;
    const m = byId.get(String(e.id));
    if (!m) return e;
    used.add(String(e.id));
    return overlay(e, m);
  });
  for (const m of live) {
    const id = String(m.id);
    if (used.has(id)) continue;
    const at = Date.parse(m.time);
    if (!Number.isFinite(at)) continue;
    out.push(fromLive(m, at, activeLast4));
  }
  return out.sort((a, b) => a.at - b.at);
}

function overlay(e: TextEntry, m: ConversationMessage): TextEntry {
  const archived = new Map((e.attachments ?? []).map((a) => [String(a.id), a]));
  const attachments: TimelineAttachment[] = (m.attachments?.length ? m.attachments : e.attachments ?? []).map((a) => ({
    id: String(a.id),
    contentType: a.contentType,
    uri: a.uri,
    archived: archived.get(String(a.id))?.archived ?? false,
  }));
  return {
    ...e,
    body: m.text ?? e.body,
    status: m.messageStatus || e.status,
    deliveryError: m.deliveryError || e.deliveryError,
    sentBy: m.sentBy || e.sentBy,
    attachments,
    live: true,
  };
}

function fromLive(m: ConversationMessage, at: number, last4: string): TextEntry {
  return {
    type: "text",
    id: String(m.id),
    dir: m.direction === "Outbound" ? "out" : "in",
    at,
    last4,
    body: m.text ?? "",
    status: m.messageStatus ?? "",
    deliveryError: m.deliveryError ?? "",
    attachments: (m.attachments ?? []).map((a) => ({ id: String(a.id), contentType: a.contentType, uri: a.uri })),
    sentBy: m.sentBy ?? "",
    live: true,
  };
}

/**
 * The newest INBOUND event on screen — what a resolve covers up to (plan §4.4).
 *
 * ⚠️ It is what the rep was SHOWN, which is the whole point: a text that lands
 * while they type the Called note is newer than this, so it stays open rather
 * than being swallowed by the resolve. The gateway clamps it to "now".
 */
export function seenThroughFor(entries: TimelineEntry[], newestOpenAt: number | null): number | null {
  let best = Number.isFinite(newestOpenAt as number) ? (newestOpenAt as number) : -Infinity;
  for (const e of entries) {
    if (e.type === "text" || e.type === "call" || e.type === "voicemail") {
      if (e.dir === "in" && Number.isFinite(e.at) && e.at > best) best = e.at;
    }
  }
  return Number.isFinite(best) ? best : null;
}

/**
 * Fill in a number the gateway could not resolve, from the patient's own
 * records — only when exactly ONE of them shares its last four.
 *
 * ⚠️ `candidates` must be THIS patient's numbers (their dossier), never a list
 * wider than that: the match is on four digits, which is a hint, not an
 * identity. Two candidates sharing the digits resolve to nothing, and the
 * header keeps showing `···1234`.
 */
export function fillNumbers(numbers: ItemNumber[], candidates: string[]): ItemNumber[] {
  const clean = [...new Set(candidates.map((c) => toE164(c)).filter(Boolean))];
  let changed = false;
  const out = numbers.map((n) => {
    if (n.e164 || !n.last4) return n;
    const hits = clean.filter((c) => last4Of(c) === n.last4);
    if (hits.length !== 1) return n;
    changed = true;
    return { ...n, e164: hits[0] };
  });
  return changed ? out : numbers;
}

/**
 * The number the composer texts and the Call button dials, by default: the one
 * the newest inbound event came in on — that is who is waiting — else the first
 * number we can actually reach.
 */
export function defaultNumber(numbers: ItemNumber[], entries: TimelineEntry[]): ItemNumber | null {
  const reachable = numbers.filter((n) => !!n.e164);
  if (!reachable.length) return null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if ((e.type === "text" || e.type === "call" || e.type === "voicemail") && e.dir === "in") {
      const hit = reachable.find((n) => n.last4 && n.last4 === e.last4);
      if (hit) return hit;
      break;
    }
  }
  return reachable[0];
}

/** "3:12" — a call's length. */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * What a call row says. The verdicts are the gateway's (the legs rule —
 * `callConnected` — mirrored and parity-tested there); this only words them.
 */
export function callLine(e: CallEntry): string {
  const who = e.dialedBy ? ` · ${whoShort(e.dialedBy)}` : "";
  if (e.dir === "out") {
    // A browser pickup: their call, our answer — RingCentral just logged it
    // backwards (the record is Outbound toward the caller, §5.49).
    if (e.pickedUp) return `They called — we picked up · ${formatDuration(e.durationSec)}`;
    return e.connected ? `We called · ${formatDuration(e.durationSec)}${who}` : `We called · no answer${who}`;
  }
  if (e.blocked) return "Blocked call";
  if (e.missed) return e.voicemail ? "Missed call · left a voicemail" : "Missed call";
  return `Answered call · ${formatDuration(e.durationSec)}`;
}

/**
 * "Victor Guerra (ext 13)" — who picked up an inbound call, or "" when we
 * don't know (§5.47d). The extension alone when RingCentral's list had no
 * name for it; never anything on an outbound call, nor on one nobody answered.
 *
 * Its own line under `callLine` in the timeline, not appended to it: in the
 * popup's width "Answered by Victor Guerra (ext 13) · 2:03" wrapped the
 * duration onto a line by itself (rendered 2026-09-30).
 */
export function answeredByLabel(
  e: Pick<CallEntry, "dir" | "answeredExt" | "answeredName"> & Partial<Pick<CallEntry, "connected" | "missed">>,
): string {
  if (e.dir !== "in" || e.missed || e.connected === false) return "";
  const name = (e.answeredName ?? "").trim();
  const ext = (e.answeredExt ?? "").trim();
  if (name && ext) return `${name} (ext ${ext})`;
  if (ext) return `ext ${ext}`;
  return name;
}

/** Which of the patient's numbers, when they have more than one. */
export function numberHint(last4: string, numbers: { last4: string }[]): string {
  return numbers.length > 1 && last4 ? `on ···${last4}` : "";
}

/**
 * The suggestion, brought forward by the live thread.
 *
 * The gateway suggests *Texted* once the text is captured (a minute at most).
 * The rep who has just pressed Send is looking at the bubble now, so the same
 * rule is applied to what is on screen: the newest outbound text a PERSON sent
 * here (it carries a sender) since the item opened. ⚠️ Texts only — a live
 * thread knows nothing about calls, and only a CONNECTED callback may suggest
 * *Called* (the gateway's leg rule). ⚠️ A text with no sender — an automation,
 * the RingCentral app — never suggests anything, exactly as on the gateway.
 *
 * ⚠️⚠️ **A TEXT RINGCENTRAL GAVE UP ON NEVER SUGGESTS TEXTED** — the gateway's
 * `textFailed` rule, read here through `smsDeliveryState` (one reading of the
 * status in the browser, §5.5). The live thread learns the verdict SOONER than
 * the archive does, so a *Texted* suggestion the gateway made for a text the
 * thread now shows as failed is withdrawn rather than highlighted: confirming
 * it would resolve the item on a message the patient never got. It is not
 * replaced by an older gateway candidate the browser cannot see (a callback);
 * the gateway recomputes within a minute, and a missing highlight costs a rep
 * nothing — every button still works.
 */
export function liveSuggestion(state: ItemState, entries: TimelineEntry[]): ItemState["suggestion"] {
  let current = state.suggestion;
  if (!state.open || !state.openedBy) return current;
  const failed = (e: TextEntry) => smsDeliveryState(e.status) === "failed";
  if (current && current.how === "texted") {
    const at = current.at;
    const shown = entries.find((e): e is TextEntry => e.type === "text" && e.dir === "out" && e.at === at);
    if (shown && failed(shown)) current = null;
  }
  let best: TextEntry | null = null;
  for (const e of entries) {
    if (e.type !== "text" || e.dir !== "out" || !e.sentBy) continue;
    if (!(e.at > state.openedBy.at)) continue;
    if (failed(e)) continue;
    if (!best || e.at > best.at) best = e;
  }
  if (!best) return current;
  if (current && current.at >= best.at) return current;
  return { how: "texted", at: best.at, by: best.sentBy };
}
