/**
 * Recordings we saved before RingCentral deleted them.
 *
 * ⚠️ **The reason this exists at all is that a purged call looks identical to a
 * call that was never recorded.** RingCentral drops the `recording` object from
 * the call-log row and keeps the row, so an aged-out call renders with its date,
 * its duration and no Play button — and until this module, the Command Center
 * had no way to know the audio existed anywhere (§5.16, §5.47). The gateway's
 * `callArchive` now holds those bytes; this is how a screen finds out.
 *
 * Two halves, and the first is the one that is easy to leave out:
 *   · `fetchArchivedAudio` — which of these calls do we hold audio for. Without
 *     it a playback fallback fixes nothing a rep can SEE, because the button is
 *     never drawn in the first place.
 *   · `archivedPlaybackUrl` — a short-lived presigned URL straight to the
 *     bucket.
 *
 * ⚠️ **PRESIGNED, NOT PROXIED, AND THAT SHAPES THE CALL.** The URL is fetched
 * with the signed-in identity (`?json=1`) and then used as a bare `src` /
 * `href`. It cannot be `fetch()`ed: a browser following a cross-origin redirect
 * with fetch needs CORS on the bucket, and Railway buckets expose no way to
 * configure it — but an `<audio src>` and an `<a href>` need no CORS at all.
 * That is also why the filename rides in the URL: a `download` attribute is
 * ignored cross-origin, so the gateway signs a Content-Disposition instead.
 *
 * ⚠️ The URL is a bearer credential for PHI and lives minutes. Fetch it when
 * the rep presses something — never ahead of time for a list, and never into
 * anything durable.
 */

import { getIdToken } from "../shared/auth";

const GATEWAY =
  (import.meta.env.VITE_MONDAY_GATEWAY_URL as string | undefined)?.replace(/\/+$/, "") || "";

/** Without a gateway there is no archive — the SPA never talks to the bucket
 *  directly, and could not: the credentials are server-side. */
export function archiveAvailable(): boolean {
  return GATEWAY.length > 0;
}

function authHeaders(): Record<string, string> {
  const token = getIdToken();
  return token ? { "X-MM-Auth": token } : {};
}

/**
 * A request to one of the gateway's other archive routes (`callCounts.ts`),
 * with the same base and the same identity header as the two below — one
 * definition, so a change to how this client authenticates reaches every
 * archive route at once.
 */
export function archiveFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = { ...(init.headers as Record<string, string> | undefined), ...authHeaders() };
  return fetch(`${GATEWAY}${path}`, { ...init, headers });
}

export interface ArchivedAudio {
  hasAudio: boolean;
  /** none | pending | stored | gone | failed — see callArchiveRules.mjs. */
  audioState: string;
  contentType: string | null;
  bytes: number | null;
  durationSec: number;
}

/**
 * Which of these call ids do we hold audio for?
 *
 * ⚠️ ONE batched question per list, never a lookup per row — a call-history
 * panel renders for every patient a rep clicks through, and a per-row request
 * against the gateway is INCIDENT_2026-08-20's shape with a nicer name. The
 * route is Postgres-only (it touches RingCentral not at all), so what it spends
 * is a single indexed read rather than the shared phone account's budget.
 *
 * ⚠️ Returns an EMPTY map on failure rather than throwing. The fallback is an
 * enhancement: a rep whose archive lookup failed sees exactly what they saw
 * before it existed, which is the right degradation. The caller must not cache
 * that emptiness as an answer — see `useArchivedAudio`.
 */
export async function fetchArchivedAudio(
  callIds: readonly string[],
): Promise<{ ok: boolean; audio: Record<string, ArchivedAudio> }> {
  const ids = [...new Set(callIds.filter(Boolean))].slice(0, 500);
  if (!archiveAvailable() || !ids.length) return { ok: true, audio: {} };
  try {
    const res = await fetch(`${GATEWAY}/calls/recordings/have`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ callIds: ids }),
    });
    if (!res.ok) return { ok: false, audio: {} };
    const json = (await res.json()) as { ok?: boolean; results?: Record<string, ArchivedAudio> };
    if (!json.ok) return { ok: false, audio: {} };
    return { ok: true, audio: json.results ?? {} };
  } catch {
    return { ok: false, audio: {} };
  }
}

/**
 * A short-lived URL that plays, or downloads, one archived recording.
 *
 * `filename` is only honoured together with `download`, because it is signed
 * into a Content-Disposition — asking for one without the other would name a
 * file nothing saves.
 */
export async function archivedPlaybackUrl(
  callId: string,
  opts: { download?: boolean; filename?: string } = {},
): Promise<string> {
  if (!archiveAvailable()) throw new Error("No archive is configured for this build.");
  const params = new URLSearchParams({ callId, json: "1" });
  if (opts.download) {
    params.set("download", "1");
    if (opts.filename) params.set("filename", opts.filename);
  }
  const res = await fetch(`${GATEWAY}/calls/recording?${params}`, { headers: authHeaders() });
  if (!res.ok) {
    // ⚠️ The gateway distinguishes "never recorded" from "purged before we got
    // there" from "queued, come back shortly", and that distinction is the
    // whole point of not flattening it to a 404 — a rep who is told the audio
    // is still being fetched waits, where "no recording" sends them away.
    let state = "";
    try {
      state = ((await res.json()) as { audioState?: string }).audioState || "";
    } catch {
      /* no body, or not JSON — fall through to the generic message */
    }
    if (state === "pending") throw new Error("This recording is still being saved — try again shortly.");
    if (state === "gone") throw new Error("RingCentral deleted this recording before we could save it.");
    if (state === "none") throw new Error("This call was never recorded.");
    throw new Error(`The archive could not serve that recording (${res.status}).`);
  }
  const json = (await res.json()) as { url?: string };
  if (!json.url) throw new Error("The archive returned no URL for that recording.");
  return json.url;
}

/**
 * Where a call's audio should come from.
 *
 * ⚠️ **THE ARCHIVE WINS WHERE WE HAVE IT**, and that is deliberate rather than
 * a fallback-shaped accident. Our own copy is free to serve (bucket egress
 * costs nothing), does not spend the shared RingCentral budget that
 * INCIDENT_2026-08-20 was about, and — unlike RingCentral's — will still be
 * there next year. RingCentral remains the source for anything recorded since
 * the last archive run, which is exactly the window the archive cannot cover.
 */
export type RecordingSource =
  | { kind: "archive"; callId: string }
  | { kind: "ringcentral"; contentUri: string }
  | null;

export function recordingSource(
  call: { id: string; recording?: { contentUri: string } },
  archived: Record<string, ArchivedAudio> = {},
): RecordingSource {
  if (archived[call.id]?.hasAudio) return { kind: "archive", callId: call.id };
  if (call.recording?.contentUri) return { kind: "ringcentral", contentUri: call.recording.contentUri };
  return null;
}

/** Does this call have audio anywhere — which is what decides whether a Play
 *  button is drawn at all. */
export function hasPlayableAudio(
  call: { id: string; recording?: { contentUri: string } },
  archived: Record<string, ArchivedAudio> = {},
): boolean {
  return recordingSource(call, archived) !== null;
}
