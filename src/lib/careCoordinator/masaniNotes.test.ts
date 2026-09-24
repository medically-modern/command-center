/**
 * Brandon's 2026-09-22 notes on the Masani dashboard — the rules behind them.
 *
 * Each block names the report it answers, because several of these reverse an
 * earlier decision and the reason is the only thing that stops them being
 * reversed back by accident.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bucketedLeads, intakeBuckets, isFormLead, type IntakeLead } from "./workflow";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * ⚠️ Comments are STRIPPED before a "must not contain" scan. These files
 * document the very mutations they must not call — `callAttempt.ts`'s own
 * header explains why it re-reads before appending, and that sentence names
 * `change_column_value` — so a raw-text scan fails on the explanation and the
 * only way to pass it is to delete it. Same rule as `stagePanelEmbed.test.ts`.
 */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const NOW_MS = Date.parse("2026-09-22T18:00:00Z");
const TODAY = "2026-09-22";
const GROUPS = { partial: "group_mm5z87zt", completed: "group_mm5zgeak" };
const ctx = {
  today: TODAY, nowMinutes: 14 * 60, nowMs: NOW_MS,
  formGroupIds: [GROUPS.partial, GROUPS.completed],
};

const lead = (over: Partial<IntakeLead> = {}): IntakeLead => ({
  id: "1", name: "Test Lead", groupId: GROUPS.partial,
  createdAt: new Date(NOW_MS - 72 * 3_600_000).toISOString(),
  phone: "3475550101", email: "t@example.com",
  dropOffStep: "Step 4 - Doctor", attemptCounter: "", dropOffAttempt: "",
  requestType: "CGM", pumpNeed: "", reasonForInquiry: "",
  proceedPreference: "Wants a call first", scheduledCallTime: "", bookingStatus: "",
  intakeCallComplete: "", intakeEscalation: "", referralType: "Patient", referralSource: "Patient",
  alreadyInSystem: "", followUp: "", followUpDate: "", dupCheckResult: "",
  state: "NY", generalInsurance: "Aetna", insuranceProvidedVia: "", insuranceOther: "",
  calendlyEventUri: "", providedDoctorName: "", providedClinicPhone: "",
  ipCoveragePath: "", cgmCoveragePath: "", hasInsuranceCard: false,
  stediError: "", stediActive: "Yes", stediPlanName: "Plan", stediInNetwork: "", intakeWarnings: "", intakeWarningAcks: "",
  ...over,
});

/**
 * ⚠️ *"The filters on intake should only be filtering from the list — the
 * filters look like it's taking from all of them (e.g. in equity type, there's
 * 1686 for not set)."* 1,686 is the 8/25 SNJ bulk import: rows with a blank
 * Drop-off Step, which `intakeBuckets` excludes and the column never draws.
 * The options were counted over the raw board read, so the control's biggest
 * number described a population that is not on the screen.
 */
describe("the intake filter counts only what the column can render", () => {
  it("leaves out the imported rows the column excludes", () => {
    const rows = [
      lead({ id: "form", dropOffStep: "Step 4 - Doctor" }),
      lead({ id: "import-1", dropOffStep: "" }),
      lead({ id: "import-2", dropOffStep: "" }),
    ];
    // The import gate is the one that fires on these.
    expect(rows.filter(isFormLead).map((l) => l.id)).toEqual(["form"]);
    const shown = bucketedLeads(intakeBuckets(rows, ctx));
    expect(shown.map((l) => l.id)).toEqual(["form"]);
  });

  it("leaves out an escalated lead too — nothing renders them here", () => {
    const rows = [lead({ id: "ok" }), lead({ id: "esc", intakeEscalation: "Manager Escalation Required" })];
    const b = intakeBuckets(rows, ctx);
    expect(b.withManager).toBe(1);
    expect(bucketedLeads(b).map((l) => l.id)).toEqual(["ok"]);
  });

  it("keeps a booked import, because the column DOES draw those", () => {
    // ⚠️ The exclusion order matters: a booking is checked before the import
    // gate, so an imported row with a real appointment is on screen — and the
    // filter has to offer its values or it cannot be filtered to.
    const rows = [lead({ id: "booked-import", dropOffStep: "", scheduledCallTime: `${TODAY} 15:00` })];
    expect(bucketedLeads(intakeBuckets(rows, ctx)).map((l) => l.id)).toEqual(["booked-import"]);
  });

  it("the page derives the options from that population, not the raw read", () => {
    const page = read("src/pages/CareCoordinatorPage.tsx");
    expect(page).toContain("bucketedLeads(intakeBuckets(allIntakeLeads");
    expect(page).toContain("leads={facetPopulation}");
    // The raw list must not reach the filter again — that IS the bug.
    expect(page).not.toContain("leads={allIntakeLeads}");
  });
});

/**
 * ⚠️ *"Add a red 'Already in System' orange pill next to patients name on the
 * intake side."* The trap is WHICH column says so: on a partial lead the
 * duplicate check is deliberately flag-only and never writes Already In
 * System, because writing it trips the automation that empties this queue. So
 * reading the flag alone hides the pill from most of its own population.
 */
describe("the Already-in-System pill reads the verdict column", () => {
  const cards = read("src/components/careCoordinator/cards.tsx");

  it("leads with the duplicate-check verdict, not the flag", () => {
    expect(cards).toContain("isAlreadyInSystemResult(lead.dupCheckResult)");
    // The flag is ORed in for the Completed group, where the check does file it.
    expect(cards).toContain('lead.alreadyInSystem.trim() === "Yes"');
  });

  it("is an intake-only pill", () => {
    // `inSystem(...)` rides beside the intake pill actions and nowhere else;
    // a Welcome Call patient is past the duplicate check entirely.
    expect(cards).toContain("inSystem={inSystem(lead)}");
    expect(cards).not.toContain("inSystem={inSystem(item)}");
  });
});

/**
 * ⚠️ *"Is the green border on the left working for welcome call too? ... that
 * green border is if we've done an outbound call to them yet."* It was the
 * board's attempt counter alone, which almost nothing writes on Welcome Call.
 */
describe("the green edge means we have called them", () => {
  const cards = read("src/components/careCoordinator/cards.tsx");

  it("is the union of a logged attempt and a real outbound call", () => {
    const fn = cards.slice(cards.indexOf("function calledOut("), cards.indexOf("function inSystem("));
    expect(fn).toContain("attempts > 0");
    expect(fn).toContain("extras.contact?.callsOut");
    // ⚠️ The board half STAYS: the RingCentral window is seven days, so a
    // patient called a fortnight ago has no evidence left there and dropping
    // their edge back to gray would say we had never tried.
    expect(fn).toMatch(/attempts > 0 \|\|/);
  });

  it("every card asks that one function, never `attempts > 0` inline", () => {
    expect(cards).not.toMatch(/attempted=\{[^}]*attempts > 0\s*\}/);
  });
});

/**
 * ⚠️ Logging an attempt is the FIRST write this dashboard makes (Josh,
 * 2026-09-22). The line it crosses was deliberate, so it is crossed by calling
 * the stage pages' own writers and nothing else.
 */
describe("logging an attempt calls the existing writers", () => {
  const src = read("src/lib/careCoordinator/callAttempt.ts");
  const body = code("src/lib/careCoordinator/callAttempt.ts");

  it("uses the profile and welcome-call writers, never its own mutation", () => {
    expect(src).toContain("logContactAttempt");
    expect(src).toContain("appendIntakeNote");
    expect(src).toContain("sendCallAttemptsToMonday");
    expect(src).toContain("sendNotesToMonday");
    expect(body).not.toContain("change_column_value");
    expect(body).not.toContain("change_multiple_column_values");
  });

  it("re-reads the Welcome Call notes before appending", () => {
    // Monday has no compare-and-set and this dashboard memoises notes per
    // column load, so appending onto the cached copy silently deletes whatever
    // landed in between.
    expect(src).toContain("fetchItemNotes(target.itemId, NOTES_COLUMN.welcome)");
  });

  it("refuses a note-less attempt", () => {
    expect(src).toContain('if (!body) throw new Error');
  });
});

/**
 * ⚠️ *"Any way to improve loading on the patient intake side?"* — the column is
 * ~1,754 rows and Monday caps a page at 500, so it is four SEQUENTIAL round
 * trips before anything reaches the screen. The read hands each page up as it
 * lands and the column paints after the first.
 */
describe("the intake column paints before the read finishes", () => {
  const api = code("src/lib/careCoordinator/mondayApi.ts");
  const hook = code("src/hooks/careCoordinator/useBoardPoll.ts");
  const page = code("src/pages/CareCoordinatorPage.tsx");

  it("reports each page's rows as well as its count", () => {
    expect(api).toContain("onBatch?: BatchReport<IntakeLead>");
    expect(api).toContain("onBatch([...soFar])");
  });

  it("commits a partial ONLY while nothing is on screen", () => {
    // ⚠️ A background poll committing page one over a full list would shrink
    // the column to a third of itself and grow back, several times an hour.
    expect(hook).toContain("!coldRef.current) return");
  });

  it("never caches or measures a partial", () => {
    // `lastGood` and the remembered total are written after the run COMPLETES,
    // so a half-read can neither seed the next mount nor become a denominator.
    const batch = hook.slice(hook.indexOf("(soFar) => {"), hook.indexOf("(soFar) => {") + 200);
    expect(batch).not.toContain("lastGood");
    expect(batch).not.toContain("rememberTotal");
  });

  it("drops the skeleton as soon as there are rows, not when the read settles", () => {
    expect(page).toContain("{intake.loading && !intake.data && <Skeleton />}");
  });
});
