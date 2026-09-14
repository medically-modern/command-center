/**
 * tabProtocol.ts — one real phone per browser, mirrored into every tab.
 *
 * RingCentral counts registrations per DEVICE and caps the extension at five
 * (§5.13b), so a browser must register ONCE however many Command Center tabs
 * are open. The SDK README's "real phone plus dummy phones" model is what this
 * implements, with two browser primitives instead of a SharedWorker:
 *
 *   · Web Locks (`navigator.locks`) elect the LEADER: the tab holding the lock
 *     owns the SIP registration. A closing tab releases the lock automatically
 *     and the next waiting tab takes over and registers (a few seconds' gap).
 *   · A BroadcastChannel carries the leader's state to the other tabs, and
 *     their actions back. A follower's Answer is a message; the leader answers;
 *     the audio plays in the leader tab, which is fine — sound is sound.
 *
 * ⚠️ Without leader election every tab would register with the SAME
 * instanceId, and the SDK is explicit about what that does: only the most
 * recently registered instance receives inbound calls. Each tab re-REGISTERs
 * every ~57s, so "most recent" would rotate between tabs and the ring would
 * land in a random one.
 *
 * This file is the pure part: message shapes, guards, and the follower's view
 * of the leader's snapshot. The transport lives in softphone.ts.
 */
import type { PhoneSnapshot } from "./types";

export const CHANNEL_NAME = "mm-softphone";
export const LOCK_NAME = "mm-softphone-leader";

/** Follower → leader. */
export type TabCommand =
  | { type: "cmd"; cmd: "answer"; callId: string }
  | { type: "cmd"; cmd: "ignore"; callId: string }
  | { type: "cmd"; cmd: "hangup" }
  | { type: "cmd"; cmd: "mute"; muted: boolean }
  | { type: "cmd"; cmd: "dial"; phone: string }
  | { type: "cmd"; cmd: "dismissError" };

export type TabMessage =
  /** Leader → everyone: the whole snapshot, on every change. */
  | { type: "state"; from: string; state: PhoneSnapshot }
  /** A tab that just opened asking the leader to re-announce. */
  | { type: "hello"; from: string }
  /** The leader is going away (tab close). Followers drop its state so a stale
   *  "registered" never outlives the registration. */
  | { type: "bye"; from: string }
  | TabCommand;

const COMMANDS = new Set(["answer", "ignore", "hangup", "mute", "dial", "dismissError"]);

/** Runtime guard — BroadcastChannel delivers whatever another tab posted, and a
 *  version skew between tabs after a deploy is the ordinary case, not a rarity. */
export function isTabMessage(x: unknown): x is TabMessage {
  if (!x || typeof x !== "object") return false;
  const m = x as Record<string, unknown>;
  switch (m.type) {
    case "state":
      return typeof m.from === "string" && !!m.state && typeof m.state === "object";
    case "hello":
    case "bye":
      return typeof m.from === "string";
    case "cmd":
      return typeof m.cmd === "string" && COMMANDS.has(m.cmd);
    default:
      return false;
  }
}

/**
 * What a non-leader tab renders. The leader's snapshot verbatim, except
 * `leader: false` — and, before any leader has spoken, an honest placeholder:
 * "registering" if this person is an assigned answerer (a leader is on its
 * way), "off" otherwise. `enabled` is each tab's own reading of access.json,
 * so it never waits on the leader.
 */
export function followerView(leaderState: PhoneSnapshot | null, enabled: boolean): PhoneSnapshot {
  if (leaderState) return { ...leaderState, leader: false, enabled };
  return {
    leader: false,
    enabled,
    registration: enabled ? "registering" : "off",
    registrationError: null,
    lastError: null,
    rings: [],
    call: null,
  };
}
