/**
 * registration.ts — the pure half of registering a browser on the shared
 * RingCentral extension (§5.13b). No SDK, no DOM: everything here takes its
 * storage and clock as arguments so it can be tested.
 *
 * ── The cap this whole module exists for ───────────────────────────────────
 * RingCentral allows FIVE simultaneous SIP registrations per extension, and
 * refuses the sixth with `SIP/2.0 603 Too Many Contacts` (the web-phone SDK's
 * README, "Using unique instanceIds"). Every Command Center browser registers
 * as the SAME extension — the one the gateway's JWT belongs to — so five is the
 * ceiling on how many browsers can answer, and every RingCentral app still
 * signed in as that extension counts against it too.
 *
 * Two consequences shape the design:
 *   · ONE registration per BROWSER, never per tab (the leader election in
 *     softphone.ts), and a stable per-browser `instanceId` so a reload or a
 *     tab close does not look like a new device to RingCentral.
 *   · A refused registration is a STATE, not an error: `full` is shown to the
 *     rep and retried every minute, because a slot frees up within ~2 minutes
 *     of another browser closing.
 *   · WHO registers is assigned by a manager (accessStore `callAnswerers`,
 *     capped at the same five), never self-service: the slots are scarce and a
 *     toggle anyone could flip would hand them out first-come.
 */
import type { SipInfo } from "ringcentral-web-phone/types";

/** localStorage keys — per BROWSER on purpose (§5.13b): a device identity and
 *  its credentials belong to the machine, not the person. (Who may answer at
 *  all is NOT stored here: that is assigned by a manager in access.json.) */
export const INSTANCE_ID_KEY = "mm-softphone-instance";
export const SIP_INFO_KEY = "mm-softphone-sip";
/** The ringtone mute — per BROWSER too: it is about the speaker on this desk. */
export const MUTE_KEY = "mm-softphone-muted";

/**
 * How long a provisioned `sipInfo` is reused before asking the gateway again.
 * The SDK README: "you may save and re-use sipInfo for a long time". Every
 * `sip-provision` call creates a NEW device record on the RingCentral side —
 * the account grew nine of them in a month from the old provision-per-page-load
 * — so reuse is not only faster, it keeps the extension's device list sane.
 */
export const SIP_INFO_TTL_MS = 7 * 24 * 60 * 60_000;

/** How long a `full` verdict waits before trying again. A closed browser's
 *  slot is freed by the SIP server within ~2 minutes (SDK README). */
export const FULL_RETRY_MS = 60_000;

export type RegistrationFailure = "full" | "auth" | "network" | "unknown";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Sort a failed `webPhone.start()` (or a failed provision) into what to DO
 * about it. The SDK throws `Error("Registration failed: <SIP status line>")`
 * for a refused REGISTER; a WebSocket that never opened rejects with a bare
 * `Event`; the gateway's provision route fails with a fetch error or a JSON
 * `{error}`.
 *
 * ⚠️ `full` must be matched on the SIP status, not on wording: "603" is the
 * contract, "Too Many Contacts" is RingCentral's phrasing of it today.
 */
export function classifyRegistrationError(err: unknown): RegistrationFailure {
  const text = messageOf(err);
  if (/\b603\b/.test(text) || /too many contacts/i.test(text)) return "full";
  if (/\b(401|403|407)\b/.test(text) || /unauthori[sz]ed|forbidden/i.test(text)) return "auth";
  if (typeof Event !== "undefined" && err instanceof Event) return "network";
  if (/websocket|network|failed to fetch|load failed|ECONN|timed? ?out/i.test(text)) return "network";
  return "unknown";
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) return String((err as { message: unknown }).message);
  return "";
}

/**
 * When to try registering again after a failure.
 *   full     — a fixed minute: a slot may have freed up, and hammering the SIP
 *              server with REGISTERs is how you get the whole account throttled.
 *   auth     — a short beat after the cached sipInfo has been thrown away.
 *   network / unknown — exponential, 2s → 60s, the SDK README's own ladder.
 */
export function retryDelayMs(kind: RegistrationFailure, attempt: number): number {
  if (kind === "full") return FULL_RETRY_MS;
  if (kind === "auth") return 5_000;
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(60_000, 2_000 * 2 ** n);
}

/** The sentence the rep sees for a failed registration. */
export function describeRegistrationFailure(kind: RegistrationFailure, raw: unknown): string {
  switch (kind) {
    case "full":
      return "The line already has five devices registered, so this browser can't ring right now. It retries every minute — or use Take it to ring your phone.";
    case "auth":
      return "RingCentral rejected this browser's phone credentials. Fetching fresh ones…";
    case "network":
      return "Can't reach RingCentral's phone server. Retrying…";
    default: {
      const m = messageOf(raw);
      return m ? `Browser calling isn't available: ${m}` : "Browser calling isn't available right now. Retrying…";
    }
  }
}

/* ── per-browser identity ──────────────────────────────────────────────── */

/**
 * The browser's stable SIP instance id. RFC 5626 §4.1 (which the SDK README
 * points at) wants it persistent across reboots and network changes; the SDK
 * wraps it as `+sip.instance="<urn:uuid:…>"`, so what we store is the bare
 * UUID. Minted once per browser and never rotated: a new id is a new device to
 * RingCentral, and a browser that looked like a new device on every reload
 * would leak slots for two minutes at a time.
 */
export function instanceIdFor(storage: StorageLike, mint: () => string): string {
  let id = "";
  try {
    id = storage.getItem(INSTANCE_ID_KEY) || "";
  } catch {
    /* storage disabled — fall through to a session-only id */
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    id = mint();
    try {
      storage.setItem(INSTANCE_ID_KEY, id);
    } catch {
      /* storage disabled */
    }
  }
  return id;
}

/* ── ringtone mute ─────────────────────────────────────────────────────── */

/** Is the ringtone muted in this browser? Cards still show; only the sound
 *  stops. Off by default — a silent ring is a missed call. */
export function readMuted(storage: StorageLike): boolean {
  try {
    return storage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMuted(storage: StorageLike, on: boolean): void {
  try {
    if (on) storage.setItem(MUTE_KEY, "1");
    else storage.removeItem(MUTE_KEY);
  } catch {
    /* storage disabled */
  }
}

/* ── sipInfo cache ─────────────────────────────────────────────────────── */

interface CachedSipInfo {
  email: string;
  at: number;
  sipInfo: SipInfo;
}

/**
 * The cached provision, if it is this person's and younger than the TTL.
 * Scoped to the signed-in email so a shared machine handed to somebody else
 * re-provisions rather than reusing a device record minted for the last user.
 */
export function readCachedSipInfo(storage: StorageLike, email: string, now: number): SipInfo | null {
  try {
    const raw = storage.getItem(SIP_INFO_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<CachedSipInfo>;
    if (!c || c.email !== email.toLowerCase()) return null;
    if (typeof c.at !== "number" || now - c.at > SIP_INFO_TTL_MS || now < c.at) return null;
    const s = c.sipInfo;
    if (!s || !s.username || !s.domain || !s.outboundProxy) return null;
    return s;
  } catch {
    return null;
  }
}

export function writeCachedSipInfo(storage: StorageLike, email: string, sipInfo: SipInfo, now: number): void {
  const c: CachedSipInfo = { email: email.toLowerCase(), at: now, sipInfo };
  try {
    storage.setItem(SIP_INFO_KEY, JSON.stringify(c));
  } catch {
    /* storage disabled */
  }
}

export function clearCachedSipInfo(storage: StorageLike): void {
  try {
    storage.removeItem(SIP_INFO_KEY);
  } catch {
    /* storage disabled */
  }
}
