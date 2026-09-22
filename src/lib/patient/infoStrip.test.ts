/**
 * The Onboarding info strip's rule (§5.46f).
 *
 * Every case below is one that would be SILENT on screen: a coverage-path id
 * read from the wrong board renders an em dash on a filled-in column, a naive
 * board date parsed as an instant lands on the wrong day, and a New Form group
 * read as evidence on its own calls 1,697 imported referrals "web-form leads".
 */
import { describe, expect, it } from "vitest";
import type { DossierItem, PatientDossier } from "@/lib/commsHub/dossier";
import {
  INFO_COL,
  STAGE_DAYS_WARN,
  agoText,
  anchorItem,
  daysSince,
  etDateOf,
  infoStripColumns,
  infoStripFacts,
  isWebFormLead,
  stageDaysText,
  usDate,
} from "./infoStrip";

const DTC = 18392794310;
const SO = 18406352652;
const MED = 18406060017;
const INS = 18410601299;
const WC = 18410804557;
const SUB = 18407459988;

function item(boardId: number, over: Partial<DossierItem> = {}): DossierItem {
  return {
    itemId: `${boardId}-1`,
    name: "Jane Doe",
    phone: "+15555550100",
    boardId,
    boardName: String(boardId),
    groupId: "g",
    groupTitle: "2. Medical Necessity",
    isCompleted: false,
    isStuck: false,
    escalationText: "",
    escalationLevel: null,
    isProposedStuck: false,
    dob: "",
    route: "/x",
    stageAdvancerText: "",
    notes: "",
    notesColId: "",
    notesColType: null,
    nextActionDate: "",
    daysSinceStage: "",
    createdAt: "",
    cols: {},
    ...over,
  };
}

const dossier = (items: DossierItem[], active: DossierItem | null = null): PatientDossier => ({
  name: "Jane Doe",
  phone: "+15555550100",
  active,
  path: [],
  alsoOn: [],
  items,
});

const TODAY = "2026-09-22";
const facts = (d: PatientDossier | null) => {
  const out = new Map<string, ReturnType<typeof infoStripFacts>[number]>();
  for (const f of infoStripFacts(d, TODAY)) out.set(f.label, f);
  return out;
};

describe("the column map", () => {
  it("⚠️ the COVERAGE PATHS are renumbered on Insurance and Welcome Call", () => {
    // Brandon's handoff names Profile Send Off's / Medical Evaluation's ids.
    // Read live 2026-09-22, the other two boards do not have them — using his
    // board-wide would read BLANK on the two stages where they are most filled
    // in, silently (§5.11).
    expect(INFO_COL[SO].cgmPath).toBe("color_mm1w7e5q");
    expect(INFO_COL[MED].cgmPath).toBe("color_mm1w7e5q");
    expect(INFO_COL[INS].cgmPath).toBe("color_mm2w8q");
    expect(INFO_COL[WC].cgmPath).toBe("color_mm2wsam4");

    expect(INFO_COL[SO].pumpPath).toBe("color_mm1w5xn1");
    expect(INFO_COL[INS].pumpPath).toBe("color_mm1w5xn1");
    expect(INFO_COL[WC].pumpPath).toBe("color_mm2xtn41");
  });

  it("⚠️ Profile Send Off has NO stage-start column", () => {
    // Which is Brandon's own note — "Send Off: the item's creation date" — and
    // why `createdAt` is read at all.
    expect(INFO_COL[SO].stageStart).toBeNull();
    expect(INFO_COL[MED].stageStart).toBe("date_mm1w6jeq");
  });

  it("⚠️ DTC Intake maps only what its titles name unambiguously", () => {
    // It has no Request Type at all and three candidate primary-insurance
    // columns, so both stay null rather than being guessed (§5.28's rule).
    expect(INFO_COL[DTC].requestType).toBeNull();
    expect(INFO_COL[DTC].primaryInsurance).toBeNull();
    expect(INFO_COL[DTC].referralSource).toBe("color_mkywv02j");
  });

  it("infoStripColumns is the non-null ids, and nothing for an unmapped board", () => {
    expect(infoStripColumns(MED)).toEqual([
      "date_mm1wf43j",
      "date_mm1w6jeq",
      "color_mm1w1978",
      "color_mm1x157j",
      "color_mm1w5xn1",
      "color_mm1w7e5q",
      "color_mm1w5wxr",
    ]);
    expect(infoStripColumns(SUB)).toEqual([]);
    expect(infoStripColumns(SO)).toContain("color_mm5zv7q8");
  });
});

describe("dates", () => {
  it("⚠️ a created_at IS an instant and converts to the ET calendar day", () => {
    // 00:30 UTC on the 19th is still the 18th in New York. This is the one
    // date here that may go through a Date (§5.15's inversion).
    expect(etDateOf("2026-09-19T00:30:00Z")).toBe("2026-09-18");
    expect(etDateOf("2026-09-18T20:19:13Z")).toBe("2026-09-18");
    expect(etDateOf("")).toBe("");
    expect(etDateOf("not a date")).toBe("");
  });

  it("counts whole ET calendar days, from the PARTS", () => {
    expect(daysSince("2026-09-22", TODAY)).toBe(0);
    expect(daysSince("2026-09-18", TODAY)).toBe(4);
    expect(daysSince("2026-09-25", TODAY)).toBe(-3);
    expect(daysSince("", TODAY)).toBeNull();
    expect(daysSince("9/18/2026", TODAY)).toBeNull();
  });

  it("words them the way Brandon does", () => {
    expect(agoText(0)).toBe("today");
    expect(agoText(1)).toBe("1 day ago");
    expect(agoText(4)).toBe("4 days ago");
    expect(agoText(-2)).toBe("in 2 days");
    expect(agoText(null)).toBe("");
    // Days in stage is always in the past, so a future stage start says
    // nothing rather than "in 3 days".
    expect(stageDaysText(3)).toBe("3 days");
    expect(stageDaysText(1)).toBe("1 day");
    expect(stageDaysText(-3)).toBe("");
  });

  it("usDate leaves anything it does not recognise alone", () => {
    expect(usDate("2026-09-08")).toBe("9/8/2026");
    expect(usDate("whenever")).toBe("whenever");
  });
});

describe("the facts", () => {
  it("is Brandon's eight, in his order", () => {
    const f = infoStripFacts(dossier([item(MED)], item(MED)), TODAY);
    expect(f.map((x) => x.label)).toEqual([
      "Intake date",
      "Stage start date",
      "Request type",
      "Primary insurance",
      "Pump path",
      "CGM path",
      "Referral source",
      "Stage",
    ]);
  });

  it("returns nothing at all when the patient has no records", () => {
    expect(infoStripFacts(dossier([]), TODAY)).toEqual([]);
  });

  it("⚠️ a blank is an em dash and is MARKED missing, never a zero", () => {
    const f = facts(dossier([item(MED)], item(MED)));
    expect(f.get("Request type")!.value).toBe("—");
    expect(f.get("Request type")!.missing).toBe(true);
  });

  it("⚠️ reads a fact ACROSS the records, furthest-along board first", () => {
    // A subscribed patient's active record is the Subscription board, which
    // carries none of these columns; without the scan the whole strip would be
    // em dashes for exactly the patients who have finished onboarding.
    const wc = item(WC, { cols: { [INFO_COL[WC].requestType!]: "CGM" } });
    const med = item(MED, { cols: { [INFO_COL[MED].requestType!]: "Insulin Pump" } });
    const sub = item(SUB);
    expect(facts(dossier([med, wc, sub], sub)).get("Request type")!.value).toBe("CGM");
  });

  it("⚠️ Primary insurance falls back to GENERAL on Profile Send Off", () => {
    // Measured 2026-09-22: Primary is filled on 152/200 intake rows and
    // General on 194/200 — the carrier really is one column over, and it is
    // what puts "Cash Pay" on the strip (§5.48).
    const so = item(SO, { cols: { [INFO_COL[SO].generalInsurance!]: "Cash Pay" } });
    expect(facts(dossier([so], so)).get("Primary insurance")!.value).toBe("Cash Pay");
  });

  it("stage start comes from the ANCHOR record, and warns past a fortnight", () => {
    const med = item(MED, { cols: { [INFO_COL[MED].stageStart!]: "2026-09-01" } });
    const f = facts(dossier([med], med));
    expect(f.get("Stage start date")!.value).toBe("9/1/2026");
    expect(f.get("Stage start date")!.note).toBe("21 days");
    expect(f.get("Stage start date")!.tone).toBe("warn");
  });

  it("⚠️ exactly fourteen days is NOT yet warned — Brandon's rule is over 14", () => {
    const at = (ymd: string) => {
      const med = item(MED, { cols: { [INFO_COL[MED].stageStart!]: ymd } });
      return facts(dossier([med], med)).get("Stage start date")!.tone;
    };
    expect(STAGE_DAYS_WARN).toBe(14);
    expect(at("2026-09-08")).toBeUndefined(); // 14 days
    expect(at("2026-09-07")).toBe("warn"); // 15
  });

  it("⚠️ Profile Send Off's stage start is the item's CREATION date", () => {
    const so = item(SO, { createdAt: "2026-09-18T20:19:13Z" });
    const f = facts(dossier([so], so));
    expect(f.get("Stage start date")!.value).toBe("9/18/2026");
    expect(f.get("Stage start date")!.note).toBe("4 days");
  });

  it("intake date carries the days since", () => {
    const med = item(MED, { cols: { [INFO_COL[MED].intakeDate!]: "2026-09-18" } });
    expect(facts(dossier([med], med)).get("Intake date")!.note).toBe("4 days ago");
  });
});

describe("the Stage fact", () => {
  it("names the macro stage and the sub-step", () => {
    const med = item(MED, { stageAdvancerText: "Chase Clinicals" });
    const s = facts(dossier([med], med)).get("Stage")!;
    expect(s.value).toBe("Medical Necessity");
    expect(s.sub).toBe("Chase Clinicals");
  });

  it("⚠️ a Stuck GROUP and a stuck PROPOSAL are named differently (§5.43)", () => {
    const stuck = item(MED, { isStuck: true, groupTitle: "Stuck" });
    expect(facts(dossier([stuck])).get("Stage")!.chip).toMatchObject({ text: "Stuck", tone: "red" });

    const proposed = item(MED, { isProposedStuck: true });
    expect(facts(dossier([proposed], proposed)).get("Stage")!.chip).toMatchObject({
      text: "Stuck proposed",
      tone: "amber",
    });

    expect(facts(dossier([item(MED)], item(MED))).get("Stage")!.chip).toBeUndefined();
  });

  it("reads 'Onboarding complete' with the date once every stage is done", () => {
    const done = (b: number) => item(b, { isCompleted: true, groupTitle: "Completed" });
    const sub = item(SUB, { createdAt: "2026-04-21T15:00:00Z" });
    const s = facts(dossier([done(SO), done(MED), done(INS), done(WC), sub], sub)).get("Stage")!;
    expect(s.value).toBe("Onboarding complete");
    expect(s.tone).toBe("good");
    expect(s.sub).toBe("4/21/2026");
  });

  it("⚠️ a New Form group is NOT evidence of a web-form lead on its own", () => {
    // The 8/25 SNJ import put ~1,697 rows into Partial Leads that never touched
    // the form; they are worked as referrals. Drop-off Step is what carries it.
    const imported = item(SO, { groupTitle: "New Form — Partial Leads" });
    expect(isWebFormLead([imported])).toBe(false);
    expect(facts(dossier([imported], imported)).get("Stage")!.value).toBe("Intake");

    const lead = item(SO, {
      groupTitle: "New Form — Partial Leads",
      cols: { [INFO_COL[SO].dropOffStep!]: "Step 3 - What they need" },
    });
    expect(isWebFormLead([lead])).toBe(true);
    expect(facts(dossier([lead], lead)).get("Stage")!.value).toBe("Web-form lead");
  });

  it("⚠️ a COMPLETED Send Off record is not a lead, whatever group it sits in", () => {
    const old = item(SO, {
      isCompleted: true,
      groupTitle: "New Form — Completed",
      cols: { [INFO_COL[SO].dropOffStep!]: "Completed" },
    });
    expect(isWebFormLead([old])).toBe(false);
  });
});

describe("the anchor", () => {
  it("⚠️ falls back for a patient whose only live record is STUCK", () => {
    // `pickActive` skips stuck records by design, so `dossier.active` is null
    // — without the fallback the whole strip goes blank for exactly the
    // patient a manager opened it to read.
    const stuck = item(MED, { isStuck: true, groupTitle: "Stuck" });
    const doneSo = item(SO, { isCompleted: true, groupTitle: "Completed" });
    expect(anchorItem(dossier([doneSo, stuck]))?.itemId).toBe(stuck.itemId);
  });

  it("prefers the active record when there is one", () => {
    const live = item(INS);
    expect(anchorItem(dossier([item(MED), live], live))?.itemId).toBe(live.itemId);
  });

  it("falls back to the furthest-along record when every one is completed", () => {
    const so = item(SO, { isCompleted: true });
    const wc = item(WC, { isCompleted: true });
    expect(anchorItem(dossier([so, wc]))?.itemId).toBe(wc.itemId);
  });
});
