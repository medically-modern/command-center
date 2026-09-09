import { useState, useEffect, useRef } from "react";
import type { Patient } from "@/lib/welcomeCall/workflow";
import {
  CGM_TYPE_OPTIONS,
  SUBSCRIPTION_TYPE_OPTIONS,
  servingIncludesCgm,
  PUMP_TYPE_OPTIONS,
  servingIncludesPump,
  isCrossSell,
  isFirstTimePumpUser,
  isInfusionSelling,
  needsPriorPumpDate,
  isOriginalMedicare,
  needsMonitorPurchaseDate,
  deriveMonitorPurchaseDate,
  expectedSubscriptionType,
} from "@/lib/welcomeCall/workflow";
import { BOARD_ID, COL } from "@/lib/welcomeCall/mondayApi";
import { emptyIntake } from "@/lib/welcomeCall/callIntake";
import { expectedPos } from "@/lib/shared/pos";
import { infusionSetIssue } from "@/lib/shared/infusionCompat";
import { IntakeMessages } from "@/components/profile/IntakeMessages";
// ⚠️ IntakeMessages is written against the intake page's design system
// (`.sect`, `.pillbtn`), which lives entirely under `.pf-root` — 179 rules in
// intake.css, 0 unscoped, and redesign.css deliberately hangs its theme tokens
// on `.pf-root` rather than `:root` "so the app theme is untouched". So these
// two imports cannot leak onto this page: nothing in them matches outside a
// `.pf-root` element. The component is portable; its stylesheet is not, which
// is why it needs the wrapper below rather than being a plain drop-in.
import "@/pages/profile/redesign.css";
import "@/pages/profile/intake.css";
import { payerInfusionCap, payerCapNote, supplyLengthNote, supplyLengthDays, supplyLengthOptions, DEFAULT_INFUSION_QTY } from "@/lib/welcomeCall/payerRules";
import { InsuranceBlock, AuthBlock, OopBlock } from "@/components/welcomeCall/InsuranceAuthSection";
import { useInfusionStock } from "@/hooks/welcomeCall/useInfusionStock";
import { stockVerdict, type StockVerdict } from "@/lib/welcomeCall/infusionStock";
import { etTodayYmd } from "@/lib/shared/monitorSale";
import { shouldDefaultPumpQty, setTwoTransition, isSetChosen } from "@/lib/welcomeCall/orderDefaults";
import { frequencyState, frequencyInvalidated, daysToLabel, ORDER_FREQUENCY_INDEX } from "@/lib/welcomeCall/orderFrequency";
import { NextOrderDatesCard } from "@/components/welcomeCall/PatientInfoCard";
import {
  compatibleSetOptions,
  withCurrentSelection,
  setsInvalidatedByPump,
  infusionQtyPlan,
} from "@/lib/welcomeCall/infusionSelection";
import { monitorSaleVerdict } from "@/lib/shared/monitorSale";
import { pumpConfirmLabel, pumpConfirmationStale, needsPumpConfirmation } from "@/lib/welcomeCall/sendGates";
import type { CallIntake, SupplyLength } from "@/lib/welcomeCall/callIntake";
import {
  ConfirmCheck,
  PhoneNumbersSection,
  CaretakerSection,
} from "./CallIntakeFields";
import { toast } from "sonner";
import { useStatusOptions } from "@/hooks/useStatusOptions";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { AddressAutocomplete, type AddressResult } from "@/components/welcomeCall/AddressAutocomplete";
import { Check, ChevronsUpDown, MessageSquare, Eye, EyeOff, AlertTriangle, Lightbulb } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardinalAddressNote } from "@/components/shared/CardinalAddressNote";
import { cardinalAddressNote } from "@/lib/shared/cardinalAddress";
import { pumpQtyApplies } from "@/lib/shared/servingLines";

interface Props {
  patient: Patient;
  onFieldChange: (field: keyof Patient, value: string | number | null) => void;
  /** Updates the no-column intake payload (lib/welcomeCall/callIntake.ts).
   *  Separate from `onFieldChange` because that one is typed for scalar column
   *  values; this carries a whole object. */
  onIntakeChange?: (next: CallIntake) => void;
  onSendWelcomeCallText?: () => Promise<void>;
}

function SectionHeading({ number, title }: { number: number; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <span className="flex items-center justify-center h-7 w-7 rounded-full bg-primary text-primary-foreground text-xs font-bold shrink-0">
        {number}
      </span>
      <p className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
    </div>
  );
}

/** Searchable combobox for infusion set selection */
function InfusionSetCombobox({
  options,
  value,
  onSelect,
  placeholder = "Select option",
  disabled = false,
}: {
  options: { index: number; label: string }[];
  value: number | null;
  onSelect: (label: string, index: number | null) => void;
  placeholder?: string;
  /** True while live board options are loading or failed to load. */
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.index === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search infusion sets..." />
          <CommandList>
            <CommandEmpty>No match found.</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.index}
                  value={opt.label}
                  onSelect={() => {
                    onSelect(opt.label, opt.index);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === opt.index ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {opt.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** Quantity selector as a dropdown 0-10 */
function QtySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <Select value={value || "0"} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder="0" />
      </SelectTrigger>
      <SelectContent>
        {Array.from({ length: 11 }, (_, i) => (
          <SelectItem key={i} value={String(i)}>
            {i}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Pump ↔ set compatibility, inline (was Final Confirm check C24 only). Runs the
 * SHARED matrix in lib/shared/infusionCompat.ts, so this and the check pack
 * can't drift. Silent when the pairing is fine or the set isn't recognised.
 */
function CompatNote({ pumpType, setLabel }: { pumpType: string; setLabel: string }) {
  const issue = infusionSetIssue(pumpType, setLabel);
  if (!issue) return null;
  // Amber for "we have not checked this pairing", red for "this pairing is
  // wrong". Collapsing the two would either cry wolf on an unclassified set or
  // — the bug this replaced — say nothing at all about one.
  const unverified = issue.kind === "unverified";
  return (
    <div
      className={cn(
        "mt-2 flex items-start gap-1.5 rounded-md border px-2.5 py-1.5",
        unverified
          ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30"
          : "border-red-300 bg-red-50 dark:bg-red-950/30",
      )}
    >
      <AlertTriangle className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", unverified ? "text-amber-600" : "text-red-600")} />
      <div>
        <p className={cn("text-xs font-semibold", unverified ? "text-amber-700 dark:text-amber-300" : "text-red-700 dark:text-red-300")}>
          {issue.title}
        </p>
        <p className={cn("text-xs", unverified ? "text-amber-700/90 dark:text-amber-300/90" : "text-red-700/90 dark:text-red-300/90")}>
          {issue.detail}
        </p>
      </div>
    </div>
  );
}

/**
 * Payer cap on infusion sets per order. A warning, never a block — the cap is a
 * billing expectation, and a rep with a reason to exceed it should be able to,
 * with the number visible rather than discovered at denial.
 */
/**
 * Cardinal's availability for one set. Display only — nothing here blocks a
 * send (see the `useInfusionStock` call site).
 *
 * Silent when the verdict has no label: an unselected slot and `Not Serving`
 * both produce one, and a pill reading nothing is worse than no pill.
 * ⚠️ Grey covers TWO different unknowns — "no tracker row" and "the stamp is
 * too old to trust" — and both must read as unknown rather than as green. The
 * detail line says which.
 */
function StockNote({ verdict }: { verdict: StockVerdict }) {
  if (!verdict.label) return null;
  return (
    <p
      className={cn(
        "mt-1.5 text-[11px] font-medium",
        verdict.tone === "green" && "text-emerald-700 dark:text-emerald-400",
        verdict.tone === "amber" && "text-amber-700 dark:text-amber-400",
        verdict.tone === "red" && "text-red-600 dark:text-red-400",
        verdict.tone === "grey" && "text-muted-foreground",
      )}
      title={verdict.detail}
    >
      {verdict.label}
    </p>
  );
}

function CapNote({ qty, cap, payerLabel }: { qty: number; cap: number; payerLabel: string | null }) {
  const over = qty > cap;
  return (
    <p className={cn("mt-1 text-[11px]", over ? "font-medium text-amber-600" : "text-muted-foreground")}>
      {over
        ? `${qty} exceeds the ${cap}-per-order cap${payerLabel ? ` for ${payerLabel}` : " for this payer"} — likely to be denied.`
        : payerCapNote({ cap, payerLabel })}
    </p>
  );
}

export function WelcomeCallForm({ patient, onFieldChange, onIntakeChange, onSendWelcomeCallText }: Props) {
  // The no-column payload. Falls back to a blank one so a patient mapped before
  // this field existed (or a test fixture) still renders.
  const intake = patient.callIntake ?? emptyIntake();
  // Payer-driven order rules (lib/welcomeCall/payerRules.ts). Both read the
  // EFFECTIVE payer, so they react as the rep corrects insurance on the call.
  const effectivePrimary = patient.primaryInsuranceEdited ?? patient.primaryInsurance;
  const effectiveSecondary = patient.secondaryInsuranceEdited ?? patient.secondaryInsurance;
  const infusionCap = payerInfusionCap(effectivePrimary);
  const supplyNote = supplyLengthNote(effectivePrimary, effectiveSecondary);
  const frequency = frequencyState({
    boardLabel: patient.orderFrequency,
    edited: patient.orderFrequencyEdited,
    primaryInsurance: effectivePrimary,
    secondaryInsurance: effectiveSecondary,
  });
  const derivedSupplyDays = String(supplyLengthDays(effectivePrimary, effectiveSecondary)) as SupplyLength;
  const setIntake = (next: CallIntake) => onIntakeChange?.(next);

  // Seed Supply Length from the payer rule, and keep it following the payer
  // until the rep takes it over.
  //
  // ⚠️ "Is this value the rep's, or ours?" is the whole problem, and it cannot
  // be answered by comparing values: an override that happens to equal the
  // derived number looks exactly like a derived one. Guarding on "is it empty"
  // let a seeded 90 survive a correction to Medicaid while the note beneath it
  // read "60 day supply"; guarding on "does it still equal what we seeded"
  // fixed that but would discard a rep's override once a payer change made it
  // coincide. So ownership is RECORDED (`supplyLengthManual`) rather than
  // inferred — and recorded in the notes block, so it survives a reload, which
  // is where any component-local guess would fail.
  useEffect(() => {
    if (!onIntakeChange) return;
    /* ⚠️ A rep's override survives a payer correction ONLY while the payer
     * still offers it. Pick 75 for Aetna, then fix Primary Insurance to a
     * non-Aetna plan, and the option vanishes from the menu while
     * `supplyLengthManual` holds the now-ineligible 75 in place — nothing
     * downstream re-checks it, so the send writes a cadence that payer will not
     * pay for. Same shape as Brandon's rule for infusion sets ("if Pump Type
     * changes, clear any set that's no longer compatible"). Caught by Greptile
     * on PR #55. Resetting also clears `supplyLengthManual`, because the
     * choice it was recording no longer exists. */
    const offered = supplyLengthOptions(effectivePrimary);
    if (intake.supplyLength && !offered.includes(intake.supplyLength)) {
      onIntakeChange({
        ...intake,
        supplyLength: derivedSupplyDays,
        supplyLengthManual: false,
      });
      return;
    }
    if (intake.supplyLengthManual) return;
    if (intake.supplyLength === derivedSupplyDays) return;
    onIntakeChange({ ...intake, supplyLength: derivedSupplyDays });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derivedSupplyDays, intake.supplyLength, intake.supplyLengthManual, effectivePrimary]);
  const [sendingWelcomeText, setSendingWelcomeText] = useState(false);

  /* "If Pump Type changes, clear any set that's no longer compatible"
     (Brandon, 2026-09-09).
     ⚠️ Keyed on an actual CHANGE, not on the current value being incompatible.
     Clearing whenever the pair happens to be incompatible would wipe board data
     on mount — a write-shaped side effect from merely opening a patient, and
     the rep would never see what was there. The ref carries the patient id with
     it because switching patients also changes `pumpType`, and that is not a
     correction anybody made.
     ⚠️ The set AND its quantity are cleared together: a quantity left attached
     to no set is the §5.12 shape where a counter and its columns disagree. */
  /* Set 2 arriving or leaving rewrites the quantities (Brandon, both
     directions — see `setTwoTransition`).
     ⚠️ Same ref-with-patient-id guard as the pump effect below, and for the
     same reason: running this on load would wipe the quantities of every
     already-split patient the moment a rep opened them, and switching patients
     changes Set 2 without anybody having chosen anything. */
  /* A payer correction can strand a frequency the new payer doesn't offer —
     pick 75 for Aetna, then fix the plan. Nothing downstream re-checks it, so
     the send would write a cadence that payer will not pay for. Same rule
     §5.31 needed when this value lived in the notes block; it has to survive
     the move to a column. */
  useEffect(() => {
    if (patient.orderFrequencyEdited === null) return;
    if (!frequencyInvalidated(patient.orderFrequencyEdited, effectivePrimary)) return;
    onFieldChange("orderFrequencyEdited" as keyof Patient, null);
    onFieldChange("orderFrequencyIndex" as keyof Patient, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, patient.orderFrequencyEdited, effectivePrimary]);

  const lastSet2 = useRef<{ patientId: string; has: boolean } | null>(null);
  useEffect(() => {
    const has = isSetChosen(patient.infusionSet2);
    const prev = lastSet2.current;
    lastSet2.current = { patientId: patient.id, has };
    if (!prev || prev.patientId !== patient.id || prev.has === has) return;
    const { writes, clearSet2 } = setTwoTransition(prev.has, has);
    for (const [field, value] of Object.entries(writes)) {
      onFieldChange(field as keyof Patient, value);
    }
    // The set column goes with its quantity, never one without the other.
    if (clearSet2) handleSelectChange("infusionSet2", "", null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, patient.infusionSet2]);

  const lastPump = useRef<{ patientId: string; pumpType: string } | null>(null);
  useEffect(() => {
    const prev = lastPump.current;
    lastPump.current = { patientId: patient.id, pumpType: patient.pumpType };
    if (!prev || prev.patientId !== patient.id) return;
    if (prev.pumpType === patient.pumpType) return;
    const { clearSet1, clearSet2 } = setsInvalidatedByPump(
      patient.pumpType,
      patient.infusionSet1,
      patient.infusionSet2,
    );
    if (clearSet1) {
      handleSelectChange("infusionSet1", "", null);
      onFieldChange("qtyInf1", "");
    }
    if (clearSet2) {
      handleSelectChange("infusionSet2", "", null);
      onFieldChange("qtyInf2", "");
    }
    if (clearSet1 || clearSet2) {
      toast.info("Infusion set cleared", {
        description: `That set isn't compatible with ${patient.pumpType || "the new pump"} — pick one from the filtered list.`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, patient.pumpType]);
  // Infusion-set options are read from the LIVE board, never a hardcoded table —
  // the index is the only thing that reaches Monday, so a deleted index writes a
  // blank without erroring. See `lib/shared/statusOptions.ts`.
  const { options: liveOptions, loading: optionsLoading, error: optionsError, ready: optionsReady } =
    useStatusOptions(BOARD_ID, [COL.infusionSet1, COL.infusionSet2]);
  /* Cardinal's own availability, one shared read for the whole form
     (`hooks/welcomeCall/useInfusionStock`). Display only — it does NOT gate the
     send. Brandon asked to SHOW stock; refusing an order on it is a different
     decision, and `StockVerdict.blocked` is there for the day somebody makes
     it. */
  const stock = useInfusionStock();
  const stockToday = etTodayYmd();
  const rawSet1Options = liveOptions[COL.infusionSet1] ?? [];
  const rawSet2Options = liveOptions[COL.infusionSet2] ?? [];
  /* Brandon, 2026-09-09: "filter the infusion set list by pump compatibility,
     and Set 2 can't repeat Set 1". `compatibleSetOptions` drops only the
     positively-wrong pairings (`incompatible` / `five-inch-not-mobi`) and keeps
     `unverified` — an unverified pairing is a prompt, not a refusal, and
     `CompatNote` below already says so. `withCurrentSelection` then re-admits
     whatever the board actually holds, so a filter can never blank a control
     that has a value (see its comment). */
  const infusionSet1Options = withCurrentSelection(
    compatibleSetOptions(patient.pumpType, rawSet1Options, { exclude: patient.infusionSet2 }),
    rawSet1Options,
    patient.infusionSet1Index,
  );
  const infusionSet2Options = withCurrentSelection(
    compatibleSetOptions(patient.pumpType, rawSet2Options, { exclude: patient.infusionSet1 }),
    rawSet2Options,
    patient.infusionSet2Index,
  );
  /* Qty 1 + Qty 2 against the order total. ⚠️ Over- OR under-shooting only
     WARNS — Brandon's wording is "must equal the order total (warn if over)",
     and the parenthetical sets the enforcement level. A missing quantity on a
     split IS an error, because a set with no quantity ships nothing. */
  const qtyPlan = infusionQtyPlan({
    set1: patient.infusionSet1,
    set2: patient.infusionSet2,
    qty1: patient.qtyInf1,
    qty2: patient.qtyInf2,
    orderTotal: DEFAULT_INFUSION_QTY,
  });
  const infusionDisabled = !optionsReady;
  const infusionHint = optionsError
    ? `Couldn't load infusion sets from Monday: ${optionsError}`
    : optionsLoading
      ? "Loading infusion sets from Monday…"
      : null;

  const handleSelectChange = (field: string, value: string, index: number | null) => {
    onFieldChange(field as keyof Patient, value);
    onFieldChange(`${field}Index` as keyof Patient, index);
  };

  // Section visibility based on serving — with user override toggles
  const effectiveServing = patient.servingEdited ?? patient.serving;
  const defaultShowCgm = servingIncludesCgm(effectiveServing);
  const defaultShowPump = servingIncludesPump(effectiveServing);

  const [cgmOverride, setCgmOverride] = useState<boolean | null>(null);
  const [pumpOverride, setPumpOverride] = useState<boolean | null>(null);

  // Reset overrides when patient changes
  useEffect(() => {
    setCgmOverride(null);
    setPumpOverride(null);
  }, [patient.id]);

  const showCgm = cgmOverride !== null ? cgmOverride : defaultShowCgm;
  const showPump = pumpOverride !== null ? pumpOverride : defaultShowPump;

  // Prior Pump Purchase Date: Original Medicare (Medicare A&B) patients only,
  // only when Pump Qty is 0 (toggle off / not "1"), and only when serving
  // includes pump supplies — a CGM-only patient is never asked for it.
  const effectivePrimaryInsurance = patient.primaryInsuranceEdited ?? patient.primaryInsurance;
  const showPriorPumpDate = needsPriorPumpDate(effectivePrimaryInsurance, patient.pumpQty, effectiveServing);

  // Pump Qty applies only when Serving sells an actual insulin pump DEVICE.
  // ⚠️ Deliberately NOT `servingIncludesPump` (the `showPump` gate above) —
  // that is true for `Supplies …` as well, because infusion sets and cartridges
  // ARE pump supplies. Selling a pump and shipping supplies for one the patient
  // already owns are different questions, and conflating them is what left a
  // live Pump Qty toggle on a `Supplies + CGM` profile and shipped a t:slim
  // (Bradan French, 2026-08-03). See lib/shared/servingLines.ts.
  const canSellPump = pumpQtyApplies(effectiveServing);

  // Zero a quantity Serving no longer supports — same contract as the
  // prior-pump-date effect below. The send writes local state, so a control
  // going disabled has to take its value with it or the 1 still reaches Monday.
  useEffect(() => {
    /* Brandon: "Pump Qty should be default to 1 for any serving that includes
       insulin pump". Fill-when-blank and positive-evidence only — see
       `shouldDefaultPumpQty` for why this must not key on `canSellPump`, which
       trusts a blank Serving, nor on `servingIncludesPump`, which is true for
       "Supplies" and is §5.22's $3,787 pump. */
    if (shouldDefaultPumpQty(effectiveServing, patient.pumpQty)) {
      onFieldChange("pumpQty", "1");
      return;
    }
    if (!canSellPump && (Number(patient.pumpQty) || 0) > 0) {
      onFieldChange("pumpQty", "0");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, canSellPump, patient.pumpQty, effectiveServing]);

  // Clear a stale prior-pump date if the patient stops being eligible (insurance
  // changed away from Medicare A&B, Pump Qty set to 1, or serving changed to
  // CGM-only). Keeps local state in sync with visibility so the save writes ""
  // and clears the Monday cell rather than persisting a value that no longer
  // applies.
  useEffect(() => {
    if (!showPriorPumpDate && patient.medicarePriorPumpDate) {
      onFieldChange("medicarePriorPumpDate", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, showPriorPumpDate, patient.medicarePriorPumpDate]);

  // Qty Cartridge defaults to 3 (Josh, 2026-07): pre-fill once when blank so
  // an untouched save still writes 3 — but only while the pump section
  // applies, so CGM-only patients never get cartridges stamped on them.
  useEffect(() => {
    if (showPump && !patient.qtyCartridge) onFieldChange("qtyCartridge", "3");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, showPump, patient.qtyCartridge]);

  // Monitor Purchase Date is DERIVED, not typed from scratch (Brandon,
  // 2026-08-13). Pushing it into local state rather than computing it at save
  // time is deliberate: the rep has to see the date that is about to be written
  // so they can correct it on the call. `deriveMonitorPurchaseDate` keeps any
  // value already present, so this can never clobber what they typed — and it
  // returns "" once the patient stops being eligible, which is what clears the
  // board cell (the pump date needs a separate effect for that; this rule folds
  // the clear into the same call).
  const derivedMonitorPurchaseDate = deriveMonitorPurchaseDate({
    current: patient.monitorPurchaseDate,
    primaryInsurance: effectivePrimaryInsurance,
    monitorQty: patient.monitorQty,
    serving: effectiveServing,
    sosLastBillMonitor: patient.sosLastBillMonitor,
    sosNeverBilledMonitor: patient.sosNeverBilledMonitor,
  });
  useEffect(() => {
    if (derivedMonitorPurchaseDate !== patient.monitorPurchaseDate) {
      onFieldChange("monitorPurchaseDate", derivedMonitorPurchaseDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, derivedMonitorPurchaseDate, patient.monitorPurchaseDate]);

  /* ⚠️ A pump correction invalidates an existing confirmation (Brandon,
   * 2026-09-09: "If Pump Type changes after it's checked, uncheck it
   * automatically"). The rep confirmed ONE model out loud; left ticked, the
   * audit line in the notes would claim a conversation that never happened
   * about the pump now on order. `pumpConfirmationStale` compares the recorded
   * model against the current one. */
  useEffect(() => {
    if (!pumpConfirmationStale({
      confirmed: intake.confirmed.pump,
      confirmedModel: intake.pumpConfirmedModel ?? "",
      pumpType: patient.pumpType,
    })) return;
    setIntake({
      ...intake,
      confirmed: { ...intake.confirmed, pump: false },
      pumpConfirmedModel: "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, patient.pumpType, intake.confirmed.pump, intake.pumpConfirmedModel]);

  const showMonitorPurchaseDate = needsMonitorPurchaseDate(
    effectivePrimaryInsurance,
    patient.monitorQty,
    effectiveServing,
  );

  /* ── Can we sell this patient a monitor? (Brandon + Josh, 2026-09-09) ──
   * The Same-or-Similar answer decides it: a bill inside Medicare's 5-year
   * lifetime means they own one, an older bill or no billing history at all
   * means one is sellable. See lib/shared/monitorSale.ts.
   *
   * ⚠️ The verdict is shown for every eligible patient, INCLUDING the ones we
   * are selling to — Josh asked specifically to "show the old billing date
   * though and that its green cause older than 5 years". Gating it on
   * `showMonitorPurchaseDate` would hide it in exactly the sellable case,
   * because that flag goes false the moment Monitor Qty is 1. */
  const showMonitorSale =
    isOriginalMedicare(effectivePrimaryInsurance) && servingIncludesCgm(effectiveServing);
  const monitorSale = monitorSaleVerdict({
    sosLastBillMonitor: patient.sosLastBillMonitor,
    sosNeverBilledMonitor: patient.sosNeverBilledMonitor,
  });

  /* Pre-fill Monitor Qty from that verdict — FILL-WHEN-BLANK, so it can never
   * overwrite a rep's answer, and only when SoS actually told us something
   * (`defaultQty` is "" for unknown). A blank Monitor Qty means an item nobody
   * has touched; §5.22b coerces it to "0" on send, so without this the sellable
   * patients silently ship as no-sale. */
  useEffect(() => {
    if (!showMonitorSale) return;
    if (patient.monitorQty !== "") return;
    if (monitorSale.defaultQty === "") return;
    onFieldChange("monitorQty", monitorSale.defaultQty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patient.id, showMonitorSale, patient.monitorQty, monitorSale.defaultQty]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="px-1">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          To Fill In
        </p>
        <p className="text-sm text-muted-foreground mt-1">
          Complete these fields based on the welcome call information.
        </p>
      </div>

      {/* ─── Sections 1 & 2: who we are talking to ───
          Neither has a Monday column; both are captured here and appended to
          the Notes column as a parseable block on Send (§ callIntake.ts). They
          were one section ("Contacts & Caretaker") sitting BELOW the product
          sections until Brandon's 2026-09-09 mockup opened the call with them,
          which is the order the call actually runs in. */}
      <Card className="p-6">
        <SectionHeading number={1} title="Phone Numbers" />
        <PhoneNumbersSection intake={intake} onChange={setIntake} />
      </Card>

      <Card className="p-6">
        <SectionHeading number={2} title="Caretaker (optional)" />
        <CaretakerSection intake={intake} onChange={setIntake} />
      </Card>

      {/* ─── Section 3: CGM ─── */}
      {showCgm ? (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <SectionHeading number={3} title="CGM" />
            {!defaultShowCgm && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setCgmOverride(false)}
                className="text-muted-foreground text-xs gap-1"
              >
                <EyeOff className="h-3.5 w-3.5" /> Hide
              </Button>
            )}
          </div>
          <div className={`grid grid-cols-1 ${showMonitorPurchaseDate ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-6`}>
            {/* CGM Type — editable dropdown */}
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-2">
                CGM Type
              </label>
              <Select
                value={patient.cgmTypeIndex !== null ? String(patient.cgmTypeIndex) : ""}
                onValueChange={(value) => {
                  const option = CGM_TYPE_OPTIONS.find((o) => String(o.index) === value);
                  handleSelectChange("cgmType", option?.label || "", option?.index ?? null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select CGM type" />
                </SelectTrigger>
                <SelectContent>
                  {CGM_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.index} value={String(opt.index)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isCrossSell(patient) && (
                <p className="mt-2 text-xs font-medium text-blue-600">
                  Cross-sell: verify the patient's CGM — Dexcom G7 was used as the default.
                </p>
              )}
            </div>

            {/* Monitor Qty — toggle (0 or 1) */}
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-2">
                Monitor Qty
              </label>
              <div className="flex items-center gap-3 h-10">
                <Switch
                  checked={patient.monitorQty === "1"}
                  onCheckedChange={(checked) =>
                    onFieldChange("monitorQty", checked ? "1" : "0")
                  }
                />
                <span className="text-sm font-medium">
                  {patient.monitorQty === "1" ? "1 — Yes" : "0 — No"}
                </span>
              </div>
              {/* The Same-or-Similar verdict — green when a monitor is billable,
                  amber when the patient already owns one inside its 5-year
                  lifetime, grey when Benefits hasn't answered yet. This is what
                  pre-set the toggle above, so it has to say so on screen: a
                  default a rep can't see the reason for is one they can't
                  correct (CLAUDE.md §5.10's attempt-count precedent). */}
              {showMonitorSale && (
                <div
                  className={cn(
                    "mt-2 flex items-start gap-1.5 rounded-md border px-2.5 py-1.5",
                    monitorSale.tone === "green" &&
                      "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30",
                    monitorSale.tone === "amber" &&
                      "border-amber-300 bg-amber-50 dark:bg-amber-950/30",
                    monitorSale.tone === "grey" && "border-border bg-muted/40",
                  )}
                >
                  {monitorSale.tone === "green" ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle
                      className={cn(
                        "h-3.5 w-3.5 shrink-0 mt-0.5",
                        monitorSale.tone === "amber" ? "text-amber-600" : "text-muted-foreground",
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      "text-xs font-medium",
                      monitorSale.tone === "green" && "text-emerald-700 dark:text-emerald-300",
                      monitorSale.tone === "amber" && "text-amber-700 dark:text-amber-300",
                      monitorSale.tone === "grey" && "text-muted-foreground",
                    )}
                  >
                    {monitorSale.note}
                  </span>
                </div>
              )}
            </div>

            {/* Monitor Purchase Date — Original Medicare + Monitor Qty 0 + CGM serving only */}
            {showMonitorPurchaseDate && (
              <div>
                <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">
                  Monitor Purchase Date
                </label>
                <Input
                  className="h-10"
                  value={patient.monitorPurchaseDate}
                  onChange={(e) => onFieldChange("monitorPurchaseDate", e.target.value)}
                  placeholder="MM/YYYY"
                />
                <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    {patient.sosLastBillMonitor
                      ? "Filled from the monitor's SoS last bill date — confirm with the patient if it looks wrong."
                      : patient.sosNeverBilledMonitor
                        ? "Estimated — SoS shows no billing history for the monitor. Replace it if the patient knows when they got it."
                        : "Ask the patient roughly when they got their current monitor."}
                  </span>
                </div>
              </div>
            )}
          </div>
        </Card>
      ) : (
        <Card className="p-4 border-dashed">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold">CGM</span> — hidden (not in serving)
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCgmOverride(true)}
              className="text-muted-foreground text-xs gap-1"
            >
              <Eye className="h-3.5 w-3.5" /> Show
            </Button>
          </div>
        </Card>
      )}

      {/* ─── Section 4: Pump & Infusion Sets ─── */}
      {showPump ? (
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <SectionHeading number={4} title="Pump & Infusion Sets" />
            {!defaultShowPump && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPumpOverride(false)}
                className="text-muted-foreground text-xs gap-1"
              >
                <EyeOff className="h-3.5 w-3.5" /> Hide
              </Button>
            )}
          </div>

          {/* Pump Type + Pump Qty (+ Prior Pump Purchase Date for Original Medicare) */}
          <div className={`grid grid-cols-1 ${showPriorPumpDate ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-6 mb-5`}>
            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">
                Pump Type
              </label>
              <Select
                value={patient.pumpTypeIndex !== null ? String(patient.pumpTypeIndex) : ""}
                onValueChange={(value) => {
                  const option = PUMP_TYPE_OPTIONS.find((o) => String(o.index) === value);
                  handleSelectChange("pumpType", option?.label || "", option?.index ?? null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select pump type" />
                </SelectTrigger>
                <SelectContent>
                  {PUMP_TYPE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.index} value={String(opt.index)}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* No board column — rides out in the notes block on send.
                  ⚠️ Hidden when the serving sells no pump DEVICE (Brandon:
                  "hide it and don't require it when Insulin Pump isn't in
                  Serving"). The section around it renders for supplies-only
                  patients too — `servingIncludesPump` is true for "Supplies",
                  correctly, since infusion sets ARE pump supplies — so this
                  gate must use `needsPumpConfirmation`/`servingSellsPumpDevice`
                  instead. Asking a patient to confirm a pump they already own
                  and are not being sold is the §5.22 conflation in checkbox
                  form. `unmetSendRequirements` scopes itself the same way, so
                  the checkbox and the send gate cannot disagree. */}
              {needsPumpConfirmation(effectiveServing) && (
                <ConfirmCheck
                  intake={intake}
                  onChange={setIntake}
                  field="pump"
                  className="mt-2"
                  label={pumpConfirmLabel(patient.pumpType)}
                  recordPumpModel={patient.pumpType}
                />
              )}
            </div>

            <div>
              <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">
                Pump Qty
              </label>
              <div className="flex items-center gap-3 h-10">
                <Switch
                  checked={canSellPump && patient.pumpQty === "1"}
                  disabled={!canSellPump}
                  onCheckedChange={(checked) =>
                    onFieldChange("pumpQty", checked ? "1" : "0")
                  }
                />
                <span className={`text-sm font-medium ${canSellPump ? "" : "text-muted-foreground"}`}>
                  {canSellPump && patient.pumpQty === "1" ? "1 — Yes" : "0 — No"}
                </span>
              </div>
              {!canSellPump && (
                <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    Serving is {effectiveServing} — no insulin pump. Change Serving to sell a pump.
                  </span>
                </div>
              )}
              {patient.neverBilledIsCar && (
                <div className="mt-2 flex items-center gap-1.5 rounded-md border border-blue-300 bg-blue-50 dark:bg-blue-950/30 px-2.5 py-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                  <span className="text-xs font-medium text-blue-700 dark:text-blue-300">Never billed, add to notes</span>
                </div>
              )}
              {/* Shapes the CALL, not the order — a first pump needs a different
                  conversation. Sits here because Pump Qty is the fact it keys
                  on. Absence of billing history is weak evidence (see the rule),
                  so it prompts and never gates. */}
              {isFirstTimePumpUser({
                serving: patient.servingEdited ?? patient.serving,
                pumpQty: patient.pumpQty,
                ipLastBillDate: patient.ipLastBillDate,
                medicarePriorPumpDate: patient.medicarePriorPumpDate,
              }) && (
                <div className="mt-2 flex items-start gap-1.5 rounded-md border border-violet-300 bg-violet-50 dark:bg-violet-950/30 px-2.5 py-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-violet-600 shrink-0 mt-0.5" />
                  <span className="text-xs font-medium text-violet-700 dark:text-violet-300">
                    First-time pump user — no prior pump on file. Set training expectations on this call.
                  </span>
                </div>
              )}
            </div>

            {/* Prior Pump Purchase Date — Original Medicare + Pump Qty 0 + pump-supplies serving only */}
            {showPriorPumpDate && (
              <div>
                <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">
                  Prior Pump Purchase Date
                </label>
                <Input
                  className="h-10"
                  value={patient.medicarePriorPumpDate}
                  onChange={(e) => onFieldChange("medicarePriorPumpDate", e.target.value)}
                  placeholder="MM/YYYY"
                />
                <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5">
                  <Lightbulb className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
                    If SoS is completely clear for Insulin Pump and Supplies, ask patient for approximate date they got their pump
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Infusion Set pairs */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Infusion Set 1 group */}
            <div className="rounded-lg border border-input bg-muted/20 p-4 space-y-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Infusion Set 1
              </p>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Set Type</label>
                <InfusionSetCombobox
                  options={infusionSet1Options}
                  disabled={infusionDisabled}
                  value={patient.infusionSet1Index}
                  onSelect={(label, index) =>
                    handleSelectChange("infusionSet1", label, index)
                  }
                  placeholder="Search infusion sets..."
                />
                {infusionHint && (
                  <p className="mt-1 text-[11px] text-muted-foreground">{infusionHint}</p>
                )}
                {isInfusionSelling(patient.infusionSet1Index) && (
                  <CompatNote pumpType={patient.pumpType} setLabel={patient.infusionSet1} />
                )}
                {isInfusionSelling(patient.infusionSet1Index) && stock.index && (
                  <StockNote
                    verdict={stockVerdict(patient.infusionSet1, stock.index, stockToday)}
                  />
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Quantity</label>
                <QtySelect
                  value={patient.qtyInf1}
                  onChange={(val) => onFieldChange("qtyInf1", val)}
                />
                {isInfusionSelling(patient.infusionSet1Index) && (
                  <CapNote qty={Number(patient.qtyInf1) || 0} cap={infusionCap.cap} payerLabel={infusionCap.payerLabel} />
                )}
                {isInfusionSelling(patient.infusionSet1Index) &&
                  (!patient.qtyInf1 || patient.qtyInf1 === "0") && (
                    <p className="mt-2 text-xs font-medium text-red-600">
                      Infusion set selected — please choose a quantity.
                    </p>
                  )}
              </div>
            </div>

            {/* Infusion Set 2 group */}
            <div className="rounded-lg border border-input bg-muted/20 p-4 space-y-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Infusion Set 2
              </p>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Set Type</label>
                <InfusionSetCombobox
                  options={infusionSet2Options}
                  disabled={infusionDisabled}
                  value={patient.infusionSet2Index}
                  onSelect={(label, index) =>
                    handleSelectChange("infusionSet2", label, index)
                  }
                  placeholder="Search infusion sets..."
                />
                {infusionHint && (
                  <p className="mt-1 text-[11px] text-muted-foreground">{infusionHint}</p>
                )}
                {isInfusionSelling(patient.infusionSet2Index) && (
                  <CompatNote pumpType={patient.pumpType} setLabel={patient.infusionSet2} />
                )}
                {isInfusionSelling(patient.infusionSet2Index) && stock.index && (
                  <StockNote
                    verdict={stockVerdict(patient.infusionSet2, stock.index, stockToday)}
                  />
                )}
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Quantity</label>
                <QtySelect
                  value={patient.qtyInf2}
                  onChange={(val) => onFieldChange("qtyInf2", val)}
                />
                {isInfusionSelling(patient.infusionSet2Index) && (
                  <CapNote qty={Number(patient.qtyInf2) || 0} cap={infusionCap.cap} payerLabel={infusionCap.payerLabel} />
                )}
                {isInfusionSelling(patient.infusionSet2Index) &&
                  (!patient.qtyInf2 || patient.qtyInf2 === "0") && (
                    <p className="mt-2 text-xs font-medium text-red-600">
                      Infusion set selected — please choose a quantity.
                    </p>
                  )}
              </div>
            </div>
          </div>

          {/* The two slots read against the order total. One line for the pair,
              because the fact is about the ORDER, not either slot — a per-slot
              note would say the same thing twice and neither copy would be
              right on its own. */}
          {(qtyPlan.error || qtyPlan.warning) && (
            <p
              className={cn(
                "mt-3 text-xs font-medium",
                qtyPlan.error ? "text-red-600" : "text-amber-600",
              )}
            >
              {qtyPlan.error ?? qtyPlan.warning}
            </p>
          )}

          {/* Cartridges */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-5">
            <div className="rounded-lg border border-input bg-muted/20 p-4 space-y-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Cartridges
              </p>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Quantity</label>
                <QtySelect
                  value={patient.qtyCartridge}
                  onChange={(val) => onFieldChange("qtyCartridge", val)}
                />
                {/* Brandon, 2026-09-09: the payer cap covers "the infusion sets
                    and cartridges". It has always been rendered on the two set
                    quantities and never here, so a rep could put 9 cartridges on
                    a payer that pays for 3 with nothing on screen saying so. */}
                <CapNote
                  qty={Number(patient.qtyCartridge) || 0}
                  cap={infusionCap.cap}
                  payerLabel={infusionCap.payerLabel}
                />
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <Card className="p-4 border-dashed">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold">Pump & Infusion Sets</span> — hidden (not in serving)
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPumpOverride(true)}
              className="text-muted-foreground text-xs gap-1"
            >
              <Eye className="h-3.5 w-3.5" /> Show
            </Button>
          </div>
        </Card>
      )}

      {/* ─── Section 5: Insurance ───
          No Monday column: the answers ride out in the notes block on Send
          (§ callIntake.ts). Split from the cost/auth half by the mockup —
          what the payer covers is a different question from what the patient
          owes. */}
      <Card className="p-6">
        <SectionHeading number={5} title="Insurance" />
        <InsuranceBlock patient={patient} onFieldChange={onFieldChange} />
      </Card>

      {/* ─── Section 6: Authorizations & Cost ───
          Same story: no columns. The AUTH RESULTS themselves are read-only and
          render in the patient header above — they are the Insurance stage's
          output, not something the rep sets on the call (§5.26). */}
      <Card className="p-6">
        <SectionHeading number={6} title="Authorizations" />
        <AuthBlock patient={patient} />
        <div className="mt-6 border-t pt-6">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            Out of Pocket
          </p>
          <OopBlock intake={intake} onChange={setIntake} />
        </div>
      </Card>

      {/* ─── Section 7: Subscription & Logistics ─── */}
      <Card className="p-6">
        <SectionHeading number={7} title="Subscription & Logistics" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {/* Subscription Type */}
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-2">
              Subscription Type
            </label>
            <Select
              value={patient.subscriptionTypeIndex !== null ? String(patient.subscriptionTypeIndex) : ""}
              onValueChange={(value) => {
                const option = SUBSCRIPTION_TYPE_OPTIONS.find((o) => String(o.index) === value);
                handleSelectChange("subscriptionType", option?.label || "", option?.index ?? null);
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select option" />
              </SelectTrigger>
              <SelectContent>
                {SUBSCRIPTION_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.index} value={String(opt.index)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(() => {
              const expected = expectedSubscriptionType(patient);
              const selected = patient.subscriptionTypeIndex !== null
                ? SUBSCRIPTION_TYPE_OPTIONS.find((o) => o.index === patient.subscriptionTypeIndex)?.label ?? null
                : null;
              if (expected && selected && expected !== selected) {
                return (
                  <p className="mt-2 text-xs font-medium text-red-600">
                    Mismatch: based on the selections above, expected <span className="font-semibold">{expected}</span> but <span className="font-semibold">{selected}</span> is selected.
                  </p>
                );
              }
              return null;
            })()}
          </div>

          {/* Order Frequency — Brandon: "call it that, not 'Supply length', so
              it matches the boards". It is a real Monday column now
              (`color_mm71xdhj`) rather than a line in the notes block, which is
              what lets the Subscription hop copy it. */}
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-2">
              Order Frequency
            </label>
            <Select
              value={frequency.days}
              onValueChange={(v) => {
                onFieldChange("orderFrequencyEdited" as keyof Patient, v);
                onFieldChange(
                  "orderFrequencyIndex" as keyof Patient,
                  ORDER_FREQUENCY_INDEX[daysToLabel(v)] ?? null,
                );
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select frequency" />
              </SelectTrigger>
              <SelectContent>
                {frequency.options.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d} days
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* One muted hint, and only while it means something: our guess, or
                the rep's edit. A value already on the board gets neither. */}
            {frequency.hint && (
              <p className="mt-1.5 text-xs text-muted-foreground">{frequency.hint}</p>
            )}
          </div>

        </div>

        {/* Brandon: the dates live "under the cards, in this section" rather
            than at the end of the call. Rows for lines not in Serving don't
            render. */}
        <div className="mt-6 border-t pt-6">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">
            Order Dates
          </p>
          <NextOrderDatesCard patient={patient} onFieldChange={onFieldChange} />
        </div>
      </Card>

      {/* ─── Section 8: Confirm Address ───
          Split out of Subscription & Logistics by Brandon's mockup. It is its
          own step on the call — you read the address back, then send the text —
          and it was previously buried under the supply-length controls. */}
      <Card className="p-6">
        <SectionHeading number={8} title="Confirm Address" />

        {/* Address — full width */}
        <div className="mt-6 space-y-3">
          {/* Current Monday address (read-only) */}
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">
              Address on File
            </label>
            <p className="text-sm font-medium px-3 py-2 rounded-md bg-muted/50 border border-input min-h-[40px] flex items-center">
              {patient.address || <span className="text-muted-foreground italic">No address on file</span>}
            </p>
            {/* Was a zip-only "Zip code needs to be added!" — now the FULL
                Cardinal order-format verdict (§5.17), which covers the missing
                zip and the four other ways an address stops the order, and
                prints the required shape. Welcome Call is the earliest stage
                that can fix this and the one where somebody is on the phone
                with the patient. It does NOT block the send: the existing
                `validatePatientForSend` zip gate is unchanged. */}
            <CardinalAddressNote address={patient.address} />
          </div>

          {/* Google Places autocomplete for editing */}
          <div>
            <label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold block mb-1">
              Update Address
            </label>
            <AddressAutocomplete
              key={patient.id}
              value={patient.addressEdited ?? ""}
              onChange={(result: AddressResult) => {
                onFieldChange("addressEdited", result.address);
                onFieldChange("addressLat" as keyof Patient, result.lat);
                onFieldChange("addressLng" as keyof Patient, result.lng);
              }}
              placeholder="Search for a new address..."
            />
            <CardinalAddressNote address={patient.addressEdited ?? ""} />
            {/* Still confirms the write on a SOFT note (a PO Box is going to be
                sent); suppressed only on a red one, where "will be updated"
                would read as reassurance about an address Cardinal refuses. */}
            {patient.addressEdited !== null && patient.addressEdited !== "" && cardinalAddressNote(patient.addressEdited)?.tone !== "red" && patient.addressEdited !== patient.address && (
              <p className="text-xs text-amber-600 mt-1">Address will be updated on sync</p>
            )}
          </div>
          {/* No board column — rides out in the notes block on send. Placed with
              the address so the rep ticks it while reading it back. */}
          <ConfirmCheck intake={intake} onChange={setIntake} field="address" />

          {/* Place of Service (MM-1030). The rule already ran on every send —
              it was just invisible, because COL.pos is write-only and POS was
              not in the read set, so nobody could see it had worked.
              Computed from the EFFECTIVE values, matching what mondayWrite
              will write, so it reacts as the rep corrects the address. */}
          {(() => {
            const primary = patient.primaryInsuranceEdited ?? patient.primaryInsurance;
            const address = patient.addressEdited ?? patient.address;
            const computed = expectedPos(primary, address);
            const boardDiffers = !!patient.pos && patient.pos !== computed;
            return (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Place of Service
                  </span>
                  <span className="text-sm font-semibold">{computed}</span>
                  <span className="text-xs text-muted-foreground">
                    {computed === "Office"
                      ? "— out-of-state Blue plan, billed via Anthem NY 803 BlueCard"
                      : "— set from the primary payer and the patient's state"}
                  </span>
                </div>
                {boardDiffers && (
                  <p className="text-xs text-amber-600 mt-1">
                    Board currently says {patient.pos} — this will be corrected on send.
                  </p>
                )}
              </div>
            );
          })()}
        </div>

        {/* Welcome Call Text — button below address */}
        <div className="mt-6">
          <Button
            variant={patient.welcomeCallTextIndex !== null ? "secondary" : "default"}
            disabled={sendingWelcomeText}
            className={cn(
              "gap-2 w-full sm:w-auto",
              patient.welcomeCallTextIndex !== null && "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300"
            )}
            onClick={async () => {
              // If already queued and the parent hasn't supplied a sender, allow toggle off (legacy behavior)
              if (patient.welcomeCallTextIndex !== null) {
                onFieldChange("welcomeCallText", "");
                onFieldChange("welcomeCallTextIndex" as keyof Patient, null);
                return;
              }
              if (!onSendWelcomeCallText) {
                // Fallback: just flip local state (preview / no-Monday environment)
                onFieldChange("welcomeCallText", "Send");
                onFieldChange("welcomeCallTextIndex" as keyof Patient, 0);
                return;
              }
              try {
                setSendingWelcomeText(true);
                await onSendWelcomeCallText();
              } finally {
                setSendingWelcomeText(false);
              }
            }}
          >
            <MessageSquare className="h-4 w-4" />
            {sendingWelcomeText
              ? "Sending…"
              : patient.welcomeCallTextIndex !== null
                ? "Welcome Call Text: Queued"
                : "Send Welcome Call Text"}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Pushes the form data above to Monday, then flips the Welcome Call Text trigger to Send.
          </p>
        </div>

        {/* The same Messages block Info Collection uses — the patient's text and
            email history with the MM line, readable while the rep is on the call.
            ⚠️ The `.pf-root` wrapper is REQUIRED, not decorative: every class this
            component uses is scoped under it, so without the wrapper it renders
            as unstyled markup. It contains ONLY this component, because
            `.pf-root button` strips the styling off any shadcn control placed
            inside (CLAUDE.md §9) — IntakeMessages is already written to survive
            that, the rest of this form is not.
            No `onTextSent`: that prop stamps the intake page's Call Log column,
            which this board doesn't have. */}
        <div className="pf-root mt-6">
          <IntakeMessages
            patientId={patient.id}
            email={patient.email}
            phone={patient.phoneEdited ?? patient.phone}
          />
        </div>
      </Card>

      {/* ─── End-of-call decision: Advance? ─── */}
      <Card className="p-6">
        <SectionHeading number={9} title="End of Call" />
        <p className="text-sm text-muted-foreground mb-4">
          After wrapping up the welcome call, decide whether this patient should
          advance to Order or hold here. Either choice routes the patient back
          for Profile Review on the Monday board.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-auto py-4 justify-start text-left whitespace-normal border",
              "focus-visible:ring-emerald-500 focus-visible:ring-offset-0",
              patient.advanceDecisionIndex === 1
                ? "bg-emerald-600 hover:bg-emerald-700 hover:text-white text-white border-emerald-700 shadow-md"
                : "bg-emerald-50 hover:bg-emerald-600 hover:text-white hover:border-emerald-700 text-emerald-800 border-emerald-300"
            )}
            onClick={() => {
              if (patient.advanceDecisionIndex === 1) {
                onFieldChange("advanceDecision", "");
                onFieldChange("advanceDecisionIndex" as keyof Patient, null);
              } else {
                onFieldChange("advanceDecision", "Advance");
                onFieldChange("advanceDecisionIndex" as keyof Patient, 1);
              }
            }}
          >
            <div>
              <p className="font-semibold text-sm">Advance</p>
              <p className="text-xs opacity-90 font-normal">
                Move forward to Order.
              </p>
            </div>
          </Button>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-auto py-4 justify-start text-left whitespace-normal border",
              "focus-visible:ring-rose-500 focus-visible:ring-offset-0",
              patient.advanceDecisionIndex === 2
                ? "bg-rose-600 hover:bg-rose-700 hover:text-white text-white border-rose-700 shadow-md"
                : "bg-rose-50 hover:bg-rose-600 hover:text-white hover:border-rose-700 text-rose-800 border-rose-300"
            )}
            onClick={() => {
              if (patient.advanceDecisionIndex === 2) {
                onFieldChange("advanceDecision", "");
                onFieldChange("advanceDecisionIndex" as keyof Patient, null);
              } else {
                onFieldChange("advanceDecision", "Don't Advance");
                onFieldChange("advanceDecisionIndex" as keyof Patient, 2);
              }
            }}
          >
            <div>
              <p className="font-semibold text-sm">Don&apos;t Advance</p>
              <p className="text-xs opacity-90 font-normal">
                Hold this patient — do not progress to Order.
              </p>
            </div>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Required before pressing Send to Monday. Either choice sets Stage Advancer to <span className="font-semibold">Review Profile</span>.
        </p>
      </Card>
    </div>
  );
}
