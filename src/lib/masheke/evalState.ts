// EvalState — local-only state for the Medical Necessity Evaluate tab.
// Lives in localStorage, keyed by patient ID. Never written to Monday.
// On Send (when reconnected), we'll derive Monday-bound values from this.

import type { IpPath } from "./ipPaths";
import { IP_PATH_FIELDS } from "./ipPaths";
import type { Patient } from "./workflow";

export type ValidInvalid = "Valid" | "Invalid" | "Missing";
export type YesNo = "Yes" | "No";
/** Evaluate-redesign tri-state used by the new per-product controls. */
export type YesNoInvalid = "Yes" | "No" | "Invalid";
/** Evaluate-redesign 4-state "Received?" used by CGM / IP columns. */
export type Received4 = "Yes" | "No" | "Invalid" | "Not Serving";
export type CgmCoveragePath = "Insulin" | "Hypo" | "Hypo Invalid" | "Missing" | "Not Serving";
export type LmnStatus = "Yes & Valid" | "Yes, but Invalid" | "No";

export interface LocalFile {
  name: string;
  size: number;
  addedAt: string; // ISO
}

export interface EvalState {
  // CGM block
  cgmScriptReceived?: YesNo;
  cgmScriptValid?: ValidInvalid;
  cgmCoveragePath?: CgmCoveragePath;
  generateCgmScript?: string; // "Generate" (or blank)

  // IP block
  ipScriptReceived?: YesNo;
  ipCoveragePath?: IpPath;
  ipScriptValid?: ValidInvalid;
  generateIpScript?: string; // "Generate" (or blank)
  diabetesEducation?: YesNo;
  threeInjections?: YesNo;
  cgmUse?: YesNo;
  bloodSugarIssues?: YesNo;
  lmn?: LmnStatus;
  oowDate?: string; // ISO date YYYY-MM-DD
  /** Whether the OOW date is already written on the IP script. Only relevant
   *  when path = "OOW Pump" and oowDate is set. If "No", the doctor ask becomes
   *  "Add OOW date of {date} to the script". */
  oowDateOnScript?: YesNo;
  malfunction?: YesNo;

  // Diagnosis & Clinicals
  diagnosis?: string;
  lastVisitDate?: string; // ISO date
  clinicalFiles?: LocalFile[];
  finalClinicalFiles?: LocalFile[];
  mrReceived?: YesNo;

  // ── Evaluate redesign (prototype) — UI-only tri-state fields ──
  // These drive the new 3-column layout + MN checklist. Legacy fields above
  // (cgmScriptReceived, diabetesEducation, …) are kept in sync so the existing
  // Monday send/validity logic still works.
  clinReceived3?: YesNoInvalid; // Clinicals Received? Yes / No / Invalid
  cgmLanguage?: YesNoInvalid; // the single CGM language answer (Insulin or Hypo)
  ipEducationV?: YesNoInvalid;
  ipThreeInjectionsV?: YesNoInvalid;
  ipCgmUseV?: YesNoInvalid;
  ipBsIssuesV?: YesNoInvalid;
  ipLmnV?: YesNoInvalid;
  ipMalfunctionV?: YesNoInvalid;
  ipOowOnScriptV?: YesNoInvalid;

  // Notes
  notes?: string;
}

const STORAGE_PREFIX = "mn-eval:";

export function loadEvalState(patientId: string): EvalState {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + patientId);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as EvalState;
    // Strip any stale "Generate" trigger values that may have been persisted
    // before we made these fields ephemeral.
    delete parsed.generateCgmScript;
    delete parsed.generateIpScript;
    return parsed;
  } catch {
    return {};
  }
}

export function saveEvalState(patientId: string, state: EvalState): void {
  if (typeof localStorage === "undefined") return;
  try {
    // Strip transient "Generate" trigger fields — they are tied to a single
    // in-flight DocExport run and should not survive a reload. Otherwise the
    // toggle stays stuck on "Generating…" forever.
    const {
      generateCgmScript: _gcgm,
      generateIpScript: _gip,
      ...persistable
    } = state;
    void _gcgm;
    void _gip;
    localStorage.setItem(STORAGE_PREFIX + patientId, JSON.stringify(persistable));
  } catch {
    // Storage may be full or disabled — fail silently.
  }
}

export function clearEvalState(patientId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_PREFIX + patientId);
}

/**
 * Fields whose source of truth is a Monday column. When local draft state and
 * Monday disagree, MONDAY ALWAYS WINS — including when Monday is blank (a
 * cleared column clears the local draft too). Fields NOT listed here exist
 * only in the Evaluate form (script validity, OOW details, IP requirement
 * answers, …) and keep their local draft values between sessions.
 */
const MONDAY_BACKED_FIELDS = [
  "ipCoveragePath",
  "cgmCoveragePath",
  "diagnosis",
  "mrReceived",
  "lastVisitDate",
  "notes",
  "cgmScriptReceived",
  "ipScriptReceived",
  // IP requirement answers + their legacy mirrors — reconstructed from Monday's
  // reason dropdowns so the board (not the browser cache) is the source of truth.
  "ipEducationV",
  "ipThreeInjectionsV",
  "ipCgmUseV",
  "ipBsIssuesV",
  "ipLmnV",
  "ipMalfunctionV",
  "diabetesEducation",
  "threeInjections",
  "cgmUse",
  "bloodSugarIssues",
  "lmn",
  "malfunction",
  // Script validity (Invalid) + CGM Language + clinicals received.
  "ipScriptValid",
  "cgmScriptValid",
  "cgmLanguage",
  "clinReceived3",
] as const satisfies readonly (keyof EvalState)[];

/**
 * Load the Evaluate form state for a patient with Monday as the source of
 * truth: start from the localStorage draft (if any), then overwrite every
 * Monday-backed field with Monday's current value. This closes the staleness
 * trap where an old browser session (e.g. a test run with coverage path =
 * "OOW Pump") kept overriding corrected Monday data.
 */
export function loadEvalStateForPatient(patient: Patient): EvalState {
  const monday = seedEvalStateFromPatient(patient);
  const stored = loadEvalState(patient.id);
  if (Object.keys(stored).length === 0) return monday;
  const merged: EvalState = { ...stored };
  for (const field of MONDAY_BACKED_FIELDS) {
    const v = monday[field];
    if (v !== undefined) {
      (merged as Record<string, unknown>)[field] = v;
    } else {
      delete (merged as Record<string, unknown>)[field];
    }
  }
  return merged;
}

/**
 * Build an EvalState from the patient's current Monday columns. Used as the
 * initial form state when nothing is in localStorage, and after Reset.
 */
export function seedEvalStateFromPatient(patient: Patient): EvalState {
  const seed: EvalState = {};
  // IP / CGM Coverage Path — only seed if Monday has a non-"Not Serving" value
  // since "Not Serving" is auto-derived from Serving on send and isn't a path
  // the rep can pick from the dropdown.
  if (patient.ipCoveragePath && patient.ipCoveragePath !== "Not Serving") {
    seed.ipCoveragePath = patient.ipCoveragePath as EvalState["ipCoveragePath"];
  }
  if (patient.cgmCoveragePath && patient.cgmCoveragePath !== "Not Serving") {
    if (
      patient.cgmCoveragePath === "Insulin" ||
      patient.cgmCoveragePath === "Hypo" ||
      patient.cgmCoveragePath === "Hypo Invalid" ||
      patient.cgmCoveragePath === "Missing"
    ) {
      seed.cgmCoveragePath = patient.cgmCoveragePath;
    }
  }
  if (patient.diagnosis && patient.diagnosis !== "Evaluate") {
    seed.diagnosis = patient.diagnosis;
  }
  // MRs / Clinicals → Yes/No
  if (patient.mrsClinicals === "MR Received") seed.mrReceived = "Yes";
  else if (patient.mrsClinicals === "Collect") seed.mrReceived = "No";
  if (patient.lastVisit) seed.lastVisitDate = patient.lastVisit;
  if (patient.mnEvalNotes) seed.notes = patient.mnEvalNotes;
  // Script Received
  if (patient.cgmScriptReceived === "Yes" || patient.cgmScriptReceived === "No") {
    seed.cgmScriptReceived = patient.cgmScriptReceived as YesNo;
  }
  if (patient.ipScriptReceived === "Yes" || patient.ipScriptReceived === "No") {
    seed.ipScriptReceived = patient.ipScriptReceived as YesNo;
  }
  // Reconstruct the IP requirement answers (+ CGM Language / clinicals / script
  // validity) from Monday so the form and Send Request read the board, not the
  // browser cache. Monday is the source of truth.
  Object.assign(seed, seedRequirementsFromMonday(patient));
  return seed;
}

// ---- OOW Date validity ----

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * OOW Date marks when the pump goes out of warranty.
 *   • valid = true  → today is AFTER the OOW date (pump IS out of warranty)
 *   • valid = false → today is BEFORE the OOW date (pump still under warranty)
 *
 * `diffDays` is positive when past OOW, negative when still under warranty.
 */
export function isOowDateValid(
  oowDate: string | undefined,
  _primaryInsurance?: string | undefined,
): { valid: boolean; diffDays: number; ageDays: number; thresholdDays: number } | null {
  if (!oowDate) return null;
  const d = new Date(oowDate);
  if (Number.isNaN(d.getTime())) return null;
  const diffDays = (Date.now() - d.getTime()) / MS_PER_DAY;
  // valid when today is past the OOW date
  return { valid: diffDays > 0, diffDays, ageDays: diffDays, thresholdDays: 0 };
}

/** Human-readable relative time from a day count. */
export function formatOowDiff(diffDays: number): string {
  const abs = Math.abs(diffDays);
  if (abs < 1) return "today";
  if (abs < 7) return `${Math.round(abs)}d`;
  if (abs < 30) return `${Math.floor(abs / 7)}w ${Math.round(abs % 7)}d`;
  if (abs < 365.25) {
    const months = Math.floor(abs / 30.44);
    const days = Math.round(abs % 30.44);
    return days > 0 ? `${months}mo ${days}d` : `${months}mo`;
  }
  const years = Math.floor(abs / 365.25);
  const months = Math.round((abs % 365.25) / 30.44);
  return months > 0 ? `${years}y ${months}mo` : `${years}y`;
}

// ---- Validity rollup ----

export interface ValidityResult {
  established: boolean;
  reasons: string[]; // combined human-readable list (all reasons)
  cgmReasons: string[]; // CGM-block-specific only
  ipReasons: string[]; // IP-block-specific only
  generalReasons: string[]; // shared (diagnosis, MR received, last visit, expiry)
  sections: {
    cgm: { shown: boolean; valid: boolean };
    ip: { shown: boolean; valid: boolean };
    diagnosis: { valid: boolean };
    mr: { valid: boolean }; // mr received + last visit set + not expired
  };
}

/** Compute MR Expiry Date (Last Visit + 6 months, clamped to month-end so
 *  e.g. Mar 31 → Sep 30) and whether it's still valid (after today). */
export function getMrExpiry(lastVisit?: string): { expiry: Date | null; expired: boolean } {
  if (!lastVisit) return { expiry: null, expired: false };
  const d = new Date(lastVisit);
  if (Number.isNaN(d.getTime())) return { expiry: null, expired: false };
  const expiry = new Date(d);
  const day = expiry.getDate();
  expiry.setMonth(expiry.getMonth() + 6);
  // Month-end clamp: if the day rolled over (Mar 31 + 6mo → Oct 1), snap back
  // to the last day of the intended month (Sep 30).
  if (expiry.getDate() !== day) expiry.setDate(0);
  return { expiry, expired: expiry.getTime() <= Date.now() };
}

export function deriveValidity(
  state: EvalState,
  patient: Patient,
  showCgm: boolean,
  showIp: boolean,
): ValidityResult {
  const cgmReasons: string[] = [];
  const ipReasons: string[] = [];
  const generalReasons: string[] = [];

  // Rep explicitly marked a product "Not Serving" via its coverage path —
  // that product is treated as N/A: it neither blocks MN nor adds reasons.
  const cgmNotServing = state.cgmCoveragePath === "Not Serving";
  const ipNotServing = state.ipCoveragePath === "Not Serving";

  // ---- CGM section ----
  let cgmValid = true;
  if (showCgm && !cgmNotServing) {
    if (state.cgmScriptValid !== "Valid") {
      cgmValid = false;
      // "Missing" stays its own bucket; everything else (Invalid + unset) → invalid.
      if (state.cgmScriptValid === "Missing") cgmReasons.push("CGM Script missing");
      else cgmReasons.push("CGM Script invalid");
    }
    if (!state.cgmCoveragePath || state.cgmCoveragePath === "Missing") {
      cgmValid = false;
      cgmReasons.push("CGM Coverage Path missing");
    } else if (state.cgmCoveragePath === "Hypo Invalid") {
      cgmValid = false;
      cgmReasons.push("CGM Coverage Path invalid");
    }
  }

  // ---- IP section ----
  let ipValid = true;
  if (showIp && !ipNotServing) {
    if (!state.ipCoveragePath) {
      ipValid = false;
      ipReasons.push("Insulin Pump Coverage Path missing");
    } else {
      const cfg = IP_PATH_FIELDS[state.ipCoveragePath];
      if (state.ipScriptValid !== "Valid") {
        ipValid = false;
        if (state.ipScriptValid === "Missing") ipReasons.push("Insulin Pump Script missing");
        else ipReasons.push("Insulin Pump Script invalid");
      }
      if (cfg.showEducation && state.diabetesEducation !== "Yes") {
        ipValid = false;
        ipReasons.push("Diabetes Education invalid");
      }
      if (cfg.show3Injections && state.threeInjections !== "Yes") {
        ipValid = false;
        ipReasons.push("3+ Injections invalid");
      }
      if (cfg.showCgmUse && state.cgmUse !== "Yes") {
        ipValid = false;
        ipReasons.push("CGM Use invalid");
      }
      if (cfg.showBsIssues && state.bloodSugarIssues !== "Yes") {
        ipValid = false;
        ipReasons.push("Blood Sugar Issues invalid");
      }
      if (cfg.showLmn) {
        if (state.lmn === "No" || state.lmn === undefined) {
          ipValid = false;
          ipReasons.push("Letter of MN missing");
        } else if (state.lmn === "Yes, but Invalid") {
          ipValid = false;
          ipReasons.push("Letter of MN invalid");
        }
      }
      if (cfg.showOow) {
        const oow = isOowDateValid(state.oowDate, patient.primaryInsurance);
        if (!oow) {
          ipValid = false;
          ipReasons.push("OOW Date missing");
        } else if (!oow.valid) {
          ipValid = false;
          ipReasons.push("Pump still under warranty");
        } else if (cfg.showOowOnScript && state.oowDateOnScript !== "Yes") {
          // Date is known and old enough — but not yet on the script.
          ipValid = false;
          ipReasons.push("OOW Date not on script");
        }
      }
      if (cfg.showMalfunction && state.malfunction !== "Yes") {
        ipValid = false;
        ipReasons.push("Malfunction missing");
      }
    }
  }

  // ---- Diagnosis ----
  const diagnosisValid = !!state.diagnosis && state.diagnosis !== "Evaluate";
  if (!diagnosisValid) generalReasons.push("Diagnosis missing");

  // ---- MR Received + Last Visit + Expiry ----
  const mrReceived = state.mrReceived === "Yes";
  const lastVisitSet = !!state.lastVisitDate;
  const { expired } = getMrExpiry(state.lastVisitDate);
  const mrValid = mrReceived && lastVisitSet && !expired;
  if (!mrReceived) generalReasons.push("MR Missing");
  if (mrReceived && !lastVisitSet) generalReasons.push("Last Visit Date missing");
  if (mrReceived && lastVisitSet && expired) generalReasons.push("MR Expired (>6 months)");

  const established = cgmValid && ipValid && diagnosisValid && mrValid;

  return {
    established,
    reasons: [...cgmReasons, ...ipReasons, ...generalReasons],
    cgmReasons,
    ipReasons,
    generalReasons,
    sections: {
      // "Not Serving" selected → section reads as not-shown (N/A chip, no
      // blocking, and buildMondayPreview writes "Not Serving" for the path).
      cgm: { shown: showCgm && !cgmNotServing, valid: cgmValid },
      ip: { shown: showIp && !ipNotServing, valid: ipValid },
      diagnosis: { valid: diagnosisValid },
      mr: { valid: mrValid },
    },
  };
}

// ---- Doctor-facing ask list ----
//
// One entry per missing item. No bundled "Updated MR — must include …" or
// "Updated IP Script — must include …" rows; each gap is its own line so
// the MN Request PDF / dropdown / Send Request UI can render one row each
// with its own sample language.
//
// Things the helper deliberately does NOT surface (agent classification,
// not something the doctor can act on):
//   - "Diagnosis missing"
//   - "IP Coverage Path missing" / unset
//   - "Last Visit Date empty" while MR Received = Yes (the agent should
//     fill this in from the records)
//
// Note: CGM Coverage Path "Hypo Invalid", "Missing", or unset all surface
// the same "Hypoglycemia language" ask — the records don't have either
// insulin or hypo language and the doctor needs to add one. Only Insulin
// and Hypo paths are considered satisfied.

export function computeDoctorAskList(
  state: EvalState,
  patient: Patient,
  showCgm: boolean,
  showIp: boolean,
): string[] {
  const asks: string[] = [];

  // ---- Medical Records (whole document) ----
  // When MR is missing or expired, suppress the granular gap rows below —
  // a fresh MR resolves them and listing them would clutter the request.
  const mrReceived = state.mrReceived === "Yes";
  const { expired } = getMrExpiry(state.lastVisitDate);

  if (!mrReceived) {
    asks.push("Medical Records");
  } else if (expired) {
    asks.push("Updated Medical Records");
  } else {
    // MR is on file and current — surface specific record-level gaps as
    // their own rows.

    // CGM coverage path:
    //   - Insulin or Hypo → records have the right language → no ask
    //   - Hypo Invalid, Missing, or unset → ask for hypoglycemia language
    if (
      showCgm &&
      state.cgmCoveragePath !== "Insulin" &&
      state.cgmCoveragePath !== "Hypo"
    ) {
      asks.push("Hypoglycemia language");
    }

    // IP-path-driven record requirements
    if (showIp && state.ipCoveragePath) {
      const cfg = IP_PATH_FIELDS[state.ipCoveragePath];
      if (cfg.showEducation && state.diabetesEducation !== "Yes") {
        asks.push("Diabetes education completed");
      }
      if (cfg.show3Injections && state.threeInjections !== "Yes") {
        asks.push("3+ insulin injections / day for > 6 months");
      }
      if (cfg.showCgmUse && state.cgmUse !== "Yes") {
        asks.push("Current CGM use");
      }
      if (cfg.showBsIssues && state.bloodSugarIssues !== "Yes") {
        asks.push("Difficulty managing blood sugar despite treatment");
      }
    }
  }

  // ---- CGM Script ----
  // No "Updated CGM Script" variant — script is either there or it isn't,
  // and an invalid script just means we need a fresh one.
  if (showCgm && (state.cgmScriptValid === "Missing" || state.cgmScriptValid === "Invalid")) {
    asks.push("CGM Script");
  }

  // ---- Insulin Pump Script ----
  if (showIp && state.ipCoveragePath) {
    if (state.ipScriptValid === "Missing") {
      // Path-aware base ask — bake in OOW requirements so the doctor
      // doesn't send back a script we'd just have to ask to update.
      let title = "Insulin Pump Script";
      if (state.ipCoveragePath === "OOW Pump") {
        title = "Insulin Pump Script (must include OOW date and malfunction note)";
      }
      asks.push(title);
    } else if (state.ipScriptValid === "Invalid") {
      asks.push("Updated Insulin Pump Script");
    }
    // If script is Valid, OOW / malfunction gaps are surfaced as their
    // own rows below — no bundled "Updated IP Script — must include …".
  }

  // ---- OOW Date (only when path = OOW Pump and IP Script exists) ----
  // We only surface OOW asks when the IP script is on file (Valid). When
  // the script is missing/invalid, the IP Script ask above already covers
  // OOW for OOW Pump path via the "must include" sub-clause.
  if (showIp && state.ipCoveragePath) {
    const cfg = IP_PATH_FIELDS[state.ipCoveragePath];
    if (cfg.showOow && state.ipScriptValid === "Valid") {
      const oow = isOowDateValid(state.oowDate, patient.primaryInsurance);
      if (!oow) {
        asks.push("OOW date");
      } else if (!oow.valid) {
        asks.push("OOW date — pump still under warranty");
      } else if (cfg.showOowOnScript && state.oowDateOnScript !== "Yes") {
        // Date is known and old enough — just not yet on the script.
        asks.push(`Add OOW date of ${formatOowDate(state.oowDate)} to the script`);
      }
    }
    if (cfg.showMalfunction && state.malfunction !== "Yes" && state.ipScriptValid === "Valid") {
      // Phrasing differs by path so the consolidated list lines up with the
      // PDF row templates (Omnipod Switch has its own "Omnipod insufficient"
      // row instead of the generic "Non-repairable malfunction reason").
      asks.push(
        state.ipCoveragePath === "Omnipod Switch"
          ? "Omnipod insufficient"
          : "Non-repairable malfunction reason",
      );
    }
  }

  // ---- Letter of Medical Necessity ----
  if (showIp && state.ipCoveragePath) {
    const cfg = IP_PATH_FIELDS[state.ipCoveragePath];
    if (cfg.showLmn) {
      if (state.lmn === "No" || state.lmn === undefined) {
        asks.push("Letter of Medical Necessity");
      } else if (state.lmn === "Yes, but Invalid") {
        asks.push("Updated Letter of Medical Necessity");
      }
    }
  }

  return asks;
}

/** Format an ISO date (YYYY-MM-DD) as MM/DD/YYYY for the doctor-facing
 *  ask string. Returns the input unchanged if it doesn't parse. */
function formatOowDate(iso?: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${m[2]}/${m[3]}/${m[1]}`;
}

// ---- Preview payload (what would be written to Monday) ----

export interface MondayPreview {
  ipCoveragePath?: string;
  cgmCoveragePath?: string;
  diagnosis?: string;
  mrsClinicals: "MR Received" | "Collect";
  lastVisitDate?: string;
  mrExpiryDate?: string;
  medicalNecessity: "Established" | "Not Established";
  generalMnInvalidReasons: string[];
  cgmMnInvalidReasons: string[];
  ipMnInvalidReasons: string[];
  /** Consolidated, doctor-facing ask list — what the agent reads on the call.
   *  Drives the MN Request Consolidated dropdown column on Monday and the
   *  MN Request Letter PDF body. */
  mnRequestConsolidated: string[];
  generateCgmScript?: string;
  generateIpScript?: string;
}

export function buildMondayPreview(
  state: EvalState,
  validity: ValidityResult,
  patient: Patient,
): MondayPreview {
  const { expiry } = getMrExpiry(state.lastVisitDate);
  const consolidated = computeDoctorAskList(
    state,
    patient,
    validity.sections.cgm.shown,
    validity.sections.ip.shown,
  );
  return {
    // When a patient isn't being served that product, the preview reflects
    // what'll be written to Monday: "Not Serving".
    ipCoveragePath: validity.sections.ip.shown
      ? state.ipCoveragePath
      : "Not Serving",
    cgmCoveragePath: validity.sections.cgm.shown
      ? state.cgmCoveragePath
      : "Not Serving",
    diagnosis: state.diagnosis,
    mrsClinicals: state.mrReceived === "Yes" ? "MR Received" : "Collect",
    lastVisitDate: state.lastVisitDate,
    mrExpiryDate: expiry ? expiry.toISOString().slice(0, 10) : undefined,
    medicalNecessity: validity.established ? "Established" : "Not Established",
    generalMnInvalidReasons: validity.generalReasons,
    cgmMnInvalidReasons: validity.sections.cgm.shown ? validity.cgmReasons : [],
    ipMnInvalidReasons: validity.sections.ip.shown ? validity.ipReasons : [],
    mnRequestConsolidated: consolidated,
    generateCgmScript: state.generateCgmScript,
    generateIpScript: state.generateIpScript,
  };
}

// ---- MN checklist (Documents / Language, with language sub-bullets) ----
//
// Auto-derived from the Evaluate answers; shared by the Evaluate footer and the
// Send Request "What we're still missing" section so both stay in sync.

/** ok = have & valid, invalid = present but invalid/expired, missing = absent,
 *  na = product not served. */
export type MnState = "ok" | "invalid" | "missing" | "na";
export interface MnItem {
  label: string;
  state: MnState;
}
export interface MnLangItem extends MnItem {
  /** Specific requirement bullets behind this language item. */
  subItems: MnItem[];
  /** Coverage path label for this product (e.g. "Insulin", "1st Pump <6M Diagnosed"). */
  coverage?: string;
}
export interface MnChecklist {
  established: boolean;
  documents: MnItem[];
  language: MnLangItem[];
  /** Medical-records detail for the shared records card. Coverage language,
   *  visit date, and diagnosis all come from the medical records. */
  mr: {
    received: boolean;
    lastVisit?: string;
    expiry?: string;
    expired: boolean;
    diagnosis?: string;
    diagnosisOk: boolean;
  };
}

function deriveReceived4(
  showProduct: boolean,
  scriptReceived: YesNo | undefined,
  scriptValid: ValidInvalid | undefined,
  coveragePath: string | undefined,
): Received4 | undefined {
  if (!showProduct) return "Not Serving";
  if (coveragePath === "Not Serving") return "Not Serving";
  if (scriptReceived === "Yes") return scriptValid === "Invalid" ? "Invalid" : "Yes";
  if (scriptReceived === "No") return "No";
  return undefined;
}

export function computeMnChecklist(
  state: EvalState,
  showCgm: boolean,
  showIp: boolean,
): MnChecklist {
  const cgmReceived = deriveReceived4(
    showCgm,
    state.cgmScriptReceived,
    state.cgmScriptValid,
    state.cgmCoveragePath,
  );
  const ipReceived = deriveReceived4(
    showIp,
    state.ipScriptReceived,
    state.ipScriptValid,
    state.ipCoveragePath,
  );
  const cgmServed = showCgm && cgmReceived !== "Not Serving";
  const ipServed = showIp && ipReceived !== "Not Serving";
  const { expiry, expired } = getMrExpiry(state.lastVisitDate);

  // Map a Yes/No/Invalid answer (or a received script) to a tri-state.
  const yni = (v: YesNoInvalid | undefined): MnState =>
    v === "Yes" ? "ok" : v === "Invalid" ? "invalid" : "missing";
  const scriptState = (served: boolean, r: Received4 | undefined): MnState =>
    !served ? "na" : r === "Yes" ? "ok" : r === "Invalid" ? "invalid" : "missing";
  // Roll a set of sub-items up: any missing → missing, else any invalid → invalid, else ok.
  const agg = (subs: MnItem[]): MnState =>
    subs.some((s) => s.state === "missing")
      ? "missing"
      : subs.some((s) => s.state === "invalid")
        ? "invalid"
        : "ok";

  // We "have" records if Clinicals was received OR a visit date is on file.
  // Records that exist but are expired read as invalid → "Updated Medical Records".
  const haveRecords = state.clinReceived3 === "Yes" || !!state.lastVisitDate;
  const clinState: MnState =
    state.clinReceived3 === "Invalid"
      ? "invalid"
      : !haveRecords
        ? "missing"
        : expired
          ? "invalid"
          : "ok";

  const documents: MnItem[] = [
    { label: "Insulin Pump Script", state: scriptState(ipServed, ipReceived) },
    { label: "CGM Script", state: scriptState(cgmServed, cgmReceived) },
    { label: "Clinicals", state: clinState },
  ];

  // CGM language — a single bullet (Insulin or Hypoglycemia language)
  const cgmSubs: MnItem[] = [];
  if (cgmServed && (state.cgmCoveragePath === "Insulin" || state.cgmCoveragePath === "Hypo")) {
    cgmSubs.push({
      label: state.cgmCoveragePath === "Hypo" ? "Hypoglycemia Language" : "Insulin Language",
      state: yni(state.cgmLanguage),
    });
  }
  const cgmLangState: MnState = !cgmServed ? "na" : cgmSubs.length === 0 ? "missing" : agg(cgmSubs);

  // IP language — per-path requirement bullets
  const ipSubs: MnItem[] = [];
  const cfg =
    state.ipCoveragePath && state.ipCoveragePath !== "Not Serving"
      ? IP_PATH_FIELDS[state.ipCoveragePath]
      : null;
  if (ipServed && cfg) {
    const add = (cond: boolean, label: string, v: YesNoInvalid | undefined) => {
      if (cond) ipSubs.push({ label, state: yni(v) });
    };
    add(cfg.showEducation, "Diabetes Education", state.ipEducationV);
    add(cfg.show3Injections, "3+ Injections / Day", state.ipThreeInjectionsV);
    add(cfg.showCgmUse, "CGM Use", state.ipCgmUseV);
    add(cfg.showBsIssues, "Blood Sugar Issues", state.ipBsIssuesV);
    add(cfg.showLmn, "Letter of MN on File", state.ipLmnV);
    // OOW Date implies it must be on the script — one combined item.
    if (cfg.showOow)
      ipSubs.push({
        label: "OOW Date",
        state: state.oowDate && (!cfg.showOowOnScript || state.ipOowOnScriptV === "Yes") ? "ok" : "missing",
      });
    add(cfg.showMalfunction, "Malfunction", state.ipMalfunctionV);
  }
  const ipLangState: MnState = !ipServed
    ? "na"
    : !cfg
      ? "missing"
      : ipSubs.length === 0
        // A coverage path with no language requirements (e.g. "Supplies Only")
        // has nothing to satisfy — mark it not-applicable rather than "ok", so
        // it doesn't render a misleading green "valid" check.
        ? "na"
        : agg(ipSubs);

  const cgmCoverage = cgmServed
    ? state.cgmCoveragePath === "Hypo"
      ? "Hypoglycemia"
      : state.cgmCoveragePath === "Insulin"
        ? "Insulin"
        : undefined
    : undefined;
  const ipCoverage =
    ipServed && state.ipCoveragePath && state.ipCoveragePath !== "Not Serving"
      ? state.ipCoveragePath
      : undefined;

  const language: MnLangItem[] = [
    { label: "CGM Language", state: cgmLangState, subItems: cgmSubs, coverage: cgmCoverage },
    { label: "Insulin Pump Language", state: ipLangState, subItems: ipSubs, coverage: ipCoverage },
  ];

  const applicable = [...documents, ...language]
    .map((i) => i.state)
    .filter((s) => s !== "na");
  const established = applicable.length > 0 && applicable.every((s) => s === "ok");

  const mr = {
    received: state.clinReceived3 === "Yes",
    lastVisit: state.lastVisitDate,
    expiry: expiry ? expiry.toISOString().slice(0, 10) : undefined,
    expired,
    diagnosis: state.diagnosis,
    diagnosisOk: !!state.diagnosis && state.diagnosis !== "Evaluate",
  };

  return { established, documents, language, mr };
}

/**
 * MN "Established" exactly as shown by the Evaluate Step-2 banner (the green
 * "Medical Necessity Established" headline + Final Clinicals unlock). This is
 * the SINGLE source of truth for stage routing on submit:
 *   established → "Completed" (skip Send Request)
 *   not         → "Send Request"
 *
 * It mirrors the banner's checklist (received scripts + per-path IP language
 * requirements + CGM language + clinicals within MR expiry) — deliberately NOT
 * deriveValidity, so what the rep sees is what the submit does.
 */
export function bannerMnEstablished(state: EvalState, showCgm: boolean, showIp: boolean): boolean {
  const cgmReceivedVal: Received4 | undefined = !showCgm
    ? "Not Serving"
    : state.cgmCoveragePath === "Not Serving"
      ? "Not Serving"
      : state.cgmScriptReceived === "Yes"
        ? state.cgmScriptValid === "Invalid" ? "Invalid" : "Yes"
        : state.cgmScriptReceived === "No" ? "No" : undefined;
  const ipReceivedVal: Received4 | undefined = !showIp
    ? "Not Serving"
    : state.ipCoveragePath === "Not Serving"
      ? "Not Serving"
      : state.ipScriptReceived === "Yes"
        ? state.ipScriptValid === "Invalid" ? "Invalid" : "Yes"
        : state.ipScriptReceived === "No" ? "No" : undefined;

  const cgmServed = showCgm && cgmReceivedVal !== "Not Serving";
  const ipServed = showIp && ipReceivedVal !== "Not Serving";

  const ipCfg =
    state.ipCoveragePath && state.ipCoveragePath !== "Not Serving"
      ? IP_PATH_FIELDS[state.ipCoveragePath]
      : null;
  const ipReqValues: YesNoInvalid[] = [];
  if (ipCfg) {
    if (ipCfg.showEducation) ipReqValues.push(state.ipEducationV ?? "No");
    if (ipCfg.show3Injections) ipReqValues.push(state.ipThreeInjectionsV ?? "No");
    if (ipCfg.showCgmUse) ipReqValues.push(state.ipCgmUseV ?? "No");
    if (ipCfg.showBsIssues) ipReqValues.push(state.ipBsIssuesV ?? "No");
    if (ipCfg.showLmn) ipReqValues.push(state.ipLmnV ?? "No");
    if (ipCfg.showMalfunction) ipReqValues.push(state.ipMalfunctionV ?? "No");
    if (ipCfg.showOowOnScript) ipReqValues.push(state.ipOowOnScriptV ?? "No");
  }

  const cgmDocChecked = cgmServed && cgmReceivedVal === "Yes";
  const ipDocChecked = ipServed && ipReceivedVal === "Yes";
  const { expired: mrExpired } = getMrExpiry(state.lastVisitDate);
  const clinDocChecked = state.clinReceived3 === "Yes" && !mrExpired;
  const cgmLangChecked =
    cgmServed &&
    (state.cgmCoveragePath === "Insulin" || state.cgmCoveragePath === "Hypo") &&
    state.cgmLanguage === "Yes";
  const ipLangChecked = ipServed && !!ipCfg && ipReqValues.every((v) => v === "Yes");

  const mnChecks: boolean[] = [clinDocChecked];
  if (cgmServed) mnChecks.push(cgmDocChecked, cgmLangChecked);
  if (ipServed) mnChecks.push(ipDocChecked, ipLangChecked);
  return mnChecks.every(Boolean);
}

// =====================================================================
// Monday round-trip for IP requirement answers (Option A — June 2026)
//
// The board has NO per-requirement columns. The rep's Yes/No/Invalid answers are
// stored in two existing dropdowns on board 18406060017:
//   • "IP MN Invalid Reasons" (dropdown_mm2xgg2y) — items marked Invalid
//   • "IP MN No Reasons"      (dropdown_mm4bwxpv) — items marked No (= Missing)
// CGM Language has its own Yes/No/Invalid column; CGM/IP script "Invalid" rides
// the CGM/IP invalid-reason dropdowns. This block is the SINGLE source of truth
// for the label strings — used both when writing to Monday (computeIpReasonLists)
// and when seeding back (seedRequirementsFromMonday) — so the rep's exact answer
// round-trips and the board, not the browser cache, is authoritative.
//
// Labels MUST match the board exactly (casing included) or a duplicate is made.
// Verified live against board 18406060017 on 2026-06-23. The board has no
// "Malfunction invalid" label, so a Malfunction marked Invalid is stored as
// Missing (round-trips as "No"); every other requirement preserves Yes/No/Invalid.

type ReqLabel = { invalid: string | null; missing: string };
const IP_REQ_LABELS = {
  education: { invalid: "Diabetes Education invalid", missing: "Diabetes Education Missing" },
  injections: { invalid: "3+ Injections invalid", missing: "3+ Injections Missing" },
  cgmUse: { invalid: "CGM Use invalid", missing: "CGM Use Missing" },
  bloodSugar: { invalid: "Blood Sugar Issues invalid", missing: "Blood Sugar Issues Missing" },
  lmn: { invalid: "Letter of MN invalid", missing: "Letter of MN missing" },
  malfunction: { invalid: null, missing: "Malfunction Missing" },
} satisfies Record<string, ReqLabel>;
const IP_SCRIPT_INVALID_LABEL = "Insulin Pump Script invalid";
const CGM_SCRIPT_INVALID_LABEL = "CGM Script invalid";

/** Build the two IP reason dropdown lists from the rep's 3-state answers.
 *  invalid → "IP MN Invalid Reasons"; missing (No) → "IP MN No Reasons". */
export function computeIpReasonLists(
  state: EvalState,
  showIp: boolean,
): { invalid: string[]; missing: string[] } {
  const invalid: string[] = [];
  const missing: string[] = [];
  const path = state.ipCoveragePath;
  if (!showIp || !path || path === "Not Serving") return { invalid, missing };
  const cfg = IP_PATH_FIELDS[path];
  if (!cfg) return { invalid, missing };
  const add = (applies: boolean, v: YesNoInvalid | undefined, labels: ReqLabel) => {
    if (!applies) return;
    const val = v ?? "No"; // an unanswered required item counts as Missing
    if (val === "Yes") return;
    if (val === "Invalid" && labels.invalid) invalid.push(labels.invalid);
    else missing.push(labels.missing); // No, or Invalid with no board label
  };
  add(cfg.showEducation, state.ipEducationV, IP_REQ_LABELS.education);
  add(cfg.show3Injections, state.ipThreeInjectionsV, IP_REQ_LABELS.injections);
  add(cfg.showCgmUse, state.ipCgmUseV, IP_REQ_LABELS.cgmUse);
  add(cfg.showBsIssues, state.ipBsIssuesV, IP_REQ_LABELS.bloodSugar);
  add(cfg.showLmn, state.ipLmnV, IP_REQ_LABELS.lmn);
  add(cfg.showMalfunction, state.ipMalfunctionV, IP_REQ_LABELS.malfunction);
  // IP Script received-but-Invalid (the not-received case lives on the
  // "IP Script Received" column, so it isn't duplicated here).
  if (state.ipScriptReceived === "Yes" && state.ipScriptValid === "Invalid") {
    invalid.push(IP_SCRIPT_INVALID_LABEL);
  }
  return { invalid, missing };
}

function splitDropdown(text?: string): string[] {
  return text ? text.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

/** Reconstruct the rep's 3-state answers (and their legacy mirrors) from the
 *  Monday reason dropdowns + the CGM Language / MRs columns. Inverse of
 *  computeIpReasonLists, so reading from Monday reproduces exactly what the rep
 *  entered — including No (Missing) vs Invalid. */
export function seedRequirementsFromMonday(patient: Patient): Partial<EvalState> {
  const out: Partial<EvalState> = {};
  const ipInvalid = splitDropdown(patient.ipMnInvalidReasons);
  const ipNo = splitDropdown(patient.ipMnNoReasons);
  const cgmInvalid = splitDropdown(patient.cgmMnInvalidReasons);
  // "Has this patient been evaluated at least once?" When yes, an applicable
  // requirement absent from both reason lists means it was met (Yes). When no
  // (a fresh patient), absence means unanswered — leave it undefined so we never
  // show a false "Yes".
  const evaluated = !!(patient.medicalNecessity && patient.medicalNecessity.trim());

  const path =
    patient.ipCoveragePath && patient.ipCoveragePath !== "Not Serving"
      ? (patient.ipCoveragePath as IpPath)
      : undefined;
  const cfg = path ? IP_PATH_FIELDS[path] ?? null : null;

  const recon = (applies: boolean, labels: ReqLabel): YesNoInvalid | undefined => {
    if (!applies) return undefined;
    if (labels.invalid && (ipInvalid.includes(labels.invalid) || ipNo.includes(labels.invalid)))
      return "Invalid";
    if (ipNo.includes(labels.missing) || ipInvalid.includes(labels.missing)) return "No";
    return evaluated ? "Yes" : undefined;
  };

  if (cfg) {
    const setReq = (vField: keyof EvalState, applies: boolean, labels: ReqLabel) => {
      const v = recon(applies, labels);
      if (v !== undefined) (out as Record<string, unknown>)[vField] = v;
    };
    setReq("ipEducationV", cfg.showEducation, IP_REQ_LABELS.education);
    setReq("ipThreeInjectionsV", cfg.show3Injections, IP_REQ_LABELS.injections);
    setReq("ipCgmUseV", cfg.showCgmUse, IP_REQ_LABELS.cgmUse);
    setReq("ipBsIssuesV", cfg.showBsIssues, IP_REQ_LABELS.bloodSugar);
    setReq("ipLmnV", cfg.showLmn, IP_REQ_LABELS.lmn);
    setReq("ipMalfunctionV", cfg.showMalfunction, IP_REQ_LABELS.malfunction);

    // Keep the legacy 2-state mirrors in sync (deriveValidity / the consolidated
    // ask list read them if recomputed on the Evaluate screen after a reload).
    if (out.ipEducationV !== undefined) out.diabetesEducation = out.ipEducationV === "Yes" ? "Yes" : "No";
    if (out.ipThreeInjectionsV !== undefined) out.threeInjections = out.ipThreeInjectionsV === "Yes" ? "Yes" : "No";
    if (out.ipCgmUseV !== undefined) out.cgmUse = out.ipCgmUseV === "Yes" ? "Yes" : "No";
    if (out.ipBsIssuesV !== undefined) out.bloodSugarIssues = out.ipBsIssuesV === "Yes" ? "Yes" : "No";
    if (out.ipMalfunctionV !== undefined) out.malfunction = out.ipMalfunctionV === "Yes" ? "Yes" : "No";
    if (out.ipLmnV !== undefined)
      out.lmn = out.ipLmnV === "Yes" ? "Yes & Valid" : out.ipLmnV === "Invalid" ? "Yes, but Invalid" : "No";
  }

  // IP / CGM script "Invalid" validity (received state stays on its own column).
  if (ipInvalid.includes(IP_SCRIPT_INVALID_LABEL) || ipNo.includes(IP_SCRIPT_INVALID_LABEL))
    out.ipScriptValid = "Invalid";
  if (cgmInvalid.includes(CGM_SCRIPT_INVALID_LABEL)) out.cgmScriptValid = "Invalid";

  // CGM Language — its own Yes/No/Invalid column (color_mm4bb5sm).
  if (patient.cgmLanguage === "Yes" || patient.cgmLanguage === "No" || patient.cgmLanguage === "Invalid")
    out.cgmLanguage = patient.cgmLanguage;

  // Clinicals received — the MRs / Clinicals column (MR Received / Collect).
  if (patient.mrsClinicals === "MR Received") out.clinReceived3 = "Yes";
  else if (patient.mrsClinicals === "Collect") out.clinReceived3 = "No";

  return out;
}
