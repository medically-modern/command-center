import { COL } from "./mondayApi";
import type { Patient } from "./workflow";
import type { MondayItem } from "./mondayApi";

/**
 * Convert a Monday board item into a Patient row.
 */
export function mondayItemToPatient(item: MondayItem): Patient {
  const cv = (id: string) => item.column_values.find((c) => c.id === id);
  const txt = (id: string) => cv(id)?.text ?? "";
  const statusIndex = (id: string): number | null => {
    const v = cv(id)?.value;
    if (!v) return null;
    try {
      return JSON.parse(v).index ?? null;
    } catch {
      return null;
    }
  };
  const phoneVal = (id: string) => {
    const v = cv(id)?.value;
    if (!v) return "";
    try {
      return JSON.parse(v).phone ?? "";
    } catch {
      return cv(id)?.text ?? "";
    }
  };
  const locationVal = (id: string) => {
    const v = cv(id)?.value;
    if (!v) return cv(id)?.text ?? "";
    try {
      return JSON.parse(v).address ?? "";
    } catch {
      return cv(id)?.text ?? "";
    }
  };

  return {
    id: item.id,
    name: item.name,
    dob: txt(COL.dob),
    phone: phoneVal(COL.phone),
    email: txt(COL.email),
    address: locationVal(COL.address),
    gender: txt(COL.gender),
    primaryInsurance: txt(COL.primaryInsurance),
    memberId1: txt(COL.memberId1),
    secondaryInsurance: txt(COL.secondaryInsurance),
    memberId2: txt(COL.memberId2),
    serving: txt(COL.serving),
    pumpType: txt(COL.pumpType),
    pumpTypeIndex: statusIndex(COL.pumpType),
    cgmType: txt(COL.cgmType),
    cgmTypeIndex: statusIndex(COL.cgmType),
    requestType: txt(COL.requestType),
    doctorName: txt(COL.doctorName),
    referralSource: txt(COL.referralSource),
    referralReceivedDate: txt(COL.referralReceivedDate),
    diagnosis: txt(COL.diagnosis),
    notes: txt(COL.notes),
    monitorQty: txt(COL.monitorQty),
    pumpQty: txt(COL.pumpQty),
    qtyInf1: txt(COL.qtyInf1),
    infusionSet1: txt(COL.infusionSet1),
    infusionSet1Index: statusIndex(COL.infusionSet1),
    qtyInf2: txt(COL.qtyInf2),
    infusionSet2: txt(COL.infusionSet2),
    infusionSet2Index: statusIndex(COL.infusionSet2),
    subscriptionType: txt(COL.subscriptionType),
    subscriptionTypeIndex: statusIndex(COL.subscriptionType),
    welcomeCallText: txt(COL.welcomeCallText),
    welcomeCallTextIndex: statusIndex(COL.welcomeCallText),
    orderHandling: txt(COL.orderHandling),
    orderHandlingIndex: statusIndex(COL.orderHandling),
    advanceDecision: txt(COL.advanceDecision),
    advanceDecisionIndex: statusIndex(COL.advanceDecision),
    secondaryInsuranceIndex: statusIndex(COL.secondaryInsurance),
    secondaryInsuranceEdited: null,
    memberId2Edited: null,
    addressEdited: null,
    addressLat: null,
    addressLng: null,
    escalated: false,
    receivedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}

