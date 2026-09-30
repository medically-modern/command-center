/**
 * Whose screen is on show — the borrow behind "Viewing: <person>" (§5.39g).
 *
 * Josh, 2026-09-19: *"clicking that should show me exactly what the other
 * logins see when they login. the whole ui should be EXACTLY what they see"* —
 * and, naming the case: *"if mashekes view has patient communication assigned
 * and i view her view it should appear … same with inventory reports metrics"*.
 *
 * So a borrow is no longer just the home PANE. It swaps the identity that every
 * display gate reads: the header tabs, the Manage menu, the Users button and
 * the home view all answer for the borrowed person. That is a deliberate change
 * from the first cut, which rendered their bars under MY permissions and so
 * could never show what they actually see.
 *
 * ⚠️⚠️ **THIS CHANGES WHAT IS SHOWN, NEVER WHAT A WRITE DOES.** Abilities gate
 * buttons and tabs and nothing else (§5.39c — "they unlock buttons; they never
 * hide information"); no write path, no Monday query and no gateway route reads
 * one. So a borrow is a PREVIEW. If an ability is ever made to guard a write,
 * that write must read the SIGNED-IN identity and not this.
 *
 * ⚠️⚠️ **CALL ANSWERING IS NEVER BORROWED.** `phoneLine` (the person's own
 * connected RingCentral line, §5.13c) drives a real SIP registration: borrowing
 * it would either register this browser as somebody else or — worse — stop MY
 * phone ringing while I look at their screen. `CallConnectionBadge` and
 * `IncomingCallHost` ask the gateway with the SIGNED-IN Google token
 * (lib/softphone/rcLine.ts) and must keep doing so; nothing here reaches it.
 * `viewAsScope.test.ts` scans for it.
 *
 * ⚠️ **Module scope, never localStorage.** A borrowed identity that survives a
 * reload is how somebody forgets they are in one. The `?viewing=` param on the
 * home page is the durable record; this store is what carries it across a
 * navigation inside one tab, so the header keeps telling the truth when you
 * click through to Communications.
 */
import { useSyncExternalStore } from "react";

let borrowedEmail = "";
const subs = new Set<() => void>();

function emit() {
  for (const fn of subs) fn();
}

/** Set (or clear, with "") whose screen is being borrowed. */
export function setViewAs(email: string) {
  const next = (email || "").trim().toLowerCase();
  if (next === borrowedEmail) return;
  borrowedEmail = next;
  emit();
}

export function getViewAs(): string {
  return borrowedEmail;
}

function subscribe(fn: () => void) {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/**
 * The email every DISPLAY gate should answer for: the borrowed person while a
 * borrow is on, otherwise the signed-in person.
 *
 * ⚠️ Returns the string, not an object — incident rule 2 (a fresh object per
 * render is a dependency array that never settles).
 */
export function useViewAs(): string {
  return useSyncExternalStore(subscribe, getViewAs, () => "");
}
