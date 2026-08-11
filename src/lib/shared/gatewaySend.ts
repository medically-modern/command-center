/**
 * Phase 2 client — submit a verified write to the gateway's transactional
 * /send endpoint, with a localStorage outbox so a submit survives a flaky
 * connection or a closed tab.
 *
 * The win for bad internet: the browser only needs connectivity for ONE quick
 * POST. Once the gateway has the job (202), it completes the snapshot → write →
 * verify → stage sequence server-side even if the browser drops offline a
 * moment later. If the POST itself can't get through, the job is parked in the
 * outbox and retried on the next `online` event / page load.
 *
 * Idempotency: the caller passes a stable key; re-submitting the same key
 * returns the same server job (never a double write).
 *
 * PHI note: a queued job in the outbox holds column values (patient data) in
 * this browser's localStorage until it flushes. That is inherent to offline
 * queueing; it clears as soon as the POST succeeds.
 */

import { MONDAY_VIA_GATEWAY, mondayActor } from "./mondayEndpoint";
import { getIdToken, getUser } from "./auth";

const GATEWAY =
  (import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined)?.replace(/\/+$/, "") || "";
const OUTBOX_KEY = "mm-send-outbox";

export interface SendPayload {
  itemId: string;
  boardId: string;
  dataColumns: Record<string, unknown>;
  stageColumns: Record<string, unknown>;
  verify?: { columnId: string; expectedText?: string }[];
  idempotencyKey: string;
  label?: string;
  /** When true, the gateway writes columns with create_labels_if_missing
   *  (used by flows that legitimately add labels, e.g. Evaluate). */
  createLabelsIfMissing?: boolean;
}

export type SendOutcome = "done" | "submitted" | "queued-offline" | "queued-unconfirmed";

/** Progress milestones of a gateway send, for UIs that block until Monday
 *  confirms: "posting" (browser → gateway), "accepted" (job durably queued
 *  server-side), "confirmed" (job done — written AND read-back verified). */
export type SendPhase = "posting" | "accepted" | "confirmed";

export function gatewaySendAvailable(): boolean {
  return MONDAY_VIA_GATEWAY && GATEWAY.length > 0;
}

function loadOutbox(): SendPayload[] {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]"); } catch { return []; }
}
function saveOutbox(items: SendPayload[]) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items)); } catch { /* quota / disabled */ }
}
function addToOutbox(p: SendPayload) {
  const o = loadOutbox().filter((x) => x.idempotencyKey !== p.idempotencyKey);
  o.push(p);
  saveOutbox(o);
}
function removeFromOutbox(key: string) {
  saveOutbox(loadOutbox().filter((x) => x.idempotencyKey !== key));
}
export function outboxCount(): number {
  return loadOutbox().length;
}

async function postSend(p: SendPayload): Promise<{ jobId: string | number; status: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const idToken = getIdToken();
  if (idToken) headers["X-MM-Auth"] = idToken;       // verified server-side → attributes the send
  const actor = getUser()?.email || mondayActor();
  if (actor) headers["X-MM-User"] = actor;
  const res = await fetch(`${GATEWAY}/send`, { method: "POST", headers, body: JSON.stringify(p) });
  if (!res.ok) throw new Error(`/send HTTP ${res.status}`);
  return res.json();
}

async function pollDone(jobId: string | number, ms = 20000): Promise<{ status: string; error?: string }> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const r = await fetch(`${GATEWAY}/send/${jobId}`);
      if (r.ok) {
        const j = await r.json();
        if (j.status === "done" || j.status === "failed") return j;
      }
    } catch { /* transient — keep polling */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { status: "pending" };
}

// ── Background failure watch ───────────────────────────────────
//
// A send that outlives the foreground poll window returns "submitted", and
// callers WITHOUT `requireDone` report that to the user as success (see
// verifiedWrite's gateway fast path). That is right for the common case — the
// job is durable and idempotent, so it will still run — but it means a job
// that ultimately FAILS server-side surfaces nowhere: the panel already showed
// a clean send and the browser moved on. That is exactly how a stuck Evaluate
// send looked to a manager on 2026-08-11 — no error, no advance, five repeats.
//
// So whenever we stop watching in the foreground, keep watching in the
// background and shout if the job fails. Deliberately failure-only: a job still
// pending after the window is usually just a slow queue, and alarming on that
// would train people to ignore the alarm.

export interface SendFailureInfo {
  jobId: string | number;
  /** Human label for the transaction, e.g. "Evaluate send". */
  label?: string;
  /** Server-side error text (e.g. the verify-timeout / missing-label message). */
  error?: string;
}

type SendFailureListener = (info: SendFailureInfo) => void;
const failureListeners = new Set<SendFailureListener>();

/** Subscribe to sends that failed AFTER we stopped watching in the foreground.
 *  Mounted app-wide (App.tsx) so the toast reaches whoever is still at the
 *  keyboard, whatever page they moved on to. Returns an unsubscribe fn. */
export function subscribeSendFailures(cb: SendFailureListener): () => void {
  failureListeners.add(cb);
  return () => failureListeners.delete(cb);
}

function emitSendFailure(info: SendFailureInfo) {
  for (const cb of failureListeners) {
    try { cb(info); } catch { /* one bad listener must not silence the rest */ }
  }
}

/** How long to keep watching a handed-off job. Long enough to cover the
 *  gateway's own retries (MAX_JOB_ATTEMPTS × ~12s verify), short enough that
 *  the timer dies with a normal working session. */
const BACKGROUND_WATCH_MS = 180_000;

/** Watch a job we've stopped waiting on; notify subscribers if it FAILS.
 *  Fire-and-forget by design — never awaited, never throws. */
export function watchSendInBackground(
  jobId: string | number,
  label?: string,
  ms = BACKGROUND_WATCH_MS,
): void {
  void pollDone(jobId, ms)
    .then((fin) => {
      if (fin.status === "failed") emitSendFailure({ jobId, label, error: fin.error });
    })
    .catch(() => { /* best-effort: a dead network here is already visible elsewhere */ });
}

/**
 * Decide what to do when the gateway POST never got a successful ACK (H1).
 * Pure + exported so the no-double-write guarantee is unit-testable.
 *   - offline → park in the outbox, flush on the next `online` event
 *     ("queued-offline")
 *   - online + the gateway returned an ERROR STATUS (res.ok === false) → POST
 *     /send only 2xx's once the job is created/found, so a non-2xx means NO job
 *     was persisted; the caller may safely fall back to the client path
 *     ("fallback")
 *   - online + NO response at all (fetch rejected) → AMBIGUOUS: the request may
 *     have reached the gateway and created the job while the ACK was lost.
 *     Falling back to the client path would double-write (the server can't
 *     dedupe the client's direct Monday writes). POST /send is idempotent on
 *     idempotencyKey, so park the SAME payload for a safe retry
 *     ("queued-unconfirmed").
 */
export function decideLostAck(
  online: boolean,
  lastWasHttpError: boolean,
): "queued-offline" | "fallback" | "queued-unconfirmed" {
  if (!online) return "queued-offline";
  if (lastWasHttpError) return "fallback";
  return "queued-unconfirmed";
}

/**
 * Submit a send. Resolves once the job is durably accepted by the server (or
 * parked offline). Throws only when the server reports the job FAILED while we
 * were watching — callers treat a throw as "fall back to the client-side path".
 */
export async function submitSend(
  p: SendPayload,
  opts?: { waitForDone?: boolean; waitForDoneMs?: number; onPhase?: (phase: SendPhase) => void },
): Promise<SendOutcome> {
  if (!gatewaySendAvailable()) throw new Error("gateway send not configured");

  opts?.onPhase?.("posting");
  let posted: { jobId: string | number; status: string } | null = null;
  let lastErr: unknown;
  // Whether the LAST attempt got an HTTP error *response* from the gateway
  // (res.ok === false) vs. a network-level rejection with no response. This is
  // the safety hinge for H1 (see below).
  let lastWasHttpError = false;
  for (let a = 0; a < 3; a++) {
    try { posted = await postSend(p); break; }
    catch (e) {
      lastErr = e;
      lastWasHttpError = e instanceof Error && e.message.includes("/send HTTP");
      await new Promise((r) => setTimeout(r, 600 * (a + 1)));
    }
  }

  if (!posted) {
    const online = !(typeof navigator !== "undefined" && navigator.onLine === false);
    const decision = decideLostAck(online, lastWasHttpError);
    // "fallback": the gateway definitively did not persist the job → safe to let
    // the caller re-run on the client path.
    if (decision === "fallback") {
      throw lastErr instanceof Error ? lastErr : new Error("send failed");
    }
    // Otherwise park for an idempotent retry and NEVER fall back (no double
    // write). "queued-unconfirmed" also kicks a background retry so a
    // parked-while-online job still lands without a page reload.
    addToOutbox(p);
    if (decision === "queued-unconfirmed") scheduleOutboxRetry();
    return decision;
  }

  opts?.onPhase?.("accepted");
  if (opts?.waitForDone) {
    const fin = await pollDone(posted.jobId, opts.waitForDoneMs);
    if (fin.status === "failed") throw new Error("send failed server-side: " + (fin.error || ""));
    if (fin.status === "done") {
      opts?.onPhase?.("confirmed");
      return "done";
    }
    // Ran out of foreground patience while the job is still queued/processing.
    // Callers without `requireDone` report this as success, so hand the job to
    // the background watcher — otherwise a later server-side failure is silent.
    watchSendInBackground(posted.jobId, p.label);
    return "submitted";
  }
  // Never waited at all — same reasoning, same safety net.
  watchSendInBackground(posted.jobId, p.label);
  return "submitted";
}

/** Retry anything parked in the outbox. Safe to call repeatedly (idempotent). */
export async function flushOutbox(): Promise<void> {
  if (!gatewaySendAvailable()) return;
  for (const p of loadOutbox()) {
    try {
      const r = await postSend(p);
      if (r) removeFromOutbox(p.idempotencyKey);
    } catch { /* stay queued, try again next time */ }
  }
}

// Background retry for jobs parked while ONLINE (a lost-ack ambiguous failure).
// The `online` event never fires in that case (we're already online), so passive
// flushing wouldn't deliver until a page reload. This backs off and stops once
// the outbox drains, so a parked send still lands without the rep doing anything.
let outboxRetryTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleOutboxRetry(delayMs = 3000): void {
  if (outboxRetryTimer != null) return;
  outboxRetryTimer = setTimeout(() => {
    outboxRetryTimer = null;
    void flushOutbox().then(() => {
      if (outboxCount() > 0) scheduleOutboxRetry(Math.min(delayMs * 2, 60000));
    });
  }, delayMs);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => { void flushOutbox(); });
  setTimeout(() => { void flushOutbox(); }, 4000);
}
