/**
 * Who the order is for, what pays for it, who prescribed it — the columns the
 * Welcome Call → order board hop copied onto the item. All read-only here
 * (`mondayApi.ts` header). Lives in the details drawer: the header already
 * names the patient, the DOB and the ship-to address.
 */
import { Card } from "@/components/ui/card";
import { fmtPhone, type Order } from "@/lib/orders/workflow";
import { Field, SectionTitle } from "./Field";

export function PatientCoverageCard({ order }: { order: Order }) {
  const authIds = [
    ["Sensors", order.sensorsAuthId], ["Receiver", order.monitorAuthId], ["Pump", order.pumpAuthId],
    ["Sets", order.infusionSetAuthId], ["Cartridges", order.cartridgesAuthId],
  ]
    .filter(([, v]) => (v ?? "").trim())
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");

  return (
    <Card className="p-4">
      <SectionTitle>Patient & coverage</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Gender" value={order.gender} />
        <Field label="Email" value={order.email} valueClassName="text-xs break-all" />
        <Field label="Phone" value={fmtPhone(order.phone)} />
        <Field label="Place of service" value={order.pos} />
        <Field label="SNF / hospice / hospital" value={order.snfHospice} className="col-span-2" valueClassName="text-amber-700" />
      </div>

      <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-3">
        <Field label="Primary insurance" value={order.primaryInsurance} />
        <Field label="Member ID" value={order.memberId} valueClassName="font-mono" />
        <Field label="Secondary insurance" value={order.secondaryInsurance} />
        <Field label="Secondary ID" value={order.secondaryId} valueClassName="font-mono" />
        <Field label="Other payer ID" value={order.otherPayerId} valueClassName="font-mono" />
        <Field label="Diagnosis" value={order.diagnosisCode} />
        <Field label="CGM coverage" value={order.cgmCoverage} />
        <Field label="Medicare prior pump date" value={order.medicarePriorPumpDate} />
        <Field label="Order frequency" value={order.orderFrequency} />
        <Field label="DDP order" value={order.ddpOrder} />
        <Field label="Auth IDs" value={authIds} className="col-span-2" valueClassName="font-mono text-xs" />
      </div>

      <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-3">
        <Field label="Doctor" value={order.doctorName} />
        <Field label="NPI" value={order.doctorNpi} valueClassName="font-mono" />
        <Field label="Clinic address" value={order.doctorAddress} className="col-span-2" />
        <Field label="Doctor phone" value={fmtPhone(order.doctorPhone)} />
        <Field label="Doctor fax" value={fmtPhone(order.doctorFax)} />
        <Field label="Referral" value={[order.referralFlag ? `Referral: ${order.referralFlag}` : "", order.referralStatus].filter(Boolean).join(" · ")} />
      </div>
    </Card>
  );
}

/** The board's running notes on this order. Display-only (§5.35). */
export function NotesCard({ order }: { order: Order }) {
  return (
    <Card className="p-4">
      <SectionTitle>Notes</SectionTitle>
      {order.notes ? (
        <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed font-sans">{order.notes}</pre>
      ) : (
        <p className="text-sm text-muted-foreground">No notes on this order.</p>
      )}
    </Card>
  );
}
