/**
 * Parity guard for the gateway batch fast path (verifiedWrite.ts:154).
 *
 * When every task in a send carries a raw `value` AND a boardId is passed, the
 * whole transaction is handed to the gateway's `/send`, which writes those
 * values with ONE `change_multiple_column_values`. On that path a task's `fn`
 * is NEVER CALLED — the declared `value` is what reaches Monday. On the client
 * fallback path the opposite is true: the `fn` runs and the `value` is ignored.
 *
 * So a `value` that disagrees with its own `fn` writes DIFFERENT DATA depending
 * on which path happened to run, with nothing erroring. That is the one failure
 * this conversion can introduce, and it is invisible in review — the two shapes
 * live in different files (mondayWrite.ts vs mondayApi.ts).
 *
 * This test proves they agree the only way that is worth anything: it captures
 * the REAL task list each send builds, calls each task's `fn` against a stubbed
 * fetch, and compares the bytes Monday would actually have received against the
 * task's declared `value`.
 *
 * It also pins the two preconditions of the fast path itself. Miss either and
 * the change is inert — every send silently keeps taking the parallel client
 * path that produced the "Item link max locks exceeded" failures:
 *   1. EVERY task carries a `value`  (tasks.every(t => t.value !== undefined))
 *   2. a boardId is passed at EVERY executeWritesWithVerification call site
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Capture what each send hands to verifiedWrite, without executing it ──
interface CapturedSend {
  tasks: Array<{ label: string; columnId: string; value?: unknown; expectedText?: string; fn: () => Promise<unknown> }>;
  boardId?: string;
  stageColumnId: string | string[];
  /** Mutations the send fired BEFORE handing the batch over — i.e. the hoisted
   *  create-label writes. Snapshotted here because `sent` is reused per task. */
  preBatch?: SentCall[];
}
const captured: CapturedSend[] = [];

vi.mock("./verifiedWrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./verifiedWrite")>();
  return {
    ...actual,
    executeWritesWithVerification: async (opts: CapturedSend) => {
      captured.push({ ...opts, preBatch: [...sent] });
      return [] as string[];
    },
  };
});

// ── Record the exact GraphQL bodies a task's fn would POST ──
interface SentCall { query: string; variables: Record<string, unknown> }
const sent: SentCall[] = [];

beforeEach(() => {
  captured.length = 0;
  sent.length = 0;
  // vi.stubEnv is what actually reaches the modules under test — a direct
  // assignment here only mutates THIS module's import.meta.env copy.
  vi.stubEnv("VITE_MONDAY_API_TOKEN", "test-token");
  globalThis.fetch = (async (_url: unknown, init: { body: string }) => {
    const call = JSON.parse(init.body) as SentCall;
    // A send may READ before it writes — the notes guard asks the board for the
    // column's live type (lib/shared/columnType) before building its tasks.
    // That is a query, not a mutation: answer it (as long_text, so the guard
    // behaves as it does today) and keep it out of `sent`, which is the record
    // of what a task's fn WRITES.
    if (/^\s*query\b/.test(call.query)) {
      const cols = ((call.variables?.cols as string[] | undefined) ?? []).map((id) => ({ id, type: "long_text" }));
      return { ok: true, status: 200, json: async () => ({ data: { boards: [{ columns: cols }] } }), text: async () => "{}" };
    }
    sent.push(call);
    return { ok: true, status: 200, json: async () => ({ data: {} }), text: async () => "{}" };
  }) as unknown as typeof fetch;
});

/** What a single recorded mutation actually writes, normalised to the shape
 *  `change_multiple_column_values` would take for the same column. */
function batchEquivalentOf(call: SentCall): { columnId: string; value: unknown } {
  const q = call.query;
  const v = call.variables ?? {};
  const columnId =
    (v.columnId as string | undefined) ?? q.match(/column_id:\s*"([^"]+)"/)?.[1] ?? "(unknown)";

  if (/change_simple_column_value/.test(q)) {
    // Simple writes take a bare string. The batch equivalent is a plain string
    // for the item name, and { label } for a status column.
    const raw =
      v.value !== undefined
        ? String(v.value)
        : JSON.parse(q.match(/value:\s*("(?:[^"\\]|\\.)*")/)?.[1] ?? '""');
    return { columnId, value: columnId === "name" ? raw : { label: raw } };
  }
  // change_multiple_column_values IS the batch shape: `vals` is a JSON object of
  // { columnId: value }. The notes writers use it with a BARE string since
  // 2026-09-03 (accepted for both long_text and text — the notes columns are
  // mid-conversion, CLAUDE.md §10), so the batch equivalent is that one entry.
  if (/change_multiple_column_values/.test(q)) {
    const obj = JSON.parse(String(v.vals ?? v.column_values ?? "{}")) as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length !== 1) throw new Error(`expected exactly one column in a helper's batch write, got ${keys.length}`);
    return { columnId: keys[0], value: obj[keys[0]] };
  }
  // change_column_value takes JSON — exactly the per-column shape the batch uses.
  // Most helpers pass it as the $value GraphQL variable, but profile's
  // writeDropdownLabels has to inline it in the query string (create_labels_if_missing
  // is a top-level mutation argument, not a column-value field), so the payload
  // arrives as a JSON string literal embedded in the query: parse the literal to
  // get the inner JSON text, then parse that to get the value itself.
  if (v.value === undefined) {
    const inline = q.match(/value:\s*("(?:[^"\\]|\\.)*")/)?.[1];
    if (inline === undefined) throw new Error(`could not find a value in mutation: ${q.slice(0, 200)}`);
    return { columnId, value: JSON.parse(JSON.parse(inline) as string) };
  }
  return { columnId, value: JSON.parse(String(v.value)) };
}

/** Run every task's fn and assert the bytes match its declared `value`. */
async function expectParity(send: CapturedSend, where: string) {
  expect(send.tasks.length, `${where}: built no tasks`).toBeGreaterThan(0);

  // Precondition 1 — a single missing value disables the fast path for the whole send.
  const missing = send.tasks.filter((t) => t.value === undefined).map((t) => `${t.label} (${t.columnId})`);
  expect(missing.join(" | "), `${where}: tasks missing a raw value — fast path stays OFF`).toBe("");

  // Precondition 2 — no boardId means the fast path can never engage either.
  expect(send.boardId, `${where}: no boardId passed`).toBeTruthy();

  // Precondition 3 — no two tasks may write the same column with DIFFERENT
  // values. The gateway path folds the task list into an object
  // (`dataColumns[t.columnId] = t.value`, verifiedWrite.ts), so when two tasks
  // name one column only the LAST survives — silently. The client path instead
  // fires both mutations in parallel, where the winner is whichever Monday
  // happens to index last. So a column with two DISAGREEING opinions in one
  // send has no defined outcome on either path, and the batch merely makes the
  // wrong one deterministic — that is the bug this pins (it is what let the
  // duplicated per-product auth loop silently undo the "No Auth Needed" clears).
  //
  // Two tasks writing the SAME value are only redundant: they collapse to one
  // write with the identical result, which is a mutation the batch saves rather
  // than a hazard. Trigger DVS / Trigger Pump DVS do exactly this — an
  // auto-at-DVS push and the rep's manual toggle both set the same index.
  const byColumn = new Map<string, { label: string; value: unknown }[]>();
  for (const t of send.tasks) {
    byColumn.set(t.columnId, [...(byColumn.get(t.columnId) ?? []), { label: t.label, value: t.value }]);
  }
  const conflicts = [...byColumn.entries()]
    .filter(([, ts]) => ts.length > 1 && new Set(ts.map((t) => JSON.stringify(t.value))).size > 1)
    .map(([columnId, ts]) => `${columnId} <- ${ts.map((t) => `${t.label}=${JSON.stringify(t.value)}`).join(" THEN ")}`);
  expect(conflicts.join(" ;; "), `${where}: one column, two different values — the batch silently keeps only the last`).toBe("");

  // Precondition 4 — a column written BOTH outside and inside the batch must
  // carry `expectedText`. verifiedWrite Phase 2 falls back to snapshot-diff,
  // whose 3-stable-reads escape hatch reads "unchanged from snapshot" as
  // "same-value write, already correct". That holds only when the snapshot is
  // the value BEFORE the transaction. A hoisted write breaks that: the snapshot
  // is taken after it, so if it has not indexed yet the baseline is the OLD
  // value, every poll reads "unchanged", and the advancer fires on stale data.
  // Exact-match verification has no escape hatch. Derived from what the send
  // actually wrote before the handover, so a new hoist is covered automatically.
  const hoistedColumns = new Set(
    (send.preBatch ?? []).map((c) => batchEquivalentOf(c).columnId),
  );
  const unguarded = send.tasks
    .filter((t) => hoistedColumns.has(t.columnId) && t.expectedText === undefined)
    .map((t) => `${t.label} (${t.columnId})`);
  expect(unguarded.join(" | "), `${where}: written outside the batch AND inside it, but verified only by snapshot-diff`).toBe("");

  for (const task of send.tasks) {
    sent.length = 0;
    await task.fn();

    // A fn that writes nothing (planPhoneWrite/planEmailWrite "skip", the blank
    // -address location no-op) must not be in the list at all: the batch would
    // write its `value` where the old path deliberately wrote nothing.
    expect(sent.length, `${where}: "${task.label}" fn made ${sent.length} writes, expected exactly 1`).toBe(1);

    const actual = batchEquivalentOf(sent[0]);
    expect(actual.columnId, `${where}: "${task.label}" columnId mismatch`).toBe(task.columnId);
    expect(actual.value, `${where}: "${task.label}" (${task.columnId}) value disagrees with its own fn`)
      .toEqual(task.value);
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────
function samanthaPatient(overrides: Record<string, unknown> = {}) {
  return {
    id: "111",
    name: "Parity Test",
    dob: "1970-01-01",
    product: "CGM",
    serving: "Insulin Pump + CGM",
    primaryInsurance: "Medicare A&B",
    secondaryInsurance: "",
    memberId1: "M1",
    memberId2: "M2",
    payer: "",
    doctorName: "Dr Who",
    doctorNpi: "1234567890",
    doctorPhone: "3475550101",
    doctorEmail: "dr@example.com",
    doctorFax: "3475550102@rcfax.com",
    doctorClinic: "",
    clinicAddress: "1 Main St, Albany, NY 12207",
    patientPhone: "3475550103",
    patientAddress: "2 Oak Rd, Albany, NY 12207",
    contactMethod: "parachute",
    stage: "advanced",
    pillars: {},
    pathwayChecks: {},
    chaseStep: 0,
    faxPhase: 1,
    notes: "parity note",
    receivedAt: "",
    lastUpdated: "",
    owner: "Samantha",
    ...overrides,
  };
}

function finalConfirmPatient(overrides: Record<string, unknown> = {}) {
  // Every field the Patient interface requires, defaulted, so the fixture keeps
  // compiling as the stage grows. The overlay below turns on the branches that
  // actually build write tasks.
  const blank = {
    id: "", name: "", dob: "", phone: "", email: "", address: "", gender: "", genderIndex: null,
    primaryInsurance: "", primaryInsuranceIndex: null, memberId1: "", secondaryInsurance: "",
    secondaryInsuranceIndex: null, secondaryInsuranceEdited: null, memberId2: "", memberId2Edited: null,
    planName: "", deductible: "", deductibleRemaining: "", coInsurance: "", oopMax: "", oopMaxRemaining: "",
    doctorName: "", doctorNpi: "", doctorPhone: "", doctorEmail: "", doctorFax: "", clinicName: "",
    clinicalsMethod: "", clinicalsMethodIndex: null, clinicAddress: "", clinicAddressEdited: null,
    clinicAddressLat: null, clinicAddressLng: null, diagnosis: "", diagnosisIndex: null,
    cgmCoveragePath: "", cgmCoveragePathIndex: null, ipCoveragePath: "", ipCoveragePathIndex: null,
    mrExpiryDate: "", serving: "", servingIndex: null, pumpType: "", pumpTypeIndex: null,
    cgmType: "", cgmTypeIndex: null, requestType: "", requestTypeIndex: null, referralType: "",
    referralTypeIndex: null, referralSource: "", referralSourceIndex: null, carecentrixIntakeId: "",
    subscriptionType: "", subscriptionTypeIndex: null, infusionSet1: "", infusionSet1Index: null,
    qtyInf1: "", infusionSet2: "", infusionSet2Index: null, qtyInf2: "", qtyCartridge: "",
    monitorQty: "", pumpQty: "", medicarePriorPumpDate: "", monitorPurchaseDate: "",
    sosNeverBilledMonitor: false, sosLastBillMonitor: "", orderHandling: "", orderHandlingIndex: null,
    pos: "", posIndex: null, sosMonitor: "", sosSensors: "", sosIp: "", sosInfusionSet: "",
    sosCartridge: "", lastBillDateMonitor: "", lastBillDateSensors: "", lastBillDateIp: "",
    lastBillDateInfusionSet: "", lastBillDateCartridge: "", nextOrderDateIp: "", nextOrderDateSensors: "",
    nextOrderDateSupplies: "", cgmAuthResult: "", cgmAuthResultIndex: null, sensorsAuthResult: "",
    sensorsAuthResultIndex: null, ipAuthResult: "", ipAuthResultIndex: null, infusionSetAuthResult: "",
    infusionSetAuthResultIndex: null, cartridgeAuthResult: "", cartridgeAuthResultIndex: null,
    monitorAuthId: "", monitorAuthStart: "", monitorAuthEnd: "", monitorAuthUnits: "",
    sensorsAuthId: "", sensorsAuthStart: "", sensorsAuthEnd: "", sensorsAuthUnits: "",
    ipAuthId: "", ipAuthStart: "", ipAuthEnd: "", ipAuthUnits: "",
    infusionSetAuthId: "", infusionSetAuthStart: "", infusionSetAuthEnd: "", infusionSetAuthUnits: "",
    cartridgeAuthId: "", cartridgeAuthStart: "", cartridgeAuthEnd: "", cartridgeAuthUnits: "",
    a4230Claim: "", a4232Claim: "", notes: "", addressEdited: null, addressLat: null, addressLng: null,
    emailEdited: null, phoneEdited: null, escalated: false, receivedAt: "", lastUpdated: "",
    dateOfStageStart: "",
  };
  return {
    ...blank,
    id: "222",
    name: "Parity Confirm",
    dob: "1970-01-01",
    phone: "3475550201",
    email: "pt@example.com",
    address: "3 Elm St, Albany, NY 12207",
    gender: "Female",
    genderIndex: 1,
    primaryInsurance: "Medicare A&B",
    primaryInsuranceIndex: 8,
    memberId1: "M1",
    coInsurance: "20",
    oopMax: "5000",
    doctorName: "Dr Who",
    doctorNpi: "1234567890",
    doctorPhone: "3475550202",
    doctorEmail: "dr@example.com",
    doctorFax: "3475550203@rcfax.com",
    clinicAddress: "1 Main St, Albany, NY 12207",
    // Non-empty diagnosis is what exercises the create_labels_if_missing hoist.
    diagnosis: "Type 1 Diabetes",
    diagnosisIndex: 0,
    serving: "Insulin Pump + CGM",
    servingIndex: 4,
    pumpType: "Tandem t:slim X2",
    cgmType: "Dexcom G7",
    subscriptionType: "Sensors & Supplies",
    qtyInf1: "10",
    qtyCartridge: "3",
    monitorQty: "1",
    pumpQty: "1",
    pos: "Home",
    posIndex: 1,
    notes: "parity note",
    ...overrides,
  };
}

function profilePatient(overrides: Record<string, unknown> = {}) {
  // Every field the profile Patient interface requires, defaulted, so the fixture
  // keeps compiling as the stage grows. The overlay turns on the branches that
  // actually build write tasks.
  const blank = {
    id: "", name: "", dob: "", ptPhone: "", email: "", gender: "", dateOfIntake: "",
     patientAddress: "", patientAddressLat: null, patientAddressLng: null, alreadyInSystem: "",
     moveToOnboarding: "", notes: "", formReasonForInquiry: "", formState: "", formDropOffStep: "",
     formSessionId: "", formPumpNeed: "", formCgmPreference: "", formPumpPreference: "",
     formProvidedDoctorName: "", formProvidedClinicPhone: "", formCardPhoto: "", cgmDataFile: "",
     formCardPhotoIds: "", cgmDataFileIds: "", formInsuranceVia: "", formInsuranceOther: "",
     formSecondaryProvided: "", formSecondaryMemberId: "", formProceedPreference: "",
     formCallSlot: "", formBookingStatus: "", scheduledCallTime: "", selfAdvocacy: "",
     currentOopCost: "", cgmDataAwareness: "", attemptCounter: "", dropOffAttempt: "",
     intakeCallComplete: "", intakeEscalation: "", dupCheckResult: "", intakeSubStage: "",
     followUp: "", followUpDate: "", runStediEligibility: "", stediEligibilityActive: "",
     stediCoverageType: "", stediPayerName: "", stediMedicareAdvantage: "",
     stediMedicareAdvantageCarrier: "", stediMedicareAdvantageMemberId: "", stediQmb: "",
     stediMedicareJurisdiction: "", stediMedicaidMltc: "", stediManagedMedicaid: "",
     stediPrimaryPayer: "", stediInNetwork: "", stediPriorAuthRequired: "", stediCoinsurance: "",
     stediCopay: "", stediIndividualDeductible: "", stediIndividualDeductibleRemaining: "",
     stediFamilyDeductible: "", stediFamilyDeductibleRemaining: "", stediIndividualOopMax: "",
     stediIndividualOopMaxRemaining: "", stediFamilyOopMax: "", stediFamilyOopMaxRemaining: "",
     stediPlanBeginDate: "", stediErrorDescription: "", stediSecondaryMedicaidId: "",
     stediPlanName: "", stediGender: "", stediMedicaidId: "", stediHomePlan: "", stediAddress: "",
     stediFacilityFlags: "", primaryInsurance: "", generalInsurance: "", workingMemberId: "",
     memberId1: "", memberId2: "", secondaryInsurance: "", oopFirst: "", oopRecurring: "",
     workingCoinsurance: "", workingDeductible: "", workingDeductibleRemaining: "",
     workingOopMax: "", workingOopMaxRemaining: "", doctorStatus: "", doctorName: "",
     doctorPhone: "", doctorNpi: "", clinicalsMethod: "", doctorEmail: "", doctorFax: "",
     clinicName: "", clinicAddress: "", clinicAddressLat: null, clinicAddressLng: null,
     prescriberRequirements: "", referralType: "", referralSource: "", pumpType: "", cgmType: "",
     requestType: "", cgmCrossSell: "", serving: "", insulinPumpCoveragePath: "",
     cgmCoveragePath: "",
  };
  return {
    ...blank,
    id: "301",
    name: "Parity Profile",
    dob: "1970-01-01",
    ptPhone: "3475550301",
    email: "pt@example.com",
    gender: "Female",
    patientAddress: "4 Pine St, Albany, NY 12207",
    primaryInsurance: "Medicare A&B",
    generalInsurance: "Medicare A&B",
    workingMemberId: "W1",
    memberId1: "M1",
    memberId2: "M2",
    secondaryInsurance: "Medicaid",
    doctorName: "Dr Who",
    doctorPhone: "3475550302",
    doctorNpi: "1234567890",
    doctorEmail: "dr@example.com",
    doctorFax: "3475550303@rcfax.com",
    clinicName: "The Office",
    clinicAddress: "1 Main St, Albany, NY 12207",
    clinicalsMethod: "Fax",
    // A non-empty Stedi plan name is what exercises the create-labels hoist:
    // profile's writeDropdownLabels ALWAYS sends create_labels_if_missing.
    stediPlanName: "Some Plan Name",
    stediPlanBeginDate: "2026-01-01",
    // Numeric cells — profile's writeNumber strips formatting and SKIPS an
    // empty result, so these exercise both halves of HAZARD 1b.
    workingCoinsurance: "20",
    workingDeductible: "$1,234",
    workingOopMax: "5000",
    serving: "Insulin Pump + CGM",
    requestType: "Insulin Pump + CGM",
    cgmType: "Dexcom G7",
    pumpType: "Tandem t:slim X2",
    notes: "parity note",
    ...overrides,
  };
}

function welcomeCallPatient(overrides: Record<string, unknown> = {}) {
  // Every field the welcomeCall Patient interface requires, defaulted, so the fixture
  // keeps compiling as the stage grows. The overlay turns on the branches that
  // actually build write tasks.
  const blank = {
    id: "", name: "", dob: "", phone: "", email: "", address: "", gender: "", primaryInsurance: "",
     primaryInsuranceIndex: null, primaryInsuranceEdited: null, primaryInsuranceIndexEdited: null,
     memberId1: "", memberId1Edited: null, secondaryInsurance: "", memberId2: "", serving: "",
     servingIndex: null, servingEdited: null, servingIndexEdited: null, pumpType: "",
     pumpTypeIndex: null, cgmType: "", cgmTypeIndex: null, requestType: "", doctorName: "",
     doctorNpi: "", referralSource: "", referralReceivedDate: "", diagnosis: "", notes: "",
     secondaryInsuranceIndex: null, secondaryInsuranceEdited: null, memberId2Edited: null,
     monitorQty: "", pumpQty: "", qtyInf1: "", infusionSet1: "", infusionSet1Index: null,
     qtyInf2: "", infusionSet2: "", infusionSet2Index: null, qtyCartridge: "",
     medicarePriorPumpDate: "", monitorPurchaseDate: "", subscriptionType: "",
     subscriptionTypeIndex: null, welcomeCallText: "", welcomeCallTextIndex: null,
     orderHandling: "", orderHandlingIndex: null, callAttempts: "", followUp: "", followUpDate: "",
     cgmAuthResult: "", sensorsAuthResult: "", ipAuthResult: "", infusionSetAuthResult: "",
     cartridgeAuthResult: "", cgmAuthStart: "", cgmAuthEnd: "", sensorsAuthStart: "",
     sensorsAuthEnd: "", ipAuthStart: "", ipAuthEnd: "", infusionSetAuthStart: "",
     infusionSetAuthEnd: "", cartridgeAuthStart: "", cartridgeAuthEnd: "", pos: "", deductible: "",
     deductibleRemaining: "", oopMax: "", oopMaxRemaining: "", stediCoinsurance: "", stediQmb: "",
     cgmLastBillDate: "", sensorsLastBillDate: "", ipLastBillDate: "", infusionSetLastBillDate: "",
     cartridgeLastBillDate: "", ipNextOrderDate: "", sensorsNextOrderDate: "",
     suppliesNextOrderDate: "", ipNextOrderDateEdited: null, sensorsNextOrderDateEdited: null,
     suppliesNextOrderDateEdited: null, advanceDecision: "", advanceDecisionIndex: null,
     phoneEdited: null, addressEdited: null, addressLat: null, addressLng: null, escalated: false,
     receivedAt: "", lastUpdated: "", neverBilledIsCar: false, neverBilledCgm: false,
     sosNeverBilledMonitor: false, sosLastBillMonitor: "",
  };
  return {
    ...blank,
    id: "302",
    name: "Parity Welcome",
    dob: "1970-01-01",
    phone: "3475550401",
    email: "pt@example.com",
    address: "5 Cedar Ave, Albany, NY 12207",
    gender: "Female",
    primaryInsurance: "Medicare A&B",
    primaryInsuranceIndex: 8,
    memberId1: "M1",
    serving: "Insulin Pump + CGM",
    servingIndex: 4,
    pumpType: "Tandem t:slim X2",
    pumpTypeIndex: 1,
    cgmType: "Dexcom G7",
    cgmTypeIndex: 1,
    doctorName: "Dr Who",
    doctorNpi: "1234567890",
    diagnosis: "Type 1 Diabetes",
    monitorQty: "1",
    pumpQty: "1",
    qtyInf1: "10",
    qtyInf2: "0",
    qtyCartridge: "3",
    infusionSet1Index: 1,
    subscriptionTypeIndex: 1,
    orderHandlingIndex: 1,
    pos: "Home",
    notes: "parity note",
    ...overrides,
  };
}

function subscriptionPatient(overrides: Record<string, unknown> = {}) {
  // Every field the subscription Patient interface requires, defaulted, so the fixture
  // keeps compiling as the stage grows. The overlay turns on the branches that
  // actually build write tasks.
  const blank = {
    id: "", name: "", status: "", statusIndex: null, daysToOrder: "", daysToOrderIndex: null,
     orderingCycle: "", orderingCycleIndex: null, nextOrder: "", subscription: "",
     subscriptionIndex: null, orderType: "", orderTypeIndex: null, dob: "", gender: "", phone: "",
     email: "", address: "", primaryInsurance: "", primaryInsuranceIndex: null, memberId1: "",
     secondaryInsurance: "", secondaryInsuranceIndex: null, memberId2: "", sensorsRevenue: "",
     sensorsCost: "", sensorsGP: "", suppliesRevenue: "", suppliesCost: "", suppliesGP: "",
     totalRevenue: "", totalCost: "", shippingCost: "", totalGP: "", arr: "", arp: "",
     cgmCoverage: "", mr: "", mnExpiry: "", visitDate: "", diagnosis: "", sensorsAuthStatus: "",
     sensorsAuthStatusIndex: null, sensorsAuthId: "", sensorsUnits: "", sensorsStartAuth: "",
     sensorsEndAuth: "", sensorsId2: "", suppliesAuthStatus: "", suppliesAuthStatusIndex: null,
     infusionSetAuthId: "", cartridgeAuthId: "", suppliesUnits: "", suppliesStartAuth: "",
     suppliesEndAuth: "", sensorsType: "", sensorsTypeIndex: null, suppliesType: "",
     suppliesTypeIndex: null, infusionSet1: "", infusionSet1Index: null, infQty1: "",
     infusionSet2: "", infusionSet2Index: null, infQty2: "", doctor: "", npi: "", doctorAddress: "",
     doctorPhone: "", doctorFax: "", faxParachute: "", orderCount: "", deadReason: "",
     pauseReason: "", referral: "", carecentrixIntakeId: "", denialReason: "", stediActive: "",
     stediDedRemaining: "", insuranceChange: "", priorAuthReq: "", primaryClaimPaid: "",
     claimsStatus: "", phoneEdited: null, addressEdited: null, addressLat: null, addressLng: null,
     memberId1Edited: null, memberId2Edited: null, doctorEdited: null, npiEdited: null,
     doctorAddressEdited: null, doctorAddressLat: null, doctorAddressLng: null,
     doctorPhoneEdited: null, doctorFaxEdited: null, primaryInsuranceEdited: null,
     secondaryInsuranceEdited: null, faxParachuteEdited: null, notes: "", escalated: false,
     receivedAt: "", lastUpdated: "",
  };
  return {
    ...blank,
    id: "303",
    name: "Parity Subscription",
    orderingCycleIndex: 1,
    subscriptionIndex: 1,
    orderTypeIndex: 1,
    sensorsTypeIndex: 1,
    suppliesTypeIndex: 1,
    infusionSet1Index: 1,
    infusionSet2Index: 2,
    infQty1: "10",
    infQty2: "5",
    doctor: "Dr Who",
    npi: "1234567890",
    doctorAddressEdited: "1 Main St, Albany, NY 12207",
    doctorPhoneEdited: "3475550501",
    doctorFaxEdited: "3475550502@rcfax.com",
    primaryInsuranceEdited: 8,
    secondaryInsuranceIndex: 2,
    visitDate: "2026-03-01",
    faxParachute: "Parachute",
    notes: "parity note",
    ...overrides,
  };
}

// ── The suites ──────────────────────────────────────────────────────────
describe("Insurance (samantha) send — task.value matches task.fn", () => {
  const CONTEXTS = ["benefits", "submitAuth", "authOutstanding"] as const;

  for (const context of CONTEXTS) {
    it(`${context}: every task's declared value is the bytes its fn writes`, async () => {
      const { sendPatientToMonday } = await import("../samantha/mondayWrite");
      await sendPatientToMonday(samanthaPatient() as never, context);
      expect(captured.length).toBe(1);
      await expectParity(captured[0], `samantha/${context}`);
    });
  }

  it("a patient with auth details on file does not write any column twice", async () => {
    const { sendPatientToMonday } = await import("../samantha/mondayWrite");
    await sendPatientToMonday(
      samanthaPatient({
        insurance: {
          universal: { "in-network": "confirmed", active: "confirmed", "dme-benefits": "confirmed" },
          codes: {
            "cgm-sensors": {
              status: "pending",
              auth: "required",
              sos: "clear",
              authSubmissionMethod: "Portal",
              authSubmissionDate: "2026-08-01",
              authId: "AUTH-123",
              authStart: "2026-08-01",
              authEnd: "2026-12-31",
              authUnits: "90",
            },
          },
        },
      }) as never,
      "submitAuth",
    );
    await expectParity(captured[0], "samantha/auth-details");
  });

  it("No Auth Needed clears are not overwritten by a later duplicate write", async () => {
    const { sendPatientToMonday } = await import("../samantha/mondayWrite");
    await sendPatientToMonday(
      samanthaPatient({
        insurance: {
          universal: { "in-network": "confirmed", active: "confirmed", "dme-benefits": "confirmed" },
          codes: {
            "cgm-sensors": {
              status: "pending",
              auth: "required",
              sos: "clear",
              authOutstandingResult: "no-auth-needed",
              authId: "AUTH-123",
              authStart: "2026-08-01",
              authEnd: "2026-12-31",
              authUnits: "90",
            },
          },
        },
      }) as never,
      "authOutstanding",
    );
    await expectParity(captured[0], "samantha/no-auth-needed-clears");
  });

  it("an UNPARSEABLE phone/email is not written at all (planPhoneWrite/planEmailWrite skip)", async () => {
    const { sendPatientToMonday } = await import("../samantha/mondayWrite");
    await sendPatientToMonday(
      samanthaPatient({ patientPhone: "555-121", doctorPhone: "abc", doctorEmail: "not an address" }) as never,
      "benefits",
    );
    await expectParity(captured[0], "samantha/garbage-contact");
  });

  it("a BLANK phone/email clears the column rather than being skipped", async () => {
    const { sendPatientToMonday } = await import("../samantha/mondayWrite");
    await sendPatientToMonday(
      samanthaPatient({ patientPhone: "", doctorPhone: "", doctorEmail: "" }) as never,
      "benefits",
    );
    await expectParity(captured[0], "samantha/blank-contact");
  });

  it("a BLANK address is not written (writing {} to a location column creates a phantom)", async () => {
    const { sendPatientToMonday } = await import("../samantha/mondayWrite");
    await sendPatientToMonday(
      samanthaPatient({ patientAddress: "", clinicAddress: "" }) as never,
      "benefits",
    );
    await expectParity(captured[0], "samantha/blank-address");
  });
});

describe("Final Confirm send — task.value matches task.fn", () => {
  it("every task's declared value is the bytes its fn writes", async () => {
    const { sendPatientToMonday } = await import("../finalConfirm/mondayWrite");
    await sendPatientToMonday(finalConfirmPatient() as never);
    expect(captured.length).toBe(1);
    await expectParity(captured[0], "finalConfirm");
  });

  it("an UNPARSEABLE phone/email is not written at all", async () => {
    const { sendPatientToMonday } = await import("../finalConfirm/mondayWrite");
    await sendPatientToMonday(
      finalConfirmPatient({ phone: "555-121", doctorPhone: "xyz", doctorEmail: "nope" }) as never,
    );
    await expectParity(captured[0], "finalConfirm/garbage-contact");
  });

  it("a BLANK phone/email clears the column rather than being skipped", async () => {
    const { sendPatientToMonday } = await import("../finalConfirm/mondayWrite");
    await sendPatientToMonday(
      finalConfirmPatient({ phone: "", doctorPhone: "", doctorEmail: "" }) as never,
    );
    await expectParity(captured[0], "finalConfirm/blank-contact");
  });
});


describe("Patient Intake (profile) send — task.value matches task.fn", () => {
  it("every task's declared value is the bytes its fn writes", async () => {
    const { sendPatientToMonday } = await import("../profile/mondayWrite");
    await sendPatientToMonday(profilePatient() as never, null);
    expect(captured.length).toBe(1);
    await expectParity(captured[0], "profile");
  });

  it("a selected clinic (dropdown id) still round-trips", async () => {
    const { sendPatientToMonday } = await import("../profile/mondayWrite");
    await sendPatientToMonday(profilePatient() as never, 42);
    await expectParity(captured[0], "profile/clinic-id");
  });

  it("an UNPARSEABLE phone/email is not written at all", async () => {
    const { sendPatientToMonday } = await import("../profile/mondayWrite");
    await sendPatientToMonday(
      profilePatient({ ptPhone: "555-121", doctorPhone: "abc", doctorEmail: "not an address", doctorFax: "??" }) as never,
      null,
    );
    await expectParity(captured[0], "profile/garbage-contact");
  });

  it("a WHITESPACE-ONLY phone/email clears the column rather than being skipped", async () => {
    const { sendPatientToMonday } = await import("../profile/mondayWrite");
    // ⚠️ Whitespace, not "". Unlike welcomeCall, profile guards each of these
    // fields with a plain truthy check (`if (p.ptPhone)`), so an empty string
    // never reaches the task at all and a `""` fixture would test nothing. A
    // whitespace-only value passes that guard and IS what planPhoneWrite /
    // planEmailWrite trim to "clear" — the branch that would wipe a real number
    // or fax if its shape were wrong.
    await sendPatientToMonday(
      profilePatient({ ptPhone: " ", doctorPhone: "  ", doctorEmail: " ", doctorFax: "  " }) as never,
      null,
    );
    const cleared = captured[0].tasks.filter((t) =>
      ["Phone", "Doctor Phone", "Doctor Email", "Doctor Fax"].includes(t.label),
    );
    expect(cleared.length, "profile: the clear branch built no tasks — fixture is vacuous").toBe(4);
    await expectParity(captured[0], "profile/whitespace-contact");
  });

  it("a blank or non-numeric number column is not written (writeNumber returns early)", async () => {
    const { sendPatientToMonday } = await import("../profile/mondayWrite");
    await sendPatientToMonday(
      profilePatient({ workingCoinsurance: "", workingDeductible: "n/a", workingOopMax: "  " }) as never,
      null,
    );
    await expectParity(captured[0], "profile/blank-numbers");
  });
});

describe("Welcome Call send — task.value matches task.fn", () => {
  it("every task's declared value is the bytes its fn writes", async () => {
    const { sendPatientToMonday } = await import("../welcomeCall/mondayWrite");
    await sendPatientToMonday(welcomeCallPatient() as never);
    expect(captured.length).toBe(1);
    await expectParity(captured[0], "welcomeCall");
  });

  it("an UNPARSEABLE phone is not written at all", async () => {
    const { sendPatientToMonday } = await import("../welcomeCall/mondayWrite");
    await sendPatientToMonday(welcomeCallPatient({ phoneEdited: "555-121" }) as never);
    await expectParity(captured[0], "welcomeCall/garbage-phone");
  });

  it("an edited blank phone clears the column rather than being skipped", async () => {
    const { sendPatientToMonday } = await import("../welcomeCall/mondayWrite");
    await sendPatientToMonday(welcomeCallPatient({ phoneEdited: "" }) as never);
    await expectParity(captured[0], "welcomeCall/blank-phone");
  });
});

describe("Subscription send — task.value matches task.fn", () => {
  it("every task's declared value is the bytes its fn writes", async () => {
    const { sendPatientToMonday } = await import("../subscription/mondayWrite");
    await sendPatientToMonday(subscriptionPatient() as never);
    expect(captured.length).toBe(1);
    await expectParity(captured[0], "subscription");
  });

  it("an EDITED secondary insurance is not shadowed by the board value", async () => {
    const { sendPatientToMonday } = await import("../subscription/mondayWrite");
    // The rep changed it (edited = 5) while the board still says 2. Two tasks on
    // one column with different values is exactly the collapse that silently
    // discards an edit, so this fixture is what makes the duplicate check bite.
    await sendPatientToMonday(
      subscriptionPatient({ secondaryInsuranceIndex: 2, secondaryInsuranceEdited: 5 }) as never,
    );
    await expectParity(captured[0], "subscription/edited-secondary");
    const sec = captured[0].tasks.filter((t) => t.label === "Secondary Insurance");
    expect(sec.length, "subscription: Secondary Insurance written more than once").toBe(1);
    expect(sec[0].value, "subscription: the rep's edit must win").toEqual({ index: 5 });
  });

  it("an UNPARSEABLE phone/fax is not written at all", async () => {
    const { sendPatientToMonday } = await import("../subscription/mondayWrite");
    await sendPatientToMonday(
      subscriptionPatient({ doctorPhoneEdited: "555-121", doctorFaxEdited: "not an address" }) as never,
    );
    await expectParity(captured[0], "subscription/garbage-contact");
  });
});
