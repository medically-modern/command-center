/**
 * primaryInsurance.ts — Primary & Secondary insurance suggestion engine.
 *
 * Advisory-only: derives a suggested Primary Insurance (and Secondary) from the
 * Stedi eligibility output so the rep can confirm/override before advancing.
 * The rep's confirmed choice is what gets written to Monday
 * (`color_mm1xg10n` / `color_mm1zbrx0`); this engine never writes.
 *
 * Ported faithfully from the Profile Send-Off redesign prototype
 * (`profile-sendoff-redesign-v2.html`). Keep the label strings it returns for
 * *writable* suggestions aligned with `PRIMARY_INSURANCE_INDEX` keys in
 * `mondayMapping.ts` (the board labels), so an accepted suggestion maps to the
 * right status index on submit. Advisory-only fallbacks (e.g. "Low-Cost",
 * "Aetna Better Health") are intentionally not board labels — the rep resolves
 * them from the dropdown.
 */

import type { Patient } from "./workflow";

export type Confidence = "low" | "medium" | "high";

export interface SuggestionWarning {
  code: string;
  message: string;
}

export interface Suggestion {
  value: string | null;
  reason: string;
  confidence: Confidence;
  /** Place-of-service hint ("11" office / "12" home) — advisory display only. */
  pos: string;
  posReason?: string;
  secondary: string;
  alternatives: string[];
  warnings: SuggestionWarning[];
  /** Inputs the engine still needs (e.g. "address") to finish the suggestion. */
  needs: string[];
}

/** Normalized Stedi snapshot the engine reasons over. */
export interface StediSnapshot {
  active: string;
  covtype: string;
  plan: string;
  payerName: string;
  homeplan: string;
  /** Medicaid ID returned by Stedi ("" or "—" means none). */
  medid: string;
  qmb: string;
  ma: boolean;
  mltc: boolean;
}

export interface SuggestionInputs {
  /** Whether a Stedi check has completed (mirrors prototype `S.stedi==='done'`). */
  stediDone: boolean;
  generalInsurance: string;
  /** The working Member ID (Benefits-Check field) — used for JLJ/HZN prefix rules. */
  memberId: string;
  patientAddress: string;
  requestType: string;
  stedi: StediSnapshot;
}

// ── State resolution (patient address is the master input for Anthem/BCBS) ──
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
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY",
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
function homePlanState(hp: string): string { return resolveState(hp || ""); }

// ── Coverage classification helpers ──
function coverageCategory(s: StediSnapshot): "Medicare" | "Medicaid" | "Commercial" {
  const ct = (s.covtype || "").toLowerCase();
  const blob = (ct + " " + (s.plan || "")).toLowerCase();
  if (s.ma === true || /medicare/.test(ct) || /medicare adv|d-snp|dual (align|liberty|complete|access)|wellcare/.test(blob)) return "Medicare";
  if (/medicaid|mltc|managed medicaid|community plan/.test(blob)) return "Medicaid";
  return "Commercial";
}
function isMLTCplan(s: StediSnapshot): boolean {
  return s.mltc === true || /mltc|care at home/i.test(s.plan || "");
}
function classifyFidelisPlan(plan: string): string {
  const p = (plan || "").toLowerCase();
  if (!p) return "";
  if (/wellcare|dual align|dual liberty|medicare advantage|\bd-snp\b|\bma eligible\b/.test(p)) return "Fidelis Medicare";
  if (/healthierlife|harp/.test(p)) return "Fidelis Medicaid";
  if (/mltc|care at home/.test(p)) return "Fidelis Medicaid";
  if (/medicaid|managed care/.test(p)) return "Fidelis Medicaid";
  if (/child health plus|chip|community plan for kids/.test(p)) return "Fidelis Low-Cost";
  if (/essential plan|\bep ?\d|ep standard|essential/.test(p)) return "Fidelis Low-Cost";
  if (/ambetter|silver|gold|bronze|platinum|metal|marketplace|hsa/.test(p)) return "Fidelis Commercial";
  return "";
}
export function isMedicareAdvantage(s: StediSnapshot): boolean {
  if (s.ma === true) return true;
  const blob = ((s.covtype || "") + " " + (s.plan || "")).toLowerCase();
  return /medicare advantage|\bmapd\b|d-snp|c-snp|i-snp|dual complete|dual align|dual liberty|gold plus|\badvantage\b/.test(blob);
}
function classifyCoverage(plan: string): "Medicaid" | "Medicare" | "LowCost" | "Commercial" {
  const p = (plan || "").toLowerCase();
  if (/medicaid|managed care|community plan(?! for kids)|harp|healthierlife|better health|mltc|managed long term care|care at home|\bmap\b|\bfida\b|ma eligible|eligible pcp/.test(p)) return "Medicaid";
  if (/medicare|mapd|advantage|d-snp|c-snp|i-snp|\bsnp\b|dual complete|dual access|dual align|dual liberty|gold plus|aarp medicare|group medicare|\bsenior\b|elite \(ppo\)|patriot|complete care/.test(p)) return "Medicare";
  if (/essential plan|\bep ?\d|ep 200|child health|\bchp\b|chplus|community plan for kids/.test(p)) return "LowCost";
  return "Commercial";
}

function midHasJLJ(memberId: string): boolean { return /JLJ/.test((memberId || "").toUpperCase()); }

// DME carve-out watchlist — keyed on the home plan (extensible)
const DME_CARVE_OUT_PLANS = [{ match: /michigan/i, label: "Blue Cross Blue Shield of Michigan", carveTo: "Northwood" }];

/** NY Medicaid CIN format: 2 letters, 5 digits, 1 letter (e.g. AB12345C). */
export function isNyMedicaidId(id: string): boolean {
  return /^[A-Za-z]{2}\d{5}[A-Za-z]$/.test((id || "").trim());
}
/** A Medicaid ID only "counts" when it's in the NY Medicaid format — payers
 *  sometimes return other identifiers in this field. */
function medicaidIdPresent(s: StediSnapshot): boolean {
  return !!(s.medid && s.medid !== "—") && isNyMedicaidId(s.medid);
}
function pumpRequested(requestType: string): boolean { return /insulin pump/i.test(requestType || ""); }

// ── Anthem / BCBS ──
function anthemSubType(inp: SuggestionInputs): Suggestion & { value: string } {
  const s = inp.stedi;
  const cov = coverageCategory(s);
  const plan = s.plan || "";
  const out = blank();
  if (cov === "Medicare") { out.value = "Anthem BCBS Medicare"; out.reason = "Medicare"; return out as Suggestion & { value: string }; }
  if (/essential plan|\bep ?\d|ep standard|child health|\bchp\b|chplus/i.test(plan)) { out.value = "Anthem BCBS Low-Cost (JLJ)"; out.reason = "Low-Cost"; return out as Suggestion & { value: string }; }
  if (cov === "Medicaid" || midHasJLJ(inp.memberId)) {
    if (isMLTCplan(s)) { out.value = "Anthem BCBS Low-Cost (JLJ)"; out.reason = "MLTC"; return out as Suggestion & { value: string }; }
    out.value = "Anthem BCBS Medicaid (JLJ)"; out.reason = "Medicaid plan";
    out.warnings.push({ code: "CHECK_MEDICAID_ID", message: "Check ID card for Medicaid ID" });
    return out as Suggestion & { value: string };
  }
  out.value = "Anthem BCBS Commercial"; out.reason = "Commercial"; return out as Suggestion & { value: string };
}
function shortReason(value: string | null, state: string, isMLTC: boolean): string {
  if (!value) return "Add the patient address to finish the suggestion.";
  if (/Medicare/.test(value)) return "Anthem Medicare Advantage plan";
  if (/Medicaid \(JLJ\)/.test(value)) return "Medicaid plan name — may have Medicaid ID on card";
  if (/Low-Cost \(JLJ\)/.test(value)) return isMLTC ? "MLTC plan → Low-Cost (JLJ)" : "Low-Cost plan";
  return "Anthem insurance with " + state + " home address";
}
function anthemSuggest(inp: SuggestionInputs): Suggestion {
  const s = inp.stedi;
  const o = blank();
  const state = resolveState(inp.patientAddress);
  if (!state) {
    if (coverageCategory(s) === "Medicaid" || midHasJLJ(inp.memberId) || isMLTCplan(s)) {
      const sub = anthemSubType(inp);
      o.value = sub.value || null; o.warnings.push(...sub.warnings);
      o.pos = ""; o.confidence = sub.value ? "medium" : "low"; o.reason = shortReason(o.value, "", isMLTCplan(s));
      return o;
    }
    o.warnings.push({ code: "ADDRESS_UNRESOLVED", message: "patient address is missing" }); o.needs.push("address"); return o;
  }
  const homePlan = s.homeplan || "";
  const hps = homePlanState(homePlan);
  const HOST: Record<string, string> = { NJ: "Horizon BCBS", TN: "BCBS TN", FL: "BCBS FL", WY: "BCBS WY" };
  if (HOST[state]) {
    o.value = HOST[state]; o.pos = "12"; o.confidence = "high";
  } else if (state === "NY") {
    const sub = anthemSubType(inp);
    o.value = sub.value || null; o.secondary = sub.secondary; o.alternatives = sub.alternatives; o.needs = sub.needs;
    o.warnings.push(...sub.warnings); o.pos = "12"; o.confidence = sub.value ? "high" : "medium";
  } else {
    const sub = anthemSubType(inp);
    let val = sub.value; if (!val && !sub.needs.length) val = "Anthem BCBS Commercial";
    o.value = val || null; o.secondary = sub.secondary; o.alternatives = sub.alternatives; o.needs = sub.needs;
    o.warnings.push(...sub.warnings); o.pos = "11"; o.confidence = "medium";
    o.posReason = "POS 11 due to " + state + " home address";
    o.warnings.push({ code: "POS_11", message: "out-of-state via 803 BlueCard — POS 11 (Office)" });
    o.warnings.push({ code: "OUT_OF_STATE", message: "out-of-state Blue" + (homePlan ? " (home plan: " + homePlan + ")" : "") });
  }
  o.reason = shortReason(o.value, state, isMLTCplan(s));
  if (hps && hps !== state) {
    o.warnings.push({ code: "HOME_PLAN_MISMATCH", message: "card is " + (homePlan || hps) + " but patient lives in " + state + " — following the address; verify" });
    if (o.confidence === "high") o.confidence = "medium";
  }
  const carve = DME_CARVE_OUT_PLANS.find((c) => c.match.test(homePlan));
  if (carve) o.warnings.push({ code: "DME_CARVE_OUT", message: "DME carved out to " + carve.carveTo + " — 803 claim may reject; verify" });
  return o;
}
function fidelisSuggest(inp: SuggestionInputs): Suggestion {
  const s = inp.stedi;
  const o = blank(); o.confidence = "high";
  const plan = s.plan || "";
  o.value = classifyFidelisPlan(plan);
  if (!o.value) { const cov = coverageCategory(s); o.value = cov === "Medicare" ? "Fidelis Medicare" : (cov === "Medicaid" ? "Fidelis Medicaid" : "Fidelis Commercial"); o.confidence = "medium"; }
  o.reason = "Fidelis plan: " + (plan || "—");
  return o;
}
function unitedSuggest(inp: SuggestionInputs): Suggestion {
  const s = inp.stedi;
  const o = blank(); o.confidence = "high";
  const plan = s.plan || "";
  if (/essential plan|\bep ?\d|ep standard|child health|\bchp\b|chplus/i.test(plan)) { o.value = "United Low-Cost"; o.reason = "Essential Plan / CHP — Low-Cost"; return o; }
  const cov = coverageCategory(s);
  if (cov === "Medicare") { o.value = "United Medicare"; o.reason = "Medicare plan"; return o; }
  if (cov === "Commercial") { o.value = "United Commercial"; o.reason = "Commercial plan"; return o; }
  o.value = "United Medicaid"; o.reason = "Medicaid plan name — may have Medicaid ID on card";
  o.warnings.push({ code: "CHECK_MEDICAID_ID", message: "Check ID card for Medicaid ID" }); return o;
}

// ── Other payers (fallback book) ──
function carrierFromPayer(inp: SuggestionInputs): string {
  const s = inp.stedi;
  const pn = ((s.payerName || "") + " " + (inp.generalInsurance || "")).toUpperCase();
  if (/AETNA/.test(pn)) return "aetna";
  if (/CHLIC|CGLIC|CIGNA/.test(pn)) return "cigna";
  if (/HUMANA/.test(pn)) return "humana";
  if (/WELLCARE/.test(pn) && !/FIDELIS/.test(pn)) return "wellcare";
  if (/NYSDOH/.test(pn) || /\bMEDICAID\b/.test(pn)) return "medicaid";
  if (/MAGNACARE/.test(pn)) return "magnacare";
  if (/MIDLANDS CHOICE/.test(pn)) return "midlands";
  if (/\bCMS\b|MEDICARE A&B|MEDICARE A AND B/.test(pn) || /\bMEDICARE\b/.test((inp.generalInsurance || "").toUpperCase())) return "medicare";
  return "generic";
}
function medicaidFork(inp: SuggestionInputs, o: Suggestion, managedLabel: string, reasonBase: string, unmapped: boolean): Suggestion {
  o.value = pumpRequested(inp.requestType) ? managedLabel : "Medicaid";
  o.reason = reasonBase;
  if (!medicaidIdPresent(inp.stedi)) o.warnings.push({ code: "CHECK_MEDICAID_ID", message: "Check ID card for Medicaid ID" });
  if (unmapped) o.warnings.push({ code: "UNMAPPED_CARRIER", message: "New carrier — verify Primary Insurance" });
  return o;
}
function otherPayerSuggest(inp: SuggestionInputs): Suggestion {
  const s = inp.stedi;
  const carrier = carrierFromPayer(inp);
  const cov = classifyCoverage(s.plan);
  const o = blank(); o.confidence = "medium";
  if (cov === "LowCost") { o.value = "Low-Cost"; o.confidence = "high"; o.reason = "Essential Plan / CHP — Low-Cost"; return o; }
  if (carrier === "cigna") { o.value = "Cigna"; o.confidence = "high"; o.reason = "Cigna payer → Cigna."; return o; }
  if (carrier === "humana") { o.value = "Humana"; o.confidence = "high"; o.reason = "Humana payer → Humana."; return o; }
  if (carrier === "medicare") {
    if (isMedicareAdvantage(s)) { o.value = null; o.confidence = "low"; o.reason = "Medicare Advantage — carrier not mapped"; o.warnings.push({ code: "MA_UNMAPPED", message: "Medicare Advantage (" + (s.payerName || "unknown carrier") + ") — pick the carrier's Medicare plan or verify serviceability; not straight Medicare A&B" }); return o; }
    o.value = "Medicare A&B"; o.confidence = "high"; o.reason = "Straight Medicare A&B."; return o;
  }
  if (carrier === "medicaid") { o.value = "Medicaid"; o.confidence = "high"; o.reason = "Straight NY Medicaid (NYSDOH)."; return o; }
  if (carrier === "magnacare") { o.value = "MagnaCare"; o.confidence = "high"; o.reason = "Magnacare PPO network."; o.warnings.push({ code: "RENTAL_NETWORK", message: "PPO rental network — confirm the underlying payer before billing." }); return o; }
  if (carrier === "midlands") { o.value = "Midlands Choice"; o.confidence = "high"; o.reason = "Midlands Choice PPO network."; o.warnings.push({ code: "RENTAL_NETWORK", message: "PPO rental network — confirm the underlying payer before billing." }); return o; }
  if (carrier === "wellcare") {
    if (cov === "Medicaid" || /d-snp|dual/.test((s.plan || "").toLowerCase())) return medicaidFork(inp, o, "Wellcare", "Wellcare dual / D-SNP.", false);
    o.value = "Wellcare"; o.confidence = "high"; o.reason = "Wellcare (Medicare)."; return o;
  }
  if (carrier === "aetna") {
    if (cov === "Medicare") { o.value = "Aetna Medicare"; o.confidence = "high"; o.reason = "Aetna · Medicare plan."; return o; }
    if (cov === "Medicaid") return medicaidFork(inp, o, "Aetna Better Health", "Aetna · Medicaid (Better Health).", false);
    o.value = "Aetna Commercial"; o.confidence = "high"; o.reason = "Aetna · Commercial plan."; return o;
  }
  const label = s.payerName || inp.generalInsurance || "Unknown carrier";
  if (cov === "Medicaid") return medicaidFork(inp, o, label, "Unmapped carrier — Medicaid.", true);
  o.value = label + " " + (cov === "Medicare" ? "Medicare" : "Commercial"); o.confidence = "low";
  o.reason = "Unmapped carrier (" + label + ") — verify the right Primary Insurance.";
  o.warnings.push({ code: "UNMAPPED_CARRIER", message: "New carrier (" + label + ") — confirm the correct Primary Insurance option before sending." });
  return o;
}
/** Managed-Medicaid labels drop to plain Medicaid unless a pump is requested. */
function applyMedicaidFork(inp: SuggestionInputs, o: Suggestion | null): Suggestion | null {
  if (!o || !o.value) return o;
  const managed: Record<string, number> = { "Anthem BCBS Medicaid (JLJ)": 1, "United Medicaid": 1, "Fidelis Medicaid": 1 };
  if (!managed[o.value]) return o;
  if (!pumpRequested(inp.requestType)) { const managedPlan = o.value; o.value = "Medicaid"; o.reason = (inp.requestType || "No pump") + " → Medicaid; " + managedPlan + " is secondary"; }
  return o;
}

function payerKey(gins: string): "fidelis" | "anthem" | "united" | "other" {
  const g = (gins || "").toLowerCase();
  if (g.includes("fidelis")) return "fidelis";
  if (g.includes("anthem") || g.includes("bcbs")) return "anthem";
  if (g.includes("united")) return "united";
  return "other";
}

export function isCoverageActive(s: StediSnapshot): boolean {
  return /^active$/i.test(s.active || "") || /^yes$/i.test(s.active || "");
}

function blank(): Suggestion {
  return { value: null, reason: "", confidence: "low", pos: "", secondary: "", alternatives: [], warnings: [], needs: [] };
}

/** Main entry — suggest the Primary Insurance from Stedi output. Returns null before Stedi runs. */
export function suggestPrimary(inp: SuggestionInputs): Suggestion | null {
  if (!inp.stediDone) return null;
  if (!isCoverageActive(inp.stedi)) {
    return { value: null, reason: "Coverage came back inactive", confidence: "low", pos: "", secondary: "", alternatives: [], needs: [], warnings: [{ code: "INACTIVE", message: "Eligibility inactive — verify before selecting a Primary Insurance" }] };
  }
  const payer = payerKey(inp.generalInsurance);
  if (payer === "anthem") return applyMedicaidFork(inp, anthemSuggest(inp));
  if (payer === "fidelis") return applyMedicaidFork(inp, fidelisSuggest(inp));
  if (payer === "united") {
    if (/preferred provider/i.test(inp.stedi.plan || "")) {
      return { value: "NYSHIP", reason: "Empire Plan / NYSHIP", secondary: "", pos: "", confidence: "high", alternatives: [], needs: [], warnings: [] };
    }
    return applyMedicaidFork(inp, unitedSuggest(inp));
  }
  return otherPayerSuggest(inp);
}

/** Dual-eligible (D-SNP) — Medicaid rides behind the Medicare Advantage plan. */
export function isDualPlan(s: StediSnapshot): boolean {
  return /dual complete|d-?snp|dual align|dual liberty|\bdual\b/i.test((s.plan || "") + " " + (s.covtype || ""));
}

/**
 * Suggest Secondary Insurance — NY Medicaid when there's a Medicaid backstop
 * (Medicaid ID returned, CHECK_MEDICAID_ID caveat, QMB=Yes, or a dual plan).
 * Skipped when the primary itself is already plain (NY) Medicaid.
 */
export function suggestSecondary(inp: SuggestionInputs): string {
  if (!inp.stediDone) return "";
  if (!isCoverageActive(inp.stedi)) return "";
  const sg = suggestPrimary(inp);
  if (sg && /^medicaid$/i.test(sg.value || "")) return "";
  const hasCheck = !!(sg && sg.warnings.some((w) => w.code === "CHECK_MEDICAID_ID"));
  const qmb = /^yes/i.test(inp.stedi.qmb || "");
  if (medicaidIdPresent(inp.stedi) || hasCheck || qmb || isDualPlan(inp.stedi)) return "NY Medicaid";
  return "";
}

// ── Patient → engine input adapter ──

function truthy(v: string): boolean { return /^(yes|true|active|1)$/i.test((v || "").trim()); }

/** Build engine inputs from a Patient. `stediDone` reflects whether a Stedi
 *  result has landed (plan name or active flag populated). */
export function buildSuggestionInputs(p: Patient): SuggestionInputs {
  const stediDone = !!(p.stediPlanName?.trim() || p.stediEligibilityActive?.trim());
  return {
    stediDone,
    generalInsurance: p.generalInsurance ?? "",
    memberId: (p.workingMemberId || p.memberId1 || "").trim(),
    patientAddress: p.patientAddress ?? "",
    requestType: p.requestType ?? "",
    stedi: {
      active: p.stediEligibilityActive ?? "",
      covtype: p.stediCoverageType ?? "",
      plan: p.stediPlanName ?? "",
      payerName: p.stediPayerName ?? "",
      homeplan: p.stediHomePlan ?? "",
      medid: (p.stediMedicaidId || p.stediSecondaryMedicaidId || "").trim(),
      qmb: p.stediQmb ?? "",
      ma: truthy(p.stediMedicareAdvantage ?? ""),
      mltc: truthy(p.stediMedicaidMltc ?? ""),
    },
  };
}
