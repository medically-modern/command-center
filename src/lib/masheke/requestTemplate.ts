/**
 * requestTemplate - builds the doctor-facing request body from the eval
 * output. Shared by Send Request (editable composer) and Confirm Receipt
 * (read-only courtesy-fax preview) so both render the exact same message.
 *
 * Extracted verbatim from SendRequestPanel.tsx (June 2026) - logic unchanged.
 */
import type { Patient } from "@/lib/masheke/workflow";
import type { MnChecklist } from "@/lib/masheke/evalState";

/** Manufacturer partners we recognize as a referral source (so we can offer
 *  to loop in their rep / clinical educator). */
const MFR_PARTNERS = ["Tandem", "Beta Bionics", "Insulet", "Dexcom", "Abbott"];

/** Capitalize first letter of each word, lowercase the rest. */
export function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/** "a" or "an" based on whether the next word starts with a vowel sound. */
function aOrAn(word: string): string {
  return /^[aeiou]/i.test(word.trim()) ? "an" : "a";
}

/** Join a list with commas + "and" (Oxford). */
function joinAnd(arr: string[]): string {
  if (arr.length <= 1) return arr[0] ?? "";
  if (arr.length === 2) return `${arr[0]} and ${arr[1]}`;
  return `${arr.slice(0, -1).join(", ")}, and ${arr[arr.length - 1]}`;
}

/** Example "simple language" the provider can put in the chart, per requirement. */
const SIMPLE_LANG: Record<string, string> = {
  Diagnosis: "\"Patient has been diagnosed with diabetes for 6+ months\"",
  "Insulin Language": "\"Patient is insulin-treated\"",
  "Hypoglycemia Language": "\"Patient experiences hypoglycemia\"",
  "Diabetes Education": "\"Patient completed a comprehensive diabetes education program\"",
  "3+ Injections / Day": "\"Patient injects insulin 3+ times per day with frequent self-adjustments\"",
  "CGM Use": "\"Patient uses a Dexcom / FreeStyle Libre daily\"",
  "Blood Sugar Issues": "\"Patient experiences recurring hypoglycemia despite adhering to the treatment plan\"",
  "Letter of MN on File": "Signed LMN explaining why pump therapy is medically necessary now and why delay would be unsafe - reach out if you'd like a draft",
  "OOW Date": "Out-of-warranty date must be included on the script",
  "OOW on Script": "Out-of-warranty date must be included on the script",
  Malfunction:
    "Non-repairable malfunction reason on the script - e.g. \"cracked/broken screen\" or \"battery is depleted,\" AND \"pump cannot be repaired or replaced\"",
};

/** Auto-fill the doctor-facing request body from the eval output. */
export function buildRequestTemplate(patient: Patient, checklist: MnChecklist): string {
  const docName = patient.doctorName?.trim() || "Provider";
  const lastName = titleCase(docName.replace(/^dr\.?\s*/i, "").split(/\s+/).pop() || docName);
  const patientName = titleCase(patient.name || "the patient");
  // Patient DOB rides immediately after the name so the office can match the
  // patient unambiguously (column is already MM/DD/YYYY text). Omitted when blank.
  const dob = patient.dob?.trim();
  const patientLabel = dob ? `${patientName} (DOB: ${dob})` : patientName;
  // Served products + states (a "Not Serving" model falls back to generic).
  const docState = (label: string) => checklist.documents.find((d) => d.label === label)?.state;
  const ipState = docState("Insulin Pump Script");
  const cgmState = docState("CGM Script");
  const clin = docState("Clinicals");
  const ipServed = !!ipState && ipState !== "na";
  const cgmServed = !!cgmState && cgmState !== "na";
  const pumpModel = patient.pumpType && patient.pumpType !== "Not Serving" ? patient.pumpType : "";
  const cgmModel = patient.cgmType && patient.cgmType !== "Not Serving" ? patient.cgmType : "";
  const pumpPhrase = ipServed ? (pumpModel ? `${aOrAn(pumpModel)} ${pumpModel} insulin pump` : "an insulin pump") : null;
  const cgmPhrase = cgmServed ? (cgmModel ? `${aOrAn(cgmModel)} ${cgmModel} CGM` : "a CGM") : null;

  // Partner = referral-source manufacturer.
  const partner = MFR_PARTNERS.find(
    (p) => p.toLowerCase() === (patient.referralSource ?? "").trim().toLowerCase(),
  );

  // Cross-sell: request was for a pump (not CGM) but we're also serving CGM -
  // the pump is primary; the CGM script rides along ("full bundle").
  const reqType = patient.requestType ?? "";
  const cgmCrossSell = /pump/i.test(reqType) && !/cgm/i.test(reqType) && cgmServed;

  // What's missing.
  const ipScriptMissing = ipServed && ipState !== "ok";
  const cgmScriptMissing = cgmServed && cgmState !== "ok";
  const recordsNeed =
    clin === "missing" ? "medical records" : clin === "invalid" ? "updated medical records from the last 6 months" : null;

  // Specific in-records language/diagnosis - only once records are on file & current.
  const specifics: string[] = [];
  if (clin === "ok") {
    if (!checklist.mr.diagnosisOk) specifics.push(`Diagnosis - ${SIMPLE_LANG["Diagnosis"]}`);
    for (const l of checklist.language) {
      for (const s of l.subItems) {
        if (s.state !== "ok") specifics.push(`${s.label} - ${SIMPLE_LANG[s.label] ?? "include in the chart note"}`);
      }
    }
  }

  // Serving line - cross-sell mentions only the primary (pump).
  const servingProducts = cgmCrossSell
    ? pumpPhrase ?? "diabetes supplies"
    : joinAnd([pumpPhrase, cgmPhrase].filter(Boolean) as string[]) || "diabetes supplies";
  const servingLine = partner
    ? `We are working with ${partner} to serve ${patientLabel} ${servingProducts}.`
    : `We are serving ${patientLabel} with ${servingProducts}.`;

  const lines: string[] = [];
  lines.push(`Hi Dr. ${lastName}'s office,`);
  lines.push("");
  lines.push(servingLine);
  lines.push("");

  if (cgmCrossSell) {
    // Narrative framing for a cross-sell.
    const sentences: string[] = [];
    if (ipScriptMissing) sentences.push("We still need a signed script (attached).");
    if (cgmScriptMissing)
      sentences.push("We are also attaching a CGM script to be signed (insurance likes to see the full bundle).");
    if (recordsNeed) sentences.push(`We also need ${recordsNeed}.`);
    let para = sentences.join(" ");
    if (specifics.length) {
      para = `${para ? para + " " : ""}Additionally, insurance requires specific language included in the medical records (example chart language in quotes):`;
      lines.push(para);
      for (const s of specifics) lines.push(`- ${s}`);
    } else if (para) {
      lines.push(para);
    } else {
      lines.push("Everything is on file - no further documentation needed. Thank you!");
    }
  } else {
    // Standard dynamic sentence.
    const scriptCount = (cgmScriptMissing ? 1 : 0) + (ipScriptMissing ? 1 : 0);
    const phrases: string[] = [];
    if (scriptCount === 2) phrases.push("signed scripts (attached)");
    else if (scriptCount === 1) phrases.push("a signed script (attached)");
    if (recordsNeed) phrases.push(recordsNeed);
    if (specifics.length) phrases.push("specific language included in the medical records");
    if (phrases.length) {
      const tail = specifics.length ? " (example chart language in quotes):" : ".";
      lines.push(`To establish medical necessity, we still need ${joinAnd(phrases)}${tail}`);
      for (const s of specifics) lines.push(`- ${s}`);
    } else {
      lines.push("Everything is on file - no further documentation needed. Thank you!");
    }
  }

  lines.push("");
  lines.push("Thank you,");
  lines.push("Medically Modern (NPI: 1023042348)");
  return lines.join("\n");
}

/** Short spoken phrases for the confirm-receipt talk track. */
const SPOKEN_LANG: Record<string, string> = {
  Diagnosis: "a documented diabetes diagnosis",
  "Insulin Language": "documentation that the patient is insulin-treated",
  "Hypoglycemia Language": "documentation of hypoglycemia",
  "Diabetes Education": "diabetes education",
  "3+ Injections / Day": "language showing 3+ daily insulin injections",
  "CGM Use": "documented CGM use",
  "Blood Sugar Issues": "documented blood-sugar management difficulty",
  "Letter of MN on File": "a signed letter of medical necessity",
  "OOW Date": "the out-of-warranty date",
  "OOW on Script": "the out-of-warranty date on the script",
  Malfunction: "the non-repairable malfunction reason",
};

/** A light call script for confirm-receipt, built from the same "what's
 *  missing" logic as the request message. */
export function buildTalkTrack(patient: Patient, checklist: MnChecklist): string {
  const name = titleCase(patient.name || "the patient");
  const docState = (label: string) => checklist.documents.find((d) => d.label === label)?.state;
  const cgm = docState("CGM Script");
  const ip = docState("Insulin Pump Script");
  const clin = docState("Clinicals");

  const missing: string[] = [];
  if (ip && ip !== "na" && ip !== "ok") missing.push("a signed insulin pump script");
  if (cgm && cgm !== "na" && cgm !== "ok") missing.push("a signed CGM script");
  if (clin === "missing") missing.push("medical records");
  else if (clin === "invalid") missing.push("updated medical records from the last 6 months");
  if (clin === "ok") {
    if (!checklist.mr.diagnosisOk) missing.push("a documented diabetes diagnosis");
    for (const l of checklist.language) {
      for (const s of l.subItems) {
        if (s.state !== "ok") missing.push(SPOKEN_LANG[s.label] ?? s.label.toLowerCase());
      }
    }
  }

  const greeting = `"Hi, this is Medically Modern confirming you received our fax for ${name}.`;
  if (!missing.length) {
    return `${greeting} Everything we need looks complete - just confirming it came through."`;
  }
  return `${greeting} We're still missing the following, and it should be on the cover page: ${joinAnd(missing)}."`;
}
