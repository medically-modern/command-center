/**
 * benefitsDerive.ts
 * =================
 * Derivation engine for the redesigned Benefits tab (Brandon's July 2026
 * handoff — see JOSH_HANDOFF_BENEFITS.md + BENEFITS_REDESIGN_REVIEW.md).
 *
 * The rep records FACTS only:
 *   - 3 universal pass/fail checks
 *   - per product: Auth Required / Not Required
 *   - per product: Last Bill Date + Units, OR "No Billing History"
 *
 * Everything else is DERIVED here — Same-or-Similar Clear/Not-Clear/Skip,
 * the Medicare never-billed rollups (+ the "TBD" pump-date write),
 * escalation, and the stage outcome. The rep never sees or picks
 * Clear / Not Clear / Skip.
 *
 * Every date comparison is anchored to ET (Monday dates are ET,
 * timezone-naive — CLAUDE.md §9). Never compare with a bare `new Date()`.
 */

import {
  isAutoFilledMedicaidSupply,
  PRODUCT_LABELS,
  resolveHcpcs,
  type ProductId,
} from "./hcpcRules";
import type {
  CallLogRow,
  InsuranceState,
  Patient,
  ProductCodeId,
  ProductCodeState,
  SosChoice,
} from "./workflow";
import { EMPTY_INSURANCE } from "./workflow";

// ─────────────────────────────────────────────────────────────────────
// ET-anchored date helpers
// ─────────────────────────────────────────────────────────────────────

/** Today's date in America/New_York as YYYY-MM-DD. */
export function etTodayYmd(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Add (or subtract) days to a YYYY-MM-DD string — DST-safe (UTC math). */
export function addDaysYmd(ymd: string, days: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return "";
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** MM/DD/YYYY display form of a YYYY-MM-DD string. */
export function ymdToUs(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : ymd;
}

// ─────────────────────────────────────────────────────────────────────
// Lookback windows (spec §1)
// ─────────────────────────────────────────────────────────────────────

/** Case-insensitive "medicaid" in either insurance — same convention as
 *  computeNextOrderDates (workflow.ts). */
export function patientHasMedicaidIns(primary: string, secondary: string): boolean {
  return (
    (primary ?? "").toLowerCase().includes("medicaid") ||
    (secondary ?? "").toLowerCase().includes("medicaid")
  );
}

/**
 * SoS lookback per product: Insulin Pump (E0784) and CGM Monitor (E2103)
 * = 4 years; CGM Sensors / Infusion Sets / Cartridges = 90 days, or 60
 * days when the patient has Medicaid (primary or secondary).
 *
 * NOTE: "4 years" is 365*4 = 1460 days — matching both the prototype and
 * the live next-order math (workflow.ts). Whether an exact-boundary
 * patient should use calendar years (1461 w/ leap day) is an open intent
 * question for Brandon (review doc, open question 2).
 */
export function sosLookbackDays(codeId: ProductCodeId, hasMedicaid: boolean): number {
  if (codeId === "pump" || codeId === "cgm-monitor") return 365 * 4;
  return hasMedicaid ? 60 : 90;
}

/** The cutoff date: a last bill STRICTLY BEFORE this date derives Clear. */
export function sosCutoffYmd(
  codeId: ProductCodeId,
  hasMedicaid: boolean,
  todayYmd: string = etTodayYmd(),
): string {
  return addDaysYmd(todayYmd, -sosLookbackDays(codeId, hasMedicaid));
}

/** Human label for the lookback hint, e.g. "4 yr" / "90 day" / "60 day — Medicaid". */
export function sosLookbackLabel(codeId: ProductCodeId, hasMedicaid: boolean): string {
  const days = sosLookbackDays(codeId, hasMedicaid);
  if (days >= 365) return "4 yr";
  return days === 60 ? "60 day — Medicaid" : `${days} day`;
}

// ─────────────────────────────────────────────────────────────────────
// Derived Same-or-Similar (spec §1)
// ─────────────────────────────────────────────────────────────────────

/**
 * Derive a product's SoS from recorded facts. The rep NEVER picks this.
 *
 *   Auth = Required          → "skip"  (deferred until the auth resolves;
 *                                        any entered date/units are ignored)
 *   No Billing History       → "clear"
 *   Billed, date < cutoff    → "clear"
 *   Billed, date ≥ cutoff    → "not-clear"  (a bill exactly ON the cutoff
 *                                            is NOT clear — strict <)
 *   otherwise                → ""  (incomplete)
 */
export function derivedSos(
  state: ProductCodeState | undefined,
  codeId: ProductCodeId,
  hasMedicaid: boolean,
  todayYmd: string = etTodayYmd(),
): SosChoice {
  if (state?.auth === "required") return "skip";
  if (state?.sosEntry === "never") return "clear";
  if (state?.sosEntry === "billed" && state.lastBillDate) {
    return state.lastBillDate < sosCutoffYmd(codeId, hasMedicaid, todayYmd)
      ? "clear"
      : "not-clear";
  }
  return "";
}

/** Units must be a positive whole number for a billed entry to count. */
export function isValidUnits(units: string | undefined): boolean {
  if (!units || !units.trim()) return false;
  const n = Number(units);
  return Number.isInteger(n) && n > 0;
}

/**
 * Is this product's SoS entry complete?
 *   Auth = Required → true (deferred, nothing to fill)
 *   Never billed    → true
 *   Billed          → needs BOTH a date and valid units
 */
export function sosEntryComplete(state: ProductCodeState | undefined): boolean {
  if (state?.auth === "required") return true;
  if (state?.sosEntry === "never") return true;
  if (state?.sosEntry === "billed") return !!state.lastBillDate && isValidUnits(state.units);
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Never Billed derivation (spec §2)
// ─────────────────────────────────────────────────────────────────────

export interface DerivedNeverBilled {
  /** Medicare A&B + Infusion Sets AND Cartridges both never billed. */
  isCar: boolean;
  /** Medicare A&B + CGM Sensors never billed. */
  cgm: boolean;
  /** Write the literal "TBD" to the pump-date text column. Keyed on
   *  IS + Cartridges only — the pump's own entry is NOT consulted
   *  (prototype behavior; flagged as an intent question for Brandon). */
  pumpDateTbd: boolean;
}

export function deriveNeverBilled(
  ins: InsuranceState,
  primaryInsurance: string,
): DerivedNeverBilled {
  // Exact gate — other Medicare plans (Fidelis/Anthem/United/Aetna
  // Medicare) do NOT qualify. Matches the old attestation checkboxes.
  if (primaryInsurance !== "Medicare A&B") {
    return { isCar: false, cgm: false, pumpDateTbd: false };
  }
  const isCar =
    ins.codes["infusion-sets"]?.sosEntry === "never" &&
    ins.codes["cartridges"]?.sosEntry === "never";
  const cgm = ins.codes["cgm-sensors"]?.sosEntry === "never";
  return { isCar, cgm, pumpDateTbd: isCar };
}

// ─────────────────────────────────────────────────────────────────────
// Submit gating (spec §5)
// ─────────────────────────────────────────────────────────────────────

const UNIVERSAL_GATE_LABELS: Record<string, string> = {
  "in-network": "In-Network",
  active: "Insurance Active",
  "dme-benefits": "DME Benefits",
};

const PRODUCT_TO_CODE_ID: Record<ProductId, ProductCodeId> = {
  monitor: "cgm-monitor",
  sensors: "cgm-sensors",
  insulin_pump: "pump",
  infusion_set: "infusion-sets",
  cartridge: "cartridges",
};

/**
 * Gating for "Benefit Check Complete": all 3 universal checks answered
 * (a Not-Confirmed answer PASSES gating — it escalates instead), and
 * every VISIBLE product has Auth answered AND a complete SoS entry
 * (date + valid units, Never Billed, or deferred-by-auth).
 */
export function validateBenefitsFactsForSubmit(patient: Patient): string[] {
  const missing: string[] = [];
  const ins = patient.insurance ?? EMPTY_INSURANCE;

  for (const id of ["in-network", "active", "dme-benefits"] as const) {
    if (!ins.universal[id]) missing.push(UNIVERSAL_GATE_LABELS[id]);
  }

  const resolved = resolveHcpcs(
    patient.primaryInsurance || null,
    patient.serving || null,
    patient.secondaryInsurance ?? null,
  );
  for (const r of resolved.filter((x) => !isAutoFilledMedicaidSupply(x))) {
    const state = ins.codes[PRODUCT_TO_CODE_ID[r.product]];
    if (!state?.auth) missing.push(`${r.hcpc} · Auth Requirements`);
    else if (!sosEntryComplete(state)) {
      missing.push(`${r.hcpc} · Last Bill Date + Units, or No Billing History`);
    }
  }
  return missing;
}

// ─────────────────────────────────────────────────────────────────────
// Call logs (spec §4, decision D8 — two dedicated append-only columns)
// ─────────────────────────────────────────────────────────────────────

/** A row is meaningful when either field has content. */
export function isBlankCallRow(row: CallLogRow): boolean {
  return !(row.ref ?? "").trim() && !(row.note ?? "").trim();
}

/** One line per call: "[Benefits call · ref 4821-A · 2026-07-13] <notes>".
 *  Section-2 rows are tagged as SoS/auth calls. Fully-blank rows are
 *  discarded before appending. */
export function composeCallLogLines(
  rows: CallLogRow[],
  section: "benefits" | "sos-auth",
  dateYmd: string = etTodayYmd(),
): string[] {
  const tag = section === "benefits" ? "Benefits call" : "SoS/auth call";
  return rows
    .filter((r) => !isBlankCallRow(r))
    .map((r) => {
      const ref = (r.ref ?? "").trim();
      const note = (r.note ?? "").trim();
      const head = ref ? `[${tag} · ref ${ref} · ${dateYmd}]` : `[${tag} · ${dateYmd}]`;
      return note ? `${head} ${note}` : head;
    });
}

/** Append new lines onto the existing column text. Never drops history. */
export function appendCallLog(existing: string | null | undefined, lines: string[]): string {
  const base = (existing ?? "").trimEnd();
  if (lines.length === 0) return base;
  return base ? `${base}\n${lines.join("\n")}` : lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────
// Escalation reason (decision D4 — appended to Call Reference Notes)
// ─────────────────────────────────────────────────────────────────────

/**
 * Compose the auto-escalation reason line. Returns "" when nothing
 * escalates. Escalation = any universal check Not Confirmed OR the
 * pump's derived SoS = Not Clear (spec §5 — other products being
 * Not Clear do NOT escalate).
 */
export function composeEscalationReason(
  ins: InsuranceState,
  pumpSos: SosChoice,
  pumpLastBill: string | undefined,
  dateYmd: string = etTodayYmd(),
): string {
  const reasons: string[] = [];
  if (ins.universal["in-network"] === "not-confirmed") reasons.push("In-Network = Out-of-Network");
  if (ins.universal["active"] === "not-confirmed") reasons.push("Insurance Active = Not Active");
  if (ins.universal["dme-benefits"] === "not-confirmed") reasons.push("DME Benefits = Not Covered");
  if (pumpSos === "not-clear") {
    reasons.push(
      pumpLastBill
        ? `Insulin Pump SoS Not Clear (last billed ${pumpLastBill}, within the 4-yr window)`
        : "Insulin Pump SoS Not Clear",
    );
  }
  if (reasons.length === 0) return "";
  return `[Auto-escalated · ${dateYmd}] ${reasons.join("; ")}`;
}

// ─────────────────────────────────────────────────────────────────────
// Full board preview — drives the "Monday Board Output" drawer AND is
// exercised by tests so the drawer stays in lockstep with the send path.
// ─────────────────────────────────────────────────────────────────────

export interface BenefitsPreview {
  ready: boolean;
  activeNetwork: string; // "Active/In-network" | "Stuck" | "—"
  dmeBenefits: string;   // "Yes" | "Partial / No" | "—"
  auth: string;          // "Auths Required" | "No Auths Required" | "—"
  sos: string;           // "All Clear" | "Partial / Not Clear" | "Skip" | "—"
  notClearProducts: string[];
  skipProducts: string[];
  stage: string;         // board labels: "Benefits / SoS" | "Submit Auth." | "Complete"
  escalation: string;    // "Escalation Required" | "Done"
  nextOrder: { ip: string; sensors: string; supplies: string };
  neverBilled: DerivedNeverBilled;
  /** Per-product auth-result labels keyed by ProductId ("Required" /
   *  "No Auth Needed" / "Not Serving" / "—"). Only written to the board
   *  when at least one product requires auth. */
  authResults: Record<ProductId, string>;
  anyAuthRequired: boolean;
  /** Derived SoS per code id — "" when incomplete. */
  derived: Partial<Record<ProductCodeId, SosChoice>>;
}

const CODE_ID_TO_LABEL: Record<ProductCodeId, string> = {
  pump: PRODUCT_LABELS.insulin_pump,
  "cgm-monitor": PRODUCT_LABELS.monitor,
  "cgm-sensors": PRODUCT_LABELS.sensors,
  "infusion-sets": PRODUCT_LABELS.infusion_set,
  cartridges: PRODUCT_LABELS.cartridge,
};

export function deriveBenefitsPreview(
  patient: Patient,
  todayYmd: string = etTodayYmd(),
): BenefitsPreview {
  const ins = patient.insurance ?? EMPTY_INSURANCE;
  const primary = patient.primaryInsurance ?? "";
  const secondary = patient.secondaryInsurance ?? "";
  const hasMedicaid = patientHasMedicaidIns(primary, secondary);

  const resolved = resolveHcpcs(primary || null, patient.serving || null, secondary || null);

  // Per-product effective state: hidden Medicaid supplies are hardcoded
  // Auth=Required / SoS=Clear (they're handled at the DVS stage but the
  // board must still show Required so the DVS automation can key on it).
  const productStates: Array<{
    cid: ProductCodeId;
    product: ProductId;
    auth: string;
    sos: SosChoice;
    complete: boolean;
    hidden: boolean;
  }> = resolved.map((r) => {
    const cid = PRODUCT_TO_CODE_ID[r.product];
    const state = ins.codes[cid];
    if (isAutoFilledMedicaidSupply(r)) {
      return { cid, product: r.product, auth: "required", sos: "clear", complete: true, hidden: true };
    }
    return {
      cid,
      product: r.product,
      auth: state?.auth ?? "",
      sos: derivedSos(state, cid, hasMedicaid, todayYmd),
      complete: !!state?.auth && sosEntryComplete(state),
      hidden: false,
    };
  });

  const derived: Partial<Record<ProductCodeId, SosChoice>> = {};
  for (const s of productStates) derived[s.cid] = s.sos;

  const uVals = Object.values(ins.universal);
  const universalAllConfirmed = uVals.length > 0 && uVals.every((v) => v === "confirmed");
  const anyUniversalNotConfirmed = uVals.some((v) => v === "not-confirmed");

  const inNet = ins.universal["in-network"];
  const active = ins.universal["active"];
  const activeNetwork =
    inNet === "confirmed" && active === "confirmed"
      ? "Active/In-network"
      : inNet === "not-confirmed" || active === "not-confirmed"
        ? "Stuck"
        : "—";
  const dme = ins.universal["dme-benefits"];
  const dmeBenefits = dme === "confirmed" ? "Yes" : dme === "not-confirmed" ? "Partial / No" : "—";

  const allFilled = productStates.length > 0 && productStates.every((s) => s.complete && s.auth);
  const anyAuthRequired = productStates.some((s) => s.auth === "required");
  const anyNotClear = productStates.some((s) => s.sos === "not-clear");
  const anySkip = productStates.some((s) => s.sos === "skip");

  const auth = !allFilled ? "—" : anyAuthRequired ? "Auths Required" : "No Auths Required";
  const sos = !allFilled ? "—" : anyNotClear ? "Partial / Not Clear" : anySkip ? "Skip" : "All Clear";

  const notClearProducts = productStates.filter((s) => s.sos === "not-clear").map((s) => CODE_ID_TO_LABEL[s.cid]);
  const skipProducts = productStates.filter((s) => s.sos === "skip").map((s) => CODE_ID_TO_LABEL[s.cid]);

  const pumpNotClear = productStates.some((s) => s.cid === "pump" && s.sos === "not-clear");
  const shouldEscalate = anyUniversalNotConfirmed || pumpNotClear;
  const stage =
    anyUniversalNotConfirmed || !universalAllConfirmed || !allFilled || pumpNotClear
      ? "Benefits / SoS"
      : anyAuthRequired
        ? "Submit Auth."
        : "Complete";

  // Next Order Dates keep the existing math — but a product whose SoS is
  // deferred (Skip) contributes nothing (spec §1: entered date/units are
  // ignored while Auth = Required).
  const usable = (cid: ProductCodeId): string => {
    if (derived[cid] === "skip") return "";
    return ins.codes[cid]?.lastBillDate ?? "";
  };
  const later = (a: string, b: string) => (!a ? b : !b ? a : a >= b ? a : b);
  const pumpBill = usable("pump");
  const sensorsBill = usable("cgm-sensors");
  const suppliesBill = later(usable("infusion-sets"), usable("cartridges"));
  const nextOrder = {
    ip: pumpBill ? addDaysYmd(pumpBill, 365 * 4) : "",
    sensors: sensorsBill ? addDaysYmd(sensorsBill, 90) : "",
    supplies: suppliesBill ? addDaysYmd(suppliesBill, hasMedicaid ? 60 : 90) : "",
  };

  const neverBilled = deriveNeverBilled(ins, primary);

  const servedProducts = new Set(productStates.map((s) => s.product));
  const authResults = {} as Record<ProductId, string>;
  for (const product of ["monitor", "sensors", "insulin_pump", "infusion_set", "cartridge"] as ProductId[]) {
    const st = productStates.find((s) => s.product === product);
    authResults[product] = st
      ? st.auth === "required"
        ? "Required"
        : st.auth === "not-required"
          ? "No Auth Needed"
          : "—"
      : servedProducts.size > 0
        ? "Not Serving"
        : "—";
  }

  return {
    ready: productStates.length > 0,
    activeNetwork,
    dmeBenefits,
    auth,
    sos,
    notClearProducts,
    skipProducts,
    stage,
    escalation: shouldEscalate ? "Escalation Required" : "Done",
    nextOrder,
    neverBilled,
    authResults,
    anyAuthRequired,
    derived,
  };
}
