/**
 * The patient screen's per-stage panel (§5.39c) — the REAL stage tool, rendered
 * read-only under the stepper.
 *
 * Brandon's handoff: *"the same page Josh already renders at
 * /unverified-referrals, /evaluate, /send-request, … with exactly one
 * difference: the navy page header and the patient header card are not carried
 * over. Everything else is the real thing."*
 *
 * ⚠️⚠️ **HIS MOCKUP DOES NOT DRAW THESE AND SAYS SO — "Stand-in … do not port
 * it."** So there was nothing of his to copy; this is the thing the stand-in
 * stands in for. The mockup's generic cards are deliberately not reproduced.
 *
 * ⚠️⚠️ **THE PANEL, NEVER THE PAGE — and that distinction is the safety
 * property, not a convenience.** Each stage PAGE wires a polling hook to a
 * prop-driven panel (§4's per-role convention), and the writes that fire
 * without anybody pressing anything live in the HOOK: `masheke
 * /useMondayPatients` backfills a blank Next Action Date and self-heals a stale
 * escalation ON READ (§5.30 records a dashboard being kept off those hooks for
 * exactly this reason). Mounting the panel alone means no poll, no self-heal,
 * and no second queue reading the board every 30 seconds behind a screen a rep
 * is only looking at.
 *
 * ⚠️⚠️ **AND NOTHING HERE CAN WRITE.** Verified panel by panel: every internal
 * `writeLongText` / `runVerifiedSend` / `sendPatientToMonday` call in the ten
 * panels below sits in an EVENT HANDLER — not one is in an effect. So the
 * `inert` wrapper is a real guard rather than a cosmetic one: it blocks focus
 * and clicks at the browser level, so no handler can run. The callbacks are
 * no-ops on top of that, because a panel that cannot be clicked still should
 * not be handed a writer. `stagePanelEmbed.test.ts` scans for both.
 *
 * ⚠️⚠️ **NO BACKGROUND WORK BEHIND A FROZEN PANEL — and one hook had to be
 * switched off for that to be true.** Every non-React hook the ten panels call
 * was read: `useStatusOptions` / `usePayerOptions` / `useInfusionStock` are
 * module-cached and TTL'd, shared with the live pages, so they add no load;
 * `useMondayFiles` is one read per panel opened and polls only while a
 * Generate is running, which `inert` prevents starting. **`useFaxStatus` was
 * the exception**: it walks a backoff ladder out to ~33 minutes / 56
 * RingCentral requests whenever a fax went out TODAY (§5.9b) — and behind a
 * panel nobody can press, that is pure waste, because the chip exists so a rep
 * can decide whether to press "Request Sent". Send Request and Confirm Receipt
 * therefore take an `embedded` prop that switches it off. The live pages are
 * unchanged.
 *
 * ⚠️ **Read at FULL WIDTH through the slice's own mapping** (`useStageRecord`):
 * handing a panel the dossier's column subset would draw a patient with no
 * scripts, no coverage paths and no attempts — a plausible, wrong audit, with
 * nothing erroring (§5.25).
 *
 * ⚠️ **What the values MEAN depends on the record.** A completed board item is
 * frozen — nothing writes to it again once the hop creates the next board's
 * item (§5.38) — so its columns ARE the values the patient left the stage with.
 * The LIVE board's item is current, not historical, and the stamp says which.
 * Brandon's handoff asks for the same distinction and allows exactly this:
 * *"until [a snapshot store] exists, show the current columns and say so."*
 *
 * ⚠️ **Granularity is per BOARD.** Medical Evaluation's five tools share ONE
 * item, so a column a later sub-stage overwrote reads as though it always said
 * that. The stamp says so rather than implying a per-step history the board
 * does not keep.
 */
import { Suspense, lazy, useMemo, type ReactNode } from "react";
import { Eye } from "lucide-react";
import type { DossierItem } from "@/lib/commsHub/dossier";
import { useStageRecord } from "@/hooks/patient/useStageRecord";

/* ── The ten embeddable tools ──────────────────────────────────────────────
   Lazy, so a patient screen nobody opens a panel on never downloads them —
   `EvaluatePanel` alone is 3,133 lines. */
const EvaluatePanel = lazy(() => import("@/components/masheke/EvaluatePanel").then((m) => ({ default: m.EvaluatePanel })));
const SendRequestPanel = lazy(() => import("@/components/masheke/SendRequestPanel").then((m) => ({ default: m.SendRequestPanel })));
const ConfirmReceiptPanel = lazy(() => import("@/components/masheke/ConfirmReceiptPanel").then((m) => ({ default: m.ConfirmReceiptPanel })));
const ChaseClinicalsPanel = lazy(() => import("@/components/masheke/ChaseClinicalsPanel").then((m) => ({ default: m.ChaseClinicalsPanel })));
const DoctorAppointmentsPanel = lazy(() => import("@/components/masheke/DoctorAppointmentsPanel").then((m) => ({ default: m.DoctorAppointmentsPanel })));
const BenefitsPanel = lazy(() => import("@/components/samantha/BenefitsPanel").then((m) => ({ default: m.BenefitsPanel })));
const AuthorizationsPanel = lazy(() => import("@/components/samantha/AuthorizationsPanel").then((m) => ({ default: m.AuthorizationsPanel })));
const AuthOutstandingPanel = lazy(() => import("@/components/samantha/AuthOutstandingPanel").then((m) => ({ default: m.AuthOutstandingPanel })));
const WelcomeCallForm = lazy(() => import("@/components/welcomeCall/WelcomeCallForm").then((m) => ({ default: m.WelcomeCallForm })));
const FinalConfirmCard = lazy(() => import("@/components/finalConfirm/PatientInfoCard").then((m) => ({ default: m.PatientInfoCard })));

/* ── Loaders: the slice's own reader + its own mapping ─────────────────── */
const mashekeRecord = async (itemId: string) => {
  const [api, map] = await Promise.all([import("@/lib/masheke/mondayApi"), import("@/lib/masheke/mondayMapping")]);
  const it = await api.fetchItemById(itemId);
  return it ? map.mondayItemToPatient(it) : null;
};
/** ⚠️ Insurance reads TWO column sets and they are not nested: the Submit Auth
 *  / Auth Outstanding panels need `AUTH_READ_COLUMN_IDS`, Benefits needs the
 *  ordinary one. Reading the wrong set does not error — it blanks every field
 *  the other set owns. `useMondayPatients` picks by GROUP; here the sub-stage
 *  names the panel, so the panel names the set. */
const insuranceRecord = (auth: boolean) => async (itemId: string) => {
  const [api, map] = await Promise.all([import("@/lib/samantha/mondayApi"), import("@/lib/samantha/mondayMapping")]);
  const it = await api.fetchItemById(itemId, auth);
  return it ? map.mondayItemToPatient(it) : null;
};
const welcomeCallRecord = async (itemId: string) => {
  const [api, map] = await Promise.all([import("@/lib/welcomeCall/mondayApi"), import("@/lib/welcomeCall/mondayMapping")]);
  const it = await api.fetchItemById(itemId);
  return it ? map.mondayItemToPatient(it) : null;
};
const finalConfirmRecord = async (itemId: string) => {
  const [api, map] = await Promise.all([import("@/lib/finalConfirm/mondayApi"), import("@/lib/finalConfirm/mondayMapping")]);
  const it = await api.fetchItemById(itemId);
  return it ? map.mondayItemToPatient(it) : null;
};

const NOOP = () => {};
const NOOP_ASYNC = async () => {};

export function StagePanelEmbed({ item, subStage }: { item: DossierItem; subStage: string }) {
  const spec = useMemo(() => panelFor(item.boardId, subStage), [item.boardId, subStage]);
  const { record, loading, error } = useStageRecord(
    spec?.scope ?? "",
    item.itemId,
    spec?.load ?? (async () => null),
    spec !== null,
  );

  if (!spec) return null;
  if (loading && !record) return <div className="card pad small muted">Reading {spec.tool} from the board…</div>;
  if (error) return <div className="card pad small muted">Couldn’t read this record — {error}</div>;
  if (!record) return <div className="card pad small muted">Nothing on this board for {spec.tool}.</div>;

  return (
    <Frozen>
      <Suspense fallback={<div className="card pad small muted">Loading {spec.tool}…</div>}>
        {spec.render(record)}
      </Suspense>
    </Frozen>
  );
}

/**
 * ⚠️ **`inert` is what makes the embed read-only, and it is a browser-level
 * guard, not a style.** It removes the whole subtree from the focus order and
 * swallows every pointer event, so a panel's own Send / Add note / Log attempt
 * handler cannot run — which is the reason it can be trusted with panels that
 * write internally. `pointer-events: none` in the CSS is belt and braces for
 * anything that predates it; the muted cursor and the reduced contrast are the
 * only cosmetic parts.
 */
function Frozen({ children }: { children: ReactNode }) {
  return (
    // @ts-expect-error — `inert` is a real HTML attribute; React's types lag it
    // on this version, and the DOM honours the string form on every browser we
    // support. Typed away rather than dropped: it IS the guard.
    <div className="stage-embed" inert="">
      {children}
    </div>
  );
}

interface PanelSpec {
  /** Distinguishes two boards' reads of one item id in the record cache. */
  scope: string;
  tool: string;
  load: (itemId: string) => Promise<unknown>;
  render: (record: unknown) => ReactNode;
}

/**
 * ⚠️ **Three of the thirteen tools are deliberately absent, and each for its
 * own reason** — the panel falls back to the snapshot cards and says so rather
 * than a toggle whose tab opens nothing:
 *  · **DVS** and the two **Intake** tools render inline in their pages
 *    (`DvsPage` 739 lines, `ProfilePage` 2,036, `UnverifiedReferralsPage`
 *    4,047), the one place this repo's shell/body convention does not already
 *    hold, so embedding them means splitting those pages first.
 *  · **Auth Denied** has no tool at all — the stage is deliberately unbuilt
 *    (§7), which is why its `route` is empty too.
 */
function panelFor(boardId: number, subStage: string): PanelSpec | null {
  const P = <T,>(spec: {
    scope: string;
    tool: string;
    load: (id: string) => Promise<T | null>;
    render: (r: T) => ReactNode;
  }): PanelSpec => ({
    scope: spec.scope,
    tool: spec.tool,
    load: spec.load as (id: string) => Promise<unknown>,
    render: (r) => spec.render(r as T),
  });

  if (boardId === 18406060017) {
    const base = { scope: "masheke", load: mashekeRecord };
    switch (subStage) {
      case "Evaluate MN":
        return P({ ...base, tool: "Evaluate MN", render: (p) => <EvaluatePanel patient={p} onUpdate={NOOP} onOpenForm={NOOP} reviewMode /> });
      case "Send Request":
        return P({ ...base, tool: "Send Request", render: (p) => <SendRequestPanel patient={p} onUpdate={NOOP} onOpenForm={NOOP} embedded /> });
      case "Confirm Receipt":
        return P({ ...base, tool: "Confirm Receipt", render: (p) => <ConfirmReceiptPanel patient={p} onUpdate={NOOP} onOpenForm={NOOP} embedded /> });
      case "Chase Clinicals":
        return P({ ...base, tool: "Chase Clinicals", render: (p) => <ChaseClinicalsPanel patient={p} onUpdate={NOOP} onOpenForm={NOOP} /> });
      case "Doctor Appointment":
        return P({ ...base, tool: "Doctor Appointments", render: (p) => <DoctorAppointmentsPanel patient={p} onUpdate={NOOP} onDone={NOOP} /> });
      default:
        return null;
    }
  }

  if (boardId === 18410601299) {
    switch (subStage) {
      case "Benefits / SoS":
        return P({
          scope: "insurance",
          tool: "Benefits",
          load: insuranceRecord(false),
          render: (p) => (
            <div className="bnr">
              <BenefitsPanel patient={p} onUniversalChange={NOOP} onCodeChange={NOOP} onCallLogChange={NOOP} missing={[]} onSend={NOOP_ASYNC} reviewMode />
            </div>
          ),
        });
      case "Submit Auth.":
        return P({
          scope: "insurance-auth",
          tool: "Submit Auth",
          load: insuranceRecord(true),
          render: (p) => (
            <div className="bnr">
              <AuthorizationsPanel patient={p} onCodeChange={NOOP} onIntakeIdChange={NOOP} missing={[]} onSend={NOOP_ASYNC} />
            </div>
          ),
        });
      case "Auth. Outstanding":
        return P({
          scope: "insurance-auth",
          tool: "Auth Outstanding",
          load: insuranceRecord(true),
          render: (p) => (
            <div className="bnr">
              <AuthOutstandingPanel patient={p} onCodeChange={NOOP} onNotesChange={NOOP} onSaveNotesToMonday={NOOP_ASYNC} onSaveNoAuthNeeded={NOOP_ASYNC} />
            </div>
          ),
        });
      default:
        return null;
    }
  }

  if (boardId === 18410804557) {
    switch (subStage) {
      case "Welcome Call":
        return P({ scope: "welcomeCall", tool: "Welcome Call", load: welcomeCallRecord, render: (p) => <WelcomeCallForm patient={p} onFieldChange={NOOP} onIntakeChange={NOOP} /> });
      case "Review Profile":
        return P({ scope: "finalConfirm", tool: "Final Profile Confirmation", load: finalConfirmRecord, render: (p) => <FinalConfirmCard patient={p} onFieldChange={NOOP} /> });
      default:
        return null;
    }
  }

  return null;
}

export function StagePanelUnavailable({ tool }: { tool: string }) {
  return (
    <div className="card pad small muted">
      <Eye style={{ width: 12, height: 12, verticalAlign: -1 }} /> {tool} has no embeddable panel yet — its screen is
      built into its page rather than a component. The record’s own fields are below; <b>Open {tool}</b> shows it in full.
    </div>
  );
}
