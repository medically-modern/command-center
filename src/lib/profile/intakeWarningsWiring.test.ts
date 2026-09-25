/**
 * The Intake Warnings wiring (§5.20b), pinned because every failure here is
 * silent: a column missing from a read set is a warning that never shows, a
 * settle signature without it reveals the results before the warnings land,
 * and a page that stops passing the ticks to the gate either locks Advance
 * shut or lets a patient through that the check said to stop.
 *
 * Behavioural where the function can be driven (`triggerStediRun`, the read
 * set, the settle signature); a source scan for the page wiring — the
 * `doctorFaxGateWiring.test.ts` convention.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => [] as string[]);

vi.mock("./mondayApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./mondayApi")>();
  return {
    ...actual,
    writeText: vi.fn(async (_itemId: string, columnId: string, text: string) => {
      calls.push(`text:${columnId}:${text}`);
    }),
    clearStatusColumn: vi.fn(async (_itemId: string, columnId: string) => {
      calls.push(`clear:${columnId}`);
    }),
    writeStatusIndex: vi.fn(async (_itemId: string, columnId: string, index: number) => {
      calls.push(`status:${columnId}:${index}`);
    }),
  };
});

import { COL, LIST_COLUMN_IDS, READ_COLUMN_IDS } from "./mondayApi";
import { triggerStediRun } from "./mondayWrite";
import { stediSignature } from "@/hooks/profile/useStediRun";
import type { Patient } from "./workflow";

const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
const PROFILE = read("../../pages/ProfilePage.tsx");
const INTAKE = read("../../pages/UnverifiedReferralsPage.tsx");
const CC_API = read("../careCoordinator/mondayApi.ts");
const CARDS = read("../../components/careCoordinator/cards.tsx");

describe("the read", () => {
  it("both columns are in the full read, where the pages look", () => {
    expect(READ_COLUMN_IDS).toContain(COL.intakeWarnings);
    expect(READ_COLUMN_IDS).toContain(COL.intakeWarningAcks);
  });

  it("…and NOT in the slim list read — a ~2,000-row poll does not need them", () => {
    expect(LIST_COLUMN_IDS).not.toContain(COL.intakeWarnings);
    expect(LIST_COLUMN_IDS).not.toContain(COL.intakeWarningAcks);
  });

  it("the Care Coordinator's own intake read carries both, for the card's lines", () => {
    expect(CC_API).toMatch(/PROFILE_COL\.intakeWarnings,\s*PROFILE_COL\.intakeWarningAcks/);
    expect(CC_API).toMatch(/intakeWarnings:\s*text\(item, PROFILE_COL\.intakeWarnings\)/);
    expect(CC_API).toMatch(/intakeWarningAcks:\s*text\(item, PROFILE_COL\.intakeWarningAcks\)/);
  });
});

describe("a check that is still landing is not revealed early", () => {
  it("the intake page's settle signature moves when the warnings land", () => {
    const before = { stediEligibilityActive: "Yes", intakeWarnings: "" } as Patient;
    const after = { ...before, intakeWarnings: "SELF_REF_UHC|CONFIRM:Confirmed with patient|x" } as Patient;
    expect(stediSignature(after)).not.toBe(stediSignature(before));
  });

  it("…and so does /profile's", () => {
    const keys = PROFILE.slice(PROFILE.indexOf("const STEDI_SIGNATURE_KEYS"), PROFILE.indexOf("function stediSignature"));
    expect(keys).toContain('"intakeWarnings"');
  });
});

describe("a new check asks again", () => {
  beforeEach(() => { calls.length = 0; });

  it("triggerStediRun clears the ticks BEFORE it flips Run", async () => {
    await triggerStediRun("42");
    const clearAcks = calls.indexOf(`text:${COL.intakeWarningAcks}:`);
    const flip = calls.indexOf(`status:${COL.runStediEligibility}:1`);
    expect(clearAcks).toBeGreaterThanOrEqual(0);
    expect(flip).toBeGreaterThan(clearAcks);
  });

  it("both pages clear the ticks on screen once a check has started", () => {
    expect(INTAKE).toMatch(/if \(await stedi\.start\(selected\)\) intakeWarnings\.markCheckStarted\(\);/);
    const run = PROFILE.slice(PROFILE.indexOf("await triggerStediRun(runId);"));
    expect(run.slice(0, 300)).toContain("intakeWarnings.markCheckStarted();");
  });
});

describe("the gate reads the ticks the SCREEN shows", () => {
  it("the intake page's unlock is built from gatePatient", () => {
    expect(INTAKE).toMatch(/evaluateUnlock\(intakeWarnings\.gatePatient\)/);
  });

  it("/profile's checklist reads the same conditions", () => {
    expect(PROFILE).toMatch(/warningConditions\(intakeWarnings\.gatePatient \?\? selected\)/);
  });
});

describe("both intake pages show them", () => {
  it.each([["/profile", PROFILE], ["the intake page", INTAKE]])("%s mounts the panel — and NO pop-up (Brandon, 2026-09-25)", (_name, src) => {
    expect(src).toMatch(/<IntakeWarningsPanel\b/);
    // "get rid of that big pop-up that comes up when you click into their
    // profile" — the panel under the results is the one place the check
    // speaks, and it now names the in-network states in its heading.
    expect(src).not.toMatch(/<IntakeWarningsDialog\b/);
    // Keyed by patient, so an override reason cannot follow a sidebar click.
    const panel = src.slice(src.indexOf("<IntakeWarningsPanel"), src.indexOf("<IntakeWarningsPanel") + 200);
    expect(panel).toMatch(/key=\{(selected|pt)\.id\}/);
  });

  it("every intake card on the Care Coordinator passes the warning lines", () => {
    const intakeCards = CARDS.match(/networkPill=\{networkPill\(lead\)\}\s*\n\s*warnings=\{cardWarnings\(lead\)\}/g) ?? [];
    expect(intakeCards).toHaveLength(3);
  });
});
