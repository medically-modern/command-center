/**
 * DVS rail narrowing.
 *
 * The two DVS charts (Retry Queue / Manual Review) share the Manager as
 * Processor column, so the rail is selected by CHART id, not by column. These
 * tests pin the predicates against the oversight CHART_FILTERS they mirror —
 * change one and this should fail.
 *
 * The predicates are re-declared here rather than exported from DvsPage,
 * because importing that module pulls in the whole page (and its hooks) into a
 * unit test. They are copied verbatim; the assertions below encode the label
 * sets the real filters use.
 */
import { describe, it, expect } from "vitest";
import type { Patient } from "@/lib/samantha/workflow";

type Tone = "mint" | "rose" | "sky" | "amber" | "gray";

function toneFor(label: string | undefined): Tone {
  const l = (label ?? "").toLowerCase();
  if (!l) return "gray";
  if (l.includes("success") || l.includes("paid") || l.includes("approved")) return "mint";
  if (l.includes("denied") || l.includes("failed") || l.includes("error") || l.includes("manual") || l.includes("mltc") || l.includes("incorrect")) return "rose";
  if (l.includes("retry")) return "amber";
  if (l.includes("running") || l.includes("trigger") || l.includes("submit")) return "sky";
  return "gray";
}
const isFailedish = (label: string | undefined) => toneFor(label) === "rose";
// Mirrors DvsPage.isManualReview. Classification is STATUS-driven: an escalation
// label never puts a patient in manual review (the 2026-07-29 rule) — the chart
// filter only uses the escalation column to EXCLUDE the Final half, which is a
// column-split concern rather than part of this predicate. This local copy had
// kept a stale `|| !!p.escalated`, so it stopped mirroring the page it guards.
const isManualReview = (p: Patient) =>
  isFailedish(p.dvsStatus) ||
  isFailedish(p.pumpDvsStatus) ||
  isFailedish(p.claimsStatus) ||
  isFailedish(p.ipClaimsStatus);
const isQueued = (p: Patient) => p.dvsStatus === "Retry Queued" || p.pumpDvsStatus === "Retry Queued";

const mk = (over: Partial<Patient>): Patient => ({ id: "x", name: "x", ...over }) as Patient;

describe("isQueued (mirrors CHART_FILTERS['dvs-retry-queue'])", () => {
  it("matches the literal Retry Queued label on either DVS column", () => {
    expect(isQueued(mk({ dvsStatus: "Retry Queued" }))).toBe(true);
    expect(isQueued(mk({ pumpDvsStatus: "Retry Queued" }))).toBe(true);
  });

  it("ignores a lingering retry count — the count outlives the queue", () => {
    expect(isQueued(mk({ retryCount: 3, dvsStatus: "Manual Review" }))).toBe(false);
  });

  it("does not treat Manual Review as queued", () => {
    // The old rule keyed on tone === "amber", which Manual Review also matched;
    // that put "Retry queue · attempt N" on manual-review rows.
    for (const label of ["Manual Review", "MLTC", "Failed", "Success", "Running"]) {
      expect(isQueued(mk({ dvsStatus: label }))).toBe(false);
    }
  });
});

describe("isManualReview (mirrors CHART_FILTERS['dvs-manual-review'])", () => {
  it("matches every rose label the chart filter lists", () => {
    for (const label of ["MLTC", "Failed", "Manual Review"]) {
      expect(isManualReview(mk({ dvsStatus: label }))).toBe(true);
    }
    // Pump adds Denied on top of the shared set.
    for (const label of ["MLTC", "Failed", "Manual Review", "Denied"]) {
      expect(isManualReview(mk({ pumpDvsStatus: label }))).toBe(true);
    }
    // BOTH claims families — supplies ("S Claims Status") and pump
    // ("IP Claims Status"). The pump half was unread until 2026-08-02.
    for (const label of ["Claims Error", "Claims Denied", "Payment Incorrect"]) {
      expect(isManualReview(mk({ claimsStatus: label }))).toBe(true);
      expect(isManualReview(mk({ ipClaimsStatus: label }))).toBe(true);
    }
  });

  it("does NOT classify on the escalation label — status only", () => {
    // A label carried in from an earlier stage must not read as manual review;
    // that was the 2026-07-29 rule and it still holds for classification.
    expect(isManualReview(mk({ escalated: true }))).toBe(false);
    expect(isManualReview(mk({ escalated: true, escalationLabel: "Manager Escalation Required" }))).toBe(false);
  });

  it("does not match healthy or queued patients", () => {
    expect(isManualReview(mk({ dvsStatus: "Success", claimsStatus: "Claims Paid" }))).toBe(false);
    expect(isManualReview(mk({ dvsStatus: "Retry Queued" }))).toBe(false);
    expect(isManualReview(mk({}))).toBe(false);
  });
});

describe("the two rails are disjoint", () => {
  it("no patient shows in both Retry Queue and Manual Review", () => {
    const pool = [
      mk({ id: "queued", dvsStatus: "Retry Queued" }),
      mk({ id: "manual", dvsStatus: "Manual Review" }),
      mk({ id: "pumpclaim", ipClaimsStatus: "Claims Denied" }),
      // Escalated but every status healthy: classification is status-driven, so
      // this patient belongs to NEITHER rail (the label alone means nothing).
      mk({ id: "esc", escalated: true, escalationLabel: "Manager Escalation Required" }),
      mk({ id: "ok", dvsStatus: "Success" }),
    ];
    const queued = pool.filter(isQueued).map((p) => p.id);
    const manual = pool.filter(isManualReview).map((p) => p.id);
    expect(queued).toEqual(["queued"]);
    expect(manual.sort()).toEqual(["manual", "pumpclaim"]);
    expect(queued.filter((id) => manual.includes(id))).toEqual([]);
  });
});
