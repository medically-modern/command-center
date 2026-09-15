/**
 * Monday item → `Order`. The same mapper serves the slim list read and the
 * full detail read; the caller says which it was, and a list row is stamped
 * `partial` so it can never be mistaken for the whole order (§5.25).
 */
import { COL, GROUP_TITLES, type MondayItem } from "./mondayApi";
import type { Order, OrderFile } from "./workflow";

export function mondayItemToOrder(item: MondayItem, opts: { partial?: boolean } = {}): Order {
  const byId = new Map(item.column_values.map((c) => [c.id, c]));
  const txt = (id: string) => byId.get(id)?.text ?? "";
  const statusIndex = (id: string): number | null => {
    const v = byId.get(id)?.value;
    if (!v) return null;
    try {
      const parsed = JSON.parse(v) as { index?: number } | null;
      return typeof parsed?.index === "number" ? parsed.index : null;
    } catch {
      return null;
    }
  };
  const phoneVal = (id: string) => {
    const v = byId.get(id)?.value;
    if (!v) return txt(id);
    try {
      return (JSON.parse(v) as { phone?: string }).phone ?? txt(id);
    } catch {
      return txt(id);
    }
  };
  const locationVal = (id: string) => {
    const v = byId.get(id)?.value;
    if (!v) return txt(id);
    try {
      return (JSON.parse(v) as { address?: string }).address ?? txt(id);
    } catch {
      return txt(id);
    }
  };
  const emailVal = (id: string) => {
    const v = byId.get(id)?.value;
    if (!v) return txt(id);
    try {
      return (JSON.parse(v) as { email?: string }).email ?? txt(id);
    } catch {
      return txt(id);
    }
  };

  const groupId = item.group?.id ?? "";
  const order: Order = {
    id: item.id,
    name: item.name,
    groupId,
    groupTitle: item.group?.title ?? GROUP_TITLES[groupId] ?? "",
    createdAt: item.created_at ?? "",
    updatedAt: item.updated_at ?? "",

    orderStatus: txt(COL.orderStatus),
    orderStatusIndex: statusIndex(COL.orderStatus),
    apiStatus: txt(COL.apiStatus),
    orderDate: txt(COL.orderDate),
    orderType: txt(COL.orderType),
    subscriptionType: txt(COL.subscriptionType),
    shipMethod: txt(COL.shipMethod),
    ddpOrder: txt(COL.ddpOrder),
    pos: txt(COL.pos),
    preCheck: txt(COL.preCheck),
    preCheckDetail: txt(COL.preCheckDetail),
    notes: txt(COL.notes),
    orderFrequency: txt(COL.orderFrequency),
    referralStatus: txt(COL.referralStatus),
    referralFlag: txt(COL.referralFlag),

    backordered: txt(COL.backordered),
    inactiveProducts: txt(COL.inactiveProducts),
    backorderedQty: txt(COL.backorderedQty),
    substituteInfusionSet: txt(COL.substituteInfusionSet),
    substitutionStatus: txt(COL.substitutionStatus),
    substitutionCahNumber: txt(COL.substitutionCahNumber),

    cgmType: txt(COL.cgmType),
    qtySensors: txt(COL.qtySensors),
    qtyMonitor: txt(COL.qtyMonitor),
    pumpType: txt(COL.pumpType),
    qtyPump: txt(COL.qtyPump),
    infusionSet1: txt(COL.infusionSet1),
    qtyInfusionSet1: txt(COL.qtyInfusionSet1),
    infusionSet2: txt(COL.infusionSet2),
    qtyInfusionSet2: txt(COL.qtyInfusionSet2),
    cartridgeType: txt(COL.cartridgeType),
    qtyCartridge: txt(COL.qtyCartridge),

    monitorAuthId: txt(COL.monitorAuthId),
    sensorsAuthId: txt(COL.sensorsAuthId),
    pumpAuthId: txt(COL.pumpAuthId),
    infusionSetAuthId: txt(COL.infusionSetAuthId),
    cartridgesAuthId: txt(COL.cartridgesAuthId),

    dob: txt(COL.dob),
    gender: txt(COL.gender),
    phone: phoneVal(COL.phone),
    email: emailVal(COL.email),
    address: locationVal(COL.address),
    snfHospice: txt(COL.snfHospice),

    primaryInsurance: txt(COL.primaryInsurance),
    memberId: txt(COL.memberId),
    secondaryInsurance: txt(COL.secondaryInsurance),
    secondaryId: txt(COL.secondaryId),
    otherPayerId: txt(COL.otherPayerId),
    diagnosisCode: txt(COL.diagnosisCode),
    cgmCoverage: txt(COL.cgmCoverage),
    medicarePriorPumpDate: txt(COL.medicarePriorPumpDate),

    doctorName: txt(COL.doctorName),
    doctorNpi: txt(COL.doctorNpi),
    doctorAddress: locationVal(COL.doctorAddress),
    doctorPhone: phoneVal(COL.doctorPhone),
    doctorFax: phoneVal(COL.doctorFax),

    cahOrderNumber: txt(COL.cahOrderNumber),
    poNumber: txt(COL.poNumber),
    lastCardinalSync: txt(COL.lastCardinalSync),
    apiMessage: txt(COL.apiMessage),
    holdReason: txt(COL.holdReason),
    uspsCheck: txt(COL.uspsCheck),
    lineItemDetail: txt(COL.lineItemDetail),
    cardinalRawResponse: txt(COL.cardinalRawResponse),
    cardinalRequestPayload: txt(COL.cardinalRequestPayload),
    orderDiscrepancy: txt(COL.orderDiscrepancy),

    warehouse: txt(COL.warehouse),
    carrier: txt(COL.carrier),
    carrierDescription: txt(COL.carrierDescription),
    estimatedShipDate: txt(COL.estimatedShipDate),
    shipDate: txt(COL.shipDate),
    tracking: [COL.tracking1, COL.tracking2, COL.tracking3, COL.tracking4, COL.tracking5]
      .map((id) => txt(id).trim())
      .filter(Boolean),
    packageWeight: txt(COL.packageWeight),
    serialNumbers: txt(COL.serialNumbers),
    deliveryDate: txt(COL.deliveryDate),
    signedBy: txt(COL.signedBy),
    confirmedDeliveryAddress: txt(COL.confirmedDeliveryAddress),
    shipTextLog: txt(COL.shipTextLog),
    deliveryCheckinText: txt(COL.deliveryCheckinText),

    invoiceNumber: txt(COL.invoiceNumber),
    invoiceDate: txt(COL.invoiceDate),
    invoiceDueDate: txt(COL.invoiceDueDate),
    invoiceAmount: txt(COL.invoiceAmount),
    invoiceSubtotal: txt(COL.invoiceSubtotal),
    salesTax: txt(COL.salesTax),
    shippingHandling: txt(COL.shippingHandling),
    freightFee: txt(COL.freightFee),
    paymentTerms: txt(COL.paymentTerms),
    superbillBatch: txt(COL.superbillBatch),

    files: filesByColumn(item),
  };
  if (opts.partial) order.partial = true;
  return order;
}

/**
 * File column value JSON (`{"files":[{name, assetId}]}`) cross-referenced with
 * the item's assets for a URL the viewer can fetch. Empty on the list read,
 * which asks for neither.
 */
function filesByColumn(item: MondayItem): Record<string, OrderFile[]> {
  const out: Record<string, OrderFile[]> = {};
  if (!item.assets?.length) return out;
  const assetById = new Map(item.assets.map((a) => [String(a.id), a]));
  for (const cv of item.column_values) {
    if (!cv.id.startsWith("file_") || !cv.value) continue;
    try {
      const parsed = JSON.parse(cv.value) as { files?: { name?: string; assetId?: number | string }[] };
      const list: OrderFile[] = [];
      for (const f of parsed.files ?? []) {
        const assetId = String(f.assetId ?? "");
        const a = assetById.get(assetId);
        if (!assetId || !a) continue;
        list.push({ assetId, name: f.name ?? a.name ?? "(unnamed)", url: a.public_url || a.url });
      }
      if (list.length) out[cv.id] = list;
    } catch {
      /* malformed value — no files */
    }
  }
  return out;
}
