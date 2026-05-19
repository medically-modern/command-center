import type { Patient } from "@/lib/welcomeCall/workflow";
import { Card } from "@/components/ui/card";

interface Props {
  patient: Patient;
}

function ReviewRow({ label, value, filled }: { label: string; value: string; filled: boolean }) {
  return (
    <tr className={filled ? "bg-green-50" : ""}>
      <td className="px-4 py-3 text-sm font-medium text-muted-foreground border-b">{label}</td>
      <td className="px-4 py-3 text-sm text-right border-b font-semibold">{value || "—"}</td>
    </tr>
  );
}

export function ReviewPanel({ patient }: Props) {
  // Track which fields have values
  const filledFields: [string, string, boolean][] = [
    [
      "Serving",
      patient.servingEdited || patient.serving,
      !!(patient.servingEdited || patient.serving),
    ],
    ["CGM Type", patient.cgmType, !!patient.cgmType],
    ["Monitor Qty", patient.monitorQty, !!patient.monitorQty],
    ["Infusion Set 1", patient.infusionSet1, !!patient.infusionSet1],
    ["Qty Inf. 1", patient.qtyInf1, !!patient.qtyInf1],
    ["Infusion Set 2", patient.infusionSet2, !!patient.infusionSet2],
    ["Qty Inf. 2", patient.qtyInf2, !!patient.qtyInf2],
    ["Subscription Type", patient.subscriptionType, !!patient.subscriptionType],
    ["Welcome Call Text", patient.welcomeCallText, !!patient.welcomeCallText],
    ["Order Handling", patient.orderHandling, !!patient.orderHandling],
    [
      "Address",
      patient.addressEdited || patient.address,
      !!(patient.addressEdited || patient.address),
    ],
    [
      "Secondary Insurance",
      patient.secondaryInsuranceEdited || patient.secondaryInsurance,
      !!(patient.secondaryInsuranceEdited || patient.secondaryInsurance),
    ],
    [
      "Member ID 2",
      patient.memberId2Edited || patient.memberId2,
      !!(patient.memberId2Edited || patient.memberId2),
    ],
    ["Advance?", patient.advanceDecision, !!patient.advanceDecision],
  ];

  const filledCount = filledFields.filter(([, , filled]) => filled).length;

  return (
    <Card className="p-6 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          Review & Send
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          {filledCount} of {filledFields.length} fields filled. Green rows will be updated in Monday.
        </p>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <table className="w-full">
          <tbody>
            {filledFields.map(([label, value, filled], idx) => (
              <ReviewRow key={idx} label={label} value={value} filled={filled} />
            ))}
          </tbody>
        </table>
      </div>

      {filledCount === 0 && (
        <div className="rounded-lg border border-dashed bg-muted/20 p-4 text-center">
          <p className="text-sm text-muted-foreground">
            No fields filled in yet. Complete the form above to review changes.
          </p>
        </div>
      )}
    </Card>
  );
}
