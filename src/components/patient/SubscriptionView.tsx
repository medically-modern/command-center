/**
 * The patient screen's SUBSCRIPTION view — Brandon's Profile | Orders tabs
 * (§5.45).
 *
 * Josh, 2026-09-21, looking at what shipped: *"is this what brandons mockup did
 * here? if not follow it"*. It was not: §5.39 recorded these tabs as "still not
 * built, deliberately", and what stood in for them was two link buttons on an
 * otherwise empty page. His `patientMain` renders a Profile | Orders segmented
 * toggle carrying the order COUNT, then either `profilePage` (a subscription
 * overview strip, then the board's facts in cards, then the notes) or
 * `ordersPage` (the order history table, newest first).
 *
 * ⚠️⚠️ **THE PROFILE TAB IS BRANDON'S GRID FROM 2026-09-24** (his pixel-match,
 * items 4–13): overview → Demographics | Insurance | Medical necessity & auth →
 * Order details | Doctor info | Financials → Subscription notes. Josh's rule
 * for it, the same day: *"its so so critical that we are just changing the
 * visuals and not the backend or label options"*. So the cards
 * (`SubscriptionCards.tsx`) write the same `Patient` fields the
 * `/subscription` page's own components write, offer the same options, and the
 * Send below is the same `sendPatientToMonday`. Two things are NOT his and are
 * Josh's decisions: the Send STAYS in the bar pinned to the bottom of the tab
 * (his 9/23 ask — *"leave these"*), and address, insurance and doctor stay
 * editable (his 9/23 build).
 *
 * ⚠️⚠️ **EDITABLE BEHIND `editProfile`, READ-ONLY WITHOUT IT** (Josh,
 * 2026-09-21). Brandon's own mechanism now: every control `disabled`, the
 * Order details card `.readonly`, the drop zone `.off`, and the writer handed
 * down is a no-op. The Send is gated TWICE — the bar is not rendered without
 * the ability, and the handler checks it again (§5.39h: the button is what a
 * rep sees, the handler is what stops the write).
 *
 * ⚠️⚠️ **ONE WRITER, TWO SCREENS — never a second implementation.** The send
 * calls `/subscription`'s own `sendPatientToMonday` on a `Patient` read through
 * the subscription slice's own `fetchItemById` + mapping. The few columns
 * Brandon's layout adds that `/subscription` does not edit (Frequency, the two
 * quantities, the Contacts block — Josh, *"1. YES"*) ride that SAME verified
 * send as a DELTA (`profileExtras.diffExtras`), so nothing the rep did not
 * change is written. The visit date goes through Update Clinicals' own
 * `saveVisitDateVerified` (MN Expiry AND the MR rung, §5.36), and MN documents
 * through the same `uploadFileToColumn` `/subscription`'s panel uses.
 */
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import confetti from "canvas-confetti";
import { AlertTriangle, ArrowUpRight, Copy, Eye, Package, RotateCcw, User } from "lucide-react";
import type { DossierItem } from "@/lib/commsHub/dossier";
import { subscriptionOverview, type OverviewFact } from "@/lib/patient/subscriptionOverview";
import { mondayItemToOrder } from "@/lib/orders/mondayMapping";
import { fmtDate, orderStage, type Order } from "@/lib/orders/workflow";
import { orderHeadline } from "@/lib/orders/headline";
import { orderLines } from "@/lib/orders/skuJoin";
import { StagePill } from "@/components/orders/pills";
import { buildReorderForm, responseTone, type ReorderForm } from "@/lib/patient/reorderForm";
import { expectedItems } from "@/lib/patient/expectedItems";
import { usePatientOrders } from "@/hooks/patient/usePatientOrders";
import { useSubscriptionRecord } from "@/hooks/patient/useSubscriptionRecord";
import { useMnDocFiles } from "@/hooks/patient/useMnDocFiles";
import { useStatusOptions } from "@/hooks/useStatusOptions";
import { SendToMondayButton } from "@/components/subscription/SendToMondayButton";
import { inferMimeType } from "@/components/subscription/MnDocsPanel";
import { useAbility } from "@/components/shell/AbilityLock";
import { BOARD_ID, COL, uploadFileToColumn } from "@/lib/subscription/mondayApi";
import { saveVisitDateVerified, sendPatientToMonday } from "@/lib/subscription/mondayWrite";
import { expiryForVisitDate } from "@/lib/subscription/mrStatus";
import {
  EXTRA_COL,
  diffExtras,
  extrasRefusals,
  hasExtras,
  type ExtrasEdit,
} from "@/lib/subscription/profileExtras";
import { validatePatientForSend, type Patient as SubPatient } from "@/lib/subscription/workflow";
import { GatewayPendingError } from "@/lib/shared/verifiedWrite";
import { refusePendingNote } from "@/components/shared/pendingNoteGuard";
import { getUser } from "@/lib/shared/auth";
import { appendNoteToRecord } from "@/lib/commsHub/dossierApi";
import { noteStageLabel } from "@/lib/patient/recentNotes";
import {
  DemographicsCard,
  DoctorCard,
  FinancialsCard,
  InsuranceCard,
  MnAuthCard,
  OrderDetailsCard,
  SubscriptionNotesCard,
  type FieldChange,
  type LiveOptions,
} from "@/components/patient/SubscriptionCards";

export type SubTab = "profile" | "orders";

export function parseSubTab(raw: string | null): SubTab {
  return raw === "orders" ? "orders" : "profile";
}

/** The audit line for a Caregiver Authorized tick made here — the twin of
 *  Welcome Call's `caregiverConsentNote`, naming where it was recorded. No date
 *  or initials of its own: the note stamp supplies both. */
const CAREGIVER_CONSENT_NOTE = "Caregiver authorized — recorded on the patient screen";

/** The signed-in person's name for Brandon's "Read-only for <name>". */
function readerName(): string {
  return getUser()?.name?.trim() || "you";
}

export function SubscriptionView({
  item,
  phone,
  tab,
  onTab,
  embedded = false,
  onNoteAppended,
}: {
  item: DossierItem;
  phone: string;
  tab: SubTab;
  onTab: (next: SubTab) => void;
  /** Drawn in the Communications hub's right pane (§5.49). */
  embedded?: boolean;
  /** A note added on the Subscription notes card — the host lays the new body
   *  over its record so every reader on the screen shows it at once. */
  onNoteAppended?: (itemId: string, notes: string) => void;
}) {
  const canEdit = useAbility("editProfile");
  /**
   * ⚠️ **Read once for the WHOLE Subscription view, not once per tab.** It was
   * gated on `tab === "orders"`; the Profile tab's overview strip needs the
   * FIRST order date (§5.46b), and the tab badge should carry the count before
   * a rep has pressed it, exactly as Brandon draws it.
   *
   * ⚠️ That is still "on open, never on render": this view is mounted only when
   * a rep is looking at it, and `fetchOrdersForPatient` is ONE filtered query
   * against the order board, module-cached per number. It is not the shape
   * INCIDENT_2026-08-20 warns about — that is a read per ROW, or a read on a
   * timer — and it does not touch RingCentral at all.
   */
  const { orders: raw, loading, error } = usePatientOrders(phone, true);
  /* ⚠️ `partial: true` — these rows come from the LIST columns, so every column
     the list did not ask for is "" (§5.25). The flag is what stops a partial
     record ever being rendered as the OPEN order, which is the orders page's
     own rule. Here a row is only ever a summary, and clicking opens the real
     one on /orders. */
  const orders = useMemo(
    () => raw?.map((it) => mondayItemToOrder(it, { partial: true })) ?? null,
    [raw],
  );
  const count = orders?.length ?? null;
  const orderDates = useMemo(() => orders?.map((o) => o.orderDate) ?? null, [orders]);
  /* ⚠️ Computed ONCE for both tabs — the Profile strip and the Orders tab's
     upcoming card are the same facts, and two derivations of "when is the
     next box due" is how the two tabs of one screen come to disagree. */
  const overview = useMemo(
    () => subscriptionOverview(item.cols, orderDates, undefined, { createdAt: item.createdAt }),
    [item.cols, item.createdAt, orderDates],
  );
  /* Brandon's fourth column of the Upcoming order strip — the reorder form
     (§5.46c). It is the SUBSCRIPTION board's own record, so it costs no read:
     the seven columns ride the dossier fetch this screen already made. */
  const reorder = useMemo(
    () => buildReorderForm(item.boardId, item.cols),
    [item.boardId, item.cols],
  );
  /* Brandon's third column on the Upcoming order strip (§5.46d) — what the
     next order is set up to carry, from the profile's own product columns. */
  const expected = useMemo(
    () => expectedItems(item.boardId, item.cols),
    [item.boardId, item.cols],
  );
  const name = readerName();

  return (
    <>
      <div className="row wrap sub-toggle">
        <div className="segc home-toggle">
          <button className={tab === "profile" ? "on" : ""} onClick={() => onTab("profile")}>
            <User style={{ width: 13, height: 13 }} /> Profile
          </button>
          <button className={tab === "orders" ? "on" : ""} onClick={() => onTab("orders")}>
            <Package style={{ width: 13, height: 13 }} /> Orders
            {count !== null && <span className="n">{count}</span>}
          </button>
        </div>
        {/* Brandon's own split: the Save for somebody who can edit, this line
            for everybody else. The Save itself stays in the bar pinned to the
            foot of the Profile tab (Josh, 2026-09-24: *"leave these"*). */}
        {tab === "profile" && !canEdit && (
          <span className="xs muted ro-line">
            <Eye style={{ width: 13, height: 13 }} /> Read-only for {name}
          </span>
        )}
      </div>

      {tab === "profile" ? (
        <ProfileTab
          key={item.itemId}
          item={item}
          phone={phone}
          canEdit={canEdit}
          overview={overview}
          orderCount={count}
          firstOrder={overview.find((f) => f.label === "First order")?.value ?? ""}
          reorder={reorder}
          embedded={embedded}
          readOnlyName={name}
          onNoteAppended={onNoteAppended}
        />
      ) : (
        <OrdersTab
          orders={orders}
          loading={loading}
          error={error}
          hasPhone={!!phone}
          overview={overview}
          reorder={reorder}
          expected={expected}
        />
      )}
    </>
  );
}

/** Green / amber / red for the overview's Status — his dot + text. An
 *  unrecognised label stays neutral: a wrong green reads as "all good". */
function statusTone(status: string): "good" | "warn" | "bad" | "" {
  if (/^active$/i.test(status)) return "good";
  if (/paused/i.test(status)) return "warn";
  if (/not active|cancel|dead/i.test(status)) return "bad";
  return "";
}

/** Brandon's teal "Subscription overview" strip — his four facts (§5.46b). */
function OverviewStrip({ facts }: { facts: OverviewFact[] }) {
  return (
    <section className="card pad left-teal">
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        Subscription overview
      </div>
      <div className="strip">
        {facts.map((f) => (
          <div className="fact" key={f.label}>
            <div className="k">{f.label}</div>
            <div className="v">
              {f.label === "Status" && f.value ? (
                <span className={`status-v ${statusTone(f.value)}`}>
                  <span className="dot" />
                  {f.value}
                </span>
              ) : (
                f.value || "—"
              )}
              {f.note && f.label === "Next order" && (
                <span
                  className={`xs ${f.warn ? "warn" : "muted"}`}
                  style={{ marginLeft: 6 }}
                  title="Calculated from the date, not the board's days-to-order status"
                >
                  {f.value ? `(${f.note})` : f.note}
                </span>
              )}
              {f.note && f.label !== "Next order" && (
                <span className="xs muted" style={{ marginLeft: 6 }}>
                  · {f.note}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** "Ordering Cycle is required" names a field this tab does not carry
 *  (Brandon deleted Cycle Controls), so it says where it IS set — a refusal
 *  with no passing move on screen is the dead end this codebase records
 *  reversing (§5.10 · §5.20 · §5.31c). */
function explainError(err: string): string {
  return /ordering cycle/i.test(err) ? `${err} — it is set on the Subscription page` : err;
}

function ProfileTab({
  item,
  phone,
  canEdit,
  overview,
  orderCount,
  firstOrder,
  reorder,
  embedded,
  readOnlyName,
  onNoteAppended,
}: {
  item: DossierItem;
  phone: string;
  canEdit: boolean;
  overview: OverviewFact[];
  orderCount: number | null;
  firstOrder: string;
  reorder: ReorderForm | null;
  embedded: boolean;
  readOnlyName: string;
  onNoteAppended?: (itemId: string, notes: string) => void;
}) {
  /* ⚠️⚠️ The editor's STATE lives here, one level above the fields it saves,
     because the Send is at the BOTTOM of the tab while the fields sit above it
     — both have to read one draft. The parent keys this tab on the item, so a
     draft still cannot survive a patient switch (§9's notes-box rule).
     ⚠️ Read for EVERYBODY, not only an editor — the read-only half of this
     screen is the same cards, disabled. */
  const { patient, extras, loading, error, reload, readFresh } = useSubscriptionRecord(item.itemId, true);
  const mn = useMnDocFiles(item.itemId);
  const [edits, setEdits] = useState<Partial<SubPatient>>({});
  const [extrasEdit, setExtrasEdit] = useState<ExtrasEdit>({});
  const [visitDate, setVisitDate] = useState("");
  const [queued, setQueued] = useState<File[]>([]);
  /** Bumped by Discard: the address boxes are uncontrolled autocompletes, so a
   *  new key is what puts the board's value back in them. */
  const [resetN, setResetN] = useState(0);

  /* The same two live reads `SubscriptionForm` makes for the sets, plus the
     three status columns Brandon's layout adds — never a hardcoded id (§5.2). */
  const infusionOpts: LiveOptions = useStatusOptions(BOARD_ID, [COL.infusionSet1, COL.infusionSet2]);
  const extraOpts: LiveOptions = useStatusOptions(BOARD_ID, [
    EXTRA_COL.orderFrequency,
    EXTRA_COL.primaryContact,
    EXTRA_COL.alternateContact,
  ]);

  const merged = useMemo(
    () => (patient ? ({ ...patient, ...edits } as SubPatient) : null),
    [patient, edits],
  );
  const extrasDelta = useMemo(() => (extras ? diffExtras(extras, extrasEdit) : {}), [extras, extrasEdit]);
  const refusals = useMemo(() => {
    const out = extrasRefusals(extrasDelta);
    if (visitDate && !expiryForVisitDate(visitDate)) out.push("Visit date isn't a readable date");
    return out;
  }, [extrasDelta, visitDate]);
  const validation = useMemo(() => {
    const v = merged ? validatePatientForSend(merged) : { valid: false, errors: [] as string[] };
    const errors = [...v.errors.map(explainError), ...refusals];
    return { valid: v.valid && refusals.length === 0, errors };
  }, [merged, refusals]);
  const dirty =
    Object.keys(edits).length > 0 || hasExtras(extrasDelta) || !!visitDate || queued.length > 0;

  /* ⚠️ A form handed to somebody who may not edit gets a writer that writes
     nothing — belt and braces behind every control's `disabled`. */
  const onFieldChange = useCallback<FieldChange>(
    (field, value) => {
      if (!canEdit) return;
      setEdits((prev) => ({ ...prev, [field]: value }));
    },
    [canEdit],
  );
  const onExtras = useCallback(
    (patch: ExtrasEdit) => {
      if (!canEdit) return;
      setExtrasEdit((prev) => ({ ...prev, ...patch }));
    },
    [canEdit],
  );

  const discard = useCallback(() => {
    setEdits({});
    setExtrasEdit({});
    setVisitDate("");
    setQueued([]);
    setResetN((n) => n + 1);
  }, []);

  const handleSend = useCallback(async () => {
    if (!merged) return;
    // ⚠️ Checked HERE as well as on the button: the button is what a rep sees,
    // this is what stops the write (§5.39h). A typed URL, a stale tab or a
    // revoked ability all reach this line and not that one.
    if (!canEdit) return;
    if (refusePendingNote()) return;
    if (refusals.length) {
      toast.error("Not sent", { description: refusals.join(" · ") });
      throw new Error(refusals.join("; "));
    }
    const expiry = visitDate ? expiryForVisitDate(visitDate) : null;

    // ⚠️⚠️ The send is built on a record read NOW, never on `merged`. `merged`
    // is the record this tab read when it opened — possibly hours ago — and the
    // send writes every board-mirrored column it holds (Next Order, Order Type,
    // the sets and quantities, the auth ids, Doctor, NPI…), so sending it put
    // that morning's values back over whatever /subscription or another rep had
    // written since. Only the rep's OWN edits are laid over the fresh read.
    let toSend: SubPatient;
    try {
      toSend = { ...(await readFresh()), ...edits } as SubPatient;
    } catch (e) {
      toast.error("Couldn't re-read this record before saving — nothing was written", {
        description: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
    // The board may have moved under the rep: validate what will actually go.
    const check = validatePatientForSend(toSend);
    if (!check.valid) {
      toast.error("Not sent — the record on Monday has changed", {
        description: check.errors.map(explainError).join(" · "),
      });
      throw new Error(check.errors.join("; "));
    }

    /* ── 1. The Subscription save, the new fields riding the SAME verified
          transaction. ─────────────────────────────────────────────────── */
    let queuedOnServer = false;
    try {
      await sendPatientToMonday(toSend, {
        requireDone: true,
        ...(hasExtras(extrasDelta) ? { extras: extrasDelta } : {}),
      });
    } catch (e) {
      if (e instanceof GatewayPendingError) {
        // Durably queued and it WILL run — not a failure, and above all not
        // retryable. The edits stay on screen so nothing looks lost, and the
        // board would still read the OLD values if we re-read now.
        toast.warning("Queued — Monday is still writing this save", {
          description: e.message,
          duration: 15_000,
        });
        queuedOnServer = true;
      } else {
        toast.error("Send to Monday failed — nothing on this page was saved", {
          description: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    }
    if (!queuedOnServer) {
      setEdits({});
      setExtrasEdit({});
    }

    /* The HIPAA consent audit line — Welcome Call's rule for the same column
       (§5.31d `caregiverConsentJustGiven`), stamped only on the off→on
       transition against what the BOARD held, through the one notes writer. A
       checkbox records the current state; this records that consent was
       recorded, by whom and when. Its failure is said, never thrown: the tick
       itself saved. */
    if (extrasDelta.caregiverAuthorized === true && extras && !extras.caregiverAuthorized && item.notesColId) {
      try {
        const next = await appendNoteToRecord({
          boardId: item.boardId,
          itemId: item.itemId,
          columnId: item.notesColId,
          columnType: item.notesColType,
          text: CAREGIVER_CONSENT_NOTE,
          stage: noteStageLabel(item),
          phone,
        });
        onNoteAppended?.(item.itemId, next);
      } catch (e) {
        toast.warning("Caregiver authorized saved, but its audit note wasn't added — add a note saying so", {
          description: e instanceof Error ? e.message : String(e),
        });
      }
    }

    /* ── 2. The visit date — its own verified write, because the MR status it
          sets fires a webhook (§5.36). ──────────────────────────────────── */
    if (expiry) {
      try {
        await saveVisitDateVerified(item.itemId, expiry);
        setVisitDate("");
      } catch (e) {
        toast.error("The profile saved, but the visit date didn't — press Send again to retry it", {
          description: e instanceof Error ? e.message : String(e),
        });
        if (!queuedOnServer) await reload();
        throw e;
      }
    }

    /* ── 3. The MN documents. A file that fails stays queued on screen. ──── */
    if (queued.length) {
      const failed: File[] = [];
      let firstError = "";
      for (const f of queued) {
        try {
          const buf = await f.arrayBuffer();
          await uploadFileToColumn(item.itemId, COL.mnDocs, new Uint8Array(buf), f.name, inferMimeType(f));
        } catch (e) {
          failed.push(f);
          if (!firstError) firstError = `${f.name}: ${e instanceof Error ? e.message : String(e)}`;
        }
      }
      setQueued(failed);
      void mn.reload();
      if (failed.length) {
        toast.error(
          `The profile saved, but ${failed.length} MN document${failed.length === 1 ? "" : "s"} didn't upload — press Send again to retry`,
          { description: firstError },
        );
        if (!queuedOnServer) await reload();
        throw new Error(firstError);
      }
    }

    if (!queuedOnServer) {
      toast.success("Sent to Monday");
      confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 } });
      await reload();
    }
  }, [merged, canEdit, refusals, visitDate, readFresh, edits, extrasDelta, extras, item, phone, onNoteAppended, queued, mn, reload]);

  const resetKey = String(resetN);

  return (
    /* ⚠️ A FRAGMENT, and that is what pins the Send from the first frame: the
       bar's containing block is then the patient body's own column
       (`.pt-main`), which starts at the top of the scroll area. Wrapped in a
       box of its own it could not rise above that box's top edge — measured in
       the hub's pane, 67px of it sat below the fold until the rep scrolled. */
    <>
      {!canEdit && (
        <div className="notice ro-note">
          <Eye style={{ width: 14, height: 14, flex: "none", marginTop: 1 }} />
          <div>
            Read-only for {readOnlyName} — an admin can turn on <b>Edit profile</b> in Users. Everything is still
            visible; nothing on the profile can be changed or saved.
          </div>
        </div>
      )}

      <OverviewStrip facts={overview} />

      {error ? (
        <section className="card pad small">
          <b>Couldn&apos;t read this Subscription record.</b> <span className="muted">{error}</span>
        </section>
      ) : !merged ? (
        <section className="card pad small muted">
          {loading ? "Reading the Subscription board…" : "Nothing to show yet."}
        </section>
      ) : (
        <div className="sub-fields">
          <div className="grid3 mnrow">
            <DemographicsCard
              patient={merged}
              extras={extras}
              extrasEdit={extrasEdit}
              onExtras={onExtras}
              canEdit={canEdit}
              onFieldChange={onFieldChange}
              contactOpts={extraOpts}
              resetKey={resetKey}
              readOnlyName={readOnlyName}
            />
            <InsuranceCard patient={merged} extras={extras} canEdit={canEdit} onFieldChange={onFieldChange} />
            <MnAuthCard
              patient={merged}
              files={mn.files}
              filesLoading={mn.loading}
              filesError={mn.error}
              queued={queued}
              onQueue={(fs) => canEdit && setQueued((q) => [...q, ...fs])}
              onUnqueue={(i) => setQueued((q) => q.filter((_, j) => j !== i))}
              visitDate={visitDate}
              onVisitDate={(v) => canEdit && setVisitDate(v)}
              canEdit={canEdit}
            />
          </div>
          <div className="grid3">
            <OrderDetailsCard
              patient={merged}
              extras={extras}
              extrasEdit={extrasEdit}
              onExtras={onExtras}
              canEdit={canEdit}
              onFieldChange={onFieldChange}
              infusionOpts={infusionOpts}
              frequencyOpts={extraOpts}
              reorder={reorder}
              readOnlyName={readOnlyName}
            />
            <DoctorCard patient={merged} canEdit={canEdit} onFieldChange={onFieldChange} resetKey={resetKey} />
            <FinancialsCard patient={merged} orderCount={orderCount} firstOrder={firstOrder} />
          </div>
        </div>
      )}

      {/* ⚠️ Not in the Communications hub's pane: that pane already carries the
          live record's notes and their composer at the top (§5.49's job 2), so
          a second copy of the same column there would be the same list and a
          second box, twice in one pane. */}
      {!embedded && (
        <SubscriptionNotesCard
          item={item}
          phone={phone}
          onAppended={(id, notes) => onNoteAppended?.(id, notes)}
        />
      )}

      {/* ⚠️⚠️ The ONE Send, at the bottom and pinned there (Josh, 2026-09-23;
          kept 2026-09-24 — *"leave these"*). Only for somebody who can edit,
          and only once there is a record to send. */}
      {canEdit && merged && (
        <SendBar dirty={dirty} onDiscard={discard} onSend={handleSend} validation={validation} />
      )}
    </>
  );
}

/**
 * The Send, pinned to the bottom of the Profile tab (Josh, 2026-09-23). Quiet
 * while clean; amber with Discard once there is something unsaved.
 *
 * ⚠️ It renders in BOTH states rather than appearing only when dirty — a form
 * with no Save on it reads as read-only, and a record can be unsendable while
 * clean: `SendToMondayButton`'s own list says why (§5.31b).
 */
function SendBar({
  dirty,
  onDiscard,
  onSend,
  validation,
}: {
  dirty: boolean;
  onDiscard: () => void;
  onSend: () => Promise<void>;
  validation: { valid: boolean; errors: string[] };
}) {
  return (
    <div className={`sub-send${dirty ? " dirty" : ""}`} role="region" aria-label="Send to Monday">
      {dirty && <AlertTriangle className="ico" />}
      <div className="grow">
        {dirty ? (
          <>
            <b>Unsaved changes.</b> Not on Monday until you press Send.
          </>
        ) : (
          <span className="muted">Every change on this profile saves here.</span>
        )}
      </div>
      {dirty && (
        <button type="button" className="btn ghost sm" onClick={onDiscard}>
          <RotateCcw style={{ width: 13, height: 13 }} /> Discard
        </button>
      )}
      <SendToMondayButton
        onSend={onSend}
        disabled={!validation.valid}
        validationErrors={validation.errors}
      />
    </div>
  );
}

/**
 * Brandon's `ordersPage`: the **upcoming order**, then the **latest order**,
 * then the history table (§5.46b).
 *
 * Josh, 2026-09-22: *"Order tab should look identical to the redesign view,
 * like: Should show the upcoming order and latest order information on top"*.
 * What shipped was the history table alone, so the answer to the question this
 * tab exists for — *where is my order, and when is the next one* — was a row a
 * rep had to find and read across.
 *
 * ⚠️ **They are two different orders and the card says which.** The upcoming
 * one is the Subscription board's NEXT ORDER DATE — a box that does not exist
 * yet — and the latest is the most recent row on the New Order Board. Merging
 * them into one "current order" card is how a rep tells a patient their next
 * delivery has shipped.
 */
function OrdersTab({
  orders,
  loading,
  error,
  hasPhone,
  overview,
  reorder,
  expected,
}: {
  orders: Order[] | null;
  loading: boolean;
  error: string;
  hasPhone: boolean;
  /** The Subscription board's own next-order facts, for the upcoming card. */
  overview: OverviewFact[];
  /** The lines the next order is expected to carry (§5.46d). */
  expected: string[];
  /** The reorder form, also the Subscription board's own (§5.46c). */
  reorder: ReorderForm | null;
}) {
  // ⚠️ A patient with no number on file gets an honest sentence, never an
  // unfiltered board read — that would hand one patient's screen every order in
  // the company (`fetchOrdersForPatient` fails closed for the same reason).
  /* ⚠️ The upcoming card rides on EVERY branch below, the failures included:
     it is read from the Subscription board, which this screen already has in
     hand, so "we could not reach the order board" must not also take away the
     one fact that did not come from it (§9 — a failed read is not an empty
     answer, and it is not an excuse to blank what did load). */
  const upcoming = (
    <UpcomingOrder facts={overview} reorder={reorder} expected={expected} />
  );

  // ⚠️ A patient with no number on file gets an honest sentence, never an
  // unfiltered board read — that would hand one patient's screen every order in
  // the company (`fetchOrdersForPatient` fails closed for the same reason).
  if (!hasPhone) {
    return (
      <>
        {upcoming}
        <section className="card pad small muted">
          No phone number on this record, and orders are matched by number — add one on the profile
          page to see this patient&apos;s order history.
        </section>
      </>
    );
  }
  if (error) {
    return (
      <>
        {upcoming}
        <section className="card pad small">
          <b>Couldn&apos;t read the order board.</b> <span className="muted">{error}</span>
        </section>
      </>
    );
  }
  if (loading && !orders) {
    return (
      <>
        {upcoming}
        <section className="card pad small muted">Reading the order board…</section>
      </>
    );
  }
  if (!orders?.length) {
    return (
      <>
        {upcoming}
        <section className="card pad small muted">
          No orders on the order board for this number. The first one is created at Final Profile
          Confirmation.
        </section>
      </>
    );
  }

  // Newest first — "where is my order" means the latest one. Ties keep Monday's
  // own order, which is item id, i.e. the order in which they were created.
  const rows = [...orders].sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""));

  return (
    <>
      {upcoming}
      <LatestOrder order={rows[0]} />
      <section className="card">
      <div className="section-h ordhead">
        <div>
          <b className="small">Order history</b>
          <div className="xs muted">
            {rows.length} order{rows.length === 1 ? "" : "s"} on the order board · newest first ·
            click a row to open it
          </div>
        </div>
      </div>
      <div className="scroll-x">
        <table className="otable">
          <thead>
            <tr>
              <th>Order #</th>
              <th>Created</th>
              <th>Type</th>
              <th>Items</th>
              <th>Status</th>
              <th>Shipped</th>
              <th>Delivered</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o, i) => (
              <OrderRow key={o.id} order={o} latest={i === 0} />
            ))}
          </tbody>
        </table>
      </div>
      </section>
    </>
  );
}

/**
 * Brandon's `upcomingOrder` — the box that has NOT gone out yet.
 *
 * ⚠️ **Every fact here is the Subscription board's**, not the order board's:
 * there is no item for a delivery that has not been created. So it renders
 * even when the order read failed, and it renders "—" rather than borrowing
 * the latest order's date, which would answer a different question.
 */
function UpcomingOrder({
  facts,
  reorder,
  expected,
}: {
  facts: OverviewFact[];
  reorder: ReorderForm | null;
  expected: string[];
}) {
  const next = facts.find((f) => f.label === "Next order");
  return (
    <section className="card pad left-teal">
      <div className="section-h" style={{ marginBottom: 10 }}>
        <div className="eyebrow">Upcoming order</div>
        {next?.note && (
          <span className={`chip${next.warn ? " amber" : ""}`}>{next.note}</span>
        )}
      </div>
      <div className="strip upstrip">
        {facts
          /* ⚠️ Brandon's strip is Next order · Subscription · Expected items ·
             Reorder form — his `upcomingOrder` carries neither First order nor
             **Status**, and Status is not lost by dropping it: it is the first
             fact on the Profile tab's own overview strip, one click away. The
             "3 days overdue" chip in the header above already answers the
             question Status is read for here. */
          .filter((f) => f.label !== "First order" && f.label !== "Status")
          .map((f) => (
            <div className="fact" key={f.label}>
              <div className="k">{f.label}</div>
              <div className="v">
                {f.value || "—"}
                {f.label !== "Next order" && f.note && (
                  <span className="xs muted" style={{ marginLeft: 6 }}>
                    {f.note}
                  </span>
                )}
              </div>
            </div>
          ))}
        {/* Brandon's third column (§5.46d). ⚠️ One line per product, and a
            line with no quantity is a product whose quantity nobody has filled
            in — 82% of the CGM-serving rows measured — never a zero. */}
        <div className="fact">
          <div className="k">Expected items</div>
          <div className="v exp">
            {expected.length
              ? expected.map((l) => <div key={l}>{l}</div>)
              : "\u2014"}
          </div>
        </div>
        {/* Brandon's fourth column. ⚠️ Rendered as a FACT in the same grid,
            not as a card of its own: he draws it level with Next order and
            Subscription, and the three facts beside it already leave exactly
            this slot free in a four-column strip. */}
        {reorder && <ReorderFact form={reorder} />}
      </div>
    </section>
  );
}

/**
 * The reorder form — what the patient answered on the link we texted
 * (§5.46c). Rule: `lib/patient/reorderForm.ts`.
 *
 * ⚠️ **There is no Resend and no Send now, and Copy link is there in their
 * place.** Both of Brandon's buttons are writes with nothing behind them — the
 * Subscription board has no trigger column for the reorder text, so it is sent
 * by the `reorder-patient-form` service and a button here would be a new
 * integration with it. The form URL is on the row, so copying it and sending
 * it from the Communications hub is the move a rep can actually make; a
 * greyed-out *Resend* would be a control whose only stated move is impossible
 * (§5.10 · §5.20 · §5.31c · §5.31f · §5.39d).
 */
function ReorderFact({ form: f }: { form: ReorderForm }) {
  const answered = f.state === "responded";
  const orderTone = responseTone(f.orderResponse);
  const insTone = responseTone(f.insuranceResponse);
  return (
    <div className="fact reorder">
      <div className="k">Reorder form</div>
      {f.state === "not-sent" ? (
        <div className="v gone">Not sent yet</div>
      ) : (
        <>
          <div className="v">
            <span className={`chip${orderTone ? ` ${orderTone}` : ""}`}>
              {answered ? f.orderResponse : "No response yet"}
            </span>
            {f.insuranceResponse && (
              <span className={`chip${insTone ? ` ${insTone}` : ""}`}>
                Ins. {f.insuranceResponse}
              </span>
            )}
          </div>
          {f.answeredAt && (
            /* ⚠️ Labelled by the STATE, never on its own: "No Response" is a
               reset for the next cycle and the stamp does not reset with it,
               so a patient we are waiting on today can still be carrying
               June's timestamp. "submitted" is only honest beside a live
               answer. */
            <div className="xs muted rl">
              {answered ? "submitted" : "last answered"} {f.answeredAt}
            </div>
          )}
          {f.latestChange && <div className="xs rl chg">{f.latestChange}</div>}
          {f.helpMessage && <div className="xs rl help">&ldquo;{f.helpMessage}&rdquo;</div>}
        </>
      )}
      {!!f.link && (
        <div className="rl rbtns">
          <a className="btn outline xs" href={f.link} target="_blank" rel="noreferrer">
            Open form <ArrowUpRight style={{ width: 11, height: 11 }} />
          </a>
          <CopyLink url={f.link} />
        </div>
      )}
      {f.textSent && <div className="xs muted rl">texted {f.textSent}</div>}
    </div>
  );
}

/**
 * ⚠️ A clipboard refusal (an insecure origin, a permissions policy) SAYS so
 * rather than silently doing nothing — the same rule `CopyPhoneButton` keeps
 * (§5.31f).
 */
function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't copy the link — your browser blocked the clipboard");
        }
      }}
    >
      <Copy style={{ width: 11, height: 11 }} /> {copied ? "Copied" : "Copy link"}
    </button>
  );
}

/**
 * Brandon's "Latest order" header — the most recent row on the New Order
 * Board, answered in ONE sentence.
 *
 * ⚠️ **`orderHeadline` and `orderStage` are the orders page's own rules, never
 * a second reading of the status columns here** (§5.35): the group is not the
 * stage on that board and the API status is, so a local rule would have this
 * card disagreeing with the page its own button opens.
 *
 * ⚠️ It is a SUMMARY. Everything that acts on an order — placing it, the
 * backorder substitution, the cash-pay link — stays on `/orders`, because each
 * of those writes, and two writers for one column is the failure this codebase
 * keeps recording (§5.31c · §5.31d).
 */
function LatestOrder({ order: o }: { order: Order }) {
  const head = orderHeadline(o);
  const lines = orderLines(o);
  return (
    <section className="card pad">
      <div className="section-h" style={{ marginBottom: 10 }}>
        <div>
          <div className="eyebrow">Latest order</div>
          <b style={{ fontSize: 15 }}>{head.text}</b>
          {head.detail && <div className="xs muted">{head.detail}</div>}
        </div>
        <Link className="btn outline sm" to={`/orders?orderId=${o.id}&from=patient`}>
          Open order <ArrowUpRight style={{ width: 13, height: 13 }} />
        </Link>
      </div>
      <div className="strip">
        <div className="fact">
          <div className="k">Order #</div>
          <div className="v mono">{o.cahOrderNumber || o.poNumber || `#${o.id.slice(-4)}`}</div>
        </div>
        <div className="fact">
          <div className="k">Placed</div>
          <div className="v">{o.orderDate ? fmtDate(o.orderDate) : "—"}</div>
        </div>
        <div className="fact">
          <div className="k">Status</div>
          <div className="v">
            <StagePill stage={orderStage(o)} size="sm" />
          </div>
        </div>
        <div className="fact">
          <div className="k">{o.deliveryDate ? "Delivered" : "Shipped"}</div>
          <div className="v">
            {o.deliveryDate
              ? fmtDate(o.deliveryDate)
              : o.shipDate
                ? fmtDate(o.shipDate)
                : "—"}
            {!o.deliveryDate && o.carrier && (
              <span className="xs muted" style={{ marginLeft: 6 }}>
                {o.carrier}
              </span>
            )}
          </div>
        </div>
      </div>
      {!!lines.length && (
        <p className="xs muted" style={{ margin: "10px 2px 0" }}>
          {lines.map((l) => `${l.quantity} × ${l.product}`).join(", ")}
        </p>
      )}
    </section>
  );
}

function OrderRow({ order: o, latest }: { order: Order; latest: boolean }) {
  // ⚠️ The stage comes from `orderStage`/`StagePill`, the same pair the orders
  // page wears — never a second reading of the status columns here. The group
  // is not the stage on that board and the API status is (§5.35), so a local
  // rule would disagree with the page this row opens.
  const lines = orderLines(o);
  const to = `/orders?orderId=${o.id}&from=patient`;

  return (
    <tr>
      <td className="mono">
        <Link to={to} className="ordlink">
          {o.cahOrderNumber || o.poNumber || `#${o.id.slice(-4)}`}
          {latest && <span className="chip blue latest">latest</span>}
          <ArrowUpRight style={{ width: 12, height: 12 }} />
        </Link>
      </td>
      <td>{o.orderDate ? fmtDate(o.orderDate) : "—"}</td>
      <td>
        {o.orderType || "—"}
        {o.subscriptionType && <div className="xs muted">{o.subscriptionType}</div>}
      </td>
      <td className="items">
        {lines.length
          ? lines.map((l) => `${l.quantity} × ${l.product}`).join(", ")
          : "—"}
      </td>
      <td>
        <StagePill stage={orderStage(o)} size="sm" />
      </td>
      <td>
        {o.shipDate ? fmtDate(o.shipDate) : "—"}
        {o.carrier && (
          <div className="xs muted">
            {o.carrier}
            {o.tracking[0] ? ` · ${o.tracking[0]}` : ""}
          </div>
        )}
      </td>
      <td>{o.deliveryDate ? fmtDate(o.deliveryDate) : "—"}</td>
    </tr>
  );
}
