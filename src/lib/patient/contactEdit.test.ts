/**
 * The top bar's contact rule (§5.46g).
 *
 * Every case below is one that would be SILENT: an email column written with a
 * text column's shape comes back HTTP 200 with nothing written, a Can Text that
 * survives a number change sends the Day-20 reorder text to a line nobody
 * reads, and a value the writer skips rather than refusing reports success
 * having written nothing at all.
 */
import { describe, expect, it } from "vitest";
import type { DossierItem, PatientDossier } from "@/lib/commsHub/dossier";
import {
  EMAIL_COL,
  contactTarget,
  contactWrites,
  emailColumns,
  emailOf,
  emailRefusal,
  patientEmail,
  phoneRefusal,
} from "./contactEdit";

const DTC = 18392794310;
const SO = 18406352652;
const MED = 18406060017;
const INS = 18410601299;
const WC = 18410804557;
const SUB = 18407459988;
const CLAIMS = 18413019028;

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

describe("the email column map", () => {
  it("⚠️ declares the TYPE, because the two shapes are not interchangeable", () => {
    // Four pipeline boards hold a plain TEXT column; Subscription and DTC
    // Intake hold `email_*` columns, which take {email, text}. The wrong shape
    // is refused at HTTP 200 with a GraphQL errors[] and nothing written.
    expect(EMAIL_COL[SO]).toEqual({ id: "text_mm1xc140", type: "text" });
    expect(EMAIL_COL[WC]).toEqual({ id: "text_mm1xc140", type: "text" });
    expect(EMAIL_COL[SUB]).toEqual({ id: "email_mkp01rrw", type: "email" });
    expect(EMAIL_COL[DTC]).toEqual({ id: "email_mkwrdzzw", type: "email" });
  });

  it("⚠️ Secondary Claims is deliberately absent", () => {
    // Its only address column is "Patient Stripe Email" — where a receipt goes,
    // not how we reach the patient. A plausible wrong answer beats no answer
    // only if it is right (§5.28).
    expect(EMAIL_COL[CLAIMS]).toBeUndefined();
    expect(emailColumns(CLAIMS)).toEqual([]);
    expect(emailColumns(INS)).toEqual(["text_mm1xc140"]);
  });
});

describe("reading", () => {
  it("⚠️ pulls the address out of an email column's composite rendering", () => {
    // Monday renders a drifted label as "Dr. Smith - a@b.com"; handing THAT to
    // a mailto, or back to Monday as an address, is the 2026-08-03 incident.
    const sub = item(SUB, { cols: { "email_mkp01rrw": "Jane at home - jane@example.com" } });
    expect(emailOf(sub)).toBe("jane@example.com");
  });

  it("⚠️ reads ACROSS the records, furthest-along board first", () => {
    // The Subscription board's own column may be empty while Welcome Call has
    // it — reading the active record alone shows an em dash for exactly the
    // patients this screen is most often opened for.
    const wc = item(WC, { cols: { "text_mm1xc140": "new@example.com" } });
    const med = item(MED, { cols: { "text_mm1xc140": "old@example.com" } });
    const sub = item(SUB);
    expect(patientEmail(dossier([med, wc, sub], sub))).toBe("new@example.com");
    expect(patientEmail(dossier([]))).toBe("");
  });
});

describe("the target", () => {
  it("is the anchor record, with that board's own columns", () => {
    const live = item(INS);
    const t = contactTarget(dossier([item(MED), live], live))!;
    expect(t.item.itemId).toBe(live.itemId);
    expect(t.phoneColId).toBe("phone_mm1x44yk");
    expect(t.emailColId).toBe("text_mm1xc140");
    expect(t.refusal).toBe("");
  });

  it("⚠️ REFUSES a completed record — that is the stage's snapshot", () => {
    // `anchorItem` only reaches one when every record is finished. §5.38: a
    // completed item's columns ARE what the stepper renders, so editing one
    // rewrites history rather than correcting live work.
    const done = item(WC, { isCompleted: true, groupTitle: "Completed" });
    expect(contactTarget(dossier([done]))!.refusal).toMatch(/completed/i);
  });

  it("⚠️ names the Can Text column only on the boards that have one", () => {
    const wc = item(WC);
    expect(contactTarget(dossier([wc], wc))!.canTextColId).toBe("color_mm72v5q7");
    const med = item(MED);
    expect(contactTarget(dossier([med], med))!.canTextColId).toBeNull();
  });

  it("is null when there is no record at all", () => {
    expect(contactTarget(dossier([]))).toBeNull();
    expect(contactTarget(null)).toBeNull();
  });
});

describe("refusals", () => {
  it("⚠️ a blank is a deliberate clear on both fields, never a refusal", () => {
    expect(phoneRefusal("")).toBe("");
    expect(emailRefusal("   ")).toBe("");
  });

  it("names what is wrong with a number rather than silently skipping it", () => {
    expect(phoneRefusal("(555) 555-0100")).toBe("");
    expect(phoneRefusal("555-0100")).toMatch(/needs 10/);
    expect(phoneRefusal("555 555 0100 x12")).toMatch(/extension/i);
  });

  it("⚠️ keeps accepting an @rcfax.com address — the shared shape test", () => {
    expect(emailRefusal("3156270554@rcfax.com")).toBe("");
    expect(emailRefusal("jane@example.com")).toBe("");
    expect(emailRefusal("jane at example")).toMatch(/doesn't look like/);
    expect(emailRefusal("Dr Smith - a@b.com")).toMatch(/doesn't look like/);
  });
});

describe("the write", () => {
  const wcTarget = (phone = "+15555550100") => {
    const wc = item(WC, { phone, cols: {} });
    return contactTarget(dossier([wc], wc))!;
  };

  it("writes a text email column as a BARE STRING", () => {
    expect(contactWrites(wcTarget(), "email", "jane@example.com")).toEqual({
      "text_mm1xc140": "jane@example.com",
    });
  });

  it("writes an email column as {email, text}", () => {
    const sub = item(SUB);
    const t = contactTarget(dossier([sub], sub))!;
    expect(contactWrites(t, "email", "jane@example.com")).toEqual({
      "email_mkp01rrw": { email: "jane@example.com", text: "jane@example.com" },
    });
  });

  it("⚠️ a blank CLEARS with {} — never null, which Monday reads as unreadable", () => {
    expect(contactWrites(wcTarget(), "email", "")).toEqual({ "text_mm1xc140": {} });
    expect(contactWrites(wcTarget(), "phone", "  ")["phone_mm1x44yk"]).toEqual({});
  });

  it("writes a phone as bare DIGITS, which is all the API accepts", () => {
    const w = contactWrites(wcTarget(), "phone", "(555) 555-0199");
    expect(w["phone_mm1x44yk"]).toEqual({ phone: "5555550199", countryShortName: "US" });
  });

  it("⚠️⚠️ CHANGING the number clears Can Text; reformatting it does not", () => {
    // §5.31d's `setSlotNumber` rule: Can Text is the starred slot's answer, so
    // a Yes about the old line would ride onto a new one and the Day-20
    // reorder text would go somewhere nobody can receive it.
    const t = wcTarget("+15555550100");
    expect(contactWrites(t, "phone", "555-555-0199")).toHaveProperty("color_mm72v5q7", {});
    expect(contactWrites(t, "phone", "(555) 555-0100")).not.toHaveProperty("color_mm72v5q7");
    // Clearing the number is a change too.
    expect(contactWrites(t, "phone", "")).toHaveProperty("color_mm72v5q7", {});
  });

  it("⚠️ a board with no Can Text column is untouched by the same edit", () => {
    const med = item(MED, { phone: "+15555550100" });
    const t = contactTarget(dossier([med], med))!;
    expect(Object.keys(contactWrites(t, "phone", "555-555-0199"))).toEqual(["phone_mm1x44yk"]);
  });

  it("writes nothing for an email on a board that has no email column", () => {
    const sec = item(CLAIMS);
    const t = contactTarget(dossier([sec], sec));
    expect(t ? contactWrites(t, "email", "a@b.com") : {}).toEqual({});
  });
});
