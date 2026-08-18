/**
 * "Patient has filled out a DTC form" flag for the Already In System queue
 * (Josh, 2026-08-18).
 *
 * A doctor (or manufacturer) referral for somebody already in the system often
 * has a TWIN: the same patient also filled out the DTC intake form on their
 * own, so a second item for the same human sits in the form groups (§5.10),
 * worked by a different rep with neither knowing about the other. The Already
 * In System page flags the referral item — "this patient has filled out a DTC
 * form" — so the rep sees the patient's own submission before deciding what to
 * do with the referral.
 *
 * READ-ONLY DISPLAY. The flag changes no queue membership, no role count, no
 * baseline: it is computed in the browser from the page's own fetch plus a
 * slim poll of the two DTC form groups (`fetchDtcFormLeads`). That is why —
 * unlike the §5.9/§5.10 splits — there is deliberately NO keep-in-agreement
 * list for it. Do NOT "promote" this to the queue fetch: a form item routed
 * through `profileReferralRole` (an in-system "Yes" on a form row) would enter
 * this sidebar while `useRoleCounts` still counts it as Unverified — exactly
 * the sidebar-vs-burndown drift §5.8 exists to prevent.
 *
 * Matching is deliberately conservative: an email match, a phone match, or
 * name AND DOB together. Name alone is not identity (families share sidebars);
 * email/phone matches are shown WITH the matched item's name so a shared
 * household address explains itself on screen.
 */
import type { Patient } from "./workflow";
import { phoneDigits } from "./workflow";
import { isInSystemQueue } from "./referralSplit";

/** The DTC form's two board groups. Literals, same pattern as
 *  `referralSplit.IN_SYSTEM_GROUP` — must match `GROUPS.newFormPartial` /
 *  `GROUPS.newFormCompleted` in mondayApi.ts. */
export const DTC_FORM_GROUP_PARTIAL = "group_mm5z87zt";
export const DTC_FORM_GROUP_COMPLETED = "group_mm5zgeak";

/** One patient-submitted form item the flag can match against. */
export interface DtcFormLead {
  id: string;
  name: string;
  /** Board group the item sits in — decides the "view" link (partial vs
   *  completed form, or an item that already moved into a queue group). */
  groupId: string;
  dob: string;
  email: string;
  phone: string;
  /** Already In System status, when known (queue-sourced leads). Routing only. */
  alreadyInSystem?: string;
  /** When the form landed: an ISO timestamp (the form groups' `created_at`)
   *  or the yyyy-mm-dd Date of Intake for a queue-sourced lead. Display only. */
  submittedOn?: string;
}

export type DtcMatchReason = "email" | "phone" | "name+dob";

export interface DtcFormMatch {
  lead: DtcFormLead;
  matchedOn: DtcMatchReason[];
}

const emailKey = (raw: string | null | undefined): string => (raw ?? "").trim().toLowerCase();

/** A phone participates in matching only as a full 10-digit US number —
 *  fragments must not join two patients. `phoneDigits` already strips
 *  formatting and a leading +1/1 country code. */
const phoneKey = (raw: string | null | undefined): string => {
  const d = phoneDigits(raw ?? "");
  return d.length === 10 ? d : "";
};

/** Canonical "8/4/1963" from any M/D/Y rendering ("08/04/1963", "8-4-1963").
 *  Purely canonicalizing — no range validation, so two items carrying the same
 *  typo still match and nothing throws on junk. Non-3-part values don't
 *  participate ("" never matches). */
const dobKey = (raw: string | null | undefined): string => {
  const groups = (raw ?? "").match(/\d+/g);
  if (!groups || groups.length !== 3) return "";
  return groups.map((g) => String(Number(g))).join("/");
};

const nameKey = (raw: string | null | undefined): string =>
  (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");

type MatchablePatient = Pick<Patient, "id" | "name" | "dob" | "email" | "ptPhone">;

/** Every lead that looks like the same human as `patient`, with the evidence.
 *  Ignores the referral-type gate — use `dtcFormMatchesFor` for the flag. */
export function findDtcFormMatches(patient: MatchablePatient, leads: DtcFormLead[]): DtcFormMatch[] {
  const pEmail = emailKey(patient.email);
  const pPhone = phoneKey(patient.ptPhone);
  const pName = nameKey(patient.name);
  const pDob = dobKey(patient.dob);

  const out: DtcFormMatch[] = [];
  for (const lead of leads) {
    if (lead.id === patient.id) continue;
    const matchedOn: DtcMatchReason[] = [];
    if (pEmail && emailKey(lead.email) === pEmail) matchedOn.push("email");
    if (pPhone && phoneKey(lead.phone) === pPhone) matchedOn.push("phone");
    if (pName && pDob && nameKey(lead.name) === pName && dobKey(lead.dob) === pDob) {
      matchedOn.push("name+dob");
    }
    if (matchedOn.length > 0) out.push({ lead, matchedOn });
  }
  return out;
}

/**
 * True when the queue item ITSELF came from the patient's own form — flagging
 * "the patient filled out a DTC form" on the form would be noise. Referral
 * TYPE only, the same vocabulary rule as referralSplit: the SOURCE column has
 * its own "Patient" label that must not decide anything.
 */
export function isPatientFormReferral(referralType: string | null | undefined): boolean {
  return (referralType ?? "").trim().toLowerCase() === "patient";
}

/**
 * The flag: matches for a queue patient, or [] when the patient's own item is
 * a patient-form referral. Doctor referrals are the reported case; the flag
 * renders for every non-patient origin (Manufacturer, Payor, blank …) because
 * "the patient filled out a DTC form" is just as true and as useful there.
 */
export function dtcFormMatchesFor(
  patient: MatchablePatient & Pick<Patient, "referralType">,
  leads: DtcFormLead[],
): DtcFormMatch[] {
  if (isPatientFormReferral(patient.referralType)) return [];
  return findDtcFormMatches(patient, leads);
}

/**
 * Patient-form items already sitting in the queue's OWN fetch, as leads. A
 * form row marked Already In System "Yes" is MOVED into the board's in-system
 * group and leaves the form groups (Ivy Gushea's pair, 2026-07-28), so the
 * form-group poll alone would miss exactly the twin this flag exists for.
 * Zero extra fetch: the page already holds these patients.
 */
export function queueLeadsFrom(
  patients: (MatchablePatient &
    Pick<Patient, "referralType" | "groupId" | "alreadyInSystem" | "dateOfIntake">)[],
): DtcFormLead[] {
  return patients
    .filter((p) => isPatientFormReferral(p.referralType))
    .map((p) => ({
      id: p.id,
      name: p.name,
      groupId: p.groupId ?? "",
      dob: p.dob,
      email: p.email,
      phone: p.ptPhone,
      alreadyInSystem: p.alreadyInSystem,
      submittedOn: p.dateOfIntake,
    }));
}

/** Short label for where the matched form item stands. */
export function dtcLeadKindLabel(lead: DtcFormLead): string {
  if (lead.groupId === DTC_FORM_GROUP_PARTIAL) return "partial form";
  if (lead.groupId === DTC_FORM_GROUP_COMPLETED) return "completed form";
  return "patient-submitted referral";
}

/**
 * Where "View form" navigates. `null` = the lead is in THIS queue (Already In
 * System, by group or by flag — §5.10's two routes), so the page selects it in
 * place instead of navigating away.
 */
export function dtcLeadRoute(lead: DtcFormLead): string | null {
  if (lead.groupId === DTC_FORM_GROUP_PARTIAL) {
    return `/unverified-referrals?source=partial&patientId=${lead.id}`;
  }
  if (lead.groupId === DTC_FORM_GROUP_COMPLETED) {
    return `/unverified-referrals?patientId=${lead.id}`;
  }
  if (isInSystemQueue(lead.alreadyInSystem, lead.groupId)) return null;
  return `/profile?patientId=${lead.id}`;
}
