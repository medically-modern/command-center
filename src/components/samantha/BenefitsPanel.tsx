/**
 * BenefitsPanel — the redesigned Benefits checklist, using the prototype's
 * exact markup/classes (benefits-redesign.html IS the visual spec; styles
 * in benefitsRedesign.css, scoped under .bnr).
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
 * exactly what each column write will be — delete it when this ships.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, Phone } from "lucide-react";
import { isMedicareABOnly, isMedicarePrimary, medicareJurisdictionPill } from "@/lib/samantha/medicareJurisdiction";
import type {
  CallLogRow,
  Patient,
  ProductCodeId,
  ProductCodeState,
  UniversalChoice,
} from "@/lib/samantha/workflow";
import { EMPTY_INSURANCE, PRODUCT_CODES, isNegUniversal, sensorsNextOrderOffsetDays } from "@/lib/samantha/workflow";
import type { ResolvedProduct } from "@/lib/samantha/hcpcRules";
import {
  isAutoFilledMedicaidSupply,
  PRODUCT_LABELS,
  resolveHcpcs,
} from "@/lib/samantha/hcpcRules";
import {
  addDaysYmd,
  anyUniversalNegative,
  deriveBenefitsPreview,
  etTodayYmd,
  failedUniversalChecks,
  patientHasMedicaidIns,
  sosEntryComplete,
  ymdToUs,
} from "@/lib/samantha/benefitsDerive";
import "./benefitsRedesign.css";

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
  missing: string[];
  onSend: () => Promise<void>;
}

/* ── Step 1 — universal checks ────────────────────────────────────── */

const UNIVERSAL_META: Array<{
  id: "in-network" | "active" | "dme-benefits";
  label: string;
  yes: string;
  no: string;
}> = [
  { id: "in-network", label: "In-Network", yes: "In-Network", no: "Out-of-Network" },
  { id: "active", label: "Insurance Active", yes: "Active", no: "Not Active" },
  { id: "dme-benefits", label: "DME Benefits", yes: "Covered", no: "Not Covered" },
];

/* ── Call log — [Ref #][Call notes][✕] rows, "+ Add Call" ─────────── */

function CallLog({
  rows,
  minOne,
  onChange,
}: {
  rows: CallLogRow[];
  minOne: boolean;
  onChange: (rows: CallLogRow[]) => void;
}) {
  // Section 1 always shows at least one (possibly empty) row; fully-blank
  // rows are discarded at send.
  const display: CallLogRow[] = rows.length === 0 && minOne ? [{ ref: "", note: "" }] : rows;
  const min = minOne ? 1 : 0;

  const setRow = (i: number, patch: Partial<CallLogRow>) =>
    onChange(display.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="call-log">
      <div className="cl-head">Call Log</div>
      {display.map((row, i) => (
        <div className="cl-row" key={i}>
          <input
            type="text"
            className="cl-ref"
            placeholder="Ref #"
            value={row.ref}
            onChange={(e) => setRow(i, { ref: e.target.value })}
          />
          <input
            type="text"
            placeholder="Call notes…"
            value={row.note}
            onChange={(e) => setRow(i, { note: e.target.value })}
          />
          {display.length > min ? (
            <button
              className="cl-del"
              title="Remove call"
              onClick={() => onChange(display.filter((_, idx) => idx !== i))}
            >
              ✕
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}
      <button className="cl-add" onClick={() => onChange([...display, { ref: "", note: "" }])}>
        + Add Call
      </button>
    </div>
  );
}

/* ── Step 2 — product card ────────────────────────────────────────── */

/** Rep-facing status — never exposes derived Clear/Not Clear. */
function statusPill(state: ProductCodeState | undefined) {
  if (!state?.auth || !sosEntryComplete(state)) return <span className="pill pending">● Pending</span>;
  if (state.auth === "required") return <span className="pill warn">◷ Auth required</span>;
  return <span className="pill clear">✓ Done</span>;
}

function nextOrderOffsetDays(
  codeId: ProductCodeId,
  hasMedicaid: boolean,
  units?: string,
  isMedicare = false,
): number | null {
  if (codeId === "pump") return isMedicare ? 365 * 5 : 365 * 4; // RUL: 5 yr Medicare, else 4
  if (codeId === "cgm-sensors") return sensorsNextOrderOffsetDays(units); // A4239: 30/60 for 1/2 units, else 90
  if (codeId === "infusion-sets" || codeId === "cartridges") return hasMedicaid ? 60 : 90;
  return null; // cgm-monitor has no next-order column
}

function ProductCard({
  resolved,
  state,
  hasMedicaid,
  isMedicare,
  onChange,
}: {
  resolved: ResolvedProduct;
  state: ProductCodeState | undefined;
  hasMedicaid: boolean;
  isMedicare: boolean;
  onChange: (patch: Partial<ProductCodeState>) => void;
}) {
  const codeId = PRODUCT_TO_CODE_ID[resolved.product];
  const meta = PRODUCT_CODES.find((c) => c.id === codeId);
  const auth = state?.auth ?? "";
  const authReq = auth === "required";
  const entry = state?.sosEntry ?? "";
  const entryLocked = entry === "never";
  const isRec = meta?.cadence === "RECURRING";

  const offset = nextOrderOffsetDays(codeId, hasMedicaid, state?.units, isMedicare);
  const nextOrder =
    entry === "billed" && state?.lastBillDate && offset
      ? addDaysYmd(state.lastBillDate, offset)
      : "";

  const setBilled = (patch: { lastBillDate?: string; units?: string }) => {
    const lastBillDate = patch.lastBillDate ?? state?.lastBillDate ?? "";
    const units = patch.units ?? state?.units ?? "";
    onChange({ ...patch, sosEntry: lastBillDate || units ? "billed" : "" });
  };

  return (
    <div className={`prod-card ${isRec ? "recurring" : ""}`}>
      <div className="prod-top">
        <div style={{ minWidth: 0 }}>
          <div className="prod-meta">
            <span className={`chip ${isRec ? "rec" : "one"}`}>{meta?.cadence ?? ""}</span>
            <span className="chip grp">{meta?.group ?? ""}</span>
            {resolved.billsTo === "medicaid" && <span className="chip mcd">Bills to Medicaid</span>}
          </div>
          <div className="prod-code">{resolved.hcpc}</div>
          <div className="prod-name">{meta?.name ?? PRODUCT_LABELS[resolved.product]}</div>
        </div>
        {statusPill(state)}
      </div>
      <div className="prod-grid">
        <div className="prod-q">
          <div className="flabel">
            Auth Requirements <span className="req-star">*</span>
          </div>
          <div className="seg" role="radiogroup" aria-label={`${resolved.hcpc} auth requirements`}>
            <button
              className={`g ${auth === "not-required" ? "sel-g" : ""}`}
              role="radio"
              aria-checked={auth === "not-required"}
              onClick={() => onChange({ auth: auth === "not-required" ? "" : "not-required" })}
            >
              Not Required
            </button>
            <button
              className={`a ${authReq ? "sel-a" : ""}`}
              role="radio"
              aria-checked={authReq}
              onClick={() => onChange({ auth: authReq ? "" : "required" })}
            >
              Required
            </button>
          </div>
        </div>
        <div className={`prod-q ${authReq ? "off" : ""}`}>
          <div className="flabel">
            Same or Similar · Billing History {!authReq && <span className="req-star">*</span>}
          </div>
          <div className="sos-grid">
            <div className={`sos-pair ${entryLocked ? "locked" : ""}`}>
              <div>
                <div className="slab">Last Bill Date</div>
                <input
                  type="date"
                  value={state?.lastBillDate ?? ""}
                  disabled={entryLocked || authReq}
                  onChange={(e) => setBilled({ lastBillDate: e.target.value })}
                />
              </div>
              <div>
                <div className="slab">Units</div>
                <input
                  type="number"
                  min={1}
                  step={1}
                  placeholder="0"
                  value={state?.units ?? ""}
                  disabled={entryLocked || authReq}
                  onChange={(e) => setBilled({ units: e.target.value })}
                />
              </div>
            </div>
            <div className="sos-or">OR</div>
            <button
              className={`sos-toggle nv ${entry === "never" ? "on" : ""}`}
              disabled={authReq}
              onClick={() =>
                onChange(
                  entry === "never"
                    ? { sosEntry: "" }
                    : { sosEntry: "never", lastBillDate: "", units: "" },
                )
              }
            >
              No Billing History
            </button>
          </div>
          {authReq && <div className="fhint">Deferred until the auth is resolved.</div>}
          {!authReq && nextOrder && (
            <div className="fhint">
              Next Order Date auto-set to{" "}
              <b style={{ color: "var(--bnr-foreground)" }}>{ymdToUs(nextOrder)}</b>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Monday Board Output drawer ───────────────────────────────────── */

const GOOD = new Set(["In-Network", "Active", "Yes", "No Auths Required", "All Clear", "Complete", "Never Billed", "Done", "Not Serving"]);
const WARN = new Set(["Out-of-Network", "Inactive", "Partial / No", "Auths Required", "Partial / Not Clear", "Submit Auth.", "Benefits / SoS", "Required"]);
const BAD = new Set(["Manager Escalation Required", "Final Escalation Required"]);
const SKIP = new Set(["Skip", "No Auth Needed"]);

function mvalClass(v: string): string {
  if (BAD.has(v)) return "mval bad";
  if (GOOD.has(v)) return "mval good";
  if (SKIP.has(v)) return "mval skip";
  if (WARN.has(v)) return "mval warn";
  return "mval neutral";
}

function MonRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mon-row">
      <span className="mlabel">{label}</span>
      <span className={mvalClass(value)}>{value || "—"}</span>
    </div>
  );
}

/* ── Main panel ───────────────────────────────────────────────────── */

export function BenefitsPanel({
  patient,
  onUniversalChange,
  onCodeChange,
  onCallLogChange,
  missing,
  onSend,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sendState, setSendState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const ins = patient.insurance ?? EMPTY_INSURANCE;
  const todayYmd = etTodayYmd();
  const hasMedicaid = patientHasMedicaidIns(
    patient.primaryInsurance ?? "",
    patient.secondaryInsurance ?? "",
  );

  const universalCount = Object.values(ins.universal).filter((v) => v === "confirmed").length;
  const universalDone = universalCount === 3;

  // Any negative check (Out-of-Network / Medicare not Primary / Not Active /
  // Not Covered): step 2 gates off, submission opens up, sending escalates
  // (Medicare-not-Primary handoff §2–§3).
  const gated = anyUniversalNegative(ins);

  // Medicare A&B only (traditional, no secondary): Check 1 gains a third
  // answer — "Medicare not Primary" — and the MAC-jurisdiction pill shows in
  // the step-1 header when the address state maps. (The old HMO/MSP/Inpatient
  // hazard bullets are gone — replaced by the third answer, handoff §1.)
  const showMedicareAB = isMedicareABOnly(
    patient.primaryInsurance ?? "",
    patient.secondaryInsurance ?? "",
  );
  const macPill = medicareJurisdictionPill(
    patient.primaryInsurance ?? "",
    patient.secondaryInsurance ?? "",
    patient.patientAddress ?? "",
  );

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
  const ready = !!patient.serving && !!patient.primaryInsurance;
  const step2Done =
    ready &&
    visibleResolved.length > 0 &&
    visibleResolved.every((r) => {
      const st = ins.codes[PRODUCT_TO_CODE_ID[r.product]];
      return !!st?.auth && sosEntryComplete(st);
    });

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
      if (st?.auth === "required") return null; // facts deferred while auth pending
      if (st?.sosEntry === "billed" && st.lastBillDate) {
        return { label: PRODUCT_LABELS[r.product], value: `${ymdToUs(st.lastBillDate)} × ${st.units || "?"}` };
      }
      if (st?.sosEntry === "never") {
        return { label: PRODUCT_LABELS[r.product], value: "No Billing History ✓" };
      }
      return null;
    })
    .filter(Boolean) as Array<{ label: string; value: string }>;

  const handleSend = async () => {
    if (sendState === "sending" || missing.length > 0) return;
    setSendState("sending");
    try {
      await onSend();
      setSendState("success");
      setTimeout(() => setSendState("idle"), 2200);
    } catch {
      setSendState("error");
      setTimeout(() => setSendState("idle"), 2600);
    }
  };

  return (
    <>
      {/* ============ step 1 — universal checks ============ */}
      <section className="card step-card">
        <header className="step-head">
          <span className={`step-num ${universalDone ? "done" : ""}`}>
            {universalDone ? "✓" : "1"}
          </span>
          <h2>Call the Payer · Universal Checks</h2>
          {macPill && (
            <span
              className="jur-chip"
              title={`Medicare A&B MAC jurisdiction for ${macPill.state} — ${macPill.contractor}. Fee schedules + portals differ per jurisdiction.`}
            >
              JURISDICTION {macPill.jurisdiction} · {macPill.state}
            </span>
          )}
          <span className={`step-chip ${universalDone ? "ok" : ""}`}>
            {universalCount}/3 confirmed
          </span>
        </header>
        <div className="uc-grid" style={{ marginTop: 14 }}>
          {UNIVERSAL_META.map((meta, i) => {
            const v = ins.universal[meta.id];
            // Medicare A&B only: In-Network gets a third answer — "Medicare
            // not Primary" — rendered 3-across; it behaves exactly like
            // Out-of-Network downstream (handoff §1).
            const medNP = meta.id === "in-network" && showMedicareAB;
            return (
              <div
                key={meta.id}
                className={`subcard ${v === "confirmed" ? "ok" : isNegUniversal(v) ? "bad" : ""}`}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <Phone size={18} style={{ color: "var(--mm-teal)", flexShrink: 0 }} />
                  <div>
                    <div className="uc-tag">CHECK 0{i + 1}</div>
                    <div className="uc-title">{meta.label}</div>
                  </div>
                </div>
                <div className={`seg ${medNP ? "seg-3" : ""}`} role="radiogroup" aria-label={meta.label}>
                  <button
                    className={`g ${v === "confirmed" ? "sel-g" : ""}`}
                    role="radio"
                    aria-checked={v === "confirmed"}
                    onClick={() => onUniversalChange(meta.id, v === "confirmed" ? "" : "confirmed")}
                  >
                    {meta.yes}
                  </button>
                  <button
                    className={`r ${v === "not-confirmed" ? "sel-r" : ""}`}
                    role="radio"
                    aria-checked={v === "not-confirmed"}
                    onClick={() =>
                      onUniversalChange(meta.id, v === "not-confirmed" ? "" : "not-confirmed")
                    }
                  >
                    {meta.no}
                  </button>
                  {medNP && (
                    <button
                      className={`r ${v === "medicare-not-primary" ? "sel-r" : ""}`}
                      role="radio"
                      aria-checked={v === "medicare-not-primary"}
                      onClick={() =>
                        onUniversalChange(
                          meta.id,
                          v === "medicare-not-primary" ? "" : "medicare-not-primary",
                        )
                      }
                    >
                      Medicare not Primary
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <CallLog
          rows={ins.callsUniversal ?? []}
          minOne
          onChange={(rows) => onCallLogChange("callsUniversal", rows)}
        />
      </section>

      {/* ============ step 2 — product cards ============ */}
      <section className="card step-card">
        <header className="step-head">
          <span className={`step-num ${step2Done ? "done" : ""}`}>{step2Done ? "✓" : "2"}</span>
          <h2>Product-Specific SoS &amp; Auth Requirements</h2>
        </header>
        <p className="step-sub">For each product, select Auth Requirements and record billing history.</p>

        {!ready && (
          <div className="empty-box">
            <p>Serving and Primary Insurance must be set at Profile Send-Off to load this patient's codes.</p>
          </div>
        )}

        {ready && visibleResolved.length === 0 && hiddenMedicaidSupplies.length > 0 && (
          <div className="empty-box">
            <p>No benefit check needed</p>
            <p className="sub">
              Everything this patient is served bills to NY Medicaid. These patients skip the
              benefit check entirely — they go straight to the DVS stage (handled manually on
              Monday until that stage ships).
            </p>
          </div>
        )}

        {ready && visibleResolved.length > 0 && (
          <>
            {gated && (
              <div className="gate-note">
                <AlertTriangle size={20} strokeWidth={2} />
                <span>
                  <b>{failedUniversalChecks(ins).join(" · ")}.</b> Submit below to escalate patient
                </span>
              </div>
            )}
            <div className={gated ? "step-gated" : undefined}>
              <div className="prod-list">
                {visibleResolved.map((r) => (
                  <ProductCard
                    key={r.product}
                    resolved={r}
                    state={ins.codes[PRODUCT_TO_CODE_ID[r.product]]}
                    hasMedicaid={hasMedicaid}
                    isMedicare={isMedicarePrimary(patient.primaryInsurance ?? "")}
                    onChange={(patch) => onCodeChange(PRODUCT_TO_CODE_ID[r.product], patch)}
                  />
                ))}
              </div>
              {hiddenMedicaidSupplies.length > 0 && (
                <div className="dvs-note">
                  <span>
                    <b>{hiddenMedicaidSupplies.map((r) => PRODUCT_LABELS[r.product]).join(" & ")}</b>{" "}
                    will be handled at the DVS stage.
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        <div className={gated ? "step-gated" : undefined}>
          <CallLog
            rows={ins.callsSosAuth ?? []}
            minOne={false}
            onChange={(rows) => onCallLogChange("callsSosAuth", rows)}
          />
        </div>
      </section>

      {/* ============ monday output + actions ============ */}
      <section className="card" style={{ borderLeft: "4px solid var(--mm-teal)" }}>
        <button
          type="button"
          className={`mon-toggle ${drawerOpen ? "open" : ""}`}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <h2 style={{ color: "var(--mm-teal)" }}>Monday Board Output</h2>
          <span className="mon-toggle-hint">Show/Hide what lands on the board</span>
          <ChevronDown size={18} />
        </button>

        {drawerOpen && (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="mon-box">
              <h3>Main columns</h3>
              <p className="msub">Each column on the Monday board gets the value below.</p>
              <div className="mon-rows">
                <MonRow label="In-Network?" value={preview.inNetwork} />
                <MonRow label="Active?" value={preview.active} />
                <MonRow label="DME Benefits" value={preview.dmeBenefits} />
                <MonRow label="Auth" value={preview.auth} />
                <MonRow label="SoS" value={preview.sos} />
                <MonRow label="Not Clear Products" value={preview.notClearProducts.join(", ") || "—"} />
                <MonRow label="Skip SoS Products" value={preview.skipProducts.join(", ") || "—"} />
                <MonRow label="Stage Advancer" value={preview.stage} />
                <MonRow label="Escalation" value={preview.escalation} />
                {preview.nextOrder.ip && (
                  <MonRow label="IP Next Order Date" value={ymdToUs(preview.nextOrder.ip)} />
                )}
                {preview.nextOrder.sensors && (
                  <MonRow label="Sensors Next Order Date" value={ymdToUs(preview.nextOrder.sensors)} />
                )}
                {preview.nextOrder.supplies && (
                  <MonRow label="Supplies Next Order Date" value={ymdToUs(preview.nextOrder.supplies)} />
                )}
                {preview.neverBilled.isCar && <MonRow label="Never billed IS/Car" value="Never Billed" />}
                {preview.neverBilled.cgm && <MonRow label="Never billed CGM" value="Never Billed" />}
                {preview.neverBilled.pumpDateTbd && (
                  <MonRow label="Medicare Prior Pump Date" value="TBD" />
                )}
                {!gated &&
                  billedFacts.map((f) => (
                    <MonRow key={f.label} label={`SoS Facts · ${f.label}`} value={f.value} />
                  ))}
              </div>
              {preview.sos === "—" && !gated && (
                <p className="mon-note">
                  Fill Auth + billing history for every product to compute the Auth and SoS columns.
                </p>
              )}
              {gated && (
                <p className="mon-note">
                  A universal check failed — step 2 skipped; submitting sets Escalation Required.
                </p>
              )}
            </div>

            <div className="mon-box">
              <h3>Product-specific auth result columns</h3>
              <p className="msub">
                Required / No Auth Needed / Not Serving — untouched when a universal check fails.
              </p>
              <div className="mon-rows">
                <MonRow label="CGM auth result" value={preview.authResults.monitor} />
                <MonRow label="Sensors auth result" value={preview.authResults.sensors} />
                <MonRow label="Insulin pump auth result" value={preview.authResults.insulin_pump} />
                <MonRow label="Infusion set auth result" value={preview.authResults.infusion_set} />
                <MonRow label="Cartridges auth result" value={preview.authResults.cartridge} />
              </div>
              <p className="mon-note">
                Testing aid — verify backend output against this drawer, then delete it for
                production (spec §8). Derivations are ET-anchored (today = {ymdToUs(todayYmd)}).
              </p>
            </div>
          </div>
        )}

        <div className="foot-actions">
          <button
            className={`send-btn ${sendState === "error" ? "err" : ""}`}
            disabled={missing.length > 0 || sendState === "sending"}
            onClick={handleSend}
          >
            {sendState === "sending"
              ? "Sending to Monday…"
              : sendState === "success"
                ? gated
                  ? "✓ Submitted — escalation required"
                  : "✓ Benefit check complete — sent"
                : sendState === "error"
                  ? "Send failed — click to retry"
                  : gated
                    ? "Submit — Escalation Required"
                    : "Benefit Check Complete"}
          </button>
        </div>
        {missing.length > 0 && (
          <div className="missing-box">
            <div className="mb-title">Missing before send</div>
            <div className="mb-list">{missing.join(" · ")}</div>
          </div>
        )}
      </section>
    </>
  );
}
