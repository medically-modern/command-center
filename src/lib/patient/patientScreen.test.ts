/**
 * The patient screen's rules, and the two properties that make it SAFE to add
 * (§5.39).
 *
 * The behavioural half is ordinary. The source scans are the point: this screen
 * was added on the explicit promise that it is purely additive — it writes
 * nothing, and it takes nothing away from the pages it links to. Both of those
 * are invisible on screen if they break, so a test is the only thing that would
 * catch it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DossierItem, PathStep } from "@/lib/commsHub/dossier";
import { PIPELINE_ORDER } from "@/lib/commsHub/pipelineOrder";
import { infoFacts, parseSide, parseView, stepCaption, stepOpenHref, subscriptionItem } from "./patientScreen";

const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

function item(over: Partial<DossierItem> = {}): DossierItem {
  return {
    itemId: "1",
    name: "Jane Doe",
    phone: "+15555550100",
    boardId: 18406060017,
    boardName: "Medical Evaluation",
    groupId: "g",
    groupTitle: "2. Medical Necessity",
    isCompleted: false,
    isStuck: false,
    dob: "01/15/1957",
    route: "/evaluate",
    stageAdvancerText: "Chase Clinicals",
    notes: "",
    notesColId: "",
    notesColType: null,
    nextActionDate: "2026-09-20",
    daysSinceStage: "12",
    cols: {},
    ...over,
  };
}

const board = (id: number) => PIPELINE_ORDER.find((b) => b.boardId === id)!;
const step = (over: Partial<PathStep> & Pick<PathStep, "state">): PathStep => ({
  board: board(18406060017),
  item: null,
  ...over,
});

describe("view + side params", () => {
  it("default to the onboarding trail and the text thread", () => {
    expect(parseView(null)).toBe("onboarding");
    expect(parseSide(null)).toBe("texts");
  });

  it("read an unrecognised value as the default rather than erroring", () => {
    // Same rule as every other query param in this app: an unknown value is a
    // missing answer, never a third state.
    expect(parseView("nonsense")).toBe("onboarding");
    expect(parseSide("nonsense")).toBe("texts");
  });
});

describe("stepOpenHref", () => {
  it("opens a LIVE record on its own stage page", () => {
    const href = stepOpenHref(step({ state: "active", item: item() }));
    expect(href).toBe("/evaluate?patientId=1&from=patient");
  });

  it("⚠️ opens a COMPLETED record with completedStage= — the review-mode WRITE GATE", () => {
    // Without this param `useCompletedStageReview` never fires, and a rep
    // reading history could re-advance a finished patient (§7 · §5.38).
    const href = stepOpenHref(step({ state: "completed", item: item({ isCompleted: true }) }));
    expect(href).toContain("completedStage=18406060017");
    expect(href).toContain("patientId=1");
  });

  it("returns null for a board with no page rather than a dead link", () => {
    expect(stepOpenHref(step({ state: "active", item: item({ route: "" }) }))).toBeNull();
    expect(stepOpenHref(step({ state: "notReached" }))).toBeNull();
  });

  it("returns null for a completed record on a board with no review page", () => {
    // DTC Intake has a Completed group but no canonical page (§5.38).
    const href = stepOpenHref(
      step({ board: board(18392794310), state: "completed", item: item({ boardId: 18392794310, isCompleted: true }) }),
    );
    expect(href).toBeNull();
  });
});

describe("stepCaption", () => {
  it("names a stuck record as stuck, not by its advancer", () => {
    expect(stepCaption(step({ state: "parked", item: item({ isStuck: true }) }))).toBe("Stuck");
  });
  it("names the live sub-stage", () => {
    expect(stepCaption(step({ state: "active", item: item() }))).toBe("Chase Clinicals");
  });
});

describe("subscriptionItem", () => {
  const dossier = (items: DossierItem[]) => ({ name: "", phone: "", active: null, path: [], alsoOn: [], items });

  it("⚠️ keys on the ROW'S EXISTENCE, never on its status", () => {
    // A patient stuck in Insurance whose Subscription row was created early can
    // still open it — reading a status would hide exactly that patient.
    const sub = item({ boardId: 18407459988, groupTitle: "Not Active Patients", isCompleted: false });
    expect(subscriptionItem(dossier([sub]))).not.toBeNull();
  });

  it("is null when the patient has no Subscription row", () => {
    expect(subscriptionItem(dossier([item()]))).toBeNull();
    expect(subscriptionItem(null)).toBeNull();
  });
});

describe("infoFacts", () => {
  it("⚠️ renders a blank as an em dash and MARKS it missing — never as a zero", () => {
    const facts = infoFacts({
      name: "Jane",
      phone: "",
      active: item({ nextActionDate: "", daysSinceStage: "" }),
      path: [],
      alsoOn: [],
      items: [],
    });
    const nad = facts.find((f) => f.label === "Next action")!;
    expect(nad.value).toBe("—");
    expect(nad.missing).toBe(true);
    // A real answer is never marked missing.
    expect(facts.find((f) => f.label === "Stage")!.missing).toBe(false);
  });

  it("returns nothing when there is no live record, rather than inventing one", () => {
    expect(infoFacts({ name: "", phone: "", active: null, path: [], alsoOn: [], items: [] })).toEqual([]);
  });
});

/* ── The additive promise ──────────────────────────────────────────────────── */

describe("the patient screen is READ-ONLY", () => {
  const files = [
    "src/pages/PatientPage.tsx",
    "src/components/patient/OnboardingView.tsx",
    "src/components/patient/PatientCommsColumn.tsx",
    "src/hooks/patient/usePatientRecord.ts",
    "src/lib/patient/patientScreen.ts",
  ];

  it("⚠️ imports no mondayWrite, and calls no Monday mutation", () => {
    // Two writers for one column is how they disagree (§5.31c · §5.31d). This
    // screen deep-links to the stage page whose verified write path already
    // does the work; it must never grow a second one.
    for (const f of files) {
      const text = src(f);
      expect(text, `${f} must not import a writer`).not.toMatch(/mondayWrite/);
      expect(text, `${f} must not mutate Monday`).not.toMatch(/change_(multiple_)?column_value/);
      expect(text, `${f} must not run a verified write`).not.toMatch(/executeWritesWithVerification/);
    }
  });

  it("⚠️ never polls — the record is fetched on OPEN only", () => {
    // Every per-patient read on a page a rep clicks through is
    // INCIDENT_2026-08-20's shape. `usePatientRecord` has no timer, and adding
    // one here would spend the shared Monday budget on a reference view.
    const hook = src("src/hooks/patient/usePatientRecord.ts");
    expect(hook).not.toMatch(/setInterval|setTimeout/);
  });

  it("⚠️ does not cache a FAILURE, so re-opening the patient retries", () => {
    // §5.28's `fetchDirectoryNames` lesson: a cached failure pins the screen
    // blank for the whole session with nothing erroring.
    const hook = src("src/hooks/patient/usePatientRecord.ts");
    expect(hook).toMatch(/not cached[\s\S]{0,120}failure|failure[\s\S]{0,120}not cached/i);
  });
});

describe("nothing was taken away to make room for it", () => {
  it("⚠️ the Comms Hub pane still offers its original 'Open on <board>' link", () => {
    // The patient screen was ADDED beside it, not in place of it. Replacing a
    // working door with a new one is the destructive change this build promised
    // not to make.
    const pane = src("src/components/commsHub/PatientDossierPanel.tsx");
    expect(pane).toMatch(/Open on \{active\.boardName\}/);
    expect(pane).toMatch(/\/patient\/\$\{encodeURIComponent\(active\.itemId\)\}\?board=/);
  });

  it("⚠️ the patient route is additive — no existing route was repointed", () => {
    const app = src("src/App.tsx");
    expect(app).toMatch(/path="\/patient\/:itemId"/);
    // The pages the redesign eventually absorbs are all still routed.
    for (const r of ["/subscription", "/orders", "/update-clinicals", "/assigned-patients", "/care-coordinator"]) {
      expect(app, `${r} must still be routed`).toContain(`path="${r}"`);
    }
  });
});
