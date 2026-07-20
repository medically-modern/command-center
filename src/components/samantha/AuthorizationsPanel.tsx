/**
 * AuthorizationsPanel — the redesigned Submit Auth checklist, using the
 * prototype's exact markup/classes (submit-auth-redesign.html IS the visual
 * spec; HANDOFF-Josh-Submit-Auth.md is the behavior doc). Styles live in
 * benefitsRedesign.css (shared base) + submitAuthRedesign.css, scoped .bnr.
 *
 * One step — "(1) Submit Auth for Each Required Product" — one card per
 * product whose BOARD auth status is Required and that isn't DVS-routed.
 * The "Auth Status by Product" matrix above it is read-only context, not a
 * step (Required = amber · resolved = grayed · Not Serving = faded · DVS
 * Required = blue). SoS lives at Benefits / rechecks at Auth Outstanding —
 * no SoS UI here (handoff §3). Card headline shows HCPC · modifiers
 * (payer-keyed route tables, handoff §4). MLTC plans get an amber
 * fax-only banner off the Stedi Plan Name column (§5, tip only). BCBS
 * home ≠ host shows the home-plan banner (§8, no phone directory yet).
 *
 * The "Monday Board Output" drawer is a TESTING AID (§9): verify writes,
 * then delete the drawer — but keep the Escalate + send buttons below it.
 */
import { useState } from "react";
import { AlertTriangle, Info } from "lucide-react";
import type {
  Patient,
  ProductCodeId,
  ProductCodeState,
} from "@/lib/samantha/workflow";
import { EMPTY_INSURANCE, PRODUCT_CODES } from "@/lib/samantha/workflow";
import type { AuthSubmissionMethod } from "@/lib/samantha/workflow";
import {
  isAutoFilledMedicaidSupply,
  PRODUCT_LABELS,
  resolveHcpcs,
  type ProductId,
  type ResolvedProduct,
} from "@/lib/samantha/hcpcRules";
import {
  authHomePlan,
  dvsRoutedProducts,
  isMltcPlan,
  modifiersFor,
  productCodeId,
  submitAuthCards,
} from "@/lib/samantha/submitAuthRules";
import { etTodayYmd, ymdToUs } from "@/lib/samantha/benefitsDerive";
import { Repeat, Package } from "lucide-react";
import "./benefitsRedesign.css";
import "./submitAuthRedesign.css";

/** Segmented-control display order (prototype); same set as AUTH_SUBMISSION_METHODS. */
const METHOD_ORDER: Exclude<AuthSubmissionMethod, "">[] = [
  "Availity Portal",
  "Payer Portal",
  "Call",
  "Fax",
];

const ALL_PRODUCTS: ProductId[] = ["monitor", "sensors", "insulin_pump", "infusion_set", "cartridge"];
/** Fixed HCPCs for products with no payer variance (matrix fallback when unserved). */
const FIXED_HCPC: Partial<Record<ProductId, string>> = {
  monitor: "E2103",
  sensors: "A4239",
  insulin_pump: "E0784",
};

interface Props {
  patient: Patient;
  onCodeChange: (codeId: ProductCodeId, patch: Partial<ProductCodeState>) => void;
  /** Mirrors the shared Carecentrix Intake ID onto the patient-level field.
   *  The write path prefers `p.carecentrixIntakeId` over per-code values, so
   *  an edit that only touched the codes would lose to a stale hydrated
   *  profile value — keep both in sync. */
  onIntakeIdChange: (value: string) => void;
  missing: string[];
  onSend: () => Promise<void>;
}

function cardComplete(state: ProductCodeState | undefined): boolean {
  const method = state?.authSubmissionMethod ?? "";
  if (!method || !state?.authSubmissionDate) return false;
  if ((method === "Call" || method === "Fax") && !(state?.callFaxNumber ?? "").trim()) return false;
  return true;
}

function joinNames(list: ResolvedProduct[]): string {
  const n = list.map((r) => PRODUCT_LABELS[r.product]);
  return n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} & ${n[n.length - 1]}`;
}

/* ── Auth Status by Product — read-only context matrix ────────────── */

function AuthStatusMatrix({ patient }: { patient: Patient }) {
  const ins = patient.insurance ?? EMPTY_INSURANCE;
  const resolved = resolveHcpcs(
    patient.primaryInsurance || null,
    patient.serving || null,
    patient.secondaryInsurance ?? null,
  );
  const byProduct = new Map(resolved.map((r) => [r.product, r]));
  const dvsSet = new Set(resolved.filter(isAutoFilledMedicaidSupply).map((r) => r.product));

  return (
    <div className="mtx-grid">
      {ALL_PRODUCTS.map((p) => {
        const r = byProduct.get(p);
        const isDvs = dvsSet.has(p);
        const boardLabel = r ? (ins.codes[productCodeId(p)]?._mondayAuthLabel ?? "").trim() : "";
        const label = !r ? "Not Serving" : isDvs ? "DVS Required" : boardLabel || "—";
        const lower = label.toLowerCase();
        const cls = !r
          ? "na"
          : isDvs
            ? "dvs"
            : lower === "required"
              ? "req"
              : lower === "not serving" || label === "—"
                ? "na"
                : "ok"; // No Auth Needed / Submitted / resolved → grayed, no action
        const pillCls = cls === "req" || cls === "dvs" ? cls : cls === "na" ? "na" : "ok";
        return (
          <div key={p} className={`mtx-cell ${cls}`}>
            <div>
              <div className="mtx-code">{r?.hcpc ?? FIXED_HCPC[p] ?? "—"}</div>
              <div className="mtx-name">{PRODUCT_LABELS[p]}</div>
            </div>
            <span className={`mtx-pill ${pillCls}`}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Submission card ──────────────────────────────────────────────── */

function SubmissionCard({
  resolved,
  state,
  primaryInsurance,
  sharedIntakeId,
  onChange,
  onSharedIntakeIdChange,
}: {
  resolved: ResolvedProduct;
  state: ProductCodeState | undefined;
  primaryInsurance: string;
  sharedIntakeId: string;
  onChange: (patch: Partial<ProductCodeState>) => void;
  onSharedIntakeIdChange: (value: string) => void;
}) {
  const codeId = productCodeId(resolved.product);
  const meta = PRODUCT_CODES.find((c) => c.id === codeId);
  const isRec = meta?.cadence === "RECURRING";
  const method = state?.authSubmissionMethod ?? "";
  const isCallFax = method === "Call" || method === "Fax";
  const mods = modifiersFor(resolved.hcpc, primaryInsurance);
  const showIntake = primaryInsurance === "Horizon BCBS" && method === "Payer Portal";

  const setMethod = (m: Exclude<AuthSubmissionMethod, "">) => {
    if (method === m) {
      onChange({ authSubmissionMethod: "", callFaxNumber: "" });
    } else if (m === "Call" || m === "Fax") {
      onChange({ authSubmissionMethod: m });
    } else {
      onChange({ authSubmissionMethod: m, callFaxNumber: "" });
    }
  };

  return (
    <div className={`prod-card ${isRec ? "recurring" : ""}`}>
      <div className="prod-top">
        <div style={{ minWidth: 0 }}>
          <div className="prod-meta">
            <span className={`chip ${isRec ? "rec" : "one"}`}>
              {isRec ? <Repeat size={12} /> : <Package size={12} />} {meta?.cadence ?? ""}
            </span>
            <span className="chip grp">{meta?.group ?? ""}</span>
          </div>
          <div className="prod-code-row">
            <span className="prod-code">{resolved.hcpc}</span>
            {mods && (
              <>
                <span className="mod-dot">·</span>
                {mods.mods.map((m) => (
                  <span key={m} className="mod-chip" title={`Modifier source: ${mods.source}`}>
                    {m}
                  </span>
                ))}
              </>
            )}
          </div>
          <div className="prod-name">{meta?.name ?? PRODUCT_LABELS[resolved.product]}</div>
        </div>
        {cardComplete(state) ? (
          <span className="pill clear">✓ Submitted</span>
        ) : (
          <span className="pill pending">● Pending</span>
        )}
      </div>

      <div className="sa-body">
        <div className="flabel">
          Auth Submission Method <span className="req-star">*</span>
        </div>
        <div className="method-seg" role="radiogroup" aria-label={`${resolved.hcpc} submission method`}>
          {METHOD_ORDER.map((m) => (
            <button
              key={m}
              className={method === m ? "on" : ""}
              role="radio"
              aria-checked={method === m}
              onClick={() => setMethod(m)}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="sa-fields">
          {isCallFax && (
            <div>
              <div className="flabel">
                {method} Number <span className="req-star">*</span>
              </div>
              <input
                type="text"
                className="mono"
                placeholder="e.g. (555) 123-4567"
                value={state?.callFaxNumber ?? ""}
                onChange={(e) => onChange({ callFaxNumber: e.target.value })}
              />
            </div>
          )}
          <div>
            <div className="flabel">
              Auth Submission Date <span className="req-star">*</span>
            </div>
            <input
              type="date"
              value={state?.authSubmissionDate ?? ""}
              onChange={(e) => onChange({ authSubmissionDate: e.target.value })}
            />
          </div>
          <div>
            <div className="flabel">Auth ID</div>
            <input
              type="text"
              className="mono"
              placeholder="e.g. 123456"
              value={state?.authId ?? ""}
              onChange={(e) => onChange({ authId: e.target.value })}
            />
            <div className="fhint">Leave blank if the payer hasn't issued one yet.</div>
          </div>
        </div>

        {showIntake && (
          <div className="intake-box">
            <div className="flabel">Intake ID · Carecentrix</div>
            <input
              type="text"
              placeholder="e.g. INTAKE-789"
              value={sharedIntakeId}
              onChange={(e) => onSharedIntakeIdChange(e.target.value)}
            />
            <div className="fhint">Shared across all products — only one Intake ID per patient.</div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Monday Board Output drawer row ───────────────────────────────── */

function MonRow({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="mon-row">
      <span className="mlabel">{label}</span>
      <span className={`mval ${tone}`}>{value || "—"}</span>
    </div>
  );
}

/* ── Main panel ───────────────────────────────────────────────────── */

export function AuthorizationsPanel({
  patient,
  onCodeChange,
  onIntakeIdChange,
  missing,
  onSend,
}: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sendState, setSendState] = useState<"idle" | "sending" | "success" | "error">("idle");
  const ins = patient.insurance ?? EMPTY_INSURANCE;
  const primaryInsurance = patient.primaryInsurance || "";
  const ready = !!patient.serving && !!primaryInsurance;
  const todayYmd = etTodayYmd();

  const cards = submitAuthCards(patient);
  const dvsRouted = dvsRoutedProducts(patient);
  const isCarecentrix = (patient.referralSource || "").toLowerCase().includes("carecentrix");
  const mltc = isMltcPlan(patient.planName);
  const homePlan = authHomePlan(patient);
  const allComplete =
    cards.length > 0 && cards.every((r) => cardComplete(ins.codes[productCodeId(r.product)]));

  // Carecentrix Intake ID is shared across all card products — one per
  // patient. Display prefers the freshest per-code value, falling back to
  // the hydrated patient-level field (the board's single shared column);
  // edits fan out to every card AND the patient-level field so the write
  // path (which prefers p.carecentrixIntakeId) sends what the rep typed.
  const sharedIntakeId =
    cards.map((r) => ins.codes[productCodeId(r.product)]?.intakeId).find((v) => !!v) ??
    patient.carecentrixIntakeId ??
    "";
  const setIntakeIdForAll = (value: string) => {
    for (const r of cards) onCodeChange(productCodeId(r.product), { intakeId: value });
    onIntakeIdChange(value);
  };

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

  const callFaxEntry = cards
    .map((r) => ins.codes[productCodeId(r.product)])
    .find(
      (s) =>
        (s?.authSubmissionMethod === "Call" || s?.authSubmissionMethod === "Fax") &&
        (s?.callFaxNumber ?? "").trim(),
    );

  return (
    <>
      {/* carecentrix modifier warning (conditional) */}
      {isCarecentrix && (
        <div className="ccx-card">
          <div className="ccx-row">
            <AlertTriangle size={18} />
            <span className="ccx-title">
              Carecentrix referral — submit each auth with the modifiers shown on its card below.
            </span>
          </div>
        </div>
      )}

      {/* context — auth status from monday (read-only, not a step) */}
      <section className="card">
        <header className="step-head">
          <h2 className="ctx-title">Auth Status by Product</h2>
        </header>
        {!ready ? (
          <div className="empty-box" style={{ marginTop: 14 }}>
            <p>Serving and Primary Insurance must be set at Profile Send-Off to load this patient's codes.</p>
          </div>
        ) : (
          <AuthStatusMatrix patient={patient} />
        )}
      </section>

      {/* the one step — submit auth per required product */}
      <section className="card step-card">
        <header className="step-head">
          <span className={`step-num ${allComplete ? "done" : ""}`}>{allComplete ? "✓" : "1"}</span>
          <h2>Submit Auth for Each Required Product</h2>
        </header>

        {ready && (
          <>
            {mltc && (
              <div className="ccx-card tight" style={{ marginTop: 14 }}>
                <div className="ccx-row">
                  <AlertTriangle size={18} />
                  <span className="ccx-title">
                    MLTC plan — <b>{patient.planName}</b> on the Stedi check — all auths submitted
                    via <b>fax</b> only.
                  </span>
                </div>
              </div>
            )}

            {cards.length === 0 ? (
              <>
                <div className="empty-box" style={{ marginTop: 14 }}>
                  <p>No auths to submit</p>
                  <p className="sub">
                    {dvsRouted.length > 0
                      ? "Everything bills to NY Medicaid — DVS happens at the next stage."
                      : "No product on this patient is marked Required on the board."}
                  </p>
                </div>
                {dvsRouted.length > 0 && (
                  <div className="dvs-note">
                    <Info size={20} />
                    <span>
                      <b>{joinNames(dvsRouted)}</b> {dvsRouted.length === 1 ? "bills" : "bill"} to NY
                      Medicaid. Submit DVS at the DVS stage — nothing to submit here.
                    </span>
                  </div>
                )}
              </>
            ) : (
              <>
                {homePlan && (
                  <div className="homeplan-note" style={{ marginTop: 14 }}>
                    <Info size={20} />
                    <span>
                      Auths go through the member's <b>home plan — {homePlan.home}</b> — not{" "}
                      {homePlan.host}, the host plan we bill.
                    </span>
                  </div>
                )}
                <div className="prod-list" style={{ marginTop: homePlan || mltc ? 0 : 14 }}>
                  {cards.map((r) => (
                    <SubmissionCard
                      key={r.product}
                      resolved={r}
                      state={ins.codes[productCodeId(r.product)]}
                      primaryInsurance={primaryInsurance}
                      sharedIntakeId={sharedIntakeId}
                      onChange={(patch) => onCodeChange(productCodeId(r.product), patch)}
                      onSharedIntakeIdChange={setIntakeIdForAll}
                    />
                  ))}
                </div>
                {dvsRouted.length > 0 && (
                  <div className="dvs-note">
                    <Info size={20} />
                    <span>
                      <b>{joinNames(dvsRouted)}</b> {dvsRouted.length === 1 ? "bills" : "bill"} to NY
                      Medicaid. Submit DVS at the next stage once the pump is approved.
                    </span>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {!ready && (
          <div className="empty-box" style={{ marginTop: 14 }}>
            <p>Serving and Primary Insurance must be set at Profile Send-Off to load this patient's codes.</p>
          </div>
        )}
      </section>

      {/* monday output + actions */}
      <section className="card" style={{ borderLeft: "4px solid var(--mm-teal)" }}>
        <button
          type="button"
          className={`mon-toggle ${drawerOpen ? "open" : ""}`}
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <h2 style={{ color: "var(--mm-teal)" }}>Monday Board Output</h2>
          <span className="mon-toggle-hint">Show/Hide what lands on the board</span>
          <ChevronIcon open={drawerOpen} />
        </button>

        {drawerOpen && (
          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="mon-box">
              <h3>Main columns</h3>
              <p className="msub">
                One write each per send. Follow Up Date is stamped <b>today</b> so the patient lands
                in tomorrow-or-sooner's Auth Outstanding bucket. Escalation carries the patient's
                existing flag — Submit Auth has no escalation controls or auto-rules.
              </p>
              <div className="mon-rows">
                <MonRow label="Stage Advancer" value="Auth. Outstanding" tone="warn" />
                <MonRow
                  label="Follow Up Date · date_mm34m2dz"
                  value={`${ymdToUs(todayYmd)} — today (same-day)`}
                  tone="good"
                />
                <MonRow
                  label="Escalation"
                  value={patient.escalated ? "Escalation Required" : "Done"}
                  tone={patient.escalated ? "bad" : "good"}
                />
                {callFaxEntry && (
                  <MonRow label="Call/Fax Number" value={callFaxEntry.callFaxNumber ?? ""} tone="neutral" />
                )}
                {sharedIntakeId && (
                  <MonRow label="Carecentrix Intake ID" value={sharedIntakeId} tone="neutral" />
                )}
              </div>
            </div>

            <div className="mon-box">
              <h3>Per-product columns</h3>
              <p className="msub">
                Auth results flip to Submitted; method, date and ID land in their per-product
                columns.
              </p>
              <div className="mon-rows">
                {cards.map((r) => {
                  const s = ins.codes[productCodeId(r.product)];
                  return (
                    <div key={r.product} style={{ display: "contents" }}>
                      <div className="mon-row grp-head">
                        <span className="mlabel">
                          {r.hcpc} · {PRODUCT_LABELS[r.product]}
                        </span>
                        <span></span>
                      </div>
                      <MonRow label="Auth result" value="Submitted" tone="good" />
                      <MonRow
                        label="Auth Submission Method"
                        value={s?.authSubmissionMethod || "—"}
                        tone={s?.authSubmissionMethod ? "skip" : "neutral"}
                      />
                      <MonRow
                        label="Auth Submission Date"
                        value={s?.authSubmissionDate ? ymdToUs(s.authSubmissionDate) : "—"}
                        tone="neutral"
                      />
                      <MonRow label="Auth ID" value={s?.authId || "—"} tone="neutral" />
                    </div>
                  );
                })}
                {dvsRouted.map((r) => (
                  <div key={r.product} style={{ display: "contents" }}>
                    <div className="mon-row grp-head">
                      <span className="mlabel">
                        {r.hcpc} · {PRODUCT_LABELS[r.product]}
                      </span>
                      <span></span>
                    </div>
                    <MonRow label="Auth result" value="Required (unchanged — DVS next stage)" tone="skip" />
                  </div>
                ))}
              </div>
              <p className="mon-note">
                Testing aid — verify backend output against this drawer, then delete it for
                production (spec §9; keep the buttons below).
              </p>
            </div>
          </div>
        )}

        <div className="foot-actions">
          {/* No Follow Up / Escalate controls here (removed 2026-07-20):
              follow-up is automatic (send stamps today; the sidebar's +1d
              button pushes a patient to tomorrow), and escalation state
              just carries through the send round-trip. */}
          <div className="foot-left" />
          <button
            className={`send-btn ${sendState === "error" ? "err" : ""}`}
            disabled={missing.length > 0 || sendState === "sending"}
            onClick={handleSend}
          >
            {sendState === "sending"
              ? "Sending to Monday…"
              : sendState === "success"
                ? "✓ Auth submission complete — sent"
                : sendState === "error"
                  ? "Send failed — click to retry"
                  : "Auth Submission Complete"}
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

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform .2s" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
