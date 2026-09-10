import type { Patient } from "@/lib/welcomeCall/workflow";
import { Card } from "@/components/ui/card";
import { caregiverFor, phoneSlotWrites, phoneSlotsFor } from "@/lib/welcomeCall/phoneSlots";
import { frequencyState, daysToLabel } from "@/lib/welcomeCall/orderFrequency";

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
  /* ⚠️ Read through the same helpers the SEND uses, never off the columns —
     this table's whole job is to say what is about to be written, and a row
     showing the board's stale value beside a Send that writes the rep's edit is
     worse than no row at all. */
  const phones = phoneSlotWrites(phoneSlotsFor(patient), caregiverFor(patient));
  const contactLabel = (id: number | null) =>
    id === null ? "" : id === 7 ? "Patient" : id === 4 ? "Caregiver" : "";
  const frequency = frequencyState({
    boardLabel: patient.orderFrequency,
    edited: patient.orderFrequencyEdited,
    primaryInsurance: patient.primaryInsuranceEdited ?? patient.primaryInsurance,
    secondaryInsurance: patient.secondaryInsuranceEdited ?? patient.secondaryInsurance,
  });

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
    ["Qty Cartridge", patient.qtyCartridge, !!patient.qtyCartridge],
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
    /* The six phone/caregiver columns — Brandon's handoff: "Add all six to the
       Review & Send list". */
    ["Primary Phone", phones.primaryPhone, !!phones.primaryPhone],
    ["Primary Contact", contactLabel(phones.primaryContactId), phones.primaryContactId !== null],
    ["Can Text", phones.canTextId === null ? "" : phones.canTextId === 1 ? "Yes" : "No", phones.canTextId !== null],
    ["Alternate Phone", phones.alternatePhone, !!phones.alternatePhone],
    ["Alternate Contact", contactLabel(phones.alternateContactId), phones.alternateContactId !== null],
    ["Caregiver Name", phones.caregiverName, !!phones.caregiverName],
    ["Caregiver Authorized", phones.caregiverAuthorized ? "Yes" : "", phones.caregiverAuthorized],
    /* Still owed from the 2026-09-09 notes: the three Next Order Dates ("edits
       here are real … add Sensors / IP / Supplies Next Order Date to Review &
       Send"), plus Order Frequency and Insurance Notes, which this stage began
       writing on 09-09 and which nothing here reported. */
    ["Order Frequency", frequency.days ? daysToLabel(frequency.days) : "", !!frequency.days],
    [
      "Sensors Next Order Date",
      patient.sensorsNextOrderDateEdited ?? patient.sensorsNextOrderDate,
      !!(patient.sensorsNextOrderDateEdited ?? patient.sensorsNextOrderDate),
    ],
    [
      "IP Next Order Date",
      patient.ipNextOrderDateEdited ?? patient.ipNextOrderDate,
      !!(patient.ipNextOrderDateEdited ?? patient.ipNextOrderDate),
    ],
    [
      "Supplies Next Order Date",
      patient.suppliesNextOrderDateEdited ?? patient.suppliesNextOrderDate,
      !!(patient.suppliesNextOrderDateEdited ?? patient.suppliesNextOrderDate),
    ],
    [
      "Insurance Notes",
      patient.insuranceNotesEdited ?? patient.insuranceNotes ?? "",
      !!(patient.insuranceNotesEdited ?? patient.insuranceNotes),
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
