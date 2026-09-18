/**
 * The Patient Intake column's filter — five facets, each multi-select.
 *
 * Brandon, 2026-09-17, replacing the three-way Complete / Partial / All toggle:
 * *"change the complete vs partial toggle to a filter where you can filter for
 * each of the 5 columns … each of these should be able to multi-select too."*
 *
 * The rules — which values exist, what a lead's value is, what an empty
 * selection means — are all in `lib/careCoordinator/intakeFilter.ts`. This file
 * is only how it looks.
 *
 * ⚠️ **IT HAS TO FIT ON THE LEGEND ROW.** `PipelineColumn` renders its
 * `controls` slot there rather than giving it a row of its own, so that a
 * column WITH a filter and a column WITHOUT one are the same height and their
 * section bars line up — Brandon reported those drifting on 2026-09-16 and it
 * is the same class of fault. Hence five compact triggers rather than a
 * filter bar.
 */
import { useMemo, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  BLANK_LABEL, FACET_KEYS, FACET_LABEL, activeFacetCount, clearFacet, facetOptions,
  toggleFacetValue, type FacetKey, type FacetSelection,
} from "@/lib/careCoordinator/intakeFilter";
import { shortLabel } from "@/lib/careCoordinator/pills";
import type { IntakeLead } from "@/lib/careCoordinator/workflow";
import { cn } from "@/lib/utils";

function FacetMenu({
  facet, leads, groups, selection, onChange,
}: {
  facet: FacetKey;
  leads: readonly IntakeLead[];
  groups: { partial: string; completed: string };
  selection: FacetSelection;
  onChange: (next: FacetSelection) => void;
}) {
  const [open, setOpen] = useState(false);
  // ⚠️ Off the UNFILTERED population — see `facetOptions`. Recomputing from the
  // filtered list makes a chosen facet's other values disappear, so there is no
  // way to widen a selection without clearing it first.
  const options = useMemo(() => facetOptions(leads, facet, groups), [leads, facet, groups]);
  const chosen = selection[facet];
  const active = chosen.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex max-w-[11rem] items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
            active
              ? "border-foreground bg-foreground text-background"
              : "bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          title={active ? `${FACET_LABEL[facet]}: ${chosen.map((v) => v || BLANK_LABEL).join(", ")}` : `Filter by ${FACET_LABEL[facet].toLowerCase()}`}
        >
          <span className="truncate">{FACET_LABEL[facet]}</span>
          {active && <span className="tabular-nums opacity-80">{chosen.length}</span>}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="flex items-center justify-between border-b px-2.5 py-1.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{FACET_LABEL[facet]}</span>
          {active && (
            <button
              type="button"
              onClick={() => onChange(clearFacet(selection, facet))}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {options.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">Nothing to filter by yet.</p>
          )}
          {options.map((o) => {
            const on = chosen.includes(o.value);
            return (
              <button
                key={o.value || "__blank__"}
                type="button"
                onClick={() => onChange(toggleFacetValue(selection, facet, o.value))}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-accent"
              >
                <span className={cn(
                  "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                  on ? "border-foreground bg-foreground text-background" : "border-muted-foreground/40",
                )}>
                  {on && <Check className="h-2.5 w-2.5" aria-hidden />}
                </span>
                <span className={cn("min-w-0 flex-1 truncate", !o.value && "italic text-muted-foreground")} title={o.label}>
                  {o.value ? shortLabel(o.label) : o.label}
                </span>
                <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">{o.count}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function IntakeFilter({
  leads, groups, selection, onChange, onClearAll, shown, total,
}: {
  /** The column's UNFILTERED population — what the options are derived from. */
  leads: readonly IntakeLead[];
  groups: { partial: string; completed: string };
  selection: FacetSelection;
  onChange: (next: FacetSelection) => void;
  onClearAll: () => void;
  /** How many rows survive the filter, and how many there were. */
  shown: number;
  total: number;
}) {
  const active = activeFacetCount(selection);
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter Patient Intake">
      {FACET_KEYS.map((f) => (
        <FacetMenu key={f} facet={f} leads={leads} groups={groups} selection={selection} onChange={onChange} />
      ))}
      {/* ⚠️ Only while something is filtered. A permanent "showing all 1,754"
          is noise, and a Clear button with nothing to clear reads as broken. */}
      {active > 0 && (
        <button
          type="button"
          onClick={onClearAll}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          title={`Clear ${active} filter${active === 1 ? "" : "s"}`}
        >
          <X className="h-3 w-3" aria-hidden />
          {shown.toLocaleString()} of {total.toLocaleString()}
        </button>
      )}
    </div>
  );
}

export default IntakeFilter;
