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

export type RegistrationFailure = "full" | "auth" | "gateway" | "network" | "unknown";

/**
 * The two deadline messages softphone.ts raises, kept HERE so the classifier
 * can recognise them by identity instead of by wording.
 *
 * ⚠️ Both used to be classified `network` and shown as "Can't reach
 * RingCentral's phone server" — because both contain the words "timed out"
 * (2026-09-28). One of them is not about RingCentral at all: it is OUR gateway
 * failing to answer `/messaging/sip-provision`. A rep reporting the RingCentral
 * sentence could therefore be reporting any of three different faults, and the
 * one thing everybody would do about it — look at RingCentral — was wrong for
 * one of them.
 */
export const PROVISION_TIMEOUT_MESSAGE = "Setting up calling timed out — the gateway didn't answer";
export const START_TIMEOUT_MESSAGE = "RingCentral's phone server timed out before this browser was registered";

/**
 * How many failures in a row before the cached credentials are thrown away and
 * re-provisioned, for a failure kind that is not itself about credentials.
 *
 * ⚠️⚠️ **THIS IS THE FIX FOR A REGISTRATION THAT RETRIES FOR EVER** (Katie on
 * prod, 2026-09-28: *"cant connct ring centerals phone server retrying and it
 * never resolves"*). `auth` was the ONLY kind that dropped the cached sipInfo,
 * and the SDK does not reliably give us an `auth`: per §5.13b, the web-phone
 * SDK's `register()` awaits a promise with **no rejection path**, so a REGISTER
 * that RingCentral REFUSES can hang exactly like one it never answered. Our own
 * 20s deadline then fires, its message says "timed out", that classifies as
 * `network` — and `network` keeps the credentials. So a browser holding a
 * sipInfo RingCentral no longer accepts re-tried the same dead credentials
 * every 60s, for the seven days of the cache TTL, with nothing on screen but
 * "Retrying…".
 *
 * Three is the count because the ladder's first rungs (2s · 4s · 8s) are where
 * a genuinely transient network blip recovers; anything still failing after
 * those is worth the cost of a fresh provision.
 */
export const REFRESH_CREDENTIALS_AFTER = 3;
/** And then only once every this many attempts — a provision mints a NEW
 *  RingCentral device record (§5.13b) and the gateway floors the route at 8s
 *  (§5.53), so a refresh on EVERY retry is the 2026-09-25 metronome again. At
 *  the top of the 60s ladder this is one provision every five minutes. */
export const REFRESH_CREDENTIALS_EVERY = 5;

/**
 * Should this attempt throw away the cached sipInfo and provision fresh ones?
 *
 * `full` never does: the line having five devices says nothing about whether
 * this browser's credentials are good, and re-provisioning while waiting for a
 * slot would mint device records that take up more of them.
 */
export function shouldRefreshCredentials(kind: RegistrationFailure, attempt: number): boolean {
  if (kind === "full") return false;
  if (kind === "auth") return true;
  const n = Math.max(0, Math.floor(attempt));
  if (n < REFRESH_CREDENTIALS_AFTER) return false;
  return (n - REFRESH_CREDENTIALS_AFTER) % REFRESH_CREDENTIALS_EVERY === 0;
}

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
  // ⚠️ Before the generic "timed out" rule below, which would otherwise call
  // OUR gateway's silence a RingCentral outage. Matched on identity, not on
  // the sentence, so re-wording the message cannot silently re-bucket it.
  if (text === PROVISION_TIMEOUT_MESSAGE || /gateway didn't answer/i.test(text)) return "gateway";
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
 *   auth     — exponential, 10s → 60s. The first retry is quick because the
 *              cached sipInfo has been thrown away and fresh credentials fix
 *              the ordinary case — but ⚠️ it is a LADDER, never a flat beat:
 *              every auth retry re-fetches provision (the cache was just
 *              cleared), so a REGISTER that keeps being refused re-provisions
 *              on every cycle. On 2026-09-25 a browser did exactly that at a
 *              flat 5s for twelve straight minutes — ~10 gateway + RingCentral
 *              sip-provision calls a minute, a fresh RC device record minted
 *              each time — and helped draw a real RingCentral 429 on the
 *              shared account at 9:48 AM. The gateway also floors the
 *              provision route now (`SIP_PROVISION_FLOOR_MS`, messaging.mjs);
 *              this ladder's first rung must stay ABOVE that floor or every
 *              genuine auth recovery eats a 429 on its first retry.
 *   network / unknown — exponential, 2s → 60s, the SDK README's own ladder.
 */
export function retryDelayMs(kind: RegistrationFailure, attempt: number): number {
  if (kind === "full") return FULL_RETRY_MS;
  const n = Math.max(0, Math.floor(attempt));
  // `gateway` rides the auth ladder, not the network one: like auth, its retry
  // re-fetches provision, so it must stay above the gateway's own 8s floor.
  if (kind === "auth" || kind === "gateway") return Math.min(60_000, 10_000 * 2 ** n);
  return Math.min(60_000, 2_000 * 2 ** n);
}

/** The sentence the rep sees for a failed registration. */
export function describeRegistrationFailure(kind: RegistrationFailure, raw: unknown): string {
  switch (kind) {
    case "full":
      return "The line already has five devices registered, so this browser can't ring right now. It retries every minute — quitting a RingCentral app or a spare Command Center browser frees a slot.";
    case "auth": {
      // RingCentral's own status code, so a refusal can be told from another
      // without a browser console (2026-09-30: "rejected" alone left us guessing).
      const code = /\b(401|403|407)\b/.exec(messageOf(raw))?.[1];
      return `RingCentral rejected this browser's phone credentials${code ? ` (SIP ${code})` : ""}. Fetching fresh ones…`;
    }
    case "gateway":
      // Names the half that is actually down. "Can't reach RingCentral" sent
      // everyone to look at RingCentral for a gateway that wasn't answering.
      return "The Command Center's calling service didn't answer. Retrying…";
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

/** Which RingCentral extension a provision is for: the person's OWN (they
 *  connected their login, §5.13c) or the SHARED one (Katie's, §5.13b). */
export type SipLine = "own" | "shared";

interface CachedSipInfo {
  email: string;
  at: number;
  sipInfo: SipInfo;
}

/** ⚠️ The shared line keeps the key it has always had, so nothing about how
 *  the shared line is cached changes; a person's own line (§5.13c) is kept
 *  beside it under its own key, so neither ever overwrites the other. */
export function sipInfoKeyFor(line: SipLine): string {
  return line === "own" ? `${SIP_INFO_KEY}:own` : SIP_INFO_KEY;
}

/**
 * The cached provision, if it is this person's and younger than the TTL.
 * Scoped to the signed-in email so a shared machine handed to somebody else
 * re-provisions rather than reusing a device record minted for the last user.
 */
export function readCachedSipInfo(
  storage: StorageLike,
  email: string,
  now: number,
  line: SipLine = "shared",
): SipInfo | null {
  try {
    const raw = storage.getItem(sipInfoKeyFor(line));
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

export function writeCachedSipInfo(
  storage: StorageLike,
  email: string,
  sipInfo: SipInfo,
  now: number,
  line: SipLine = "shared",
): void {
  const c: CachedSipInfo = { email: email.toLowerCase(), at: now, sipInfo };
  try {
    storage.setItem(sipInfoKeyFor(line), JSON.stringify(c));
  } catch {
    /* storage disabled */
  }
}

export function clearCachedSipInfo(storage: StorageLike): void {
  try {
    storage.removeItem(SIP_INFO_KEY);
    storage.removeItem(sipInfoKeyFor("own"));
  } catch {
    /* storage disabled */
  }
}
