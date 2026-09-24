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
    const raw = "Check with patient: lives in NY, NJ, FL or TN?";
    expect(networkPill(lead(raw))).toMatchObject({ label: raw, tone: "gray" });
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
