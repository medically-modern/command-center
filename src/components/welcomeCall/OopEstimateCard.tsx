import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import type { Patient } from "@/lib/welcomeCall/workflow";
import { estimateOop } from "@/lib/welcomeCall/oopEstimator";
import type { OopEstimate } from "@/lib/welcomeCall/oopEstimator";

interface Props {
  patient: Patient;
  /** Override infusion sets count; defaults to 3 if not provided */
  infusionSets?: number;
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function LineRow({ label, hcpc, units, rate, allowed }: {
  label: string; hcpc: string; units: number; rate: number; allowed: number;
}) {
  return (
    <tr className="border-b border-muted/40 last:border-0">
      <td className="py-1.5 pr-3 text-sm">{label}</td>
      <td className="py-1.5 pr-3 text-xs text-muted-foreground font-mono">{hcpc}</td>
      <td className="py-1.5 pr-3 text-sm text-right tabular-nums">{units}</td>
      <td className="py-1.5 pr-3 text-sm text-right tabular-nums">{fmt(rate)}</td>
      <td className="py-1.5 text-sm text-right tabular-nums font-medium">{fmt(allowed)}</td>
    </tr>
  );
}

function SummaryRow({ label, value, bold, highlight }: {
  label: string; value: string; bold?: boolean; highlight?: "green" | "amber" | "red";
}) {
  const colorCls = highlight === "green"
    ? "text-green-700"
    : highlight === "amber"
      ? "text-amber-700"
      : highlight === "red"
        ? "text-red-700"
        : "";
  return (
    <div className="flex justify-between items-center py-1">
      <span className={`text-sm ${bold ? "font-semibold" : "text-muted-foreground"}`}>{label}</span>
      <span className={`text-sm tabular-nums ${bold ? "font-semibold" : ""} ${colorCls}`}>{value}</span>
    </div>
  );
}

export function OopEstimateCard({ patient, infusionSets }: Props) {
  const result = useMemo(() => {
    // Parse infusion sets from the welcome call form if available
    const sets = infusionSets
      ?? (parseInt(patient.qtyInf1 || "0", 10) + parseInt(patient.qtyInf2 || "0", 10))
      || 3; // default 3 sets

    return estimateOop({
      primaryInsurance: patient.primaryInsurance,
      serving: patient.serving,
      infusionSets: sets,
      deductibleRemaining: patient.deductibleRemaining,
      stediCoinsurance: patient.stediCoinsurance,
      oopMaxRemaining: patient.oopMaxRemaining,
    });
  }, [
    patient.primaryInsurance,
    patient.serving,
    patient.qtyInf1,
    patient.qtyInf2,
    patient.deductibleRemaining,
    patient.stediCoinsurance,
    patient.oopMaxRemaining,
    infusionSets,
  ]);

  // Don't render if we can't estimate (missing insurance, no rates, no serving)
  if (!result.ok) {
    // Only show the card with an explanation if we have insurance but hit a rate gap
    if (!patient.primaryInsurance || !patient.serving) return null;
    return (
      <Card className="p-4">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
          OOP Estimate (Per Fill)
        </p>
        <p className="text-sm text-muted-foreground italic">{result.reason}</p>
      </Card>
    );
  }

  const est = result as OopEstimate;
  const hasBenefitsData = patient.deductibleRemaining || patient.stediCoinsurance || patient.oopMaxRemaining;

  return (
    <Card className="p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-3">
        OOP Estimate (Per Fill)
      </p>

      {/* Line items table */}
      <div className="overflow-x-auto mb-3">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-muted">
              <th className="pb-1.5 pr-3 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Product</th>
              <th className="pb-1.5 pr-3 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">HCPC</th>
              <th className="pb-1.5 pr-3 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold text-right">Units</th>
              <th className="pb-1.5 pr-3 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold text-right">Rate</th>
              <th className="pb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold text-right">Allowed</th>
            </tr>
          </thead>
          <tbody>
            {est.lines.map((line) => (
              <LineRow
                key={`${line.hcpc}-${line.product}`}
                label={line.product}
                hcpc={line.hcpc}
                units={line.units}
                rate={line.rate}
                allowed={line.allowed}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Divider */}
      <div className="border-t border-muted pt-2 space-y-0.5">
        <SummaryRow label="Total Allowed" value={fmt(est.totalAllowed)} bold />

        {hasBenefitsData ? (
          <>
            {est.appliedDeductible > 0 && (
              <SummaryRow
                label={`Deductible Applied (of ${fmt(parseFloat(patient.deductibleRemaining?.replace(/[$,]/g, "") || "0"))} remaining)`}
                value={fmt(est.appliedDeductible)}
              />
            )}
            <SummaryRow
              label={`Coinsurance (${est.coinsurancePct}%)`}
              value={fmt(est.patientCoinsurance)}
            />
            {est.oopMaxRemaining !== null && est.patientOwesRaw > est.oopMaxRemaining && (
              <SummaryRow
                label="OOP Max Cap Applied"
                value={fmt(est.oopMaxRemaining)}
                highlight="amber"
              />
            )}
            <div className="border-t border-muted mt-1 pt-1.5">
              <SummaryRow
                label="Patient Owes"
                value={fmt(est.patientOwes)}
                bold
                highlight={est.patientOwes === 0 ? "green" : est.patientOwes > 500 ? "red" : "amber"}
              />
              <SummaryRow
                label="Insurance Pays"
                value={fmt(est.insurancePays)}
                highlight="green"
              />
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground italic mt-1">
            Run Stedi eligibility to see deductible/coinsurance breakdown.
          </p>
        )}
      </div>
    </Card>
  );
}
