/**
 * The Communications popup's rules about NUMBERS (CLAUDE.md §5.50) — which of
 * a patient's numbers it shows, and which one its composer texts and its Call
 * button dials.
 *
 * Pure, and apart from the component, because each of these fails silently: a
 * number that drops out of the list is a conversation nobody can see, and a
 * composer pointed at the wrong number sends a patient's text to their
 * caregiver (or the reverse) with a green toast.
 */
import { toE164 } from "@/lib/fax/ringcentralApi";
import { fillNumbers, defaultNumber } from "@/lib/commsInbox/timeline";
import type { ItemNumber, TimelineEntry } from "@/lib/commsInbox/rules";

/** Last ten digits — the one shape every board and RingCentral rendering of a
 *  US number shares (`contactKey`'s rule, §5.28). */
export function numberKey(phone: string | null | undefined): string {
  return String(phone ?? "").replace(/\D/g, "").slice(-10);
}

/**
 * The numbers the page handed the popup, as E.164, the header's own number
 * FIRST, de-duplicated by their last ten digits. Anything that is not a whole
 * number is dropped — a popup cannot text or dial `···1234`.
 */
export function popupNumbers(primary: string, alt?: string | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of [primary, alt ?? ""]) {
    const e164 = toE164(raw || "");
    const key = numberKey(e164);
    if (!e164 || key.length !== 10 || seen.has(key)) continue;
    seen.add(key);
    out.push(e164);
  }
  return out;
}

/**
 * The item's numbers, with the header's own numbers GUARANTEED present.
 *
 * The Inbox knows a patient's numbers from the patient directory (§5.29), which
 * is at most a day old — so a number a rep corrected this morning, or a brand
 * new patient's, may not be on the item yet. The page that opened the popup
 * holds it right now, and it is the number the rep expects to text: dropping
 * it would point the composer somewhere else without saying so.
 *
 * Two steps, both conservative:
 *  1. `fillNumbers` gives a number the gateway could not read its full digits
 *     back from THESE numbers — only on a unique last four (§5.49's rule);
 *  2. a header number still missing is appended, keyed `local:<digits>` so it
 *     can never collide with a real hash.
 */
export function withHeaderNumbers(itemNumbers: ItemNumber[], headerNumbers: string[]): ItemNumber[] {
  const filled = fillNumbers(itemNumbers, headerNumbers);
  const have = new Set(filled.map((n) => numberKey(n.e164)).filter((k) => k.length === 10));
  const extra: ItemNumber[] = [];
  for (const raw of headerNumbers) {
    const e164 = toE164(raw);
    const key = numberKey(e164);
    if (!e164 || key.length !== 10 || have.has(key)) continue;
    have.add(key);
    extra.push({ hmac: `local:${key}`, last4: key.slice(-4), e164 });
  }
  return extra.length ? [...filled, ...extra] : filled;
}

/**
 * The number the composer texts and Call dials.
 *
 *  1. the one the rep CHOSE in the popup, if it is still reachable;
 *  2. otherwise the number the page opened the popup ON — the patient's number
 *     on that stage, which is what a Text button there has always texted;
 *  3. otherwise the Inbox's own default (the number the newest message came in
 *     on), so an item opened with no usable header number still works.
 */
export function activeNumber(
  numbers: ItemNumber[],
  chosenKey: string,
  primaryKey: string,
  entries: TimelineEntry[],
): ItemNumber | null {
  const reachable = numbers.filter((n) => !!n.e164);
  const byKey = (k: string) => (k ? reachable.find((n) => numberKey(n.e164) === k) ?? null : null);
  return byKey(chosenKey) ?? byKey(primaryKey) ?? defaultNumber(numbers, entries);
}
