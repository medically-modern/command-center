/**
 * Patient Questions — read-only inbox of patient messages.
 * Aggregates from Subscription board ("Patient Help Message")
 * and Secondary Claims board ("Patient Message").
 */

export interface PatientQuestion {
  id: string;
  name: string;
  message: string;
  messageUpdatedAt: string;
  source: "subscription" | "claims";
  boardId: number;

  // ── Shared demographics ──
  dob: string;
  phone: string;
  email: string;
  address: string;
  gender: string;

  // ── Subscription-source fields ──
  status: string;
  daysToOrder: string;
  orderingCycle: string;
  nextOrder: string;
  subscription: string;
  orderType: string;
  primaryInsurance: string;
  memberId1: string;
  secondaryInsurance: string;
  memberId2: string;
  sensorsType: string;
  suppliesType: string;
  infusionSet1: string;
  infQty1: string;
  infusionSet2: string;
  infQty2: string;
  doctor: string;
  npi: string;
  doctorAddress: string;
  doctorPhone: string;
  doctorFax: string;
  cgmCoverage: string;
  mr: string;
  mnExpiry: string;
  diagnosis: string;
  sensorsAuthStatus: string;
  suppliesAuthStatus: string;
  sensorsAuthId: string;
  sensorsUnits: string;
  sensorsStartAuth: string;
  sensorsEndAuth: string;
  suppliesUnits: string;
  suppliesStartAuth: string;
  suppliesEndAuth: string;
  orderCount: string;
  claimsStatus: string;
  denialReason: string;
  totalRevenue: string;
  totalCost: string;
  totalGP: string;
  arr: string;
  stediActive: string;
  stediDedRemaining: string;
  insuranceChange: string;
  priorAuthReq: string;
  primaryClaimPaid: string;
  patientOrderResponse: string;
  patientInsuranceResponse: string;

  // ── Claims-source fields ──
  secondaryPayer: string;
  claimType: string;
  dos: string;
  claimSentDate: string;
  daysOutstanding: string;
  actionContext: string;
  denialAction: string;
  secondaryStatus: string;
  estPay: string;
  secondaryPaid: string;
  secondaryPaidDate: string;
  claimId: string;
  notesActivity: string;
  primaryPaidAmount: string;
  primaryPRAmount: string;
  primaryMemberId: string;
  primaryPayor: string;
  secondaryMemberId: string;
}
