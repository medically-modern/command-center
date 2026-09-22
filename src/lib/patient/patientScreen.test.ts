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
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { DossierItem, PatientDossier } from "@/lib/commsHub/dossier";
import {
  MACRO_STAGES,
  buildStages,
  defaultStepIndex,
  itemOpenHref,
  onboardingCaption,
  parseSide,
  parseView,
  snapStateLabel,
  snapTabLabel,
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
    escalationText: "",
    escalationLevel: null,
    isProposedStuck: false,
    isStuck: false,
    dob: "01/15/1957",
    route: "/evaluate",
    stageAdvancerText: "Chase Clinicals",
    notes: "",
    notesColId: "",
    notesColType: null,
    nextActionDate: "2026-09-20",
    createdAt: "",
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
  /* ⚠️ The info strip moved to `lib/patient/infoStrip.ts` (§5.46f) and
     `infoFacts` is gone — its own tests live beside it. What stays here is the
     top bar, which is still this module's. */
  it("leads the top bar with the patient's name", () => {
    const live = item();
    expect(topBarFacts(dossier([live], live))[0].label).toBe("Patient name");
  });
});

/* ── The additive promise ──────────────────────────────────────────────────── */

describe("the patient screen is READ-ONLY", () => {
  /**
   * ⚠️ **Read off the DIRECTORY, not a hand-kept list.** The list was hardcoded
   * and a file added to this screen later would simply not have been scanned —
   * the "a list that must be updated when something changes will not be" trap
   * this repo records in §5.9 · §5.10 · §5.29. The three folders ARE the
   * screen, so a new file is covered the moment it is written.
   */
  const dir = (d: string) =>
    readdirSync(resolve(process.cwd(), d))
      .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".test.ts") && !f.endsWith(".test.tsx"))
      .map((f) => `${d}/${f}`);
  const all = [
    "src/pages/PatientPage.tsx",
    ...dir("src/components/patient"),
    ...dir("src/hooks/patient"),
    ...dir("src/lib/patient"),
  ];

  /**
   * ⚠️⚠️ **THE CARVE-OUTS, AND EACH IS A NARROWING OF THE PROMISE RATHER THAN A
   * HOLE IN IT.** Both are pinned below by what they must satisfy in place of
   * the blanket ban, so neither can quietly widen into a second writer.
   *
   * 1. **The Subscription Profile tab** (§5.45b; Josh, 2026-09-21: *"if the
   *    person has edit profile access they should be able to edit from this
   *    page too / read only if you dont have it, the way it is today"*) —
   *    renders `/subscription`'s OWN form and calls its OWN send, behind
   *    `editProfile`.
   * 2. **Recent notes** (§5.39c3) — calls the Comms Hub's OWN
   *    `appendNoteToRecord`. ⚠️ Deliberately NOT gated on `editProfile`, per
   *    §5.39h: a running case history is not the profile, and it is how a rep
   *    records what they just learned on the call they are on.
   *
   * Everything else on this screen still writes nothing.
   */
  const EDIT_PATH = [
    "src/components/patient/SubscriptionView.tsx",
    "src/hooks/patient/useSubscriptionRecord.ts",
    "src/components/patient/RecentNotes.tsx",
  ];
  const files = all.filter((f) => !EDIT_PATH.includes(f));

  it("⚠️ Recent notes calls the EXISTING writer — never a second implementation", () => {
    // ⚠️ `appendNoteToRecord` carries three rules a local copy would lose: it
    // RE-READS the column immediately before appending (Monday has no
    // compare-and-set, so appending onto a cached body silently deletes what
    // another rep added in between), it asks the LIVE board about the 2,000-char
    // cap rather than trusting a declared type (§10), and it writes a bare
    // string through change_multiple_column_values, which both column types
    // accept. Re-implementing any of it here is the §5.31c/§5.31d failure.
    const notes = src("src/components/patient/RecentNotes.tsx");
    expect(notes).toMatch(/from "@\/lib\/commsHub\/dossierApi"/);
    expect(notes).toMatch(/appendNoteToRecord\(/);
    // No hand-rolled mutation, and no second stamping rule.
    const code = notes.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/change_(multiple_)?column_value/);
    expect(code).not.toMatch(/appendStampedNote|stampNoteEntry|writeLongText/);
    // The stage label is the shared rule, not a local `stageAdvancerText ||`.
    expect(code).toMatch(/noteStageLabel\(/);
  });

  it("⚠️ Recent notes is NOT gated on editProfile — a note is not the profile", () => {
    // §5.39h: notes stay writable with the ability off on `/subscription` and
    // `/update-clinicals` too. Gating them here would make this screen stricter
    // than the pages it mirrors, and would take away the one thing a rep needs
    // while they are on the call.
    const notes = src("src/components/patient/RecentNotes.tsx");
    expect(notes).not.toMatch(/editProfile|useAbility/);
  });

  it("⚠️ the scan really found the screen's files", () => {
    // A glob that silently matched nothing passes every assertion below it.
    for (const f of [
      "src/components/patient/OnboardingView.tsx",
      "src/components/patient/SubscriptionView.tsx",
      "src/hooks/patient/usePatientRecord.ts",
      "src/lib/patient/patientScreen.ts",
    ]) {
      expect(all, `${f} is not being scanned`).toContain(f);
    }
  });

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

  it("⚠️⚠️ the edit path calls the EXISTING writer — never a second implementation", () => {
    // Two INDEPENDENT writers for one column is what §5.31c · §5.31d record
    // going wrong. Calling `/subscription`'s own send from a second screen is
    // the opposite: there is still exactly one place that knows how these
    // columns are written.
    const view = src("src/components/patient/SubscriptionView.tsx");
    expect(view).toContain('from "@/lib/subscription/mondayWrite"');
    expect(view).toContain("sendPatientToMonday");
    // ⚠️ Scanned as CODE: every file here documents the very writers it must not
    // call, so a raw-text scan fails on its own prose and the only way to pass
    // it is to delete the explanation.
    const code = (t: string) =>
      t.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const f of EDIT_PATH) {
      const text = code(src(f));
      expect(text, `${f} must not hand-roll a mutation`).not.toMatch(/change_(multiple_)?column_value/);
      expect(text, `${f} must not run its own verified write`).not.toMatch(/executeWritesWithVerification/);
    }
  });

  it("⚠️⚠️ the write is gated on editProfile TWICE — the control and the handler", () => {
    // §5.39h: the button is what a rep sees, the handler is what stops the
    // write. A typed URL, a stale tab and a revoked ability all reach the
    // second and not the first.
    const view = src("src/components/patient/SubscriptionView.tsx");
    expect(view).toMatch(/useAbility\("editProfile"\)/);
    // The handler refuses before it sends.
    expect(view).toMatch(/if \(!canEdit\) return;[\s\S]{0,400}sendPatientToMonday/);
    /* ⚠️ The EDITOR is mounted for everybody from 2026-09-22 (§5.46b) — the
       read-only half of this screen is the same form, inert — so what has to
       be gated is the SEND and the INPUTS, not the mount.
       ⚠️ `inert` is the real guard (§5.39c2): measured in Chrome 141 a real
       click is not hittable and focus cannot enter, so none of the form's
       event handlers can fire. The no-op writer is belt and braces. */
    expect(view, "the Send bar renders without the ability").toMatch(
      /canEdit \? \(\s*<div className=\{`sub-bar/,
    );
    expect(view, "the read-only form is not inert").toMatch(/inert: ""/);
    expect(view, "a form nobody can edit still holds a writer").toMatch(
      /onFieldChange=\{canEdit \? onFieldChange : noop\}/,
    );
  });

  it("⚠️ somebody WITHOUT the ability is told why, rather than shown nothing", () => {
    // Hiding the control is the dead end §5.10 · §5.20 · §5.31c each record
    // reversing — a rep who cannot see it concludes the page is broken.
    expect(src("src/components/patient/SubscriptionView.tsx")).toContain(
      '<AbilityLockNote ability="editProfile" />',
    );
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
    expect(css).toMatch(/\.cc-shell \.min-h-screen\s*\{[^}]*calc\(100vh - var\(--cc-chrome\)\)/);
    expect(css).toMatch(/\.cc-shell \.h-screen\s*\{[^}]*calc\(100vh - var\(--cc-chrome\)\)/);
  });

  it("⚠️⚠️ …and the HEADER's own height is a SEPARATE variable from the total chrome", () => {
    // §5.39h: the "You're seeing X's Command Center" banner is a second strip,
    // so the overrides must subtract more — but raising `--cc-head` for both
    // made `.gh`'s own min-height 36px taller AND stacked the banner under it.
    // Measured in a browser: the main area started 128px down instead of 92.
    // Fix by construction, not by tuning an offset (§5.30c).
    const css = src("src/pages/shell.css");
    expect(css).toMatch(/--cc-head:\s*56px/);
    expect(css).toMatch(/--cc-chrome:\s*var\(--cc-head\)/);
    expect(css).toMatch(/min-height:\s*var\(--cc-head\)/); // the header itself
    expect(css).toMatch(/\.cc-shell\.has-viewas\s*\{\s*--cc-chrome:\s*calc\(var\(--cc-head\) \+ 36px\)/);
    expect(css).not.toMatch(/\.cc-shell\.has-viewas\s*\{\s*--cc-head:/);
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

describe("phases 3–6 are additive too", () => {
  it("⚠️ the home route still renders Index for anybody with one view", () => {
    // Every access.json today has no `homeView`, which reads as ["bars"], so
    // the home page is byte-identical on the deploy that adds the model.
    const host = src("src/components/shell/HomeViewHost.tsx");
    expect(host).toMatch(/if \(active === "bars"\)/);
    expect(host).toMatch(/<Index \/>/);
  });

  it("⚠️ the coordinator and oversight views reuse the EXISTING pages", () => {
    // Brandon redraws both from sample data and calls his coordinator screen "a
    // rebuild, not a port". Rebuilding either would be a second copy of rules
    // whose drift is silent — §5.30's keep-in-agreement list alone is twelve
    // places long.
    const host = src("src/components/shell/HomeViewHost.tsx");
    expect(host).toMatch(/pages\/CareCoordinatorPage/);
    expect(host).toMatch(/components\/oversight\/OversightTab/);
  });

  it("⚠️ the combined fax bar was ADDED, not swapped in", () => {
    // Brandon says the Fax Inbox and the Comms Fax rail "should be one"; Josh
    // said add it beside them and trim later. Both old doors must still exist.
    const app = src("src/App.tsx");
    expect(app).toMatch(/path="\/fax"/);
    expect(app).toMatch(/path="\/fax-inbox"/);
    expect(app).toMatch(/path="\/assigned-patients"/);
  });

  it("⚠️ the fax bar reuses the tested join rather than re-deriving it", () => {
    // `faxDigits` strips the @rcfax.com before comparing; comparing the stored
    // value to a phone number matches nothing, with no error (§5.28).
    const page = src("src/pages/FaxBarPage.tsx");
    expect(page).toMatch(/buildFaxDirectory/);
    expect(page).toMatch(/fetchFaxMatches/);
    expect(page).toMatch(/fetchDoctorDbByFax/);
    // And it fetches the BYTES before handing them to the viewer.
    expect(page).toMatch(/fetchFaxBlobUrl/);
  });

  it("⚠️ an ability gate never hides a tab by default", () => {
    // `hasAbility` returns true for anything not explicitly turned off, so a
    // gated tab renders for everybody until an admin says otherwise.
    //
    // ⚠️ The identity is `who`, not `email`, from §5.39h: the tabs answer for
    // whoever's view is on show, because the question a borrow asks is *what
    // does their screen look like* (Josh: *"if mashekes view has patient
    // communication assigned and i view her view it should appear"*). Every
    // WRITE gate still reads the signed-in person — `viewAsScope.test.ts`
    // pins that half.
    const header = src("src/components/shell/GlobalHeader.tsx");
    expect(header).toMatch(/hasAbility\(who, config, t\.ability\)/);
    expect(header).toMatch(/ability: "inventory"/);
    expect(header).toMatch(/ability: "reports"/);
  });
});

describe("⚠️⚠️ two identical tabs are a record you cannot reach (§5.42)", () => {
  const item = (p: Partial<DossierItem> & { itemId: string }): DossierItem =>
    ({
      name: "JAMIE RIVERS", phone: "5555550142", boardId: 18406060017,
      boardName: "Medical Evaluation", groupId: "g", groupTitle: "", isCompleted: false,
      isStuck: false, dob: "", route: "", stageAdvancerText: "", notes: "",
      notesColId: "", notesColType: null, cols: {}, ...p,
    }) as unknown as DossierItem;

  it("different BOARDS keep the board name — Intake really is two boards", () => {
    const a = item({ itemId: "1", boardId: 18392794310, boardName: "DTC Intake" });
    const b = item({ itemId: "2", boardId: 18406352652, boardName: "Profile Send Off Board" });
    expect(snapTabLabel([a, b], a)).toBe("DTC Intake");
    expect(snapTabLabel([a, b], b)).toBe("Profile Send Off Board");
  });

  it("⚠️ a stage that ran TWICE on one board falls through to the GROUP", () => {
    // The reported shape: a completed Medical Evaluation record and an
    // escalated one beside it, both previously rendering "Medical Evaluation".
    const done = item({ itemId: "2001", groupTitle: "Completed", isCompleted: true });
    const live = item({ itemId: "2002", groupTitle: "2. Medical Necessity" });
    expect(snapTabLabel([done, live], done)).toBe("Completed");
    expect(snapTabLabel([done, live], live)).toBe("2. Medical Necessity");
  });

  it("⚠️ when the group collides too, the stage advancer distinguishes them", () => {
    const a = item({ itemId: "1", groupTitle: "Completed", isCompleted: true, stageAdvancerText: "Completed" });
    const b = item({ itemId: "2", groupTitle: "Completed", isCompleted: true, stageAdvancerText: "Stuck" });
    expect(snapTabLabel([a, b], a)).toBe("Completed");
    expect(snapTabLabel([a, b], b)).toBe("Stuck");
  });

  it("⚠️⚠️ and when EVERYTHING collides it is the item id, never an index", () => {
    // Two completed Profile Send Off records with the same group and the same
    // advancer is a real duplicate pair. An index ("1", "2") identifies nothing
    // and reorders between polls; the id is what a rep pastes into Monday.
    const a = item({ itemId: "12995534826", boardName: "Profile Send Off Board", groupTitle: "Completed", isCompleted: true, stageAdvancerText: "Advance to MN" });
    const b = item({ itemId: "12995609770", boardName: "Profile Send Off Board", groupTitle: "Completed", isCompleted: true, stageAdvancerText: "Advance to MN" });
    expect(snapTabLabel([a, b], a)).toBe("Profile Send Off Board #4826");
    expect(snapTabLabel([a, b], b)).toBe("Profile Send Off Board #9770");
    expect(snapTabLabel([a, b], a)).not.toBe(snapTabLabel([a, b], b));
  });

  it("a lone record still reads as its board", () => {
    const only = item({ itemId: "1", groupTitle: "Completed" });
    expect(snapTabLabel([only], only)).toBe("Medical Evaluation");
  });
});

describe("⚠️ a stage whose only record is STUCK says so (§5.42)", () => {
  const it2 = (p: Partial<DossierItem> & { itemId: string; boardId: number }): DossierItem =>
    ({
      name: "JAMIE RIVERS", phone: "5555550142", boardName: "", groupId: "", groupTitle: "",
      isCompleted: false, isStuck: false, dob: "", route: "", stageAdvancerText: "",
      notes: "", notesColId: "", notesColType: null, nextActionDate: "", daysSinceStage: "",
      cols: {}, ...p,
    }) as unknown as DossierItem;

  const dossierOf = (items: DossierItem[]): PatientDossier =>
    ({ name: "JAMIE RIVERS", phone: "5555550142", active: null, path: [], alsoOn: [], items }) as unknown as PatientDossier;

  it("reads Stuck, not 'In progress' — pickActive skips stuck records, so it is never the active board", () => {
    const steps = buildStages(
      dossierOf([
        it2({ itemId: "1", boardId: 18406352652, isCompleted: true }),
        it2({ itemId: "2", boardId: 18406060017, isStuck: true, groupTitle: "Stuck" }),
      ]),
    );
    expect(steps.find((s) => s.stage.key === "mn")!.state).toBe("stuck");
    expect(steps.find((s) => s.stage.key === "intake")!.state).toBe("done");
    expect(steps.find((s) => s.stage.key === "insurance")!.state).toBe("todo");
  });

  it("⚠️ but MOVING PAST a stage still wins — returned from stuck and now on Insurance", () => {
    const steps = buildStages(
      dossierOf([
        it2({ itemId: "2", boardId: 18406060017, isStuck: true, groupTitle: "Stuck" }),
        it2({ itemId: "3", boardId: 18410601299, groupTitle: "Benefits" }),
      ]),
    );
    expect(steps.find((s) => s.stage.key === "mn")!.state).toBe("done");
    expect(steps.find((s) => s.stage.key === "insurance")!.state).toBe("now");
  });

  it("the stuck record is the one the snapshot opens on", () => {
    const stuck = it2({ itemId: "2", boardId: 18406060017, isStuck: true, groupTitle: "Stuck" });
    const steps = buildStages(dossierOf([stuck]));
    expect(steps.find((s) => s.stage.key === "mn")!.lead?.itemId).toBe("2");
  });
});

/**
 * ⚠️ §5.43 — the search and the patient screen must not describe one patient
 * two different ways. A PROPOSED stuck record (escalation index 2) sits in an
 * ordinary working group, so `isStuck` is false for it and the screen drew it
 * as an everyday item while `searchBucket` filed it under Stuck.
 */
describe("⚠️ a proposed stuck record is stuck HERE too, and says which kind", () => {
  const it3 = (p: Partial<DossierItem> & { itemId: string; boardId: number }): DossierItem =>
    ({
      name: "JAMIE RIVERS", phone: "5555550142", boardName: "", groupId: "", groupTitle: "",
      isCompleted: false, isStuck: false, escalationText: "", escalationLevel: null,
      isProposedStuck: false, dob: "", route: "", stageAdvancerText: "", notes: "",
      notesColId: "", notesColType: null, nextActionDate: "", daysSinceStage: "", cols: {},
      ...p,
    }) as unknown as DossierItem;
  const dossierOf = (items: DossierItem[], active: DossierItem | null = null): PatientDossier =>
    ({ name: "JAMIE RIVERS", phone: "5555550142", active, path: [], alsoOn: [], items }) as unknown as PatientDossier;

  const proposed = it3({
    itemId: "2002", boardId: 18406060017, groupTitle: "2. Medical Necessity",
    escalationText: "Final Escalation Required", escalationLevel: "final", isProposedStuck: true,
  });

  it("the stage reads stuck, not 'In progress'", () => {
    const steps = buildStages(dossierOf([proposed], proposed));
    expect(steps.find((s) => s.stage.key === "mn")!.state).toBe("stuck");
  });

  it("⚠️ and it is named as a PROPOSAL — a rep must not read it as 'they have left'", () => {
    const step = buildStages(dossierOf([proposed], proposed)).find((s) => s.stage.key === "mn")!;
    expect(stepCaption(step)).toBe("Stuck proposed — with a manager");
  });

  it("a real Stuck GROUP still says plain Stuck", () => {
    const parked = it3({ itemId: "9", boardId: 18406060017, isStuck: true, groupTitle: "Stuck" });
    const step = buildStages(dossierOf([parked])).find((s) => s.stage.key === "mn")!;
    expect(stepCaption(step)).toBe("Stuck");
  });

  it("⚠️ the snapshot chip tells the four states apart", () => {
    expect(snapStateLabel(proposed)).toContain("waiting on a manager");
    expect(snapStateLabel(it3({ itemId: "a", boardId: 18406060017 }))).toBe("Live — the patient is here now");
    expect(snapStateLabel(it3({ itemId: "b", boardId: 18406060017, isStuck: true }))).toContain("out of the pipeline");
    // Completed wins over any flag still on the record — §5.18's ordering.
    expect(
      snapStateLabel(it3({ itemId: "c", boardId: 18406060017, isCompleted: true, isProposedStuck: true })),
    ).toContain("Snapshot");
    expect(snapStateLabel(null)).toBe("");
  });

  it("⚠️ proposed-stuck is NOT folded into isStuck — pickActive must still find them", () => {
    // `pickActive` skips `isStuck`. A patient whose only live record is a stuck
    // PROPOSAL is still the live end of their trail; somebody is waiting on a
    // decision about them, and dropping them would leave the screen with no
    // active record at all.
    expect(proposed.isStuck).toBe(false);
    expect(proposed.isProposedStuck).toBe(true);
  });
});
