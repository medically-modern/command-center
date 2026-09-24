/**
 * The network pill — one pill where the benefits check's banner and its
 * "In network:" line used to be (Brandon, 2026-09-24; Josh chose "Network
 * unknown" and "Check failed" for the two states his list did not cover).
 *
 * The fixtures are the column's live vocabulary, measured board-wide that day:
 * Yes 485 · Unknown 224 · No 40 · blank 2,034, and one free-text answer.
 */
import { describe, it, expect } from "vitest";
import { networkPill } from "./networkPill";

const lead = (stediInNetwork: string, stediError = "") => ({ stediInNetwork, stediError });

describe("networkPill", () => {
  it("draws NOTHING before a check has run — his 'it'll just stay blank'", () => {
    expect(networkPill(lead(""))).toBeNull();
    expect(networkPill(lead("   "))).toBeNull();
  });

  it("In-network is green, Out-of-network is red", () => {
    expect(networkPill(lead("Yes"))).toMatchObject({ label: "In-network", tone: "green" });
    expect(networkPill(lead("No"))).toMatchObject({ label: "Out-of-network", tone: "red" });
  });

  it("reads through the SAME rule the profile page uses", () => {
    // `intakeUnlock.networkAnswer`'s spellings — one rule, two screens.
    expect(networkPill(lead("in-network"))?.label).toBe("In-network");
    expect(networkPill(lead("Out of network"))?.label).toBe("Out-of-network");
  });

  it("the board's own Unknown is a GRAY 'Network unknown', never a red No", () => {
    // Original Medicare has no network, so a fee-for-service patient comes back
    // exactly this (§5.20) — reading it as a negative is the bug that file records.
    const p = networkPill(lead("Unknown"));
    expect(p).toMatchObject({ label: "Network unknown", tone: "gray" });
    expect(p?.title).toMatch(/Original Medicare/);
  });

  it("prints any other answer VERBATIM, gray — never a guess", () => {
    const raw = "Pending payer response";
    expect(networkPill(lead(raw))).toMatchObject({ label: raw, tone: "gray" });
  });

  // §5.20b — the backend's contract verdicts from 2026-09-24. The one
  // "free-text" row measured above was the first of them.
  it("Check with patient is AMBER, in Josh's words, with the backend's sentence on hover", () => {
    const raw = "Check with patient: lives in NY, NJ, FL or TN?";
    const p = networkPill(lead(raw));
    expect(p).toMatchObject({
      label: "Only in-network if patient lives in NY, NJ, FL, TN or WY?",
      tone: "amber",
    });
    expect(p?.title).toContain(raw);
  });

  it("Check with patient is matched by PREFIX, so a reworded state list keeps its colour", () => {
    expect(networkPill(lead("Check with patient: lives in NY, NJ, FL, TN or WY?"))?.tone).toBe("amber");
  });

  it("Check manually is AMBER and says what it means on hover", () => {
    const p = networkPill(lead("Check manually"));
    expect(p).toMatchObject({ label: "Check manually", tone: "amber" });
    expect(p?.title).toMatch(/look the plan up/);
  });

  it("a failed check still outranks a Check verdict left from an earlier run", () => {
    expect(networkPill(lead("Check manually", "AAA 72 — Invalid/Missing Subscriber/Insured ID"))?.label)
      .toBe("Check failed");
  });

  it("a FAILED check is a red 'Check failed', with the payer's reason on hover", () => {
    const err = "Incorrect information | AAA 73 — Invalid/Missing Subscriber/Insured Name";
    const p = networkPill(lead("", err));
    expect(p).toMatchObject({ label: "Check failed", tone: "red" });
    expect(p?.title).toContain("AAA 73");
  });

  it("a failure outranks a network answer left over from an EARLIER run", () => {
    // A failed run means the identifiers did not match, so a "Yes" beside it
    // describes a patient we could not just confirm.
    expect(networkPill(lead("Yes", "AAA 75 — Subscriber Not Found"))?.label).toBe("Check failed");
  });
});
