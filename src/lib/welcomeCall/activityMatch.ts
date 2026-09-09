/**
 * Phone identity for the Welcome Call activity box.
 *
 * ⚠️ **The canonical E.164 form is the identity — not the last ten digits.**
 * `last10` is right for NARROWING a board query, because boards store numbers
 * in whatever shape they were typed and ten digits is the only substring
 * present in every rendering (§5.13). It is wrong as an IDENTITY: two numbers
 * that differ only in country code share it, so a module-scope cache keyed on
 * it can hand one patient another patient's texts.
 *
 * That collision needs an international number, and every patient on these
 * boards is NANP — so this is not a live exposure. It is fixed because
 * `toE164` is already the repo's canonical normaliser, the exactness costs
 * nothing, and §5.13's own pattern is narrow-then-verify-on-E164 rather than
 * trusting a suffix (Greptile, PR #56).
 *
 * ⚠️ `toE164` returns "" for anything it cannot normalise rather than
 * fabricating a number from partial digits — so an empty result means "we
 * cannot identify this patient", and callers must treat it as such rather than
 * falling back to a looser match.
 */
import { toE164 } from "@/lib/fax/ringcentralApi";

export function phoneIdentity(raw: string | undefined | null): string {
  return toE164(String(raw ?? ""));
}
