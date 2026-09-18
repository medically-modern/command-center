/**
 * The patient screen's rules, and the two properties that make it SAFE to add
 * (§5.39).
 *
 * The behavioural half is ordinary. The source scans are the point: this screen
 * and the shell around it were added on the explicit promise that they are
 * purely additive — they write nothing, and they take nothing away from the
 * pages they link to. Both of those are invisible on screen if they break, so a
 * test is the only thing that would catch it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DossierItem, PatientDossier } from "@/lib/commsHub/dossier";
import {
  MACRO_STAGES,
  buildStages,
  defaultStepIndex,
  infoFacts,
  itemOpenHref,
  onboardingCaption,
  parseSide,
  parseView,
  stepCaption,
  subscriptionCaption,
  subscriptionItem,
  topBarFacts,
} from "./patientScreen";

const src = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const PROFILE = 18406352652;
const MED = 18406060017;
const INS = 18410601299;
const WC = 18410804557;
const SUB = 18407459988;

function item(over: Partial<DossierItem> = {}): DossierItem {
  return {
    itemId: "1",
    name: "Jane Doe",
    phone: "+15555550100",
    boardId: MED,
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

const dossier = (items: DossierItem[], active: DossierItem | null = null): PatientDossier => ({
  name: items[0]?.name ?? "",
  phone: items[0]?.phone ?? "",
  active,
  path: [],
  alsoOn: [],
  items,
});

describe("view + side params", () => {
  it("default to the onboarding trail and the text thread", () => {
    expect(parseView(null)).toBe("onboarding");
    expect(parseSide(null)).toBe("texts");
  });

  it("read an unrecognised value as the default rather than as a third state", () => {
    // Same rule as every other query param in this app (§5.20 `networkAnswer`).
    expect(parseView("nonsense")).toBe("onboarding");
    expect(parseSide("nonsense")).toBe("texts");
  });
});

describe("the four-stage stepper", () => {
  it("is FOUR stages, not the six boards of the pipeline", () => {
    // DTC Intake folds into Intake (read-only, no page) and Subscription is the
    // other VIEW — the stepper is the four boards a patient is worked on.
    expect(MACRO_STAGES).toHaveLength(4);
    expect(MACRO_STAGES.map((s) => s.key)).toEqual(["intake", "mn", "insurance", "welcome"]);
  });

  it("⚠️ reads an EARLIER stage as done from the patient's reach, not that board's own flag", () => {
    // A patient live on Insurance completed MN whether or not that item's
    // Completed group was read correctly — the later record's existence IS the
    // evidence (§5.38). Reading `isCompleted` alone would draw a finished stage
    // as unstarted the moment a group id moved (§5.18's hazard).
    const live = item({ itemId: "i", boardId: INS, boardName: "Insurance", isCompleted: false });
    const mn = item({ itemId: "m", boardId: MED, isCompleted: false });
    const steps = buildStages(dossier([mn, live], live));

    expect(steps[1].state).toBe("done");
    expect(steps[2].state).toBe("now");
  });

  it("marks a stage the patient never reached as todo, and a stuck one as stuck", () => {
    const stuck = item({ boardId: PROFILE, boardName: "Profile Send Off", isStuck: true, route: "/profile" });
    const steps = buildStages(dossier([stuck], stuck));
    expect(steps[0].state).toBe("stuck");
    expect(steps[3].state).toBe("todo");
  });

  it("opens on the live step, or the last one reached", () => {
    const live = item({ boardId: INS });
    expect(defaultStepIndex(buildStages(dossier([live], live)))).toBe(2);

    const doneOnly = item({ boardId: WC, isCompleted: true, boardName: "Welcome Call" });
    expect(defaultStepIndex(buildStages(dossier([doneOnly])))).toBe(3);
  });

  it("names the live sub-stage in the caption, and stuck as stuck", () => {
    const live = item({ boardId: MED });
    expect(stepCaption(buildStages(dossier([live], live))[1])).toBe("Chase Clinicals");

    const stuck = item({ boardId: MED, isStuck: true });
    expect(stepCaption(buildStages(dossier([stuck], stuck))[1])).toBe("Stuck");
  });

  it("an empty dossier is four unstarted steps, never a crash", () => {
    const steps = buildStages(null);
    expect(steps).toHaveLength(4);
    expect(steps.every((s) => s.state === "todo")).toBe(true);
  });
});

describe("itemOpenHref", () => {
  it("opens a LIVE record on its own stage page", () => {
    expect(itemOpenHref(item())).toBe("/evaluate?patientId=1&from=patient");
  });

  it("⚠️ opens a COMPLETED record with completedStage= — the review-mode WRITE GATE", () => {
    // Without this param `useCompletedStageReview` never fires, and a rep
    // reading history could re-advance a finished patient (§7 · §5.38).
    const href = itemOpenHref(item({ isCompleted: true }))!;
    expect(href).toContain("completedStage=18406060017");
    expect(href).toContain("patientId=1");
  });

  it("returns null for a board with no page rather than a dead link", () => {
    expect(itemOpenHref(item({ route: "" }))).toBeNull();
    expect(itemOpenHref(null)).toBeNull();
    // DTC Intake has a Completed group but no canonical page (§5.38).
    expect(itemOpenHref(item({ boardId: 18392794310, isCompleted: true }))).toBeNull();
  });
});

describe("subscription toggle", () => {
  it("⚠️ keys on the ROW'S EXISTENCE, never on its status", () => {
    // A patient stuck in Insurance whose Subscription row was created early can
    // still open it — reading a status would hide exactly that patient.
    const sub = item({ boardId: SUB, groupTitle: "Not Active Patients", isCompleted: false });
    expect(subscriptionItem(dossier([sub]))).not.toBeNull();
    expect(subscriptionCaption(sub)).toBeTruthy();
  });

  it("is null when the patient has no Subscription row", () => {
    expect(subscriptionItem(dossier([item()]))).toBeNull();
    expect(subscriptionItem(null)).toBeNull();
    expect(subscriptionCaption(null)).toBe("Not yet");
  });

  it("captions onboarding by how far the patient got", () => {
    const live = item({ boardId: MED });
    expect(onboardingCaption(dossier([live], live))).toBe("In progress");
    expect(onboardingCaption(null)).toBe("Not started");
  });
});

describe("facts", () => {
  it("⚠️ renders a blank as an em dash and MARKS it missing — never as a zero", () => {
    const live = item({ nextActionDate: "", daysSinceStage: "" });
    const facts = infoFacts(dossier([live], live));
    const nad = facts.find((f) => f.label === "Next action")!;
    expect(nad.value).toBe("—");
    expect(nad.missing).toBe(true);
    expect(facts.find((f) => f.label === "Stage")!.missing).toBe(false);
  });

  it("returns nothing when there is no live record, rather than inventing one", () => {
    expect(infoFacts(dossier([item()]))).toEqual([]);
  });

  it("leads the top bar with the patient's name", () => {
    const live = item();
    expect(topBarFacts(dossier([live], live))[0].label).toBe("Patient name");
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
    // INCIDENT_2026-08-20's shape.
    expect(src("src/hooks/patient/usePatientRecord.ts")).not.toMatch(/setInterval|setTimeout/);
  });

  it("⚠️ does not cache a FAILURE, so re-opening the patient retries", () => {
    // §5.28's `fetchDirectoryNames` lesson: a cached failure pins the screen
    // blank for the whole session with nothing erroring.
    expect(src("src/hooks/patient/usePatientRecord.ts")).toMatch(
      /not cached[\s\S]{0,140}failure|failure[\s\S]{0,140}not cached/i,
    );
  });

  it("⚠️ reuses the EXISTING comms components rather than copying their rules", () => {
    // ConversationThread is the only surface RingCentral's late SendingFailed
    // verdict reaches (§5.5); CallHistoryButton is the one that fetches on open
    // and paces a bulk download (§5.16). A local copy of either drifts silently.
    const col = src("src/components/patient/PatientCommsColumn.tsx");
    expect(col).toMatch(/assignedPatients\/ConversationThread/);
    expect(col).toMatch(/shared\/CallHistoryButton/);
  });
});

describe("the shell is additive", () => {
  it("⚠️ 'as today' renders children and NOTHING else", () => {
    // The escape hatch has to be a real one, or a global header cannot ship on
    // by default. The moment this branch renders a wrapper element, "as today"
    // stops being true.
    expect(src("src/components/shell/AppShell.tsx")).toMatch(
      /if \(layout !== "redesign"\) return <>\{children\}<\/>;/,
    );
  });

  it("⚠️ every shell rule is scoped under .cc-shell", () => {
    // Unscoped, the mockup's bare `.tab` / `.brand` / `.right` collide with the
    // live app — §9 records `.pf-root button` out-specifying every single-class
    // Tailwind utility, which is the same hazard pointing the other way.
    const css = src("src/pages/shell.css");
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((b) => b.split("{")[0].trim())
      .filter((s) => s && !s.startsWith("@") && !s.startsWith("/*"));
    for (const sel of selectors) {
      for (const one of sel.split(",")) {
        expect(one.trim(), `"${one.trim()}" must be scoped under .cc-shell`).toMatch(/^\.cc-shell\b/);
      }
    }
  });

  it("⚠️ every patient-screen rule is scoped under .cc-pt", () => {
    const css = src("src/pages/patient/redesign.css");
    const selectors = css
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("}")
      .map((b) => b.split("{")[0].trim())
      .filter((s) => s && !s.startsWith("@") && !s.startsWith("/*"));
    for (const sel of selectors) {
      for (const one of sel.split(",")) {
        const t = one.trim();
        // `.dark .cc-pt` / `:root[data-theme] .cc-pt` are the theme hooks.
        expect(t, `"${t}" must be scoped to the patient screen`).toMatch(/\.cc-pt\b/);
      }
    }
  });

  it("⚠️ the shell shortens the viewport for pages sized against it", () => {
    // Existing pages use min-h-screen / h-screen. Under a 56px header those are
    // 56px too tall: a second scrollbar, and on an h-screen page the composer
    // lands below the fold — §7 records exactly that on the Communications tab.
    const css = src("src/pages/shell.css");
    expect(css).toMatch(/\.cc-shell \.min-h-screen\s*\{[^}]*calc\(100vh - var\(--cc-head\)\)/);
    expect(css).toMatch(/\.cc-shell \.h-screen\s*\{[^}]*calc\(100vh - var\(--cc-head\)\)/);
  });
});

describe("nothing was taken away to make room for it", () => {
  it("⚠️ the Comms Hub pane still offers its original 'Open on <board>' link", () => {
    const pane = src("src/components/commsHub/PatientDossierPanel.tsx");
    expect(pane).toMatch(/Open on \{active\.boardName\}/);
    expect(pane).toMatch(/\/patient\/\$\{encodeURIComponent\(active\.itemId\)\}\?board=/);
  });

  it("⚠️ the patient route is additive — no existing route was repointed", () => {
    const app = src("src/App.tsx");
    expect(app).toMatch(/path="\/patient\/:itemId"/);
    for (const r of ["/subscription", "/orders", "/update-clinicals", "/assigned-patients", "/care-coordinator"]) {
      expect(app, `${r} must still be routed`).toContain(`path="${r}"`);
    }
  });

  it("⚠️ every header tab points at a page that already exists", () => {
    // "Route our current function into his new look" taken literally — no tab
    // opens something new, and Reports & Metrics points at Operations because
    // the tracker it draws has no data behind it in this build.
    const header = src("src/components/shell/GlobalHeader.tsx");
    const app = src("src/App.tsx");
    for (const r of ["/assigned-patients", "/orders", "/system-mgmt"]) {
      expect(header, `the header should link ${r}`).toContain(r);
      expect(app, `${r} must be a real route`).toContain(`path="${r}"`);
    }
  });
});
