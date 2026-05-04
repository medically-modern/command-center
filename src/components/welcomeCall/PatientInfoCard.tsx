import type { Patient } from "@/lib/welcomeCall/workflow";
import { SECONDARY_INSURANCE_OPTIONS, formatPhone, formatDateMDY, isCrossSell } from "@/lib/welcomeCall/workflow";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  patient: Patient;
  onFieldChange?: (field: keyof Patient, value: string | number | null) => void;
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </p>
      <p className="text-sm font-medium" title={value}>
        {value}
      </p>
    </div>
  );
}

export function PatientInfoCard({ patient, onFieldChange }: Props) {
  const hasSecondaryInsurance = !!patient.secondaryInsurance && patient.secondaryInsurance !== "";
  const hasMemberId2 = !!patient.memberId2 && patient.memberId2 !== "";

  return (
    <div className="space-y-4">
      {/* Patient name + phone + intake date */}
      <Card className="p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
            Patient Name
          </p>
          <p className="text-lg font-semibold">{patient.name}</p>
        </div>

        {patient.referralReceivedDate && (
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Intake Date
            </p>
            <p className="text-lg font-semibold">{formatDateMDY(patient.referralReceivedDate)}</p>
          </div>
        )}

        {patient.phone && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
              Phone
            </p>
            <a href={`tel:${patient.phone}`} className="text-lg font-semibold text-primary hover:underline">
              {formatPhone(patient.phone)}
            </a>
          </div>
        )}
      </Card>

      {/* Row 1: Referral/Product + Insurance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Referral Source" value={patient.referralSource} />
            <Field label="Doctor Name" value={patient.doctorName} />
            <Field label="Request Type" value={patient.requestType} />
            {patient.serving ? (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Serving
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium" title={patient.serving}>
                    {patient.serving}
                  </p>
                  {isCrossSell(patient) && (
                    <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider border border-amber-300">
                      Cross Sell
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </Card>

        <Card className="p-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Primary Insurance" value={patient.primaryInsurance} />
            <Field label="Member ID 1" value={patient.memberId1} />

            {/* Secondary Insurance: read-only if present, editable dropdown if empty */}
            {hasSecondaryInsurance ? (
              <Field label="Secondary Insurance" value={patient.secondaryInsurance} />
            ) : (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                  Secondary Insurance
                </p>
                <Select
                  value={
                    patient.secondaryInsuranceEdited !== null
                      ? String(
                          SECONDARY_INSURANCE_OPTIONS.find(
                            (o) => o.label === patient.secondaryInsuranceEdited
                          )?.index ?? ""
                        )
                      : ""
                  }
                  onValueChange={(value) => {
                    const option = SECONDARY_INSURANCE_OPTIONS.find(
                      (o) => String(o.index) === value
                    );
                    if (onFieldChange && option) {
                      onFieldChange("secondaryInsuranceEdited", option.label);
                      onFieldChange("secondaryInsuranceIndex", option.index);
                    }
                  }}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="Select insurance" />
                  </SelectTrigger>
                  <SelectContent>
                    {SECONDARY_INSURANCE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.index} value={String(opt.index)}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Member ID 2: read-only if present, editable text input if empty */}
            {hasMemberId2 ? (
              <Field label="Member ID 2" value={patient.memberId2} />
            ) : (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                  Member ID 2
                </p>
                <Input
                  className="h-8 text-sm"
                  value={patient.memberId2Edited ?? ""}
                  onChange={(e) => {
                    if (onFieldChange) {
                      onFieldChange("memberId2Edited", e.target.value);
                    }
                  }}
                  placeholder="Enter member ID"
                />
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
