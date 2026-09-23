/**
 * Client for the Communications inbox routes on the gateway
 * (`services/monday-gateway/commsInbox.mjs`).
 *
 * ⚠️ Every route here reads POSTGRES, never RingCentral — the list, the badge,
 * an item's state, a resolve. That is the whole reason a badge on every page
 * for every rep is allowed at all (INCIDENT_2026-08-20). The one RingCentral
 * read an item can cost is on the gateway, when the item is OPENED, to show an
 * unmatched caller's full number.
 *
 * The routes are hard-authenticated: the verified Google identity is who a
 * resolution is attributed to, and nothing the browser says about who it is
 * is trusted.
 */
import { getIdToken } from "../shared/auth";
import type { InboxItem, InboxList, InboxResolution, ItemState, ResolveHow } from "./rules";

const GATEWAY =
  (import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined)?.replace(/\/+$/, "") || "";

export function inboxConfigured(): boolean {
  return !!GATEWAY;
}

/** The server said 409 — somebody resolved it first, or the number moved. */
export class InboxConflict extends Error {
  constructor(
    message: string,
    readonly conflict: InboxResolution | null,
    readonly moved: string | null,
  ) {
    super(message);
    this.name = "InboxConflict";
  }
}

/** The module is switched off on the gateway (503). */
export class InboxOff extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxOff";
  }
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  if (!GATEWAY) throw new InboxOff("The Communications inbox needs the Monday gateway (VITE_MONDAY_GATEWAY_URL).");
  const token = getIdToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((init.headers as Record<string, string>) || {}),
  };
  if (token) headers["X-MM-Auth"] = token;
  return fetch(`${GATEWAY}${path}`, { ...init, headers });
}

async function json<T>(res: Response, what: string): Promise<T> {
  if (res.ok) return (await res.json()) as T;
  let body: { error?: string; conflict?: InboxResolution | null; moved?: string | null } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* no body */
  }
  const msg = body.error || `${what} failed (${res.status})`;
  if (res.status === 409) throw new InboxConflict(msg, normalizeResolution(body.conflict), body.moved ?? null);
  if (res.status === 503) throw new InboxOff(msg);
  throw new Error(msg);
}

/** The gateway sends instants as epoch-ms numbers or ISO strings; one shape here. */
function ms(v: unknown): number {
  if (typeof v === "number") return v;
  const t = new Date(String(v ?? "")).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function normalizeResolution(r: InboxResolution | null | undefined): InboxResolution | null {
  if (!r) return null;
  return { ...r, at: ms(r.at), coversThrough: ms(r.coversThrough) };
}

/* ── the switch ─────────────────────────────────────────────────────────── */

export interface CommsConfig {
  /** The gateway module is on (phase 1 — shadow mode). */
  enabled: boolean;
  /** Show the Inbox to reps (phase 2). */
  ui: boolean;
}

/** Unauthenticated and cheap: two booleans. A failure reads as "off". */
export async function fetchCommsConfig(): Promise<CommsConfig> {
  if (!GATEWAY) return { enabled: false, ui: false };
  const res = await fetch(`${GATEWAY}/comms/config`);
  if (!res.ok) throw new Error(`Inbox config failed (${res.status})`);
  const j = (await res.json()) as Partial<CommsConfig>;
  return { enabled: !!j.enabled, ui: !!j.ui };
}

/* ── the list and the badge ─────────────────────────────────────────────── */

export interface InboxQuery {
  view: "open" | "over" | "all";
  type: "" | "text" | "missed" | "voicemail";
  q: string;
  sort: "wait" | "recent";
  /** The row just resolved keeps its place until the rep opens another. */
  sticky: string;
}

export async function fetchInbox(query: InboxQuery): Promise<InboxList> {
  const p = new URLSearchParams({ view: query.view, sort: query.sort });
  if (query.type) p.set("type", query.type);
  if (query.q.trim()) p.set("q", query.q.trim());
  if (query.sticky) p.set("sticky", query.sticky);
  const out = await json<InboxList>(await call(`/comms/inbox?${p}`), "Loading the inbox");
  return {
    ...out,
    rows: out.rows.map((r) => ({ ...r, lastResolution: normalizeResolution(r.lastResolution) })),
  };
}

export async function fetchInboxCount(): Promise<{ open: number; over: number }> {
  const out = await json<{ open: number; over: number }>(await call("/comms/inbox/count"), "Counting the inbox");
  return { open: Number(out.open) || 0, over: Number(out.over) || 0 };
}

/* ── one item ───────────────────────────────────────────────────────────── */

export async function fetchInboxItem(key: string): Promise<InboxItem> {
  const res = await call(`/comms/item?key=${encodeURIComponent(key)}`);
  const out = await json<InboxItem>(res, "Opening the item");
  return {
    ...out,
    state: {
      ...out.state,
      lastResolution: normalizeResolution(out.state.lastResolution),
    },
    timeline: out.timeline.map((e) => (e.type === "resolution" ? { ...e, at: ms(e.at), coversThrough: ms(e.coversThrough) } : e)),
  };
}

/** The patient screen's compact bar: state for numbers the page already holds. */
export async function fetchCommsState(numbers: string[]): Promise<{ key: string | null; state: ItemState | null }> {
  const res = await call("/comms/state", { method: "POST", body: JSON.stringify({ numbers }) });
  const out = await json<{ key: string | null; state: ItemState | null }>(res, "Reading the item");
  return {
    key: out.key,
    state: out.state ? { ...out.state, lastResolution: normalizeResolution(out.state.lastResolution) } : null,
  };
}

/* ── resolving ──────────────────────────────────────────────────────────── */

export interface ResolveResult {
  resolutionId: string;
  how: ResolveHow;
  label: string;
  coversThrough: number;
  resolvedAt: number;
  by: string;
}

/**
 * Close an item (or log a Left voicemail attempt).
 *
 * @param seenThrough  the newest inbound event the rep was SHOWN. Anything
 *   newer stays open — that is what stops a text that lands while the rep types
 *   being swallowed by the resolve (plan §4.4).
 * @throws InboxConflict  already resolved by somebody else (the error names who)
 */
export async function resolveItem(opts: {
  key: string;
  how: ResolveHow;
  note?: string;
  seenThrough: number | null;
}): Promise<ResolveResult> {
  const res = await call("/comms/resolve", {
    method: "POST",
    body: JSON.stringify({
      key: opts.key,
      how: opts.how,
      note: opts.note ?? "",
      seenThrough: opts.seenThrough === null ? null : new Date(opts.seenThrough).toISOString(),
    }),
  });
  const out = await json<ResolveResult>(res, "Resolving");
  return { ...out, coversThrough: ms(out.coversThrough), resolvedAt: ms(out.resolvedAt) };
}

export async function undoResolution(resolutionId: string): Promise<void> {
  await json(await call("/comms/undo", { method: "POST", body: JSON.stringify({ resolutionId }) }), "Undo");
}

export async function addResolutionNote(resolutionId: string, note: string): Promise<void> {
  await json(await call("/comms/note", { method: "POST", body: JSON.stringify({ resolutionId, note }) }), "Saving the note");
}

/* ── the Monday copy outbox ─────────────────────────────────────────────── */

export interface OutboxEntry {
  resolutionId: string;
  how: ResolveHow;
  label: string;
  note: string;
  resolvedAt: number;
  itemBoard: number | null;
  itemId: string;
}

export async function fetchOutbox(): Promise<OutboxEntry[]> {
  const out = await json<{ pending: OutboxEntry[] }>(await call("/comms/outbox"), "Reading the note outbox");
  return (out.pending ?? []).map((e) => ({ ...e, resolvedAt: ms(e.resolvedAt) }));
}

/** Claim a note before writing it to Monday — a compare-and-set, so two open
 *  tabs cannot both write it. Null when somebody else holds it. */
export async function claimMirror(resolutionId: string): Promise<OutboxEntry | null> {
  const out = await json<{ claimed: boolean } & Partial<OutboxEntry>>(
    await call("/comms/mirror", { method: "POST", body: JSON.stringify({ action: "claim", resolutionId }) }),
    "Claiming the note",
  );
  if (!out.claimed) return null;
  return {
    resolutionId,
    how: out.how as ResolveHow,
    label: out.label ?? "",
    note: out.note ?? "",
    resolvedAt: ms(out.resolvedAt),
    itemBoard: out.itemBoard ?? null,
    itemId: out.itemId ?? "",
  };
}

export async function reportMirrorDone(resolutionId: string, mirroredTo: string): Promise<void> {
  await json(
    await call("/comms/mirror", { method: "POST", body: JSON.stringify({ action: "done", resolutionId, mirroredTo }) }),
    "Recording the copy",
  );
}

export async function reportMirrorError(resolutionId: string, error: string): Promise<void> {
  await json(
    await call("/comms/mirror", { method: "POST", body: JSON.stringify({ action: "error", resolutionId, error }) }),
    "Recording the failed copy",
  );
}

/* ── linking, dialing, reports ──────────────────────────────────────────── */

/**
 * "This number is that patient." Written AFTER any Monday write succeeds, or
 * alone for a link-only pick (plan §6). `anchorNumber` is the patient's own
 * primary number, so the link follows them from board to board.
 */
export async function linkNumber(opts: {
  key: string;
  boardId: number;
  itemId: string;
  name: string;
  anchorNumber: string;
  last4: string;
}): Promise<{ key: string }> {
  return json<{ key: string }>(
    await call("/comms/link", { method: "POST", body: JSON.stringify(opts) }),
    "Linking the number",
  );
}

/**
 * The Call button reports who dialed — the call log cannot (§5.13b: the whole
 * team is one RingCentral extension). Best-effort: a dial is never blocked on
 * it, and a failure costs only the "· Katie" on that call's row.
 */
export function reportDialed(number: string): void {
  if (!GATEWAY || !number) return;
  void call("/comms/dialed", { method: "POST", body: JSON.stringify({ number }) }).catch(() => {});
}

export interface SlaRep {
  who: string;
  resolved: number;
  within: number;
  withinPct: number | null;
  medianMs: number | null;
  hows: ResolveHow[];
  attempts: number;
}

export interface SlaReport {
  since: number;
  now: number;
  open: number;
  over: number;
  resolved: number;
  within: number;
  withinPct: number | null;
  medianMs: number | null;
  byHow: Partial<Record<ResolveHow, number>>;
  attempts: number;
  reps: SlaRep[];
}

export async function fetchSla(days = 30): Promise<SlaReport> {
  return json<SlaReport>(await call(`/comms/sla?days=${days}`), "Loading the report");
}

/* ── archive playback (the archives' own routes, §5.47) ─────────────────── */

/**
 * A short-lived presigned URL for an archived voicemail or photo, fetched with
 * the signed-in identity and then used as a bare `<audio src>` / `<img src>` —
 * never `fetch()`ed, because a browser following a cross-origin redirect with
 * fetch needs CORS on the bucket, which Railway buckets cannot set (§5.47).
 * Recordings use `callHistory/archivedRecordings.archivedPlaybackUrl`.
 */
export async function archivedMediaUrl(
  kind: "voicemail" | "photo",
  ids: { messageId: string; attachmentId?: string },
): Promise<string> {
  const p = new URLSearchParams({ messageId: ids.messageId, json: "1" });
  if (ids.attachmentId) p.set("attachmentId", ids.attachmentId);
  const path = kind === "voicemail" ? "/voicemail/audio" : "/mms/media";
  const out = await json<{ url?: string }>(await call(`${path}?${p}`), kind === "voicemail" ? "Loading the voicemail" : "Loading the photo");
  if (!out.url) throw new Error("The archive returned no URL.");
  return out.url;
}
