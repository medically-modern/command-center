import type { Patient } from "@/lib/subscription/workflow";
import {
  ORDERING_CYCLE_OPTIONS,
  SUBSCRIPTION_OPTIONS,
  ORDER_TYPE_OPTIONS,
  SENSORS_TYPE_OPTIONS,
  SUPPLIES_TYPE_OPTIONS,
  INFUSION_SET_1_OPTIONS,
  INFUSION_SET_2_OPTIONS,
} from "@/lib/subscription/workflow";
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
  onFieldChange: (field: keyof Patient, value: string | number | null) => void;
}

function StatusSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { index: number; label: string }[];
  value: number | null;
  onChange: (index: number) => void;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</p>
      <Select value={value !== null ? String(value) : ""} onValueChange={(v) => onChange(Number(v))}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.index} value={String(opt.index)}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}


export function SubscriptionForm({ patient, onFieldChange }: Props) {
  return (
    <div className="space-y-4">
      {/* Cycle Controls (Status is display-only in PatientInfoCard) */}
      <Card className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Cycle Controls</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatusSelect
            label="Ordering Cycle"
            options={ORDERING_CYCLE_OPTIONS}
            value={patient.orderingCycleIndex}
            onChange={(idx) => {
              onFieldChange("orderingCycleIndex", idx);
              onFieldChange("orderingCycle", ORDERING_CYCLE_OPTIONS.find((o) => o.index === idx)?.label ?? "");
            }}
          />
          <StatusSelect
            label="Subscription"
            options={SUBSCRIPTION_OPTIONS}
            value={patient.subscriptionIndex}
            onChange={(idx) => {
              onFieldChange("subscriptionIndex", idx);
              onFieldChange("subscription", SUBSCRIPTION_OPTIONS.find((o) => o.index === idx)?.label ?? "");
            }}
          />
          <StatusSelect
            label="Order Type"
            options={ORDER_TYPE_OPTIONS}
            value={patient.orderTypeIndex}
            onChange={(idx) => {
              onFieldChange("orderTypeIndex", idx);
              onFieldChange("orderType", ORDER_TYPE_OPTIONS.find((o) => o.index === idx)?.label ?? "");
            }}
          />
        </div>
      </Card>

      {/* Next Order Date */}
      <Card className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Next Order Date</p>
        <div className="max-w-xs">
          <Input
            type="date"
            value={patient.nextOrder}
            onChange={(e) => onFieldChange("nextOrder", e.target.value)}
            className="h-9 text-sm"
          />
        </div>
      </Card>

      {/* Order Details — Sensors & Supplies */}
      <Card className="p-4">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Order Details</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatusSelect
            label="Sensors Type"
            options={SENSORS_TYPE_OPTIONS}
            value={patient.sensorsTypeIndex}
            onChange={(idx) => {
              onFieldChange("sensorsTypeIndex", idx);
              onFieldChange("sensorsType", SENSORS_TYPE_OPTIONS.find((o) => o.index === idx)?.label ?? "");
            }}
          />
          <StatusSelect
            label="Supplies Type (Pump)"
            options={SUPPLIES_TYPE_OPTIONS}
            value={patient.suppliesTypeIndex}
            onChange={(idx) => {
              onFieldChange("suppliesTypeIndex", idx);
              onFieldChange("suppliesType", SUPPLIES_TYPE_OPTIONS.find((o) => o.index === idx)?.label ?? "");
            }}
          />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <StatusSelect
            label="Infusion Set 1"
            options={INFUSION_SET_1_OPTIONS}
            value={patient.infusionSet1Index}
            onChange={(idx) => {
              onFieldChange("infusionSet1Index", idx);
              onFieldChange("infusionSet1", INFUSION_SET_1_OPTIONS.find((o) => o.index === idx)?.label ?? "");
            }}
          />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Inf. Qty 1</p>
            <Input
              type="number"
              min={0}
              value={patient.infQty1}
              onChange={(e) => onFieldChange("infQty1", e.target.value)}
              className="h-9 text-sm"
              placeholder="0"
            />
          </div>
          <StatusSelect
            label="Infusion Set 2"
            options={INFUSION_SET_2_OPTIONS}
            value={patient.infusionSet2Index}
            onChange={(idx) => {
              onFieldChange("infusionSet2Index", idx);
              onFieldChange("infusionSet2", INFUSION_SET_2_OPTIONS.find((o) => o.index === idx)?.label ?? "");
            }}
          />
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Inf. Qty 2</p>
            <Input
              type="number"
              min={0}
              value={patient.infQty2}
              onChange={(e) => onFieldChange("infQty2", e.target.value)}
              className="h-9 text-sm"
              placeholder="0"
            />
          </div>
        </div>
      </Card>
    </div>
  );
}
