/**
 * BenefitsPanel — the redesigned Benefits checklist (Brandon's July 2026
 * handoff; see JOSH_HANDOFF_BENEFITS.md + BENEFITS_REDESIGN_REVIEW.md).
 *
 * The rep records FACTS only:
 *   Step 1 — three universal pass/fail checks (In-Network / Active / Covered)
 *   Step 2 — per product: Auth Required/Not Required + billing history
 *            (Last Bill Date + Units, or "No Billing History")
 *
 * Same-or-Similar Clear / Not Clear / Skip is DERIVED (benefitsDerive.ts)
 * and never shown as a rep choice. Two append-only call logs land on their
 * dedicated Monday columns on send (decision D8).
 *
 * The "Monday Board Output" drawer is a TESTING AID (spec §8): it previews
 * exactly what each column write will be so backend output can be verified
 * against it — delete it when this ships to production.
 */
import { useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  History,
  Phone,
  Plus,
  ShieldQuestion,
  X,
} from "lucide-react";
import { useState } from "react";
import type {
  CallLogRow,
  Patient,
  ProductCodeId,
  ProductCodeState,
  UniversalChoice,
} from "@/lib/samantha/workflow";
import { EMPTY_INSURANCE, PRODUCT_CODES } from "@/lib/samantha/workflow";
import type { ResolvedProduct } from "@/lib/samantha/hcpcRules";
import {
  isAutoFilledMedicaidSupply,
  PRODUCT_LABELS,
  resolveHcpcs,
} from "@/lib/samantha/hcpcRules";
import {
  addDaysYmd,
  deriveBenefitsPreview,
  etTodayYmd,
  patientHasMedicaidIns,
  sosCutoffYmd,
  sosEntryComplete,
  sosLookbackLabel,
  ymdToUs,
} from "@/lib/samantha/benefitsDerive";

const PRODUCT_TO_CODE_ID: Record<ResolvedProduct["product"], ProductCodeId> = {
  monitor: "cgm-monitor",
  sensors: "cgm-sensors",
  insulin_pump: "pump",
  infusion_set: "infusion-sets",
  cartridge: "cartridges",
};

interface Props {
  patient: Patient;
  onUniversalChange: (id: "in-network" | "active" | "dme-benefits", value: UniversalChoice) => void;
  onCodeChange: (codeId: ProductCodeId, patch: Partial<ProductCodeState>) => void;
  onCallLogChange: (section: "callsUniversal" | "callsSosAuth", rows: CallLogRow[]) => void;
}

/* ── Universal check card ─────────────────────────────────────────── */

const UNIVERSAL_META: Array<{
  id: "in-network" | "active" | "dme-benefits";
  num: string;
  title: string;
  yes: string;
  no: string;
}> = [
  { id: "in-network", num: "CHECK 01", title: "In-Network", yes: "In-Network", no: "Out-of-Network" },
  { id: "active", num: "CHECK 02", title: "Insurance Active", yes: "Active", no: "Not Active" },
  { id: "dme-benefits", num: "CHECK 03", title: "DME Benefits", yes: "Covered", no: "Not Covered" },
];

function UniversalCheckCard({
  meta,
  value,
  onChange,
}: {
  meta: (typeof UNIVERSAL_META)[number];
  value: UniversalChoice;
  onChange: (v: UniversalChoice) => void;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 space-y-2 transition-colors",
        value === "confirmed" && "border-success/50 bg-success/5",
        value === "not-confirmed" && "border-destructive/50 bg-destructive/5",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {meta.num}
      </p>
      <p className="text-sm font-semibold">{meta.title}</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={value === "confirmed" ? "default" : "outline"}
          className={cn(
            "h-8 text-xs flex-1",
            value === "confirmed" && "bg-emerald-600 hover:bg-emerald-700 text-white",
          )}
          onClick={() => onChange(value === "confirmed" ? "" : "confirmed")}
        >
          {meta.yes}
        </Button>
        <Button
          size="sm"
          variant={value === "not-confirmed" ? "default" : "outline"}
          className={cn(
            "h-8 text-xs flex-1",
            value === "not-confirmed" && "bg-red-600 hover:bg-red-700 text-white",
          )}
          onClick={() => onChange(value === "not-confirmed" ? "" : "not-confirmed")}
        >
          {meta.no}
        </Button>
      </div>
    </div>
  );
}

/* ── Call log ─────────────────────────────────────────────────────── */

function CallLog({
  rows,
  minOne,
  onChange,
}: {
  rows: CallLogRow[];
  minOne: boolean;
  onChange: (rows: CallLogRow[]) => void;
}) {
  // Section 1 always shows at least one (possibly empty) row; blank rows
  // are discarded at send.
  const display: CallLogRow[] = rows.length === 0 && minOne ? [{ ref: "", note: "" }] : rows;

  const setRow = (i: number, patch: Partial<CallLogRow>) => {
    const next = display.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next);
  };
  const delRow = (i: number) => onChange(display.filter((_, idx) => idx !== i));

  return (
    <div className="rounded-lg border bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Phone className="h-3 w-3" /> Call Log
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={() => onChange([...display, { ref: "", note: "" }])}
        >
          <Plus className="h-3 w-3" /> Add Call
        </Button>
      </div>
      {display.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No calls logged.</p>
      )}
      {display.map((row, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input
            value={row.ref}
            onChange={(e) => setRow(i, { ref: e.target.value })}
            placeholder="Ref #"
            className="h-8 text-sm w-32 bg-background"
          />
          <Input
            value={row.note}
            onChange={(e) => setRow(i, { note: e.target.value })}
            placeholder="Call notes…"
            className="h-8 text-sm flex-1 bg-background"
          />
          {(display.length > 1 || !minOne) && (
            <button
              onClick={() => delRow(i)}
              className="p-1 text-muted-foreground hover:text-destructive transition-colors"
              title="Remove row"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
      <p className="text-[10px] text-muted-foreground">
        Rows append to the Monday call-log column on send — history is never overwritten.
      </p>
    </div>
  );
}

/* ── Product card ─────────────────────────────────────────────────── */

function ProductStatusPill({ state }: { state: ProductCodeState | undefined }) {
  if (state?.auth === "required") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
        <ShieldQuestion className="h-3 w-3" /> Auth required
      </span>
    );
  }
  if (state?.auth && sosEntryComplete(state)) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium bg-success/15 text-success">
        <Check className="h-3 w-3" /> Done
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium bg-muted text-muted-foreground">
      <Clock className="h-3 w-3" /> Pending
    </span>
  );
}

function nextOrderOffsetDays(codeId: ProductCodeId, hasMedicaid: boolean): number | null {
  if (codeId === "pump") return 365 * 4;
  if (codeId === "cgm-sensors") return 90;
  if (codeId === "infusion-sets" || codeId === "cartridges") return hasMedicaid ? 60 : 90;
  return null; // cgm-monitor has no next-order column
}

function ProductCard({
  resolved,
  state,
  hasMedicaid,
  todayYmd,
  onChange,
}: {
  resolved: ResolvedProduct;
  state: ProductCodeState | undefined;
  hasMedicaid: boolean;
  todayYmd: string;
  onChange: (patch: Partial<ProductCodeState>) => void;
}) {
  const codeId = PRODUCT_TO_CODE_ID[resolved.product];
  const meta = PRODUCT_CODES.find((c) => c.id === codeId);
  const auth = state?.auth ?? "";
  const authRequired = auth === "required";
  const entry = state?.sosEntry ?? "";
  const isRecurring = meta?.cadence === "RECURRING";

  const cutoff = sosCutoffYmd(codeId, hasMedicaid, todayYmd);
  const lookbackLabel = sosLookbackLabel(codeId, hasMedicaid);
  const offset = nextOrderOffsetDays(codeId, hasMedicaid);
  const nextOrderHint =
    entry === "billed" && state?.lastBillDate && offset
      ? ymdToUs(addDaysYmd(state.lastBillDate, offset))
      : "";

  const setBilled = (patch: { lastBillDate?: string; units?: string }) => {
    const lastBillDate = patch.lastBillDate ?? state?.lastBillDate ?? "";
    const units = patch.units ?? state?.units ?? "";
    onChange({
      ...patch,
      sosEntry: lastBillDate || units ? "billed" : "",
    });
  };

  return (
    <div
      className={cn(
        "rounded-lg border-l-4 border border-border bg-background p-4 space-y-3",
        isRecurring ? "border-l-primary" : "border-l-accent-foreground/40",
      )}
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                isRecurring ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
              )}
            >
              {meta?.cadence ?? ""}
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
              {meta?.group ?? ""}
            </span>
            {resolved.billsTo === "medicaid" && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-200">
                Bills to Medicaid
              </span>
            )}
          </div>
          <p className="text-lg font-bold mt-1">{resolved.hcpc}</p>
          <p className="text-xs text-muted-foreground">{meta?.name ?? PRODUCT_LABELS[resolved.product]}</p>
        </div>
        <ProductStatusPill state={state} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Auth Requirements */}
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Auth Requirements <span className="text-destructive">*</span>
          </label>
          <div className="flex gap-2 mt-1">
            <Button
              size="sm"
              variant={auth === "not-required" ? "default" : "outline"}
              className={cn(
                "h-9 text-xs flex-1",
                auth === "not-required" && "bg-emerald-600 hover:bg-emerald-700 text-white",
              )}
              onClick={() => onChange({ auth: auth === "not-required" ? "" : "not-required" })}
            >
              Not Required
            </Button>
            <Button
              size="sm"
              variant={authRequired ? "default" : "outline"}
              className={cn(
                "h-9 text-xs flex-1",
                authRequired && "bg-amber-500 hover:bg-amber-600 text-white",
              )}
              onClick={() => onChange({ auth: authRequired ? "" : "required" })}
            >
              Required
            </Button>
          </div>
        </div>

        {/* Same or Similar — billing history FACTS (SoS is derived) */}
        <div
          className={cn(
            "rounded-lg border p-3",
            authRequired && "opacity-45 pointer-events-none select-none",
          )}
        >
          <label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
            <History className="h-3 w-3" /> Same or Similar · Billing History{" "}
            <span className="text-destructive">*</span>
          </label>
          <div className="mt-2 flex items-end gap-2 flex-wrap">
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Last Bill Date</p>
              <Input
                type="date"
                value={state?.lastBillDate ?? ""}
                disabled={authRequired || entry === "never"}
                onChange={(e) => setBilled({ lastBillDate: e.target.value })}
                className="h-9 w-40 bg-background"
              />
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Units</p>
              <Input
                type="number"
                min={1}
                step={1}
                value={state?.units ?? ""}
                disabled={authRequired || entry === "never"}
                onChange={(e) => setBilled({ units: e.target.value })}
                className="h-9 w-24 bg-background"
              />
            </div>
            <span className="text-[10px] font-semibold uppercase text-muted-foreground pb-2.5">
              or
            </span>
            <Button
              size="sm"
              variant={entry === "never" ? "default" : "outline"}
              disabled={authRequired}
              className={cn(
                "h-9 text-xs",
                entry === "never" && "bg-emerald-600 hover:bg-emerald-700 text-white",
              )}
              onClick={() =>
                onChange(
                  entry === "never"
                    ? { sosEntry: "" }
                    : { sosEntry: "never", lastBillDate: "", units: "" },
                )
              }
            >
              No Billing History
            </Button>
          </div>
          {authRequired ? (
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Deferred until the auth is resolved.
            </p>
          ) : nextOrderHint ? (
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Next Order Date auto-set to{" "}
              <span className="font-semibold text-foreground">{nextOrderHint}</span>.
            </p>
          ) : (
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              Last bill must be before{" "}
              <span className="font-semibold text-foreground">{ymdToUs(cutoff)}</span>{" "}
              ({lookbackLabel} lookback).
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Monday Board Output drawer (testing aid — delete for production) ─ */

type Tone = "good" | "warn" | "bad" | "skip" | "none";
const TONE_CLASS: Record<Tone, string> = {
  good: "bg-success/15 text-success",
  warn: "bg-warning/20 text-warning-foreground",
  bad: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-200",
  skip: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200",
  none: "bg-muted text-muted-foreground",
};
const GOOD = new Set(["Active/In-network", "Yes", "No Auths Required", "All Clear", "Complete", "Never Billed", "Done"]);
const WARN = new Set(["Stuck", "Partial / No", "Auths Required", "Partial / Not Clear", "Submit Auth.", "Benefits / SoS", "Required"]);
const BAD = new Set(["Escalation Required"]);
const SKIP = new Set(["Skip", "No Auth Needed"]);

function toneFor(v: string): Tone {
  if (GOOD.has(v)) return "good";
  if (BAD.has(v)) return "bad";
  if (SKIP.has(v)) return "skip";
  if (WARN.has(v)) return "warn";
  return "none";
}

function OutputRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1 border-b border-border/40 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-xs font-semibold px-2 py-0.5 rounded select-all",
          TONE_CLASS[toneFor(value)],
        )}
      >
        {value || "—"}
      </span>
    </div>
  );
}

/* ── Main panel ───────────────────────────────────────────────────── */

export function BenefitsPanel({ patient, onUniversalChange, onCodeChange, onCallLogChange }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const ins = patient.insurance ?? EMPTY_INSURANCE;
  const todayYmd = etTodayYmd();
  const hasMedicaid = patientHasMedicaidIns(
    patient.primaryInsurance ?? "",
    patient.secondaryInsurance ?? "",
  );

  const universalCount = Object.values(ins.universal).filter((v) => v === "confirmed").length;

  const resolved = useMemo(
    () =>
      resolveHcpcs(
        patient.primaryInsurance || null,
        patient.serving || null,
        patient.secondaryInsurance ?? null,
      ),
    [patient.primaryInsurance, patient.serving, patient.secondaryInsurance],
  );
  const visibleResolved = resolved.filter((r) => !isAutoFilledMedicaidSupply(r));
  const hiddenMedicaidSupplies = resolved.filter(isAutoFilledMedicaidSupply);
  const dropdownsReady = !!patient.serving && !!patient.primaryInsurance;

  // Medicaid + Insulin Pump serving: the pump always requires auth, so
  // pre-fill Auth = Required (overridable). SoS derives Skip from it —
  // the pump enters the Skip SoS Products dropdown and resurfaces in the
  // Auth Outstanding recheck (decision D5: Clear→Skip change is intended).
  const pumpAuth = ins.codes["pump"]?.auth;
  useEffect(() => {
    if (patient.primaryInsurance !== "Medicaid" || patient.serving !== "Insulin Pump") return;
    if (!pumpAuth) onCodeChange("pump", { auth: "required" });
  }, [patient.primaryInsurance, patient.serving, pumpAuth, onCodeChange]);

  const preview = useMemo(() => deriveBenefitsPreview(patient, todayYmd), [patient, todayYmd]);

  const billedFacts = visibleResolved
    .map((r) => {
      const cid = PRODUCT_TO_CODE_ID[r.product];
      const st = ins.codes[cid];
      if (st?.sosEntry !== "billed" || st.auth === "required" || !st.lastBillDate) return null;
      return { label: PRODUCT_LABELS[r.product], date: st.lastBillDate, units: st.units ?? "" };
    })
    .filter(Boolean) as Array<{ label: string; date: string; units: string }>;

  return (
    <section className="rounded-xl border bg-card p-5 shadow-card space-y-6">
      {/* STEP 1 — Universal checks */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold">Step 1 · Call the Payer · Universal Checks</h2>
            <p className="text-xs text-muted-foreground">
              Confirm each with the payer on the phone. A failed check escalates on send.
            </p>
          </div>
          <span
            className={cn(
              "inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold",
              universalCount === 3 ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
            )}
          >
            {universalCount}/3 confirmed
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {UNIVERSAL_META.map((meta) => (
            <UniversalCheckCard
              key={meta.id}
              meta={meta}
              value={ins.universal[meta.id]}
              onChange={(v) => onUniversalChange(meta.id, v)}
            />
          ))}
        </div>
        <CallLog
          rows={ins.callsUniversal ?? []}
          minOne
          onChange={(rows) => onCallLogChange("callsUniversal", rows)}
        />
      </div>

      {/* STEP 2 — Product-specific SoS & Auth */}
      <div className="space-y-3">
        <div>
          <h2 className="text-base font-semibold">Step 2 · Product-Specific SoS & Auth Requirements</h2>
          <p className="text-xs text-muted-foreground">
            For each product, select Auth Requirements and record billing history.
          </p>
        </div>

        {!dropdownsReady && (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            Serving and Primary Insurance must be set at Profile Send-Off to load this
            patient's codes.
          </div>
        )}

        {dropdownsReady && visibleResolved.length === 0 && hiddenMedicaidSupplies.length > 0 && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 p-6 text-center">
            <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">
              No benefit check needed
            </p>
            <p className="text-xs text-blue-700/80 dark:text-blue-300/80 mt-1">
              Everything this patient is served bills to NY Medicaid. These patients skip the
              benefit check entirely — they go straight to the DVS stage (handled manually on
              Monday until that stage ships).
            </p>
          </div>
        )}

        {dropdownsReady &&
          visibleResolved.map((r) => {
            const cid = PRODUCT_TO_CODE_ID[r.product];
            return (
              <ProductCard
                key={r.product}
                resolved={r}
                state={ins.codes[cid]}
                hasMedicaid={hasMedicaid}
                todayYmd={todayYmd}
                onChange={(patch) => onCodeChange(cid, patch)}
              />
            );
          })}

        {dropdownsReady && visibleResolved.length > 0 && hiddenMedicaidSupplies.length > 0 && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-900 px-4 py-3">
            <p className="text-xs text-blue-800 dark:text-blue-200">
              <span className="font-semibold">Infusion Sets & Cartridges</span> will be handled at
              the DVS stage.
            </p>
          </div>
        )}

        <CallLog
          rows={ins.callsSosAuth ?? []}
          minOne={false}
          onChange={(rows) => onCallLogChange("callsSosAuth", rows)}
        />
      </div>

      {/* Monday Board Output — testing aid, delete for production (spec §8) */}
      <div className="rounded-lg border bg-muted/10">
        <button
          onClick={() => setDrawerOpen((v) => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold flex items-center gap-2">
            {drawerOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Monday Board Output
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Testing aid · show/hide what lands on the board
          </span>
        </button>
        {drawerOpen && (
          <div className="px-4 pb-4 space-y-4">
            <div className="rounded-md border bg-background p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                Main columns
              </p>
              <OutputRow label="Active/Network" value={preview.activeNetwork} />
              <OutputRow label="DME Benefits" value={preview.dmeBenefits} />
              <OutputRow label="Auth" value={preview.auth} />
              <OutputRow label="SoS" value={preview.sos} />
              <OutputRow
                label="Not Clear Products"
                value={preview.notClearProducts.join(", ") || "—"}
              />
              <OutputRow label="Skip SoS Products" value={preview.skipProducts.join(", ") || "—"} />
              <OutputRow label="Stage Advancer" value={preview.stage} />
              <OutputRow label="Escalation" value={preview.escalation} />
              {preview.nextOrder.ip && (
                <OutputRow label="IP Next Order Date" value={ymdToUs(preview.nextOrder.ip)} />
              )}
              {preview.nextOrder.sensors && (
                <OutputRow label="Sensors Next Order Date" value={ymdToUs(preview.nextOrder.sensors)} />
              )}
              {preview.nextOrder.supplies && (
                <OutputRow label="Supplies Next Order Date" value={ymdToUs(preview.nextOrder.supplies)} />
              )}
              {preview.neverBilled.isCar && <OutputRow label="Never billed IS/Car" value="Never Billed" />}
              {preview.neverBilled.cgm && <OutputRow label="Never billed CGM" value="Never Billed" />}
              {preview.neverBilled.pumpDateTbd && (
                <OutputRow label="Medicare Prior Pump Date" value="TBD" />
              )}
              {billedFacts.map((f) => (
                <OutputRow
                  key={f.label}
                  label={`SoS Facts · ${f.label}`}
                  value={`${ymdToUs(f.date)} × ${f.units || "?"}`}
                />
              ))}
              {preview.sos === "—" && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Fill Auth + billing history for every product to compute the Auth and SoS columns.
                </p>
              )}
            </div>
            <div className="rounded-md border bg-background p-3">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                Product-specific auth result columns
              </p>
              <OutputRow label="CGM auth result" value={preview.authResults.monitor} />
              <OutputRow label="Sensors auth result" value={preview.authResults.sensors} />
              <OutputRow label="Insulin pump auth result" value={preview.authResults.insulin_pump} />
              <OutputRow label="Infusion set auth result" value={preview.authResults.infusion_set} />
              <OutputRow label="Cartridges auth result" value={preview.authResults.cartridge} />
            </div>
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <CalendarDays className="h-3 w-3" />
              Derivations are ET-anchored (today = {ymdToUs(todayYmd)}).
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
