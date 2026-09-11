/**
 * Block B of Brandon's Insurance section (2026-09-09) — the authorisation state
 * as one chip per product, READ ONLY.
 *
 * *"One chip per product in Serving only (a supplies-only patient sees two
 * chips, not five)… Exceptions sort first so the problem is the first thing the
 * eye hits… When every served product is green or grey, collapse to one
 * sentence. Chips only appear when something isn't clear."*
 *
 * ⚠️ **Two things the Lovable mockup shows are deliberately NOT here**, on
 * Brandon's explicit instruction, and both would have been wrong:
 *   - **A single "Auth expires" field.** Each product carries its own Auth End
 *     on the board, so one date is wrong the moment two differ — and it would
 *     be wrong quietly, reading as authoritative.
 *   - **"Auth notes".** There is no column for it. A box whose contents vanish
 *     on save is worse than no box.
 *
 * Nothing here writes. These five columns are the Insurance stage's output.
 */
import { servingIncludesCgm, servingIncludesPump } from "./workflow";
import { servingSellsPumpDevice } from "@/lib/shared/servingLines";

export type AuthTone = "green" | "grey" | "amber" | "red";

export interface AuthProduct {
  key: "cgm" | "sensors" | "pump" | "infusionSet" | "cartridge";
  label: string;
  result: string;
  /** Auth End, as the board's naive-ET string. */
  end: string;
  /** For the tooltip — Brandon: "a hover can show Auth ID + Auth Start". */
  authId: string;
  start: string;
  /**
   * Auth Units — how many the payer approved.
   *
   * ⚠️ Blank on almost every live row today, and not because the read is wrong:
   * the Insurance board holds the numbers and create-item automation 7918324247
   * does not copy them (56 of 57 Welcome Call rows empty, checked 2026-09-11).
   * Rendered as "—" rather than hidden, so the gap is visible rather than
   * looking like a product that simply has no limit.
   */
  units: string;
}

export interface AuthChip extends AuthProduct {
  tone: AuthTone;
  /** The chip's own words, e.g. "thru 12/31/26" or "pending". */
  state: string;
  /** False for green and grey — i.e. this one needs no attention. */
  exception: boolean;
}

/**
 * Which products this patient is actually being set up for.
 *
 * ⚠️ **The pump DEVICE is gated on `servingSellsPumpDevice`, the supplies on
 * `servingIncludesPump`.** They are different questions and this got it wrong
 * first time round: `servingIncludesPump` is TRUE for "Supplies" — correctly,
 * since infusion sets and cartridges ARE pump supplies — so keying the device
 * on it gave a supplies-only patient THREE chips. Brandon's own example is the
 * spec: *"a supplies-only patient sees two chips, not five"*. Worse than a
 * wrong count, a blank or Denied pump-device result then claimed the order
 * could not ship, when the downstream gate only ever needed the infusion-set
 * and cartridge auths — a patient who owns their pump has no device auth to
 * get. Same §5.22 distinction as Pump Qty, one product over.
 */
export function servedAuthKeys(serving: string): AuthProduct["key"][] {
  const out: AuthProduct["key"][] = [];
  if (servingIncludesCgm(serving)) out.push("cgm", "sensors");
  if (servingSellsPumpDevice(serving)) out.push("pump");
  if (servingIncludesPump(serving)) out.push("infusionSet", "cartridge");
  return out;
}

/** `2026-12-31` → `12/31/26`, by string surgery. ⚠️ Never `new Date(...)`: the
 *  board's date columns are timezone-naive ET and a Date reinterprets them in
 *  the viewer's zone (§9). */
export function shortDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((ymd ?? "").trim());
  if (!m) return "";
  return `${Number(m[2])}/${Number(m[3])}/${m[1].slice(2)}`;
}

/**
 * Brandon's mapping, verified against the live label set 2026-09-09 (all five
 * Auth Result columns share it): Evaluate · Auth Valid · Denied · No Auth
 * Needed · Submitted · Required · Not Serving.
 *
 * ⚠️ An UNRECOGNISED result is amber "not started", never green. A label we
 * have no rule for is an unknown, and the safe direction for an authorisation
 * is to make somebody look — a wrong green here reads as "cleared to ship".
 */
export function authChipState(result: string, end: string): { tone: AuthTone; state: string } {
  const r = (result ?? "").trim().toLowerCase();
  if (r === "auth valid") {
    const d = shortDate(end);
    return { tone: "green", state: d ? `thru ${d}` : "valid" };
  }
  if (r === "no auth needed") return { tone: "grey", state: "not required" };
  if (r === "submitted") return { tone: "amber", state: "pending" };
  if (r === "denied") return { tone: "red", state: "denied" };
  // Required · Evaluate · blank · anything unrecognised.
  return { tone: "amber", state: "not started" };
}

/** Exceptions first, then board order — "so the problem is the first thing the
 *  eye hits" (Brandon). Red before amber, since a denial is the worse news. */
const TONE_RANK: Record<AuthTone, number> = { red: 0, amber: 1, green: 2, grey: 3 };

export function buildAuthChips(products: AuthProduct[]): AuthChip[] {
  return products
    .map((p) => {
      const { tone, state } = authChipState(p.result, p.end);
      return { ...p, tone, state, exception: tone === "amber" || tone === "red" };
    })
    .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
}

export interface AuthSummary {
  /** True when every served product is green or grey. */
  allClear: boolean;
  /** The one sentence shown instead of chips when everything is clear. */
  sentence: string;
  /** What the first exception blocks, or "". */
  banner: string;
  chips: AuthChip[];
}

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

export function summariseAuths(products: AuthProduct[]): AuthSummary {
  const chips = buildAuthChips(products);
  if (chips.length === 0) {
    return { allClear: true, sentence: "", banner: "", chips: [] };
  }
  const exceptions = chips.filter((c) => c.exception);
  if (exceptions.length === 0) {
    // "Auths clear — sensors & CGM valid through 12/31/26."
    const valid = chips.filter((c) => c.tone === "green");
    const names = valid.map((c) => c.label.toLowerCase());
    const dates = [...new Set(valid.map((c) => shortDate(c.end)).filter(Boolean))];
    const through =
      dates.length === 1 ? ` valid through ${dates[0]}` : valid.length ? " valid" : "";
    const subject = names.length ? list(names) : "everything served";
    return {
      allClear: true,
      sentence: `Auths clear — ${subject}${through}.`,
      banner: "",
      chips,
    };
  }
  const worst = exceptions[0];
  const banner =
    worst.tone === "red"
      ? `${worst.label} auth denied — the order can't ship until that's resolved.`
      : `${worst.label} auth ${worst.state} — the order can't ship until it's approved.`;
  return { allClear: false, sentence: "", banner, chips };
}
