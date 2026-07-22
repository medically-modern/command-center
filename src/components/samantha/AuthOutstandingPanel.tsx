/**
 * AuthOutstandingPanel — redesigned Auth Outstanding view
 * (JOSH_HANDOFF_AUTH_OUTSTANDING.md + auth-outstanding-redesign.html,
 * July 2026; domain rules in lib/samantha/authOutstandingReview.ts).
 *
 * One card per TRACKED product (board label "Submitted", plus partial-saved
 * "No Auth Needed" cards whose SoS recheck is still deferred). Each card:
 * left = read-only "What Was Submitted" recap off the board; right = the
 * result entry (Auth Valid / Denied / No Auth Needed).
 *
 *   - Auth Valid    → Auth ID + Start + End + Units (all required)
 *   - Denied        → optional denial-reason upload (never gates)
 *   - No Auth Needed→ derived SoS recheck: the rep records Last Bill Date +
 *                     Units or No Billing History; Clear / Not-Clear is
 *                     derived and NEVER shown (benefits model). The
 *                     "Save No Auth Needed" button partial-saves just this
 *                     product with no stage change (handoff §4).
 *
 * NOTHING DVS-related renders here (§7) — DVS-routed products get a gray
 * "DVS Required" pill in the matrix and no card; the DVS work moves to its
 * own dedicated view. All uploads land in Final Clinicals (§5).
 *
 * Card height rule (§2): each card's result zone is locked to its tallest
 * possible state — all three result variants render stacked in one CSS grid
 * cell (inactive ones visibility-hidden), so the cell is always as tall as
 * the tallest variant at the current width and never jumps when the rep
 * switches results.
 */
import { useState } from "react";
import {
  Patient,
  PRODUCT_CODES,
  ProductCodeId,
  ProductCodeState,
  EMPTY_INSURANCE,
} from "@/lib/samantha/workflow";
import {
  resolveHcpcs,
  PRODUCT_LABELS,
  type ProductId,
  type ResolvedProduct,
} from "@/lib/samantha/hcpcRules";
import {
  dvsRoutedProducts,
  effectiveResult,
  derivedRecheckSos,
  nextOrderPreviewYmd,
  recheckComplete,
  reviewHasMedicaid,
  trackedCards,
  type AuthOutstandingResult,
} from "@/lib/samantha/authOutstandingReview";
import { authHomePlan, modifiersFor } from "@/lib/samantha/submitAuthRules";
import { sosLookbackLabel, ymdToUs } from "@/lib/samantha/benefitsDerive";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NotesPanel } from "@/components/samantha/NotesPanel";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  FileText,
  Info,
  Loader2,
  Package,
  Repeat,
  Save,
  ShieldCheck,
} from "lucide-react";
import { ClinicalsDownloadButton } from "./ClinicalsDownloadButton";
import { FinalClinicalsUpload } from "./FinalClinicalsUpload";

interface Props {
  patient: Patient;
  onCodeChange: (codeId: ProductCodeId, patch: Partial<ProductCodeState>) => void;
  onNotesChange: (v: string) => void;
  onSaveNotesToMonday?: (notes: string) => Promise<void>;
  /** Per-product partial save (handoff §4): writes THIS product's
   *  "No Auth Needed" result (and wipes its auth fields) to Monday with no
   *  Stage Advancer / Escalation side effects. */
  onSaveNoAuthNeeded?: (codeId: ProductCodeId) => Promise<void>;
}

const PRODUCT_TO_CODE_ID: Record<ProductId, ProductCodeId> = {
  monitor: "cgm-monitor",
  sensors: "cgm-sensors",
  insulin_pump: "pump",
  infusion_set: "infusion-sets",
  cartridge: "cartridges",
};

/** Typical approved unit counts — display-only placeholders. */
const UNITS_PLACEHOLDER: Record<ProductId, string> = {
  monitor: "1",
  sensors: "12",
  insulin_pump: "1",
  infusion_set: "30",
  cartridge: "30",
};

export function AuthOutstandingPanel({ patient, onCodeChange, onNotesChange, onSaveNotesToMonday, onSaveNoAuthNeeded }: Props) {
  const ins = patient.insurance ?? EMPTY_INSURANCE;
  const serving = patient.serving || "";
  const primaryInsurance = patient.primaryInsurance || "";
  const dropdownsReady = !!serving && !!primaryInsurance;

  const resolved: ResolvedProduct[] = resolveHcpcs(
    primaryInsurance || null,
    serving || null,
    patient.secondaryInsurance ?? null,
  );
  const tracked = dropdownsReady ? trackedCards(patient) : [];
  const dvsProducts = new Set(dvsRoutedProducts(patient).map((r) => r.product));
  const hasMedicaid = reviewHasMedicaid(patient);
  const homePlan = authHomePlan(patient);

  return (
    <section className="rounded-xl border bg-card p-5 shadow-card space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold">Authorizations Outstanding</h2>
          <p className="text-xs text-muted-foreground">
            Record the auth result for each product. No Auth Needed can be saved one product at a time.
          </p>
        </div>
        <ClinicalsDownloadButton itemId={patient.id} />
      </div>

      {!dropdownsReady && (
        <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Select Serving and Primary Insurance on the Benefits tab to load auth-eligible products.
          </p>
        </div>
      )}

      {dropdownsReady && homePlan && (
        <div className="flex items-start gap-3 rounded-xl border border-l-4 border-[#0F4C5C]/30 border-l-[#0F4C5C] bg-[#0F4C5C]/5 px-4 py-3">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-[#0F4C5C]" />
          <p className="text-sm text-[#0F4C5C] dark:text-teal-200">
            Auth status checks go through the member's <b>home plan — {homePlan.home}</b> — not{" "}
            {homePlan.host}, the host plan we bill.
          </p>
        </div>
      )}

      {dropdownsReady && (
        <AuthStatusMatrix resolved={resolved} dvsProducts={dvsProducts} ins={ins} />
      )}

      {dropdownsReady && tracked.length === 0 && (
        <div className="rounded-lg border-2 border-dashed border-success/30 bg-success/5 p-8 text-center">
          <p className="text-sm font-semibold text-foreground">No outstanding auths</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xl mx-auto">
            {dvsProducts.size > 0
              ? "Everything bills to Medicaid — handled at the DVS stage, nothing to record here."
              : "No product on this patient is at Submitted on the board."}
          </p>
        </div>
      )}

      {dropdownsReady && tracked.length > 0 && (
        <div className="space-y-4">
          {tracked.map((r) => {
            const codeId = PRODUCT_TO_CODE_ID[r.product];
            const meta = PRODUCT_CODES.find((c) => c.id === codeId);
            if (!meta) return null;
            const state = ins.codes[codeId] ?? ({ status: "pending" } as ProductCodeState);
            return (
              <ProductResultCard
                key={codeId}
                meta={meta}
                resolved={r}
                state={state}
                patientId={patient.id}
                primaryInsurance={primaryInsurance}
                referralSource={patient.referralSource ?? ""}
                hasMedicaid={hasMedicaid}
                onChange={(patch) => onCodeChange(codeId, patch)}
                onSaveNoAuthNeeded={onSaveNoAuthNeeded ? () => onSaveNoAuthNeeded(codeId) : undefined}
              />
            );
          })}
        </div>
      )}

      {/* Notes — same Call Reference Notes column as Benefits + Submit Auth. */}
      <NotesPanel
        notes={patient.notes}
        profileSendOffNotes={patient.profileSendOffNotes}
        mnWorkflowNotes={patient.mnWorkflowNotes}
        onNotesChange={onNotesChange}
        onSaveToMonday={onSaveNotesToMonday}
        description="Carries over from Benefits + Submit Auth. Add anything from approval / denial follow-up — rep names, reference numbers…"
        placeholder="Approval / denial details, rep names, follow-up actions…"
      />
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Auth Status by Product matrix (§8) — read-only, from Monday.
// Color language (Brandon): Submitted = light blue ("check this one
// today"); everything with no action on this view is gray — resolved
// results grayed out, DVS Required gray (a touch darker than Not
// Serving), Not Serving most faded. Required = amber. No green.
// ─────────────────────────────────────────────────────────────────────

const FIXED_HCPC: Partial<Record<ProductId, string>> = {
  monitor: "E2103",
  sensors: "A4239",
  insulin_pump: "E0784",
};

function AuthStatusMatrix({
  resolved,
  dvsProducts,
  ins,
}: {
  resolved: ResolvedProduct[];
  dvsProducts: Set<ProductId>;
  ins: { codes: Partial<Record<ProductCodeId, ProductCodeState>> };
}) {
  const ALL: ProductId[] = ["monitor", "sensors", "insulin_pump", "infusion_set", "cartridge"];
  const byProduct = new Map(resolved.map((r) => [r.product, r]));

  return (
    <div className="rounded-xl border-2 border-border bg-muted/10 p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="h-8 w-8 rounded-full bg-background border-2 border-border flex items-center justify-center shrink-0">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Auth Status by Product</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Read-only, from the Monday board. Blue = check this one today; gray = no action on this view.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {ALL.map((p) => {
          const r = byProduct.get(p);
          const state = ins.codes[PRODUCT_TO_CODE_ID[p]];
          const isDvs = dvsProducts.has(p);
          const label = !r
            ? "Not Serving"
            : isDvs
              ? "DVS Required"
              : (state?._mondayAuthLabel?.trim() || "—");
          const lower = label.toLowerCase();
          const isSubmitted = lower === "submitted";
          const isRequired = lower === "required";
          const isNotServing = !r || lower === "not serving";
          // Anything else (Auth Valid / Denied / No Auth Needed / blank) is
          // resolved-gray: no action on this view.
          return (
            <div
              key={p}
              className={cn(
                "rounded-lg border p-3 bg-background flex flex-col gap-2",
                isSubmitted && "border-sky-300 bg-sky-50/70 dark:border-sky-800 dark:bg-sky-950/30",
                isRequired && "border-warning/50 bg-warning/5",
                isDvs && "opacity-80 bg-muted/40",
                !isSubmitted && !isRequired && !isDvs && !isNotServing && "opacity-65 bg-muted/30",
                isNotServing && "opacity-55",
              )}
            >
              <div>
                <p className={cn(
                  "text-sm font-bold font-mono leading-tight",
                  isSubmitted ? "text-sky-800 dark:text-sky-200" : "text-foreground/80",
                )}>
                  {r?.hcpc ?? FIXED_HCPC[p] ?? "—"}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                  {PRODUCT_LABELS[p]}
                </p>
              </div>
              <span
                className={cn(
                  "mt-auto self-start inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold border",
                  isSubmitted && "bg-sky-100 border-sky-300 text-sky-800 dark:bg-sky-950/50 dark:border-sky-800 dark:text-sky-200",
                  isRequired && "bg-warning/15 border-warning/50 text-warning-foreground",
                  !isSubmitted && !isRequired && "bg-muted border-border text-muted-foreground",
                )}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Product result card
// ─────────────────────────────────────────────────────────────────────

interface CardProps {
  meta: typeof PRODUCT_CODES[number];
  resolved: ResolvedProduct;
  state: ProductCodeState;
  patientId: string;
  primaryInsurance: string;
  referralSource: string;
  hasMedicaid: boolean;
  onChange: (patch: Partial<ProductCodeState>) => void;
  onSaveNoAuthNeeded?: () => Promise<void>;
}

const RESULTS: Array<{ key: Exclude<AuthOutstandingResult, "">; label: string; on: string; hover: string }> = [
  { key: "auth-valid", label: "Auth Valid", on: "bg-emerald-600 border-transparent text-white", hover: "hover:border-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30" },
  { key: "denied", label: "Denied", on: "bg-red-600 border-transparent text-white", hover: "hover:border-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30" },
  { key: "no-auth-needed", label: "No Auth Needed", on: "bg-sky-600 border-transparent text-white", hover: "hover:border-sky-500 hover:text-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/30" },
];

function ProductResultCard({
  meta,
  resolved: r,
  state,
  patientId,
  primaryInsurance,
  referralSource,
  hasMedicaid,
  onChange,
  onSaveNoAuthNeeded,
}: CardProps) {
  const codeId = meta.id;
  const isRecurring = meta.cadence === "RECURRING";
  const result = effectiveResult(state);
  const mods = modifiersFor(r.hcpc, primaryInsurance);
  const method = state.authSubmissionMethod ?? "";
  const isCallFax = method === "Call" || method === "Fax";
  const [savingNan, setSavingNan] = useState(false);
  const [deniedFiles, setDeniedFiles] = useState<string[]>([]);
  const [authDocFiles, setAuthDocFiles] = useState<string[]>([]);

  const setResult = (next: Exclude<AuthOutstandingResult, "">) => {
    if (next === result) {
      // Toggle off a LOCAL pick. A board-backed No Auth Needed (partial
      // save) keeps showing via effectiveResult — it's already on Monday.
      onChange({ authOutstandingResult: "" });
      return;
    }
    if (next === "no-auth-needed") {
      // No auth exists — wipe the per-product auth metadata in one shot.
      onChange({ authOutstandingResult: next, authId: "", authStart: "", authEnd: "", authUnits: "" });
    } else {
      onChange({ authOutstandingResult: next });
    }
  };

  /** Patch recheck facts + keep the DERIVED (never shown) sosRecheck in
   *  lockstep — mondayWrite re-derives at send time as the authority. */
  const patchRecheck = (patch: Partial<ProductCodeState>) => {
    const nextState = { ...state, ...patch };
    onChange({ ...patch, sosRecheck: derivedRecheckSos(nextState, codeId, hasMedicaid) });
  };

  const handleSaveNan = async () => {
    if (!onSaveNoAuthNeeded || savingNan) return;
    setSavingNan(true);
    try {
      await onSaveNoAuthNeeded();
    } finally {
      setSavingNan(false);
    }
  };

  const recheckDone = recheckComplete(state);
  const nextOrder =
    state.sosEntry === "billed" && state.lastBillDate
      ? nextOrderPreviewYmd(codeId, state.lastBillDate, hasMedicaid, state.units)
      : "";

  // Shared auth-docs surface for the Valid + NAN variants (call/fax only —
  // portal submissions already have their record in the portal, §5).
  const authDocsZone = isCallFax ? (
    <div className="mt-3">
      <FinalClinicalsUpload
        itemId={patientId}
        tone="amber"
        title="Upload the auth docs"
        subtitle={`Submitted via ${method} — no portal record exists. Drop the payer's paperwork here.`}
        onUploadedFiles={(names) => setAuthDocFiles((prev) => [...prev, ...names])}
      />
      {authDocFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {authDocFiles.map((f, i) => (
            <span key={`${f}-${i}`} className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-background border border-amber-300 text-amber-800 dark:border-amber-700 dark:text-amber-200 max-w-full">
              <FileText className="h-3 w-3 shrink-0" />
              <span className="truncate">{f}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  ) : null;

  const unitsPlaceholder = UNITS_PLACEHOLDER[r.product] ?? "";

  return (
    <div className={cn(
      "rounded-xl border-l-4 border bg-card overflow-hidden",
      isRecurring ? "border-l-primary" : "border-l-accent-foreground/40",
    )}>
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 flex-wrap px-4 py-3 bg-muted/30 border-b">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={cn(
              "inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full",
              isRecurring ? "bg-primary/15 text-primary" : "bg-muted text-foreground/70 border border-border",
            )}>
              {isRecurring ? <Repeat className="h-3 w-3" /> : <Package className="h-3 w-3" />}
              {meta.cadence}
            </span>
            <span className="text-[10px] font-mono text-muted-foreground">{meta.group}</span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-base font-bold font-mono">{r.hcpc}</h4>
            {mods && (
              <span className="flex items-center gap-1">
                {mods.mods.map((m) => (
                  <span key={m} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-muted border border-border select-all">
                    {m}
                  </span>
                ))}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{meta.name}</p>
        </div>
        {!result && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-muted text-muted-foreground">
            ● Awaiting result
          </span>
        )}
        {result === "no-auth-needed" && !recheckDone && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-warning/15 border border-warning/40 text-warning-foreground">
            SoS recheck pending
          </span>
        )}
      </div>

      {/* Split: submission recap (left) · result entry (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4 p-4 bg-muted/20 items-stretch">
        <SubmissionRecap state={state} isCallFax={isCallFax} referralSource={referralSource} />

        <div className="rounded-lg border border-l-4 border-l-primary bg-background overflow-hidden flex flex-col min-w-0">
          <div className="px-4 py-2.5 border-b bg-muted/40">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[#0F4C5C] dark:text-teal-200">
              Record the Result <span className="text-red-500">*</span>
            </p>
          </div>
          <div className="p-4 flex-1 flex flex-col">
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={`${r.hcpc} auth result`}>
              {RESULTS.map((res) => (
                <button
                  key={res.key}
                  type="button"
                  role="radio"
                  aria-checked={result === res.key}
                  onClick={() => setResult(res.key)}
                  className={cn(
                    "px-2 py-2.5 rounded-md border-2 text-sm font-semibold transition-colors whitespace-nowrap",
                    result === res.key
                      ? res.on
                      : cn("border-border bg-background text-muted-foreground", res.hover),
                  )}
                >
                  {res.label}
                </button>
              ))}
            </div>

            {/* Result zone — all three variants stacked in one grid cell so
                the zone is always as tall as the tallest one (§2). */}
            <div className="grid mt-1">
              {/* Auth Valid */}
              <div className={cn("col-start-1 row-start-1 min-w-0", result !== "auth-valid" && "invisible pointer-events-none")} aria-hidden={result !== "auth-valid"}>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-3">
                  <div>
                    <FieldLabel>Auth ID <Req /></FieldLabel>
                    <Input
                      value={state.authId ?? ""}
                      onChange={(e) => onChange({ authId: e.target.value })}
                      placeholder="e.g. 123456"
                      className="mt-1 h-9 bg-background font-mono text-sm"
                    />
                  </div>
                  <div>
                    <FieldLabel>Auth Start <Req /></FieldLabel>
                    <Input
                      type="date"
                      value={state.authStart ?? ""}
                      onChange={(e) => onChange({ authStart: e.target.value })}
                      className="mt-1 h-9 bg-background"
                    />
                  </div>
                  <div>
                    <FieldLabel>Auth End <Req /></FieldLabel>
                    <Input
                      type="date"
                      value={state.authEnd ?? ""}
                      onChange={(e) => onChange({ authEnd: e.target.value })}
                      className="mt-1 h-9 bg-background"
                    />
                  </div>
                  <div>
                    <FieldLabel>Units <Req /></FieldLabel>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={state.authUnits ?? ""}
                      onChange={(e) => onChange({ authUnits: e.target.value })}
                      placeholder={unitsPlaceholder}
                      className="mt-1 h-9 bg-background"
                    />
                  </div>
                </div>
                {authDocsZone}
              </div>

              {/* Denied */}
              <div className={cn("col-start-1 row-start-1 min-w-0", result !== "denied" && "invisible pointer-events-none")} aria-hidden={result !== "denied"}>
                <div className="mt-3">
                  <FinalClinicalsUpload
                    itemId={patientId}
                    tone="rose"
                    multiple={false}
                    title="Upload the denial reason"
                    subtitle={`Attach the payer's denial letter or a screenshot showing why ${r.hcpc} was denied — optional, never blocks Complete.`}
                    onUploadedFiles={(names) => setDeniedFiles((prev) => [...prev, ...names])}
                  />
                  {deniedFiles.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {deniedFiles.map((f, i) => (
                        <span key={`${f}-${i}`} className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-background border border-red-300 text-red-700 dark:border-red-800 dark:text-red-300 max-w-full">
                          <FileText className="h-3 w-3 shrink-0" />
                          <span className="truncate">{f}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-2">
                    Denial escalates automatically on Auth Review Complete — no separate Escalate step.
                  </p>
                </div>
              </div>

              {/* No Auth Needed → derived SoS recheck */}
              <div className={cn("col-start-1 row-start-1 min-w-0", result !== "no-auth-needed" && "invisible pointer-events-none")} aria-hidden={result !== "no-auth-needed"}>
                <div className="mt-3 rounded-lg border border-sky-300 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/30 p-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-sky-800 dark:text-sky-200">
                      Same or Similar — recheck <Req />
                    </p>
                    {onSaveNoAuthNeeded && (
                      <Button
                        size="sm"
                        onClick={handleSaveNan}
                        disabled={savingNan}
                        className="gap-1.5 bg-sky-600 hover:bg-sky-700 text-white shrink-0 h-8"
                      >
                        {savingNan ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        Save No Auth Needed
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-sky-800/80 dark:text-sky-300/80 mb-3">
                    No auth needed — next step is the Same-or-Similar call ({sosLookbackLabel(codeId, hasMedicaid)} lookback).
                    Calling now? Record the billing history below. Calling later? <b>Save</b> writes just this product
                    to Monday (stage unchanged) and the recheck stays open until you do.
                  </p>
                  <div className="flex items-end gap-3 flex-wrap">
                    <div className={cn(
                      "flex-1 min-w-[240px] grid grid-cols-[minmax(140px,1fr)_90px] gap-3 rounded-lg border-2 border-dashed border-border bg-background p-3",
                      state.sosEntry === "never" && "opacity-50",
                    )}>
                      <div>
                        <FieldLabel><CalendarDays className="h-3 w-3 inline mr-1" />Last Bill Date</FieldLabel>
                        <Input
                          type="date"
                          value={state.sosEntry === "never" ? "" : (state.lastBillDate ?? "")}
                          disabled={state.sosEntry === "never"}
                          onChange={(e) => patchRecheck({ sosEntry: "billed", lastBillDate: e.target.value })}
                          className="mt-1 h-9 bg-background"
                        />
                      </div>
                      <div>
                        <FieldLabel>Units</FieldLabel>
                        <Input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={state.sosEntry === "never" ? "" : (state.units ?? "")}
                          disabled={state.sosEntry === "never"}
                          onChange={(e) => patchRecheck({ sosEntry: "billed", units: e.target.value })}
                          placeholder="0"
                          className="mt-1 h-9 bg-background"
                        />
                      </div>
                    </div>
                    <span className="grid place-items-center h-8 w-8 rounded-full bg-muted text-[10px] font-extrabold text-muted-foreground mb-1">
                      OR
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        state.sosEntry === "never"
                          ? patchRecheck({ sosEntry: "", lastBillDate: "", units: "" })
                          : patchRecheck({ sosEntry: "never", lastBillDate: "", units: "" })
                      }
                      className={cn(
                        "h-9 px-4 mb-1 rounded-md border-2 text-sm font-semibold transition-colors whitespace-nowrap",
                        state.sosEntry === "never"
                          ? "bg-sky-600 border-transparent text-white"
                          : "border-border bg-background text-muted-foreground hover:border-sky-500 hover:text-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950/30",
                      )}
                    >
                      No Billing History
                    </button>
                  </div>
                  {nextOrder && (
                    <p className="text-[11px] text-muted-foreground mt-2">
                      Next Order Date auto-set to <b className="text-foreground">{ymdToUs(nextOrder)}</b>.
                    </p>
                  )}
                </div>
                {authDocsZone}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Left column — what Submit Auth recorded on the board (read-only). */
function SubmissionRecap({
  state,
  isCallFax,
  referralSource,
}: {
  state: ProductCodeState;
  isCallFax: boolean;
  referralSource: string;
}) {
  const hasAny = !!(state.authSubmissionMethod || state.authSubmissionDate || state.authId || state.intakeId);
  const isCarecentrix = referralSource.toLowerCase().includes("carecentrix");
  return (
    <div className="rounded-lg border border-t-4 border-t-[#0F4C5C] bg-muted/30 overflow-hidden flex flex-col">
      <div className="px-4 py-2.5 border-b">
        <p className="text-[11px] font-bold uppercase tracking-wider text-[#0F4C5C] dark:text-teal-200">
          What Was Submitted
        </p>
      </div>
      <div className="p-3 flex-1 flex flex-col gap-2">
        {!hasAny && (
          <p className="text-xs text-muted-foreground leading-relaxed">
            No submission details on the board for this product.
          </p>
        )}
        {state.authSubmissionMethod && <RecapBox label="Submitted Via" value={state.authSubmissionMethod} />}
        {state.authSubmissionDate && <RecapBox label="Submitted On" value={ymdToUs(state.authSubmissionDate)} />}
        {state.authId && <RecapBox label="Auth ID" value={state.authId} mono />}
        {isCallFax && state.callFaxNumber && (
          <RecapBox label={`${state.authSubmissionMethod} Number`} value={state.callFaxNumber} mono />
        )}
        {state.intakeId && (
          <RecapBox label={`Intake ID${isCarecentrix ? " · Carecentrix" : ""}`} value={state.intakeId} mono />
        )}
      </div>
    </div>
  );
}

function RecapBox({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-medium mt-0.5 select-all", mono && "font-mono")}>{value}</p>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </label>
  );
}

function Req() {
  return <span className="text-red-500 font-bold">*</span>;
}
