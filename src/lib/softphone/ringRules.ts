/**
 * ringRules.ts — which calls should be MAKING A SOUND right now (§5.13b).
 *
 * Pure, so it can be tested without the RingCentral SDK (the same split
 * registration.ts / ringMerge.ts / tabProtocol.ts make).
 *
 * ⚠️ **The ring follows the CARD, not the SIP leg** (Josh, 2026-09-28: *"i feel
 * like sometimes the notif pops up and it doesnt [ring]"*). Until then
 * `syncRingtone` read only `softphone.rings` — the SIP INVITEs — so a card the
 * gateway's webhook put on screen chimed only if this browser also held the
 * leg. Everything that costs us the leg while the card still arrives is
 * routine, and every one of them looked like a silent pop-up:
 *   · the registration is down or retrying (`full` — RingCentral's five,
 *     §5.13b — `registering`, `error`, or a backoff between attempts);
 *   · the RingCentral desktop app, signed in as the same shared extension, was
 *     the most recently registered instance, so the INVITE went there;
 *   · the leg simply lands a beat after the card, which made the chime late.
 * The gateway's card is the signal every assigned answerer gets (§5.13); the
 * SIP leg is only what makes **Answer** work. So the sound is keyed on the
 * card, and a browser that cannot answer in the page still rings — which is
 * what tells the rep to press Take it, or to go and look at the badge.
 */

/** Anything that can make the phone chime: a SIP leg or a gateway card. */
export interface RingLike {
  id: string;
  startedAt: number;
}

/**
 * How long one ring may keep chiming.
 *
 * ⚠️ Shorter than every window around it, deliberately. RingCentral hands an
 * unanswered call to voicemail at ~20–30s, the card's own progress bar is
 * drawn against 30s, the gateway sweeps a stranded ring at 2 min (§5.13) and
 * the browser backstops at 150s. Chiming for two and a half minutes at a call
 * nobody can still take is how a ringtone gets muted for good — and the cap is
 * also what bounds a ring forwarded by a tab that has since been closed (see
 * softphone.ts's `setCardRings`). The CARD stays up either way; this is only
 * the speaker.
 */
export const RING_AUDIBLE_MS = 45_000;

/** The gateway's cards, in the shape `useInboundCalls` publishes them. */
interface CardLike {
  id: string;
  state: "ringing" | "answered" | "missed";
  claimedBy: string | null;
  startedAt: number;
}

/**
 * The gateway cards that should be making a sound: still ringing, and not
 * already taken. A claimed call is somebody's — theirs is the phone ringing
 * now, and a chime here would be for a call that is no longer available.
 */
export function ringingCards(calls: readonly CardLike[]): RingLike[] {
  return calls
    .filter((c) => c.state === "ringing" && !c.claimedBy)
    .map((c) => ({ id: c.id, startedAt: c.startedAt || 0 }));
}

/**
 * The rings that are audible right now: not dismissed, and inside the window.
 *
 * ⚠️ De-duplicated by id — the same call reaches the leader as a SIP leg, as
 * its own card, and as a card forwarded by every other tab of this browser.
 * They are one ring and one chime.
 */
export function audibleRings(
  rings: readonly RingLike[],
  ignored: ReadonlySet<string>,
  now: number,
  maxAgeMs: number = RING_AUDIBLE_MS,
): RingLike[] {
  const seen = new Set<string>();
  const out: RingLike[] = [];
  for (const r of rings) {
    if (!r.id || seen.has(r.id) || ignored.has(r.id)) continue;
    // A ring with no start time is one we cannot age out; treat it as fresh
    // rather than as silent — a missing timestamp must never cost the sound.
    if (r.startedAt > 0 && now - r.startedAt >= maxAgeMs) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/**
 * Do these two sets describe the same rings? Guards the BroadcastChannel post
 * in `softphone.setCardRings`, which runs on every SSE update and every
 * patient-name resolution — a message per render is INCIDENT_2026-08-20's
 * shape.
 */
export function sameRings(a: readonly RingLike[], b: readonly RingLike[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((r, i) => r.id === b[i].id && r.startedAt === b[i].startedAt);
}

/**
 * When the currently audible rings stop being audible, so the caller can arm
 * one timer instead of polling. Null when nothing is ageing out (an
 * untimestamped ring, or no rings at all).
 */
export function nextExpiryMs(
  rings: readonly RingLike[],
  now: number,
  maxAgeMs: number = RING_AUDIBLE_MS,
): number | null {
  let soonest: number | null = null;
  for (const r of rings) {
    if (!(r.startedAt > 0)) continue;
    const left = r.startedAt + maxAgeMs - now;
    if (soonest === null || left < soonest) soonest = left;
  }
  if (soonest === null) return null;
  return Math.max(0, soonest);
}
