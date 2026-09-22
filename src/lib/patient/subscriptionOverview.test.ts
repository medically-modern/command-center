import { describe, expect, it } from "vitest";
import {
  OVERVIEW_COLS,
  daysUntil,
  dueText,
  subscriptionOverview,
  usDate,
} from "./subscriptionOverview";
import { STAGE_DETAIL } from "@/lib/commsHub/stageDetail";

const TODAY = "2026-09-22";
const cols = (over: Partial<Record<string, string>> = {}) => ({
  [OVERVIEW_COLS.status]: "Active",
  [OVERVIEW_COLS.nextOrder]: "2026-09-26",
  [OVERVIEW_COLS.subscription]: "Sensors & Supplies",
  [OVERVIEW_COLS.orderType]: "Reorder",
  ...over,
}) as Record<string, string>;

const labels = (f: { label: string }[]) => f.map((x) => x.label);
const valueOf = (f: { label: string; value: string }[], k: string) =>
  f.find((x) => x.label === k)!.value;

describe("⚠️ the strip is Brandon's FOUR facts, not the board's six", () => {
  it("is Status · Next order · Subscription · First order, in that order", () => {
    // Josh, 2026-09-22: "Delete Days to order: 70 Days in profile - not on
    // redesign - same with cycle - doesn't have first order".
    expect(labels(subscriptionOverview(cols(), [], TODAY))).toEqual([
      "Status",
      "Next order",
      "Subscription",
      "First order",
    ]);
  });

  it("⚠️ carries NEITHER of the two Josh named as differences", () => {
    const l = labels(subscriptionOverview(cols(), [], TODAY));
    expect(l).not.toContain("Days to order");
    expect(l).not.toContain("Cycle");
    expect(l).not.toContain("Orders so far");
  });

  it("⚠️ the SUBSCRIPTION map is untouched — the Comms Hub still shows all six", () => {
    // Trimming the shared map would have quietly changed the dossier pane a rep
    // reads on a call (§5.28), which is the §5.7 hazard with two readers.
    const first = STAGE_DETAIL[18407459988][0];
    expect(first.title).toBe("Next order");
    expect(first.fields.map((f) => f.label)).toContain("Days to order");
    expect(first.fields.map((f) => f.label)).toContain("Cycle");
  });
});

describe("the next order's relative day count", () => {
  it("reads forward, today and overdue", () => {
    expect(dueText(daysUntil("2026-09-26", TODAY))).toBe("in 4 days");
    expect(dueText(daysUntil("2026-09-23", TODAY))).toBe("in 1 day");
    expect(dueText(daysUntil("2026-09-22", TODAY))).toBe("today");
    expect(dueText(daysUntil("2026-09-19", TODAY))).toBe("3 days overdue");
    expect(dueText(daysUntil("2026-09-21", TODAY))).toBe("1 day overdue");
  });

  it("⚠️ an unreadable date says NOTHING rather than guessing", () => {
    expect(daysUntil("", TODAY)).toBeNull();
    expect(daysUntil("next Tuesday", TODAY)).toBeNull();
    expect(dueText(null)).toBe("");
  });

  it("⚠️ counts CALENDAR days in ET and cannot drift across a month or a DST edge", () => {
    // §5.15: a naive board value parsed as a Date in a UTC container is the bug
    // that had patients showing a day out.
    expect(daysUntil("2026-10-01", "2026-09-30")).toBe(1);
    expect(daysUntil("2026-11-02", "2026-11-01")).toBe(1); // clocks changed
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
  });

  it("only an OVERDUE next order is warned about", () => {
    const late = subscriptionOverview(cols({ [OVERVIEW_COLS.nextOrder]: "2026-09-10" }), [], TODAY);
    expect(late.find((f) => f.label === "Next order")!.warn).toBe(true);
    const soon = subscriptionOverview(cols(), [], TODAY);
    expect(soon.find((f) => f.label === "Next order")!.warn).toBe(false);
    expect(soon.find((f) => f.label === "Status")!.warn).toBeUndefined();
  });
});

describe("first order", () => {
  it("is the EARLIEST order date, whatever order the board answered in", () => {
    const f = subscriptionOverview(cols(), ["2026-09-01", "2025-03-14", "2026-06-02"], TODAY);
    expect(valueOf(f, "First order")).toBe("3/14/2025");
  });

  it("⚠️ a blank date sorts OUT rather than counting as the beginning of time", () => {
    const f = subscriptionOverview(cols(), ["", "2025-03-14"], TODAY);
    expect(valueOf(f, "First order")).toBe("3/14/2025");
  });

  it("⚠️ unread orders give a BLANK, never a date borrowed from elsewhere", () => {
    expect(valueOf(subscriptionOverview(cols(), null, TODAY), "First order")).toBe("");
    expect(valueOf(subscriptionOverview(cols(), [], TODAY), "First order")).toBe("");
  });
});

describe("⚠️ missing and empty stay different facts", () => {
  it("an absent column is blank, never invented", () => {
    const f = subscriptionOverview({}, null, TODAY);
    expect(f.every((x) => x.value === "")).toBe(true);
    expect(labels(f)).toHaveLength(4);
  });

  it("undefined cols do not throw", () => {
    expect(() => subscriptionOverview(undefined, null, TODAY)).not.toThrow();
  });

  it("the order type rides as the Subscription's quieter clause, not a fifth fact", () => {
    const f = subscriptionOverview(cols(), [], TODAY);
    const sub = f.find((x) => x.label === "Subscription")!;
    expect(sub.value).toBe("Sensors & Supplies");
    expect(sub.note).toBe("Reorder");
  });
});

describe("usDate", () => {
  it("renders a board date without ever parsing it", () => {
    expect(usDate("2026-09-26")).toBe("9/26/2026");
    expect(usDate("2026-01-05")).toBe("1/5/2026");
  });

  it("⚠️ anything else passes through verbatim (§9)", () => {
    expect(usDate("")).toBe("");
    expect(usDate("TBD")).toBe("TBD");
  });
});
