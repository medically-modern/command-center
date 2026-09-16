/**
 * The MR rung rule, and the label ids it writes.
 *
 * The ids are the half that fails SILENTLY: Monday takes a write to a label id
 * a column does not have at HTTP 200 and drops it, so a wrong id here would
 * look exactly like the bug this module was written to fix — a refreshed
 * patient still reading "MR Expired", nothing in any log.
 */
import { describe, it, expect } from "vitest";
import { mrRungForExpiry, MR_STATUS_INDEX } from "./mrStatus";
import { MR_STATUS_OPTIONS } from "./workflow";

/** `color_mktyr8xg` settings_str, board 18407459988, read live 2026-09-16. */
const LIVE_LABELS: Record<number, string> = {
  0: "MR <30 Days",
  1: "MR Valid",
  2: "MR Expired",
  3: "MR <20 Days",
  4: "MR <10 Days",
  6: "MR <5 Days",
  7: "MR Invalid",
};

describe("mrStatus — label ids are the live board's", () => {
  it("every index this module can write names the label it thinks it does", () => {
    for (const [key, index] of Object.entries(MR_STATUS_INDEX)) {
      expect(LIVE_LABELS[index], `MR_STATUS_INDEX.${key} = ${index}`).toBeDefined();
    }
    expect(LIVE_LABELS[MR_STATUS_INDEX.valid]).toBe("MR Valid");
    expect(LIVE_LABELS[MR_STATUS_INDEX.expired]).toBe("MR Expired");
    expect(LIVE_LABELS[MR_STATUS_INDEX.days30]).toBe("MR <30 Days");
    expect(LIVE_LABELS[MR_STATUS_INDEX.days20]).toBe("MR <20 Days");
    expect(LIVE_LABELS[MR_STATUS_INDEX.days10]).toBe("MR <10 Days");
    expect(LIVE_LABELS[MR_STATUS_INDEX.days5]).toBe("MR <5 Days");
    expect(LIVE_LABELS[MR_STATUS_INDEX.invalid]).toBe("MR Invalid");
  });

  // The picker in workflow.ts carries the same ids for the same column. They
  // are declared twice because `MR_STATUS_OPTIONS` is display-ordered and this
  // module is rule-ordered; they must still agree about every id.
  it("agrees with MR_STATUS_OPTIONS", () => {
    for (const opt of MR_STATUS_OPTIONS) {
      expect(LIVE_LABELS[opt.index], `option ${opt.label}`).toBe(opt.label);
    }
  });

  // Every rung the rule can return has to be writable.
  it("no rung returns an index the board does not have", () => {
    for (const days of [-400, -1, 0, 1, 5, 6, 10, 11, 20, 21, 30, 31, 200]) {
      const rung = mrRungForExpiry(shift("2026-09-16", days), "2026-09-16");
      expect(rung).not.toBeNull();
      expect(LIVE_LABELS[rung!.index], `${days}d out`).toBe(rung!.label);
    }
  });
});

/** YYYY-MM-DD `days` from `from`. */
function shift(from: string, days: number): string {
  const [y, m, d] = from.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

describe("mrStatus — the ladder", () => {
  const T = "2026-09-16";
  const at = (days: number) => mrRungForExpiry(shift(T, days), T)?.label;

  // Boundaries are the automations' own: the −30 rung fires AT 30 days out, so
  // 30 reads "<30 Days" and only 31+ reads Valid. Getting this off by one is
  // how a patient reads Valid on a day the board has already stepped them down.
  it("31+ days out is MR Valid", () => {
    expect(at(31)).toBe("MR Valid");
    expect(at(180)).toBe("MR Valid");
    expect(at(3650)).toBe("MR Valid");
  });

  it("30 down to 21 is MR <30 Days", () => {
    expect(at(30)).toBe("MR <30 Days");
    expect(at(21)).toBe("MR <30 Days");
  });

  it("20 down to 11 is MR <20 Days", () => {
    expect(at(20)).toBe("MR <20 Days");
    expect(at(11)).toBe("MR <20 Days");
  });

  it("10 down to 6 is MR <10 Days", () => {
    expect(at(10)).toBe("MR <10 Days");
    expect(at(6)).toBe("MR <10 Days");
  });

  it("5 down to 1 is MR <5 Days", () => {
    expect(at(5)).toBe("MR <5 Days");
    expect(at(1)).toBe("MR <5 Days");
  });

  // Today counts as expired — automation 637034292 fires ON the date.
  it("today and anything past is MR Expired", () => {
    expect(at(0)).toBe("MR Expired");
    expect(at(-1)).toBe("MR Expired");
    expect(at(-400)).toBe("MR Expired");
  });

  // The everyday case: a recent visit + 6 months.
  it("a visit today plus six months lands on MR Valid", () => {
    expect(mrRungForExpiry("2027-03-16", "2026-09-16")?.label).toBe("MR Valid");
  });

  // ⚠️ The tail the ">30 days ⇒ MR Valid" version of this rule would have
  // missed. A visit 5.5 months ago lands INSIDE the ladder, where the rungs it
  // has already passed will never fire for the new date either — so leaving it
  // alone would keep the patient on "MR Expired" until the next rung comes up.
  it("an old visit lands mid-ladder rather than staying expired", () => {
    expect(mrRungForExpiry("2026-10-01", "2026-09-16")?.label).toBe("MR <20 Days");
  });
});

describe("mrStatus — what it refuses to answer", () => {
  // A date we could not read is not evidence of anything. Guessing "Valid"
  // from a parse failure asserts a patient's records are current on the
  // strength of a bug.
  it("no date, no claim", () => {
    expect(mrRungForExpiry("", "2026-09-16")).toBeNull();
    expect(mrRungForExpiry(null, "2026-09-16")).toBeNull();
    expect(mrRungForExpiry(undefined, "2026-09-16")).toBeNull();
    expect(mrRungForExpiry("not a date", "2026-09-16")).toBeNull();
    expect(mrRungForExpiry("16/09/2026", "2026-09-16")).toBeNull();
  });

  // Monday hands back dates as "YYYY-MM-DD", sometimes with a time on the end.
  it("reads a date with a time suffix", () => {
    expect(mrRungForExpiry("2027-03-16 00:00:00", "2026-09-16")?.label).toBe("MR Valid");
  });
});

describe("mrStatus — ET, not the runtime's timezone", () => {
  // Monday's dates are timezone-naive ET (§9) and this runs in a UTC
  // container. Both sides are compared as UTC midnights, so the day count is
  // exact whole days and cannot drift across a month or year boundary.
  it("counts whole days across month and year ends", () => {
    expect(mrRungForExpiry("2026-10-01", "2026-09-30")?.label).toBe("MR <5 Days");
    expect(mrRungForExpiry("2027-01-01", "2026-12-31")?.label).toBe("MR <5 Days");
    expect(mrRungForExpiry("2027-02-01", "2026-12-31")?.label).toBe("MR Valid");
  });

  // A leap day is 366 days out, not 365 — plain integer date math, no Date
  // arithmetic on local time.
  it("handles a leap year", () => {
    expect(mrRungForExpiry("2028-02-29", "2028-02-28")?.label).toBe("MR <5 Days");
    expect(mrRungForExpiry("2028-03-01", "2028-02-29")?.label).toBe("MR <5 Days");
  });
});
