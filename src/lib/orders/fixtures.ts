/**
 * Test fixtures for the orders slice. SYNTHETIC — no patient data (§9: PHI
 * never goes into commits). The board shapes are real (groups, statuses,
 * Cardinal's sentences); the people are not.
 */
import { GROUPS } from "./mondayApi";
import type { Order } from "./workflow";

export function mkOrder(over: Partial<Order> = {}): Order {
  const blank: Order = {
    id: "1", name: "Test Patient", groupId: GROUPS.order, groupTitle: "Order", createdAt: "", updatedAt: "",
    orderStatus: "Order", orderStatusIndex: 0, apiStatus: "", orderDate: "2026-09-10", orderType: "Reorder",
    subscriptionType: "Supplies", shipMethod: "", ddpOrder: "", pos: "", preCheck: "", preCheckDetail: "", notes: "",
    orderFrequency: "", referralStatus: "", referralFlag: "",
    backordered: "", inactiveProducts: "", backorderedQty: "", substituteInfusionSet: "", substitutionStatus: "",
    substitutionCahNumber: "",
    cgmType: "", qtySensors: "", qtyMonitor: "", pumpType: "", qtyPump: "", infusionSet1: "", qtyInfusionSet1: "",
    infusionSet2: "", qtyInfusionSet2: "", cartridgeType: "", qtyCartridge: "",
    monitorAuthId: "", sensorsAuthId: "", pumpAuthId: "", infusionSetAuthId: "", cartridgesAuthId: "",
    dob: "", gender: "", phone: "5555550100", email: "", address: "", snfHospice: "",
    primaryInsurance: "", memberId: "", secondaryInsurance: "", secondaryId: "", otherPayerId: "", diagnosisCode: "",
    cgmCoverage: "", medicarePriorPumpDate: "",
    doctorName: "", doctorNpi: "", doctorAddress: "", doctorPhone: "", doctorFax: "",
    cahOrderNumber: "", poNumber: "", lastCardinalSync: "", apiMessage: "", holdReason: "", uspsCheck: "",
    lineItemDetail: "", cardinalRawResponse: "", cardinalRequestPayload: "", orderDiscrepancy: "",
    warehouse: "", carrier: "", carrierDescription: "", estimatedShipDate: "", shipDate: "", tracking: [],
    packageWeight: "", serialNumbers: "", deliveryDate: "", signedBy: "", confirmedDeliveryAddress: "",
    shipTextLog: "", deliveryCheckinText: "",
    invoiceNumber: "", invoiceDate: "", invoiceDueDate: "", invoiceAmount: "", invoiceSubtotal: "", salesTax: "",
    shippingHandling: "", freightFee: "", paymentTerms: "", superbillBatch: "",
    files: {},
  };
  return { ...blank, ...over };
}

/** Cardinal's real hold sentence, as it appears on the API Status column. */
export const HOLD_SENTENCE =
  "Order has been put on hold, Hold reason: Credit Check Failure, Please contact sales team for more details";
export const HOLD_RELEASED_SENTENCE =
  "HOLD RELEASED;  Another Hold applied which prevents to Book the order, Hold Reason: 9999 Line Level Hold, Please contact sales team for more details";
export const BOOKING_ERROR_SENTENCE =
  "Your order cannot be processed at this time due to error while booking an order, Please contact sales team for more details";

/** A placed, in-progress order (Accepted / Partial group, Cardinal accepted). */
export const placed = (over: Partial<Order> = {}) =>
  mkOrder({
    id: "2", groupId: GROUPS.acceptedPartial, groupTitle: "Accepted / Partial", orderStatus: "Process Claim",
    orderStatusIndex: 4, apiStatus: "Accepted", cahOrderNumber: "1100000001", poNumber: "MM-2-20260910",
    lastCardinalSync: "9/10/2026, 08:33:48 ET", ...over,
  });

/** A delivered order in the Shipped/Delivered group. */
export const delivered = (over: Partial<Order> = {}) =>
  mkOrder({
    id: "3", groupId: GROUPS.shippedDelivered, groupTitle: "Shipped/Delivered", orderStatus: "Process Claim",
    orderStatusIndex: 4, apiStatus: "Delivered", cahOrderNumber: "1100000002", shipDate: "2026-09-08",
    deliveryDate: "2026-09-11", carrier: "UPS", tracking: ["1Z999AA10123456784"], signedBy: "FRONT DOOR", ...over,
  });
