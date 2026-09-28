import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Every patient queue hides a patient the moment a send advances them out of
 * it (lib/shared/pendingAdvance). This scans the source for that wiring rather
 * than testing behaviour, for the same reason `listColumns.test.ts` scans:
 * a queue that loses the guard does not fail — it goes back to showing an
 * advanced patient, with a live Send button, until the next poll, which is
 * exactly the state that got three patients re-sent on 2026-09-03.
 *
 * ⚠️ Three hazards, one per assertion:
 *  1. `applyPendingAdvances` must be applied to the list the sidebar renders,
 *     or the hide disagrees with the queue and hides the wrong people.
 *  2. The deep-link injection must respect the marker, or a re-injected
 *     patient gets the live Send button straight back.
 *  3. `markAdvanced` must be exported, or no page can call it.
 */
const HOOKS = [
  "src/hooks/masheke/useMondayPatients.ts",
  "src/hooks/samantha/useMondayPatients.ts",
  "src/hooks/welcomeCall/useMondayPatients.ts",
  "src/hooks/finalConfirm/useMondayPatients.ts",
  "src/hooks/profile/useMondayPatients.ts",
];

describe.each(HOOKS)("%s", (path) => {
  const src = readFileSync(path, "utf8");

  it("applies the pending-advance filter to its own queue list", () => {
    expect(src).toContain('from "@/lib/shared/pendingAdvance"');
    expect(src).toContain("applyPendingAdvances(");
  });

  it("its claims live in the SHARED module map, not a per-hook one", () => {
    // Keith Dye, 2026-09-25: a `useRef(new Map())` died with the hook, so
    // leaving the page forgot the advance and the Care Coordinator dashboard
    // could never consult it. The ref keeps its name; it must point at the
    // one exported map.
    expect(src).toContain("useRef(sharedPendingAdvances)");
    expect(src).not.toMatch(/useRef\(\s*new Map/);
  });

  it("does not re-inject a deep-linked patient it just hid", () => {
    expect(src).toMatch(/!hasPendingAdvance\(pendingAdvanceRef\.current,/);
  });

  it("scopes its claims to its own queue (2026-09-28)", () => {
    // An unscoped claim hid the patient from the NEXT stage on the same board
    // (same item id) for fifteen minutes. Marking, the deep-link check and the
    // commit filter must all name this queue's scope.
    expect(src).toMatch(/markPendingAdvance\(pendingAdvanceRef\.current, \w+/);
    expect(src).toMatch(/applyPendingAdvances\(\s*merged, pendingAdvanceRef\.current,\s*scopeExceptPinned\(/);
    expect(src).not.toMatch(/pendingAdvanceRef\.current\.(set|has)\(/);
  });

  it("a PINNED deep link (Oversight / Search) is shown whatever this browser hid (2026-09-28)", () => {
    // Mary Mathis: Josh proposed her stuck, then clicked her in Oversight and
    // the page refused her for fifteen minutes. The pinned patient must be
    // injected past the claim, kept at commit, and never dropped by markAdvanced.
    expect(src).toMatch(/pinnedRef\.current === injected\w* \|\|/);
    expect(src).toMatch(/scopeExceptPinned\([\s\S]{0,80}?pinnedRef\.current\)/);
    expect(src).toMatch(/if \(id !== pinnedRef\.current\) setPatients/);
  });

  it("exposes markAdvanced so a page can call it on a confirmed advance", () => {
    expect(src).toMatch(/const markAdvanced = useCallback\(/);
    expect(src).toMatch(/return \{[\s\S]{0,400}markAdvanced/);
  });
});

/**
 * The pages that own an advancing send must actually call it — a hook that
 * offers `markAdvanced` and a page that never calls it looks wired and is not.
 * Listed per queue rather than globbed: a page absent from this list is a
 * deliberate carve-out (Subscription writes no Stage Advancer at all; the two
 * Chase pages log attempts and never leave the stage; DVS is a read-only
 * monitor), and adding one should be a decision, not an accident.
 */
const CALLERS = [
  "src/pages/EvaluatePage.tsx",
  "src/pages/SendRequestPage.tsx",
  "src/pages/ConfirmReceiptPage.tsx",
  "src/pages/ChaseBenefitsPage.tsx",
  "src/pages/SubmitAuthPage.tsx",
  "src/pages/AuthOutstandingPage.tsx",
  "src/pages/WelcomeCallPage.tsx",
  "src/pages/FinalConfirmPage.tsx",
  "src/pages/ProfilePage.tsx",
  "src/pages/UnverifiedReferralsPage.tsx",
];

describe.each(CALLERS)("%s", (path) => {
  const src = readFileSync(path, "utf8");
  it("takes markAdvanced from the hook and calls it", () => {
    expect(src).toContain("markAdvanced");
    expect(src).toMatch(/markAdvanced\(/);
  });
});

describe("the Care Coordinator dashboard consults the same claims", () => {
  // Keith Dye sat in Masani's Patient Intake column for ~10 minutes after a
  // successful advance: the dashboard polls the same boards through its own
  // hook, so without this filter the shared map fixes the role queues and
  // changes nothing on the screen the coordinator actually works from.
  const src = readFileSync("src/pages/CareCoordinatorPage.tsx", "utf8");

  it("filters the Patient Intake column through the shared map", () => {
    expect(src).toMatch(/applyPendingAdvances\(intake\.data \?\? \[\], sharedPendingAdvances, \(l\) => columnScopes\(l\.groupId, INTAKE_GROUP_IDS\)\)/);
  });

  it("filters the Welcome Call column through the shared map", () => {
    expect(src).toMatch(/applyPendingAdvances\(welcome\.data \?\? \[\], sharedPendingAdvances, \(w\) => columnScopes\(w\.groupId, WELCOME_GROUP_IDS\)\)/);
    // …and every welcome-side list derives from the filtered rows, not the
    // raw poll — the buckets, the Calendly emails, the ids the grid gets.
    expect(src).toMatch(/welcomeCallBuckets\(welcomeRows,/);
    expect(src).not.toMatch(/welcomeCallBuckets\(welcome\.data/);
  });
});

describe("the Insurance pages gate the hide on what the send actually wrote", () => {
  it.each([
    ["src/pages/ChaseBenefitsPage.tsx", "benefits"],
    ["src/pages/SubmitAuthPage.tsx", "submitAuth"],
    ["src/pages/AuthOutstandingPage.tsx", "authOutstanding"],
  ])("%s", (path, queue) => {
    // ⚠️ Insurance is the one board where a send can legitimately write NO
    // stage (Auth Outstanding with nothing resolved) or this queue's own stage
    // (Benefits SoS). Hiding unconditionally there takes live work off the
    // rep's screen — so these three must go through `stageLeavesQueue`.
    const src = readFileSync(path, "utf8");
    expect(src).toContain(`stageLeavesQueue(sent.stageIndex, "${queue}")`);
  });
});

/**
 * Pipeline Oversight and Search PIN their patient links, and every page that
 * feeds a deep link into one of the five queue hooks passes the pin through
 * (Mary Mathis, 2026-09-28). A page that forgets it silently goes back to
 * refusing a manager's click for fifteen minutes after that manager acted.
 */
const PIN_PAGES = [
  "src/pages/EvaluatePage.tsx",
  "src/pages/SendRequestPage.tsx",
  "src/pages/ConfirmReceiptPage.tsx",
  "src/pages/ChaseClinicalsPage.tsx",
  "src/pages/DoctorAppointmentsPage.tsx",
  "src/pages/ChaseBenefitsPage.tsx",
  "src/pages/SubmitAuthPage.tsx",
  "src/pages/AuthOutstandingPage.tsx",
  "src/pages/WelcomeCallPage.tsx",
  "src/pages/FinalConfirmPage.tsx",
  "src/pages/ProfilePage.tsx",
  "src/pages/UnverifiedReferralsPage.tsx",
];

describe.each(PIN_PAGES)("%s passes a pinned deep link to its queue hook", (path) => {
  it("reads the pin from the URL", () => {
    expect(readFileSync(path, "utf8")).toContain("pinnedDeepLinkId(searchParams)");
  });
});

describe("the manager's doors set the pin", () => {
  it("Pipeline Oversight pins every patient click", () => {
    const src = readFileSync("src/components/oversight/OversightTab.tsx", "utf8");
    expect(src).toMatch(/params\.set\(PIN_DEEP_LINK_PARAM, "1"\)/);
  });

  it("⚠️ the Communications Hub and the Fax panel do NOT — reps work patients from them", () => {
    for (const path of [
      "src/lib/commsHub/dossier.ts",
      "src/components/commsHub/PatientDossierPanel.tsx",
      "src/components/commsHub/FaxPanel.tsx",
    ]) {
      expect(readFileSync(path, "utf8"), path).not.toContain("PIN_DEEP_LINK_PARAM");
    }
  });
});

describe("Send back to pipeline does not hide the patient (2026-09-28)", () => {
  it("the ladder bar tells the page which action ran", () => {
    const src = readFileSync("src/components/shared/StageActionBar.tsx", "utf8");
    expect(src).toMatch(/onDone: \(action: StageAction\) => void;/);
    expect(src).toContain("onDone(action);");
    expect(src.match(/onDone\("proposeStuck"\)/g)?.length).toBe(2);
  });

  it.each(["src/pages/WelcomeCallPage.tsx", "src/pages/FinalConfirmPage.tsx"])(
    "%s hides on a proposal or an approval, never on a return",
    (path) => {
      const src = readFileSync(path, "utf8");
      expect(src).toMatch(/if \(selected && action !== "returnToQueue"\) markAdvanced\(selected\.id\);/);
    },
  );
});
