/**
 * Who the order is for, what pays for it, who prescribed it — the columns the
 * Welcome Call → order board hop copied onto the item — plus the board's own
 * notes and the advisory pre-check. All read-only here (`mondayApi.ts` header).
 */
import { Card } from "@/components/ui/card";
import { fmtPhone, type Order } from "@/lib/orders/workflow";
import { Field, SectionTitle } from "./Field";

export function PatientCoverageCard({ order }: { order: Order }) {
  return (
    <Card className="p-4">
      <SectionTitle>Patient & coverage</SectionTitle>
      <div className="grid grid-cols-2 gap-3">
        <Field label="DOB" value={order.dob} />
        <Field label="Gender" value={order.gender} />
        <Field label="Phone" value={fmtPhone(order.phone)} />
        <Field label="Email" value={order.email} valueClassName="text-xs break-all" />
        <Field label="Ship-to address" value={order.address} className="col-span-2" />
        <Field label="SNF / hospice / hospital" value={order.snfHospice} valueClassName="text-amber-700" />
        <Field label="Place of service" value={order.pos} />
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

export function NotesCard({ order }: { order: Order }) {
  return (
    <Card className="p-4">
      <SectionTitle>Notes</SectionTitle>
      {order.notes ? (
        <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed font-sans">{order.notes}</pre>
      ) : (
        <p className="text-sm text-muted-foreground">No notes on this order.</p>
      )}
      {(order.preCheck || order.preCheckDetail) && (
        <div className="mt-3 pt-3 border-t">
          <Field label="Pre-check" value={order.preCheck} valueClassName={/^good to go/i.test(order.preCheck) ? "text-emerald-700" : "text-amber-700"} />
          {order.preCheckDetail && (
            <pre className="mt-1.5 whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-[11px] leading-relaxed">{order.preCheckDetail}</pre>
          )}
        </div>
      )}
    </Card>
  );
}
