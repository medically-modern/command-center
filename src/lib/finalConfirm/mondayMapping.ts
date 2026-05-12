import type { Patient } from "./workflow";
import { COL, type MondayItem } from "./mondayApi";

function cv(item: MondayItem, id: string) {
  return item.column_values.find((c) => c.id === id);
}

function parseIndex(value: string | null): number | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed?.index === "number" ? parsed.index : null;
  } catch {
    return null;
  }
}

export function mondayItemToPatient(item: MondayItem): Patient {
  return {
    id: item.id,
    name: item.name,

    // Demographics
    dob: cv(item, COL.dob)?.text ?? "",
    phone: cv(item, COL.phone)?.text ?? "",
    email: cv(item, COL.email)?.text ?? "",
    address: cv(item, COL.address)?.text ?? "",
    gender: cv(item, COL.gender)?.text ?? "",
    genderIndex: parseIndex(cv(item, COL.gender)?.value ?? null),

    // Insurance
    primaryInsurance: cv(item, COL.primaryInsurance)?.text ?? "",
    primaryInsuranceIndex: parseIndex(cv(item, COL.primaryInsurance)?.value ?? null),
    memberId1: cv(item, COL.memberId1)?.text ?? "",
    secondaryInsurance: cv(item, COL.secondaryInsurance)?.text ?? "",
    secondaryInsuranceIndex: parseIndex(cv(item, COL.secondaryInsurance)?.value ?? null),
    secondaryInsuranceEdited: null,
    memberId2: cv(item, COL.memberId2)?.text ?? "",
    memberId2Edited: null,
    deductible: cv(item, COL.deductible)?.text ?? "",
    deductibleRemaining: cv(item, COL.deductibleRemaining)?.text ?? "",
    oopMax: cv(item, COL.oopMax)?.text ?? "",
    oopMaxRemaining: cv(item, COL.oopMaxRemaining)?.text ?? "",

    // Doctor
    doctorName: cv(item, COL.doctorName)?.text ?? "",
    doctorNpi: cv(item, COL.doctorNpi)?.text ?? "",
    doctorPhone: cv(item, COL.doctorPhone)?.text ?? "",
    doctorEmail: cv(item, COL.doctorEmail)?.text ?? "",
    doctorFax: cv(item, COL.doctorFax)?.text ?? "",
    clinicName: cv(item, COL.clinicName)?.text ?? "",
    clinicalsMethod: cv(item, COL.clinicalsMethod)?.text ?? "",
    clinicalsMethodIndex: parseIndex(cv(item, COL.clinicalsMethod)?.value ?? null),

    // Medical Necessity
    diagnosis: cv(item, COL.diagnosis)?.text ?? "",
    diagnosisIndex: parseIndex(cv(item, COL.diagnosis)?.value ?? null),
    cgmCoveragePath: cv(item, COL.cgmCoveragePath)?.text ?? "",
    cgmCoveragePathIndex: parseIndex(cv(item, COL.cgmCoveragePath)?.value ?? null),
    ipCoveragePath: cv(item, COL.ipCoveragePath)?.text ?? "",
    ipCoveragePathIndex: parseIndex(cv(item, COL.ipCoveragePath)?.value ?? null),
    mrExpiryDate: cv(item, COL.mrExpiryDate)?.text ?? "",

    // Product / Referral
    serving: cv(item, COL.serving)?.text ?? "",
    servingIndex: parseIndex(cv(item, COL.serving)?.value ?? null),
    pumpType: cv(item, COL.pumpType)?.text ?? "",
    pumpTypeIndex: parseIndex(cv(item, COL.pumpType)?.value ?? null),
    cgmType: cv(item, COL.cgmType)?.text ?? "",
    cgmTypeIndex: parseIndex(cv(item, COL.cgmType)?.value ?? null),
    requestType: cv(item, COL.requestType)?.text ?? "",
    requestTypeIndex: parseIndex(cv(item, COL.requestType)?.value ?? null),
    referralType: cv(item, COL.referralType)?.text ?? "",
    referralTypeIndex: parseIndex(cv(item, COL.referralType)?.value ?? null),
    referralSource: cv(item, COL.referralSource)?.text ?? "",
    referralSourceIndex: parseIndex(cv(item, COL.referralSource)?.value ?? null),

    // Welcome Call / Order
    subscriptionType: cv(item, COL.subscriptionType)?.text ?? "",
    subscriptionTypeIndex: parseIndex(cv(item, COL.subscriptionType)?.value ?? null),
    infusionSet1: cv(item, COL.infusionSet1)?.text ?? "",
    infusionSet1Index: parseIndex(cv(item, COL.infusionSet1)?.value ?? null),
    qtyInf1: cv(item, COL.qtyInf1)?.text ?? "",
    infusionSet2: cv(item, COL.infusionSet2)?.text ?? "",
    infusionSet2Index: parseIndex(cv(item, COL.infusionSet2)?.value ?? null),
    qtyInf2: cv(item, COL.qtyInf2)?.text ?? "",
    monitorQty: cv(item, COL.monitorQty)?.text ?? "",
    pumpQty: cv(item, COL.pumpQty)?.text ?? "",
    orderHandling: cv(item, COL.orderHandling)?.text ?? "",
    orderHandlingIndex: parseIndex(cv(item, COL.orderHandling)?.value ?? null),

    // SoS & Last Bill Dates — derive SoS from whether a last-bill date is populated
    lastBillDateMonitor: cv(item, COL.lastBillDate.monitor)?.text ?? "",
    lastBillDateSensors: cv(item, COL.lastBillDate.sensors)?.text ?? "",
    lastBillDateIp: cv(item, COL.lastBillDate.insulin_pump)?.text ?? "",
    lastBillDateInfusionSet: cv(item, COL.lastBillDate.infusion_set)?.text ?? "",
    lastBillDateCartridge: cv(item, COL.lastBillDate.cartridge)?.text ?? "",
    sosMonitor: (cv(item, COL.lastBillDate.monitor)?.text ?? "") ? "Not Clear" : "",
    sosSensors: (cv(item, COL.lastBillDate.sensors)?.text ?? "") ? "Not Clear" : "",
    sosIp: (cv(item, COL.lastBillDate.insulin_pump)?.text ?? "") ? "Not Clear" : "",
    sosInfusionSet: (cv(item, COL.lastBillDate.infusion_set)?.text ?? "") ? "Not Clear" : "",
    sosCartridge: (cv(item, COL.lastBillDate.cartridge)?.text ?? "") ? "Not Clear" : "",
    // Calculated next order dates (read-only)
    nextOrderDateIp: cv(item, COL.nextOrderDate.insulin_pump)?.text ?? "",
    nextOrderDateSensors: cv(item, COL.nextOrderDate.sensors)?.text ?? "",
    nextOrderDateSupplies: cv(item, COL.nextOrderDate.supplies)?.text ?? "",

    // Auth Results
    cgmAuthResult: cv(item, COL.cgmAuthResult)?.text ?? "",
    cgmAuthResultIndex: parseIndex(cv(item, COL.cgmAuthResult)?.value ?? null),
    sensorsAuthResult: cv(item, COL.sensorsAuthResult)?.text ?? "",
    sensorsAuthResultIndex: parseIndex(cv(item, COL.sensorsAuthResult)?.value ?? null),
    ipAuthResult: cv(item, COL.ipAuthResult)?.text ?? "",
    ipAuthResultIndex: parseIndex(cv(item, COL.ipAuthResult)?.value ?? null),
    infusionSetAuthResult: cv(item, COL.infusionSetAuthResult)?.text ?? "",
    infusionSetAuthResultIndex: parseIndex(cv(item, COL.infusionSetAuthResult)?.value ?? null),
    cartridgeAuthResult: cv(item, COL.cartridgeAuthResult)?.text ?? "",
    cartridgeAuthResultIndex: parseIndex(cv(item, COL.cartridgeAuthResult)?.value ?? null),

    // Auth Details
    monitorAuthId: cv(item, COL.authDetail.monitor.id)?.text ?? "",
    monitorAuthStart: cv(item, COL.authDetail.monitor.start)?.text ?? "",
    monitorAuthEnd: cv(item, COL.authDetail.monitor.end)?.text ?? "",
    monitorAuthUnits: cv(item, COL.authDetail.monitor.units)?.text ?? "",
    sensorsAuthId: cv(item, COL.authDetail.sensors.id)?.text ?? "",
    sensorsAuthStart: cv(item, COL.authDetail.sensors.start)?.text ?? "",
    sensorsAuthEnd: cv(item, COL.authDetail.sensors.end)?.text ?? "",
    sensorsAuthUnits: cv(item, COL.authDetail.sensors.units)?.text ?? "",
    ipAuthId: cv(item, COL.authDetail.insulin_pump.id)?.text ?? "",
    ipAuthStart: cv(item, COL.authDetail.insulin_pump.start)?.text ?? "",
    ipAuthEnd: cv(item, COL.authDetail.insulin_pump.end)?.text ?? "",
    ipAuthUnits: cv(item, COL.authDetail.insulin_pump.units)?.text ?? "",
    infusionSetAuthId: cv(item, COL.authDetail.infusion_set.id)?.text ?? "",
    infusionSetAuthStart: cv(item, COL.authDetail.infusion_set.start)?.text ?? "",
    infusionSetAuthEnd: cv(item, COL.authDetail.infusion_set.end)?.text ?? "",
    infusionSetAuthUnits: cv(item, COL.authDetail.infusion_set.units)?.text ?? "",
    cartridgeAuthId: cv(item, COL.authDetail.cartridge.id)?.text ?? "",
    cartridgeAuthStart: cv(item, COL.authDetail.cartridge.start)?.text ?? "",
    cartridgeAuthEnd: cv(item, COL.authDetail.cartridge.end)?.text ?? "",
    cartridgeAuthUnits: cv(item, COL.authDetail.cartridge.units)?.text ?? "",

    // Notes
    notes: cv(item, COL.notes)?.text ?? "",

    // Editable overrides (start null — populated by local edits)
    addressEdited: null,
    addressLat: null,
    addressLng: null,
    emailEdited: null,
    phoneEdited: null,

    // Escalation
    escalated: false,

    receivedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    dateOfStageStart: cv(item, COL.dateOfStageStart)?.text ?? "",
  };
}
