/**
 * An unmatched number → a patient (COMMS_INBOX_PLAN.md §6). The two things
 * that must never happen: a Monday write the refusal should have stopped, and a
 * link claiming a number the record never got.
 */
import { describe, expect, it, vi } from "vitest";
import { addNumberOptions, addNumberToPatient, type AddNumberDeps } from "./addNumber";
import type { ContactTarget } from "@/lib/patient/contactEdit";
import type { DossierItem } from "@/lib/commsHub/dossier";

const WELCOME_CALL = 18410804557; // has Alternate Phone phone_mm7265hp
const INSURANCE = 18410601299; // has none

function target(boardId: number, over: Partial<ContactTarget> = {}, item: Partial<DossierItem> = {}): ContactTarget {
  return {
    item: {
      itemId: "123",
      name: "Jane Doe",
      phone: "+15550001111",
      boardId,
      boardName: boardId === WELCOME_CALL ? "Welcome Call" : "Insurance",
      cols: boardId === WELCOME_CALL ? { phone_mm7265hp: "(555) 000-9999" } : {},
      isCompleted: false,
      ...item,
    } as DossierItem,
    phoneColId: "phone_mm1x44yk",
    emailColId: null,
    emailType: null,
    canTextColId: boardId === WELCOME_CALL ? "color_mm72v5q7" : null,
    refusal: "",
    ...over,
  };
}

function deps() {
  const calls: string[] = [];
  const d: AddNumberDeps = {
    updatePatientContact: vi.fn(async () => {
      calls.push("monday");
    }),
    linkNumber: vi.fn(async () => {
      calls.push("link");
      return { key: `p:${WELCOME_CALL}:123` };
    }),
    forgetDirectoryName: vi.fn(() => {
      calls.push("forget");
    }),
  };
  return { d, calls };
}

const KEY = "n:" + "a".repeat(64);
const NUMBER = "+15552223333";

describe("addNumberOptions", () => {
  it("offers the alternate (naming what it replaces) and the primary with Edit profile", () => {
    expect(addNumberOptions(target(WELCOME_CALL), true)).toEqual({
      alternate: { replaces: "(555) 000-9999" },
      primary: true,
      writeRefusal: "",
    });
  });
  it("no Alternate Phone column → primary or link only, and it says why", () => {
    const o = addNumberOptions(target(INSURANCE), true);
    expect(o.alternate).toBeNull();
    expect(o.primary).toBe(true);
    expect(o.writeRefusal).toMatch(/no alternate phone/);
  });
  it("⚠️ no Edit profile → link only", () => {
    const o = addNumberOptions(target(WELCOME_CALL), false);
    expect(o).toMatchObject({ alternate: null, primary: false });
    expect(o.writeRefusal).toMatch(/Edit profile/);
  });
  it("⚠️ a completed record is never written — link only", () => {
    const o = addNumberOptions(target(WELCOME_CALL, { refusal: "completed" }), true);
    expect(o).toMatchObject({ alternate: null, primary: false, writeRefusal: "completed" });
  });
});

describe("addNumberToPatient", () => {
  it("⚠️⚠️ Monday first, then the link, then the name cache", async () => {
    const { d, calls } = deps();
    const out = await addNumberToPatient("alternate", { key: KEY, number: NUMBER, target: target(WELCOME_CALL), name: "Jane Doe" }, d);
    expect(calls).toEqual(["monday", "link", "forget"]);
    expect(out.key).toBe(`p:${WELCOME_CALL}:123`);
    // The alternate writes the Alternate Phone column and NOTHING else.
    expect(d.updatePatientContact).toHaveBeenCalledWith(
      expect.objectContaining({ values: { phone_mm7265hp: { phone: "5552223333", countryShortName: "US" } } }),
    );
    // Anchored on the patient's OWN primary, so the link follows them.
    expect(d.linkNumber).toHaveBeenCalledWith(expect.objectContaining({ anchorNumber: "+15550001111", last4: "3333", key: KEY }));
    expect(d.forgetDirectoryName).toHaveBeenCalledWith("5552223333");
  });

  it("primary: clears Can Text with the number, and the link anchors on the NEW number", async () => {
    const { d } = deps();
    await addNumberToPatient("primary", { key: KEY, number: NUMBER, target: target(WELCOME_CALL), name: "Jane Doe" }, d);
    const values = (d.updatePatientContact as ReturnType<typeof vi.fn>).mock.calls[0][0].values;
    expect(values).toEqual({ phone_mm1x44yk: { phone: "5552223333", countryShortName: "US" }, color_mm72v5q7: {} });
    expect(d.linkNumber).toHaveBeenCalledWith(expect.objectContaining({ anchorNumber: NUMBER }));
  });

  it("⚠️ a failed Monday write links NOTHING", async () => {
    const { d, calls } = deps();
    (d.updatePatientContact as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Monday said no"));
    await expect(
      addNumberToPatient("alternate", { key: KEY, number: NUMBER, target: target(WELCOME_CALL), name: "Jane Doe" }, d),
    ).rejects.toThrow("Monday said no");
    expect(calls).toEqual([]);
  });

  it("⚠️ the refusal is checked BEFORE any write", async () => {
    const { d, calls } = deps();
    await expect(
      addNumberToPatient("alternate", { key: KEY, number: "12345", target: target(WELCOME_CALL), name: "Jane Doe" }, d),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it("link-only writes nothing to Monday", async () => {
    const { d, calls } = deps();
    await addNumberToPatient("link", { key: KEY, number: NUMBER, target: target(INSURANCE), name: "Jane Doe" }, d);
    expect(calls).toEqual(["link", "forget"]);
  });

  it("a board with no alternate column refuses the alternate rather than sending an empty write", async () => {
    const { d, calls } = deps();
    await expect(
      addNumberToPatient("alternate", { key: KEY, number: NUMBER, target: target(INSURANCE), name: "Jane Doe" }, d),
    ).rejects.toThrow(/no column/);
    expect(calls).toEqual([]);
  });

  it("a completed record is refused for a write, even if asked", async () => {
    const { d, calls } = deps();
    await expect(
      addNumberToPatient("primary", { key: KEY, number: NUMBER, target: target(WELCOME_CALL, { refusal: "It's completed." }), name: "J" }, d),
    ).rejects.toThrow("It's completed.");
    expect(calls).toEqual([]);
  });
});
