/**
 * The ten-minute heads-up before a booked call — what is due, and the store
 * the top-right cards read (Josh, 2026-10-02: *"a distinctly different ring
 * that goes off 10 mins before call … just have it ring twice. and a pop up in
 * the upper right like with calls saying who the call is with and when its
 * scheduled for, only show this to people assigned care coordinator"*).
 *
 * Two sources, because the two calls live in two places (§5.15, §5.30b):
 *   · intake calls — the Calendly MIRROR on Profile Send Off, read from monday;
 *   · welcome calls — Calendly ONLY (no board carries them), read through the
 *     gateway's `/calendly/day`, which caches each day for a minute.
 * Only "welcome" is asked of Calendly: the intake half is already the mirror,
 * and asking for both would announce every intake call twice.
 *
 * `ScheduledCallHost` decides; `ReminderCards` (drawn in the incoming-call
 * stack, so the two never sit on top of each other) shows.
 */
import { etPartsOf } from "@/lib/careCoordinator/scheduleEntries";
import type { CalendlyBooking } from "@/lib/careCoordinator/calendlyDay";
import { minutesOfDay, type BookedSlot } from "./workflow";

export interface CallReminder {
  /** Stable per call per day: `i:<item id>` or `w:<Calendly event URI>`. */
  key: string;
  kind: "intake" | "welcome";
  name: string;
  phone: string;
  /** HH:mm:ss, Eastern. */
  callTime: string;
  /** Where Open goes. */
  href: string;
}

/** A welcome booking as a BookedSlot, in Eastern wall-clock terms. Calendly's
 *  start is a real instant (UTC ISO) — the one place a Date is right (§9). */
export function welcomeSlot(b: CalendlyBooking): BookedSlot & { key: string; phone: string } {
  const { date, time } = etPartsOf(b.startTime);
  return {
    key: `w:${b.eventUri || `${b.startTime}|${b.email}`}`,
    name: b.name,
    phone: b.phone ?? "",
    callDate: date,
    callTime: time,
    bookingStatus: "",
  };
}


/** "in 10 min" · "in 1 min" · "now" · "started 3 min ago". */
export function untilLabel(callTime: string, nowMinutes: number): string {
  const at = minutesOfDay(callTime);
  if (at === null) return "soon";
  const d = at - nowMinutes;
  if (d > 0) return `in ${d} min`;
  if (d === 0) return "now";
  return `started ${-d} min ago`;
}

/* ── Chime once per call, across every open tab ─────────────────────────── */

const CHIMED_KEY = "mm.callReminder.chimed";
/** Forget claims after a day — keys repeat only if a call is rebooked to the same slot. */
const CHIMED_TTL_MS = 24 * 3_600_000;

/**
 * Claim the right to chime for `key`. Every open tab shows the card, but only
 * the first to claim makes the sound — a rep with four tabs must hear two
 * rings, not eight. Storage that can't be read or written (private window)
 * just means this tab chimes: a doubled sound beats a missed one.
 */
export function claimChime(key: string, now = Date.now(), storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage()): boolean {
  if (!storage) return true;
  try {
    const raw = storage.getItem(CHIMED_KEY);
    const map: Record<string, number> = raw ? JSON.parse(raw) : {};
    for (const k of Object.keys(map)) if (now - map[k] > CHIMED_TTL_MS) delete map[k];
    if (map[key]) return false;
    map[key] = now;
    storage.setItem(CHIMED_KEY, JSON.stringify(map));
    return true;
  } catch {
    return true;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/* ── The cards' store ────────────────────────────────────────────────────── */

let shown: CallReminder[] = [];
/**
 * How Open navigates. The cards draw inside `IncomingCallHost`, which sits
 * OUTSIDE the router (App.tsx), so they cannot call `useNavigate`; the host
 * inside the router registers its navigate here.
 */
let navigateTo: ((href: string) => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const reminderStore = {
  get: (): CallReminder[] => shown,
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  add(r: CallReminder): void {
    if (shown.some((x) => x.key === r.key)) return;
    shown = [...shown, r];
    emit();
  },
  dismiss(key: string): void {
    const next = shown.filter((x) => x.key !== key);
    if (next.length === shown.length) return;
    shown = next;
    emit();
  },
  /** Drop cards whose call started more than `graceMin` ago. */
  expire(nowMinutes: number, minutesOf: (t: string) => number | null, graceMin = 15): void {
    const next = shown.filter((x) => {
      const at = minutesOf(x.callTime);
      return at === null || nowMinutes - at <= graceMin;
    });
    if (next.length === shown.length) return;
    shown = next;
    emit();
  },
  setNavigator(fn: ((href: string) => void) | null): void {
    navigateTo = fn;
  },
  /** Open the patient behind a card, and drop the card. */
  open(r: CallReminder): void {
    reminderStore.dismiss(r.key);
    if (navigateTo) navigateTo(r.href);
  },
  clear(): void {
    if (!shown.length) return;
    shown = [];
    emit();
  },
};
