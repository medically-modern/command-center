import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Sending a request is not advancing it (Josh, 2026-09-03).
 *
 * The Send button used to fax/email AND flip the Stage Advancer in one press,
 * so the patient left Send Request before anyone could see whether the fax
 * landed — and RingCentral reports `Failed` SECONDS AFTER it accepts a fax
 * (§5.5 records the same trap for texts). The rep now watches the delivery
 * status settle and presses Request Sent to advance.
 *
 * Scanned rather than executed because what matters is the SHAPE of the write
 * path: this fails the build if a later change re-couples the two, which is
 * the regression nobody would notice — it looks like the button working.
 */
const WRITE = readFileSync("src/lib/masheke/mondayWrite.ts", "utf8");
const PANEL = readFileSync("src/components/masheke/SendRequestPanel.tsx", "utf8");

function fnBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name} should exist`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("the send records, it does not advance", () => {
  it("recordRequestSentVerified holds back no stage column", () => {
    const body = fnBody(WRITE, "recordRequestSentVerified");
    expect(body).toContain("stageColumnId: []");
    // The advancer must not appear at all — not held back, not written.
    expect(body).not.toContain("COL.subStage");
  });

  it("...and does not write a Next Action Date", () => {
    // That date is the ADVANCE's snooze. Writing it on the send would push the
    // patient out of the due queue while they are still sitting, unadvanced, in
    // Send Request — the disappearing-patient failure §5.10 records.
    expect(fnBody(WRITE, "recordRequestSentVerified")).not.toContain("nextActionDate");
  });

  it("the old send-and-advance writer is gone, not merely unused", () => {
    // Left in place it would read as the obvious thing to call from a send.
    expect(WRITE).not.toContain("export async function recordAndAdvanceVerified");
  });

  it("the panel's send path calls the recording writer, never an advancing one", () => {
    expect(PANEL).toContain("recordRequestSentVerified(patient");
    expect(PANEL).not.toContain("recordAndAdvanceVerified");
  });

  it("the send does not hide the patient from the queue", () => {
    // `onAdvanced` is the optimistic queue-hide. It belongs to Mark Complete
    // alone now: hiding on a send would take away the very screen the rep needs
    // in order to read the fax status and then advance.
    // handleSend runs from its declaration to the next handler in the file.
    const send = PANEL.slice(PANEL.indexOf("const handleSend"), PANEL.indexOf("const handleMarkComplete"));
    expect(send.length).toBeGreaterThan(200);
    expect(send).not.toContain("onAdvanced");
  });

  it("Mark Complete still advances, and still hides", () => {
    const complete = PANEL.slice(PANEL.indexOf("const handleMarkComplete"), PANEL.indexOf("const handleAddNote"));
    expect(complete).toContain("COL.subStage");
    expect(complete).toContain("onAdvanced?.()");
  });

  it("Mark Complete does not overwrite a send timestamp it already has", () => {
    // Confirm Receipt polls RingCentral from Request Sent At; re-stamping it at
    // advance time would point the next stage's fax status at the wrong minute.
    const complete = PANEL.slice(PANEL.indexOf("const handleMarkComplete"), PANEL.indexOf("const handleAddNote"));
    expect(complete).toContain("if (!sentNow)");
  });

  it("the advance is offered only once something has actually been sent", () => {
    // Permissive on purpose: the board's own Request Sent At counts, so a rep
    // who faxed earlier — or from outside the app — is never stranded.
    expect(PANEL).toContain("const hasSentRequest = sentNow || !!patient.requestSentAt;");
    expect(PANEL).toContain("disabled={completing || !hasSentRequest}");
  });
});

/**
 * A portal method skips Confirm Receipt — and Email must not (Sept 2026).
 *
 * `Dashboard` joined Parachute as a portal method: the request is carried by
 * the partner's dashboard, so there is no fax or email whose arrival anybody
 * here could confirm, and the stage advances straight to Chase Clinicals on a
 * button the rep presses to say they sent it.
 *
 * ⚠️ The regression this guards is the tempting one: `Dashboard` also shares
 * the CHASE ROLE with Parachute AND Email (`chaseMethods.ts`), so a later
 * reader is one edit away from routing Send Request off that list instead.
 * Doing so would stop every Email patient passing through Confirm Receipt —
 * silently, because the stage would simply never be entered. Scanned rather
 * than executed for the reason the file's header gives.
 */
describe("Send Request routes on delivery, not on the chase role", () => {
  it("decides the next stage with isPortalMethod", () => {
    expect(PANEL).toContain("const viaPortal = isPortalMethod(patient.clinicalsMethod);");
    expect(PANEL).toContain('const nextStage = viaPortal ? "Chase Clinicals" : "Confirm Receipt";');
  });

  it("never routes Send Request off the chase-role list", () => {
    // chaseMethods.ts is the QUEUE; using it here would drag Email in with it.
    expect(PANEL).not.toContain("isParachuteRoleMethod");
    expect(PANEL).not.toContain("PARACHUTE_ROLE_METHODS");
  });

  it("does not hardcode the old Parachute-only test anywhere", () => {
    expect(PANEL).not.toContain('clinicalsMethod === "Parachute"');
    expect(PANEL).not.toContain('method === "Parachute";');
  });

  it("gives a portal method the collapsed composer and no Generate Scripts step", () => {
    expect(PANEL).toContain("const [open, setOpen] = useState(!viaPortal);");
    expect(PANEL).toContain("{!viaPortal && (");
    expect(PANEL).toContain("generateSlot={viaPortal ? generateScriptsBlock : undefined}");
  });

  it("keeps the dashboard link keyed on the patient's own method, not the portal set", () => {
    // Parachute shares `viaPortal` and must keep linking to Parachute Health.
    expect(PANEL).toContain('{method === "Dashboard" && (');
    expect(PANEL).toContain("DISTRICT_ENDOCRINE_DASHBOARD_URL");
  });
});
