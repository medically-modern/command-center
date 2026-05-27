import { COL } from "./mondayApi";
import type { Patient } from "./workflow";
import type { MondayItem } from "./mondayApi";

/**
 * Convert a Monday board item into a Subscription Patient row.
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
  const emailVal = (id: string) => {
    const v = cv(id)?.value;
    if (!v) return cv(id)?.text ?? "";
    try {
      return JSON.parse(v).email ?? cv(id)?.text ?? "";
    } catch {
      return cv(id)?.text ?? "";
    }
  };
  const dropdownText = (id: string) => {
    return cv(id)?.text ?? "";
  };

  return {
    id: item.id,
    name: item.name,

    // Subscription meta
    status: txt(COL.status),
    statusIndex: statusIndex(COL.status),
    daysToOrder: txt(COL.daysToOrder),
    daysToOrderIndex: statusIndex(COL.daysToOrder),
    orderingCycle: txt(COL.orderingCycle),
    orderingCycleIndex: statusIndex(COL.orderingCycle),
    nextOrder: txt(COL.nextOrder),
    subscription: txt(COL.subscription),
    subscriptionIndex: statusIndex(COL.subscription),
    orderType: txt(COL.orderType),
    orderTypeIndex: statusIndex(COL.orderType),

    // Demographics
    dob: txt(COL.dob),
    gender: txt(COL.gender),
    phone: phoneVal(COL.phone),
    email: emailVal(COL.email),
    address: locationVal(COL.address),

    // Insurance
    primaryInsurance: txt(COL.primaryInsurance),
    primaryInsuranceIndex: statusIndex(COL.primaryInsurance),
    memberId1: txt(COL.memberId1),
    secondaryInsurance: txt(COL.secondaryInsurance),
    secondaryInsuranceIndex: statusIndex(COL.secondaryInsurance),
    memberId2: txt(COL.memberId2),

    // Financials
    sensorsRevenue: txt(COL.sensorsRevenue),
    sensorsCost: txt(COL.sensorsCost),
    sensorsGP: txt(COL.sensorsGP),
    suppliesRevenue: txt(COL.suppliesRevenue),
    suppliesCost: txt(COL.suppliesCost),
    suppliesGP: txt(COL.suppliesGP),
    totalRevenue: txt(COL.totalRevenue),
    totalCost: txt(COL.totalCost),
    shippingCost: txt(COL.shippingCost),
    totalGP: txt(COL.totalGP),
    arr: txt(COL.arr),
    arp: txt(COL.arp),

    // Medical Necessity
    cgmCoverage: txt(COL.cgmCoverage),
    mr: txt(COL.mr),
    mnExpiry: txt(COL.mnExpiry),
    diagnosis: txt(COL.diagnosis),

    // Prior Auth — Sensors
    sensorsAuthStatus: txt(COL.sensorsAuthStatus),
    sensorsAuthStatusIndex: statusIndex(COL.sensorsAuthStatus),
    sensorsAuthId: txt(COL.sensorsAuthId),
    sensorsUnits: txt(COL.sensorsUnits),
    sensorsStartAuth: txt(COL.sensorsStartAuth),
    sensorsEndAuth: txt(COL.sensorsEndAuth),
    sensorsId2: txt(COL.sensorsId2),

    // Prior Auth — Supplies
    suppliesAuthStatus: txt(COL.suppliesAuthStatus),
    suppliesAuthStatusIndex: statusIndex(COL.suppliesAuthStatus),
    infusionSetAuthId: txt(COL.infusionSetAuthId),
    cartridgeAuthId: txt(COL.cartridgeAuthId),
    suppliesUnits: txt(COL.suppliesUnits),
    suppliesStartAuth: txt(COL.suppliesStartAuth),
    suppliesEndAuth: txt(COL.suppliesEndAuth),

    // Order Details
    sensorsType: txt(COL.sensorsType),
    sensorsTypeIndex: statusIndex(COL.sensorsType),
    suppliesType: txt(COL.suppliesType),
    suppliesTypeIndex: statusIndex(COL.suppliesType),
    infusionSet1: txt(COL.infusionSet1),
    infusionSet1Index: statusIndex(COL.infusionSet1),
    infQty1: txt(COL.infQty1),
    infusionSet2: txt(COL.infusionSet2),
    infusionSet2Index: statusIndex(COL.infusionSet2),
    infQty2: txt(COL.infQty2),

    // Doctor
    doctor: txt(COL.doctor),
    npi: txt(COL.npi),
    doctorAddress: locationVal(COL.doctorAddress),
    doctorPhone: phoneVal(COL.doctorPhone),
    doctorFax: emailVal(COL.doctorFax),
    faxParachute: txt(COL.faxParachute),

    // Other
    orderCount: txt(COL.orderCount),
    deadReason: dropdownText(COL.deadReason),
    pauseReason: dropdownText(COL.pauseReason),
    referral: dropdownText(COL.referral),
    carecentrixIntakeId: txt(COL.carecentrixIntakeId),
    denialReason: txt(COL.denialReason),

    // Stedi
    stediActive: txt(COL.stediActive),
    stediDedRemaining: txt(COL.stediDedRemaining),
    insuranceChange: txt(COL.insuranceChange),
    priorAuthReq: txt(COL.priorAuthReq),
    primaryClaimPaid: txt(COL.primaryClaimPaid),

    // Claims
    claimsStatus: txt(COL.claimsStatus),

    // Local UI state
    phoneEdited: null,
    addressEdited: null,
    addressLat: null,
    addressLng: null,
    memberId1Edited: null,
    memberId2Edited: null,
    doctorEdited: null,
    npiEdited: null,
    doctorAddressEdited: null,
    doctorPhoneEdited: null,
    doctorFaxEdited: null,
    primaryInsuranceEdited: null,
    secondaryInsuranceEdited: null,
    faxParachuteEdited: null,
    notes: "",
    escalated: false,
    receivedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
  };
}
