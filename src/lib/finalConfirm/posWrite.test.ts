/**
 * Final Confirm's POS write: preserve a stored value, fill a blank one.
 *
 * Two rules pull in opposite directions and both matter:
 *  - The spec says the system NEVER auto-rewrites POS at this stage. A value on
 *    the item — whether Welcome Call computed it or the rep overrode it — is a
 *    decision, and this stage must not quietly reverse it.
 *  - The spec also says the column is never blank after Welcome Call, because
 *    the rule's else-branch covers every payer.
 *
 * The second one can only be violated by patients who cleared Welcome Call
 * before POS existed. Flagged in review on PR #25: the original write skipped
 * on a null index, so that cohort advanced to Subscription / New Order with a
 * blank POS and nothing to catch it — C23_POS_11 only fires for out-of-state
 * Blues, so a blank that should read Home says nothing at all.
 */
import { describe, it, expect } from "vitest";

import { expectedPos, POS_INDEX } from "@/lib/shared/pos";

/** Mirrors the resolution in sendPatientToMonday — kept in sync deliberately. */
const posIndexToWrite = (p: {
  posIndex: number | null;
  primaryInsurance: string;
  address: string;
  addressEdited: string | null;
}) => p.posIndex ?? POS_INDEX[expectedPos(p.primaryInsurance, p.addressEdited ?? p.address)];

describe("Final Confirm POS write", () => {
  it("preserves a stored Office, even where the rule would say Home", () => {
    // A rep's deliberate override. C23 flags the disagreement; the value stands.
    expect(
      posIndexToWrite({
        posIndex: POS_INDEX.Office,
        primaryInsurance: "Anthem BCBS Commercial",
        address: "12 Main St, Albany, NY 12203",
        addressEdited: null,
      }),
    ).toBe(POS_INDEX.Office);
  });

  it("preserves a stored Home, even where the rule would say Office", () => {
    expect(
      posIndexToWrite({
        posIndex: POS_INDEX.Home,
        primaryInsurance: "Anthem BCBS Commercial",
        address: "500 Oak Dr, Dallas, TX 75001",
        addressEdited: null,
      }),
    ).toBe(POS_INDEX.Home);
  });

  it("fills a blank from the rule — out-of-state Blue gets Office", () => {
    expect(
      posIndexToWrite({
        posIndex: null,
        primaryInsurance: "Anthem BCBS Commercial",
        address: "500 Oak Dr, Dallas, TX 75001",
        addressEdited: null,
      }),
    ).toBe(POS_INDEX.Office);
  });

  it("fills a blank from the rule — everyone else gets Home", () => {
    expect(
      posIndexToWrite({
        posIndex: null,
        primaryInsurance: "Cigna",
        address: "500 Oak Dr, Dallas, TX 75001",
        addressEdited: null,
      }),
    ).toBe(POS_INDEX.Home);
  });

  it("fills a blank from the rep's edited address, not the stale board one", () => {
    expect(
      posIndexToWrite({
        posIndex: null,
        primaryInsurance: "Anthem BCBS Commercial",
        address: "12 Main St, Albany, NY 12203",
        addressEdited: "500 Oak Dr, Dallas, TX 75001",
      }),
    ).toBe(POS_INDEX.Office);
  });

  it("never leaves POS unresolved — every combination yields an index", () => {
    for (const primary of ["Anthem BCBS Commercial", "Horizon BCBS", "Cigna", "Medicare A&B", ""]) {
      for (const address of ["12 Main St, Albany, NY 12203", "500 Oak Dr, Dallas, TX 75001", ""]) {
        const idx = posIndexToWrite({ posIndex: null, primaryInsurance: primary, address, addressEdited: null });
        expect([POS_INDEX.Office, POS_INDEX.Home], `${primary} / ${address}`).toContain(idx);
      }
    }
  });
});
