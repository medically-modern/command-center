import type { Patient } from "@/lib/subscription/workflow";
import {
  ORDERING_CYCLE_OPTIONS,
  SUBSCRIPTION_OPTIONS,
  ORDER_TYPE_OPTIONS,
  SENSORS_TYPE_OPTIONS,
  SUPPLIES_TYPE_OPTIONS,
} from "@/lib/subscription/workflow";
import { BOARD_ID, COL } from "@/lib/subscription/mondayApi";
import { useStatusOptions } from "@/hooks/useStatusOptions";
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
  disabled = false,
  hint,
  onRetry,
}: {
  label: string;
  options: { index: number; label: string }[];
  value: number | null;
  onChange: (index: number) => void;
  /** Set while live options are loading or failed — see the note in the form body. */
  disabled?: boolean;
  hint?: string | null;
  onRetry?: (() => void) | null;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">{label}</p>
      <Select
        value={value !== null ? String(value) : ""}
        onValueChange={(v) => onChange(Number(v))}
        disabled={disabled}
      >
        <SelectTrigger className="h-9 text-sm">
          <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.index} value={String(opt.index)}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint &&
        (onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="mt-1 text-[10px] text-red-600 underline underline-offset-2 hover:no-underline"
          >
            {hint}
          </button>
        ) : (
          <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>
        ))}
    </div>
  );
}


export function SubscriptionForm({ patient, onFieldChange }: Props) {
  // Infusion-set options come from the LIVE board, never a hardcoded table.
  // These two columns are the ones the July 2026 dedup rewrote: 17 of the 49
  // hardcoded options pointed at deleted indexes, and 10 of those rendered as a
  // second, identical-looking entry beside a working one. `writeStatusIndex`
  // would have written the dead index without erroring. See
  // `lib/shared/statusOptions.ts`.
  const infusionCols = [COL.infusionSet1, COL.infusionSet2];
  const { options: liveOptions, loading: optionsLoading, error: optionsError, ready: optionsReady, reload: reloadOptions } =
    useStatusOptions(BOARD_ID, infusionCols);
  const infusionSet1Options = liveOptions[COL.infusionSet1] ?? [];
  const infusionSet2Options = liveOptions[COL.infusionSet2] ?? [];
  // Disabled rather than falling back to a stale list: writing an index we did
  // not just read from the board is exactly the failure this replaced.
  const infusionDisabled = !optionsReady;
  const infusionHint = optionsError
    ? "Couldn't load options from Monday — tap to retry"
    : optionsLoading
      ? "Loading options from Monday…"
      : null;

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
            options={infusionSet1Options}
            value={patient.infusionSet1Index}
            disabled={infusionDisabled}
            hint={infusionHint}
            onRetry={optionsError ? reloadOptions : null}
            onChange={(idx) => {
              onFieldChange("infusionSet1Index", idx);
              onFieldChange("infusionSet1", infusionSet1Options.find((o) => o.index === idx)?.label ?? "");
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
            options={infusionSet2Options}
            value={patient.infusionSet2Index}
            disabled={infusionDisabled}
            hint={infusionHint}
            onRetry={optionsError ? reloadOptions : null}
            onChange={(idx) => {
              onFieldChange("infusionSet2Index", idx);
              onFieldChange("infusionSet2", infusionSet2Options.find((o) => o.index === idx)?.label ?? "");
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
