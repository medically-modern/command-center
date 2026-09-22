/**
 * The reorder form (§5.46c) — the rule, and the two things about this data
 * that are not obvious from looking at it once.
 *
 * Fixtures are shapes read off the LIVE Subscription board on 2026-09-22 (the
 * 300 most recent responders), not invented ones: the "No Response" row still
 * carrying June's timestamp, and the blank-status row carrying July's, are both
 * real and are what the state rule exists for.
 */
import { describe, expect, it } from "vitest";
import {
  REORDER_COL,
  REORDER_SEND_FROM_COMMAND_CENTER,
  buildReorderForm,
  latestChange,
  reorderFormColumns,
  responseTone,
  stripStamp,
} from "./reorderForm";

const SUB = 18407459988;
const LINK = "https://reorder.medicallymodern.com?token=d1942b77917a41f1";

function cols(over: Record<string, string> = {}) {
  return { [REORDER_COL.link]: LINK, ...over };
}

describe("which columns the read needs", () => {
  it("is the Subscription board only — every other board gets nothing", () => {
    expect(reorderFormColumns(SUB)).toHaveLength(7);
    expect(reorderFormColumns(18406060017)).toEqual([]); // Medical Evaluation
    expect(reorderFormColumns(18410804557)).toEqual([]); // Welcome Call
  });

  it("names the seven live column ids", () => {
    expect(reorderFormColumns(SUB).sort()).toEqual(
      [
        "text_mm3khve4",
        "text_mm3rzqks",
        "color_mm3kjykc",
        "color_mm3k4z79",
        "text_mm3kt9bs",
        "long_text_mm3k5y3n",
        "long_text_mm3xnb6k",
      ].sort(),
    );
  });

  it("builds nothing for a board that has no reorder form", () => {
    expect(buildReorderForm(18406060017, cols())).toBeNull();
  });
});

describe("⚠️ 'No Response' is a RESET, not an answer", () => {
  it("a No Response row carrying an old timestamp is still AWAITING", () => {
    // Live shape: status reset for the next cycle, June's stamp and summary
    // left behind. Reading the stamp as "they answered" would print
    // *submitted 18 Jun* on a patient we are waiting on today.
    const f = buildReorderForm(
      SUB,
      cols({
        [REORDER_COL.orderResponse]: "No Response",
        [REORDER_COL.insuranceResponse]: "Confirmed",
        [REORDER_COL.respondedAt]: "Jun 18, 2026, 11:30 AM ET",
        [REORDER_COL.changeSummary]:
          "[6/18/26, 11:30 AM] Patient CONFIRM:\nCartridge quantity changed from 3 to 2.",
      }),
    )!;
    expect(f.state).toBe("awaiting");
    // The stamp is still carried — the card labels it "last answered".
    expect(f.answeredAt).toBe("Jun 18, 2026, 11:30 AM ET");
  });

  it("a BLANK status is awaiting too, never an answer", () => {
    // 88 of the 300 live rows are this: a timestamp, a CONFIRM summary, and no
    // status at all because the column is newer than they are.
    const f = buildReorderForm(
      SUB,
      cols({ [REORDER_COL.respondedAt]: "Jul 14, 2026, 2:02 PM ET" }),
    )!;
    expect(f.state).toBe("awaiting");
  });

  it("every positive label answers", () => {
    for (const label of ["Confirmed", "Delay", "Cancel", "Pause"]) {
      expect(buildReorderForm(SUB, cols({ [REORDER_COL.orderResponse]: label }))!.state).toBe(
        "responded",
      );
    }
  });
});

describe("⚠️ 'not sent' is the LINK, never the Reorder Text Sent stamp", () => {
  it("no link ⇒ not sent", () => {
    expect(buildReorderForm(SUB, { [REORDER_COL.link]: "" })!.state).toBe("not-sent");
  });

  it("a link with no sent-stamp is still SENT", () => {
    // 195 of the same 300 rows have no stamp and have plainly been texted —
    // that column is newer than the flow. Keying on it would report "Not sent
    // yet" for two thirds of the patients who have already answered.
    const f = buildReorderForm(
      SUB,
      cols({ [REORDER_COL.textSent]: "", [REORDER_COL.orderResponse]: "Confirmed" }),
    )!;
    expect(f.state).toBe("responded");
    expect(f.textSent).toBe("");
  });
});

describe("the latest change line", () => {
  it("takes the NEWEST entry, which is the LAST one", () => {
    const log = [
      "[6/18/26, 11:30 AM] Patient CONFIRM:",
      "Cartridge quantity changed from 3 to 2.",
      "[9/18/26, 2:02 PM] Patient DELAY:",
      "Order date changed from 2026-08-17 to 2026-08-24.",
    ].join("\n");
    expect(latestChange(log)).toBe("Order date changed from 2026-08-17 to 2026-08-24.");
  });

  it("joins an entry that carries several changes", () => {
    const log =
      "[9/18/26, 2:02 PM] Patient CONFIRM:\n" +
      'Infusion set 1 changed from AutoSoft XC 6 mm 5" to AutoSoft XC 9 mm 43".\n' +
      "Address changed from A to B.";
    expect(latestChange(log)).toBe(
      'Infusion set 1 changed from AutoSoft XC 6 mm 5" to AutoSoft XC 9 mm 43". · Address changed from A to B.',
    );
  });

  it("⚠️ returns an unparseable body VERBATIM rather than dropping it", () => {
    expect(latestChange("confirmed by phone")).toBe("confirmed by phone");
  });

  it("falls back to the header when an entry has no body", () => {
    expect(latestChange("[9/18/26, 2:02 PM] Patient CANCEL:")).toBe(
      "[9/18/26, 2:02 PM] Patient CANCEL:",
    );
  });

  it("is empty for an empty column", () => {
    expect(latestChange("")).toBe("");
    expect(latestChange("   \n  ")).toBe("");
  });
});

describe("the help message", () => {
  it("drops its own stamp — the card prints a timestamp beside it", () => {
    expect(stripStamp("[8/16/26, 2:03 PM ET]\nI don't need any cartridges")).toBe(
      "I don't need any cartridges",
    );
  });

  it("leaves a message whose own first words are bracketed alone", () => {
    expect(stripStamp("[urgent] call me back")).toBe("[urgent] call me back");
  });

  it("leaves a stamp with nothing under it alone rather than blanking it", () => {
    expect(stripStamp("[8/16/26, 2:03 PM ET]")).toBe("[8/16/26, 2:03 PM ET]");
  });
});

describe("chip tone matches the board's own label colours", () => {
  it("maps every live label", () => {
    expect(responseTone("Confirmed")).toBe("green");
    expect(responseTone("Delay")).toBe("amber");
    expect(responseTone("Pause")).toBe("amber");
    expect(responseTone("Changed")).toBe("amber");
    expect(responseTone("Cancel")).toBe("red");
  });

  it("⚠️ gives an unrecognised or not-yet label NO colour", () => {
    // A colour states an outcome. "No Response" is not one, and a label the
    // board grows later must not borrow green by accident.
    expect(responseTone("No Response")).toBe("");
    expect(responseTone("")).toBe("");
    expect(responseTone("Snoozed")).toBe("");
  });
});

describe("⚠️ Resend / Send now are not built", () => {
  it("the switch is off, and flipping it is a decision", () => {
    // Reading this file is the point of the test failing: there is no trigger
    // column for the reorder text, so a send from here is a new integration
    // with `reorder-patient-form`, not a button.
    expect(REORDER_SEND_FROM_COMMAND_CENTER).toBe(false);
  });
});
