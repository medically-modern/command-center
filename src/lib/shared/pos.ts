/**
 * lib/shared/pos.ts — SINGLE source of truth for address-state parsing and
 * the POS Home/Office rule.
 *
 * Used by:
 *  - Welcome Call submit: compute `expectedPos(...)` and write it to the
 *    Welcome Call board's POS status column (constants below).
 *  - Final Confirm check pack (lib/finalConfirm/checkPack.ts): C1 host-state
 *    checks + C23 POS verification.
 *  - lib/profile/primaryInsurance.ts carries an identical resolveState —
 *    migrate it to import from here when convenient (collapse the parsers;
 *    two copies WILL drift).
 *
 * The rule (Book 1 / POS handoffs, Brandon 2026-08-03): POS is a pure
 * function of Primary Insurance + patient address — never rep-entered.
 * Out-of-state Blue → Office (11), billed via Anthem NY 803 BlueCard;
 * everything else → Home (12).
 */

/* ── Welcome Call board POS column (verified live 2026-08-03) ── */
export const POS_COLUMN_ID = "color_mm5wq0ys"; // Welcome Call board 18410804557
export const POS_INDEX = { Office: 0, Home: 1 } as const;
/* Downstream POS columns fed by the create-item automation mappings:
 * Subscription Board - Updated 18407459988 → color_mm3rdr14
 * New Order Board 18405457690 → color_mm3rfpkt  (both Office=0 | Home=1) */

/* ── State resolution (moved verbatim from lib/profile/primaryInsurance.ts) ── */

const STATE_NAME2ABBR: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};
const US_ABBRS = new Set(Object.values(STATE_NAME2ABBR));

export function resolveState(addr: string): string {
  if (!addr) return "";
  const up = String(addr).toUpperCase();
  const padded = " " + up.replace(/[^A-Z0-9]/g, " ").replace(/\s+/g, " ") + " ";
  for (const name in STATE_NAME2ABBR) {
    if (padded.includes(" " + name.toUpperCase() + " ")) return STATE_NAME2ABBR[name];
  }
  const m = up.match(/\b([A-Z]{2})\b\s*,?\s*\d{5}/);
  if (m && US_ABBRS.has(m[1])) return m[1];
  const toks = padded.trim().split(" ").filter((t) => US_ABBRS.has(t));
  if (toks.length) return toks[toks.length - 1];
  return "";
}

/* ── The POS rule ── */

/** Canonical BCBS-family Primary Insurance labels (board label set). */
export const BCBS_FAMILY = new Set([
  "Horizon BCBS", "BCBS TN", "BCBS FL", "BCBS WY",
  "Anthem BCBS Commercial", "Anthem BCBS Medicare",
  "Anthem BCBS Medicaid (JLJ)", "Anthem BCBS Low-Cost (JLJ)",
]);

/** States inside the footprint — a Blue member living here is POS Home. */
export const IN_FOOTPRINT_STATES = new Set(["NY", "NJ", "TN", "FL", "WY"]);

/**
 * Deterministic POS rule. Compute at Welcome Call submit with the
 * effective (edited-over-original) primary + address; verify at Final
 * Confirm (check C23). Address state is the sole driver; member-ID prefix
 * is corroboration only.
 */
export function expectedPos(primary: string, address: string): "Office" | "Home" {
  const state = resolveState(address);
  return BCBS_FAMILY.has(primary) && !!state && !IN_FOOTPRINT_STATES.has(state)
    ? "Office"
    : "Home";
}
